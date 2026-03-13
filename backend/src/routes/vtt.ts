/**
 * vtt.ts — VTT REST routes
 *
 * These routes handle the persistent state the VTT reads on load and
 * after reconnects. Real-time updates go through Socket.io; these
 * routes are for initial hydration and writes that don't need live broadcast.
 *
 * All routes require auth. DM-only routes additionally check campaign ownership.
 *
 * Mounted at: /api/v1/vtt
 */

import { Router, Request, Response } from 'express';
import { eq, and, isNull, sql }           from 'drizzle-orm';
import { db }                        from '../db';
import {
  sessions, campaigns, campaignCharacters,
  mapTokens, sessionEnemyInstances, canvasShapes, diceLogEntries,
  maps,
} from '../db/schema';
import { requireAuth, requireDM }    from '../middleware/auth';

const router = Router();
router.use(requireAuth);

const param = (p: string | string[]): string => Array.isArray(p) ? p[0] : p;

// ── Helpers ───────────────────────────────────────────────────────────────

/** Verify session exists and user belongs to it (DM or active member) */
async function resolveSession(sessionId: string, userId: string): Promise<{
  session: typeof sessions.$inferSelect;
  campaign: typeof campaigns.$inferSelect;
  isDM: boolean;
} | null> {
  const [session] = await db.select().from(sessions)
    .where(eq(sessions.id, sessionId)).limit(1);
  if (!session) return null;

  const [campaign] = await db.select().from(campaigns)
    .where(eq(campaigns.id, session.campaign_id)).limit(1);
  if (!campaign) return null;

  const isDM = campaign.dm_user_id === userId;
  if (!isDM) {
    const [membership] = await db.select().from(campaignCharacters)
      .where(and(
        eq(campaignCharacters.campaign_id, session.campaign_id),
        eq(campaignCharacters.user_id, userId),
        isNull(campaignCharacters.removed_at),
      )).limit(1);
    if (!membership) return null;
  }
  return { session, campaign, isDM };
}

// ═══════════════════════════════════════════════════════════════════════════
// SESSION
// ═══════════════════════════════════════════════════════════════════════════

// ── GET /vtt/sessions/:id ─────────────────────────────────────────────────
// Full VTT state snapshot on load: session + active map + tokens + shapes
router.get('/sessions/:id', async (req: Request, res: Response): Promise<void> => {
  const userId    = req.user!.user_id;
  const sessionId = param(req.params.id);

  const ctx = await resolveSession(sessionId, userId);
  if (!ctx) { res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Session not found or access denied.', status: 404 } }); return; }

  const { session, isDM } = ctx;

  // Fetch active map
  let activeMap = null;
  if (session.active_map_id) {
    const [map] = await db.select().from(maps).where(eq(maps.id, session.active_map_id)).limit(1);
    activeMap = map ?? null;
  }

  // Fetch tokens on active map
  const tokens = session.active_map_id
    ? await db.select().from(mapTokens)
        .where(and(eq(mapTokens.session_id, sessionId), eq(mapTokens.map_id, session.active_map_id)))
    : [];

  // Fetch enemy instances for this session
  const enemyInstances = await db.select().from(sessionEnemyInstances)
    .where(eq(sessionEnemyInstances.session_id, sessionId));

  // Fetch canvas shapes on active map
  const shapes = session.active_map_id
    ? await db.select().from(canvasShapes)
        .where(and(eq(canvasShapes.session_id, sessionId), eq(canvasShapes.map_id, session.active_map_id)))
    : [];

  // Fetch all maps for this campaign (DM needs the list to switch maps)
  const campaignMaps = isDM
    ? await db.select().from(maps).where(eq(maps.campaign_id, session.campaign_id))
    : [];

  res.json({ session, activeMap, tokens, enemyInstances, shapes, campaignMaps });
});

// ── POST /vtt/sessions/:id/start ──────────────────────────────────────────
// DM only. Flips is_started — players exit waiting screen.
// Socket.io broadcast handled by the caller after this returns.
router.post('/sessions/:id/start', requireDM, async (req: Request, res: Response): Promise<void> => {
  const userId    = req.user!.user_id;
  const sessionId = param(req.params.id);

  const ctx = await resolveSession(sessionId, userId);
  if (!ctx) { res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Session not found.', status: 404 } }); return; }
  if (!ctx.isDM) { res.status(403).json({ error: { code: 'FORBIDDEN', message: 'DM only.', status: 403 } }); return; }

  const [updated] = await db.update(sessions)
    .set({ is_started: true })
    .where(eq(sessions.id, sessionId))
    .returning();

  res.json(updated);
});

// ── PATCH /vtt/sessions/:id/map ───────────────────────────────────────────
// DM only. Switches the active map live.
router.patch('/sessions/:id/map', requireDM, async (req: Request, res: Response): Promise<void> => {
  const userId    = req.user!.user_id;
  const sessionId = param(req.params.id);
  const { map_id } = req.body as { map_id: string };

  const ctx = await resolveSession(sessionId, userId);
  if (!ctx) { res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Session not found.', status: 404 } }); return; }
  if (!ctx.isDM) { res.status(403).json({ error: { code: 'FORBIDDEN', message: 'DM only.', status: 403 } }); return; }

  if (!map_id) { res.status(422).json({ error: { code: 'VALIDATION_ERROR', message: 'map_id is required.', status: 422 } }); return; }

  const [updated] = await db.update(sessions)
    .set({ active_map_id: map_id })
    .where(eq(sessions.id, sessionId))
    .returning();

  res.json(updated);
});

// ═══════════════════════════════════════════════════════════════════════════
// MAPS
// ═══════════════════════════════════════════════════════════════════════════

// ── GET /vtt/campaigns/:campaignId/maps ───────────────────────────────────
router.get('/campaigns/:campaignId/maps', async (req: Request, res: Response): Promise<void> => {
  const userId     = req.user!.user_id;
  const campaignId = param(req.params.campaignId);

  const [campaign] = await db.select().from(campaigns)
    .where(and(eq(campaigns.id, campaignId), isNull(campaigns.deleted_at))).limit(1);
  if (!campaign) { res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Campaign not found.', status: 404 } }); return; }

  const isDM = campaign.dm_user_id === userId;
  if (!isDM) {
    const [membership] = await db.select().from(campaignCharacters)
      .where(and(eq(campaignCharacters.campaign_id, campaignId), eq(campaignCharacters.user_id, userId), isNull(campaignCharacters.removed_at))).limit(1);
    if (!membership) { res.status(403).json({ error: { code: 'FORBIDDEN', message: 'Not part of this campaign.', status: 403 } }); return; }
  }

  const list = await db.select().from(maps).where(eq(maps.campaign_id, campaignId));
  res.json({ data: list });
});

// ── POST /vtt/campaigns/:campaignId/maps/upload-url ──────────────────────
// Step 1: DM requests a presigned PUT URL to upload a map image directly to R2
router.post('/campaigns/:campaignId/maps/upload-url', requireDM, async (req: Request, res: Response): Promise<void> => {
  const userId     = req.user!.user_id;
  const campaignId = param(req.params.campaignId);

  const [campaign] = await db.select().from(campaigns)
    .where(and(eq(campaigns.id, campaignId), isNull(campaigns.deleted_at))).limit(1);
  if (!campaign || campaign.dm_user_id !== userId) { res.status(403).json({ error: { code: 'FORBIDDEN', message: 'Not your campaign.', status: 403 } }); return; }

  const { filename, content_type = 'image/jpeg' } = req.body as { filename: string; content_type?: string };
  if (!filename) { res.status(422).json({ error: { code: 'VALIDATION_ERROR', message: 'filename required.', status: 422 } }); return; }

  const { v4: uuidv4 } = await import('uuid');
  const { getPresignedUploadUrl, getPublicUrl, mapImageKey } = await import('../lib/r2');

  const mapId    = uuidv4();
  const ext      = filename.split('.').pop() ?? 'jpg';
  const key      = mapImageKey(campaignId, mapId, `map.${ext}`);
  const uploadUrl = await getPresignedUploadUrl(key, content_type);
  const publicUrl = getPublicUrl(key);

  res.json({ upload_url: uploadUrl, public_url: publicUrl, map_id: mapId, r2_key: key });
});

// ── POST /vtt/campaigns/:campaignId/maps ──────────────────────────────────
// Step 2: After R2 upload succeeds, register the map in the DB
router.post('/campaigns/:campaignId/maps', requireDM, async (req: Request, res: Response): Promise<void> => {
  const userId     = req.user!.user_id;
  const campaignId = param(req.params.campaignId);

  const [campaign] = await db.select().from(campaigns)
    .where(and(eq(campaigns.id, campaignId), isNull(campaigns.deleted_at))).limit(1);
  if (!campaign) { res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Campaign not found.', status: 404 } }); return; }
  if (campaign.dm_user_id !== userId) { res.status(403).json({ error: { code: 'FORBIDDEN', message: 'Not your campaign.', status: 403 } }); return; }

  const { name, image_url, grid_cell_size = 70, width_cells = 20, height_cells = 20 } = req.body as {
    name: string; image_url: string;
    grid_cell_size?: number; width_cells?: number; height_cells?: number;
  };
  if (!name || !image_url) { res.status(422).json({ error: { code: 'VALIDATION_ERROR', message: 'name and image_url required.', status: 422 } }); return; }

  const [map] = await db.insert(maps).values({ campaign_id: campaignId, name, image_url, grid_cell_size, width_cells, height_cells }).returning();
  res.status(201).json(map);
});

// ── PATCH /vtt/campaigns/:campaignId/maps/:mapId ──────────────────────────
// Update map name, grid_cell_size, width_cells, height_cells
router.patch('/campaigns/:campaignId/maps/:mapId', requireDM, async (req: Request, res: Response): Promise<void> => {
  const userId     = req.user!.user_id;
  const campaignId = param(req.params.campaignId);
  const mapId      = param(req.params.mapId);

  const [campaign] = await db.select().from(campaigns)
    .where(and(eq(campaigns.id, campaignId), isNull(campaigns.deleted_at))).limit(1);
  if (!campaign) { res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Campaign not found.', status: 404 } }); return; }
  if (campaign.dm_user_id !== userId) { res.status(403).json({ error: { code: 'FORBIDDEN', message: 'Not your campaign.', status: 403 } }); return; }

  const { name, grid_cell_size, width_cells, height_cells, feet_per_cell } = req.body as {
    name?: string; grid_cell_size?: number; width_cells?: number; height_cells?: number; feet_per_cell?: number;
  };

  const updates: Record<string, unknown> = {};
  if (name           !== undefined) updates.name           = name;
  if (grid_cell_size !== undefined) updates.grid_cell_size = grid_cell_size;
  if (width_cells    !== undefined) updates.width_cells    = width_cells;
  if (height_cells   !== undefined) updates.height_cells   = height_cells;
  if (feet_per_cell  !== undefined) updates.feet_per_cell  = Math.max(1, feet_per_cell);

  if (Object.keys(updates).length === 0) { res.status(422).json({ error: { code: 'VALIDATION_ERROR', message: 'No fields to update.', status: 422 } }); return; }

  const [updated] = await db.update(maps).set(updates).where(and(eq(maps.id, mapId), eq(maps.campaign_id, campaignId))).returning();
  if (!updated) { res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Map not found.', status: 404 } }); return; }

  res.json(updated);
});

// ── DELETE /vtt/campaigns/:campaignId/maps/:mapId ─────────────────────────
router.delete('/campaigns/:campaignId/maps/:mapId', requireDM, async (req: Request, res: Response): Promise<void> => {
  const userId     = req.user!.user_id;
  const campaignId = param(req.params.campaignId);
  const mapId      = param(req.params.mapId);

  const [campaign] = await db.select().from(campaigns)
    .where(and(eq(campaigns.id, campaignId), isNull(campaigns.deleted_at))).limit(1);
  if (!campaign || campaign.dm_user_id !== userId) { res.status(403).json({ error: { code: 'FORBIDDEN', message: 'Not your campaign.', status: 403 } }); return; }

  await db.delete(maps).where(and(eq(maps.id, mapId), eq(maps.campaign_id, campaignId)));
  res.status(204).send();
});

// ═══════════════════════════════════════════════════════════════════════════
// TOKENS
// ═══════════════════════════════════════════════════════════════════════════

// ── POST /vtt/sessions/:id/tokens ─────────────────────────────────────────
// DM places a token on the current map
router.post('/sessions/:id/tokens', requireDM, async (req: Request, res: Response): Promise<void> => {
  const userId    = req.user!.user_id;
  const sessionId = param(req.params.id);

  const ctx = await resolveSession(sessionId, userId);
  if (!ctx || !ctx.isDM) { res.status(403).json({ error: { code: 'FORBIDDEN', message: 'DM only.', status: 403 } }); return; }
  if (!ctx.session.active_map_id) { res.status(422).json({ error: { code: 'NO_ACTIVE_MAP', message: 'No active map set for this session.', status: 422 } }); return; }

  const { entity_type, entity_id, cell_x = 0, cell_y = 0, label, token_url } = req.body as {
    entity_type: 'character' | 'enemy';
    entity_id:   string;
    cell_x?:     number;
    cell_y?:     number;
    label?:      string;
    token_url?:  string;
  };

  const [token] = await db.insert(mapTokens).values({
    session_id: sessionId,
    map_id:     ctx.session.active_map_id,
    entity_type, entity_id, cell_x, cell_y, label, token_url,
  }).returning();

  res.status(201).json(token);
});

// ── PATCH /vtt/sessions/:id/tokens/:tokenId ───────────────────────────────
// Move or update a token (position, label, token_url, scale, is_hidden, group_id)
router.patch('/sessions/:id/tokens/:tokenId', async (req: Request, res: Response): Promise<void> => {
  const userId    = req.user!.user_id;
  const sessionId = param(req.params.id);
  const tokenId   = param(req.params.tokenId);

  const ctx = await resolveSession(sessionId, userId);
  if (!ctx) { res.status(403).json({ error: { code: 'FORBIDDEN', message: 'Access denied.', status: 403 } }); return; }

  const { cell_x, cell_y, label, token_url, scale, is_hidden, group_id } =
    req.body as Partial<{ cell_x: number; cell_y: number; label: string; token_url: string; scale: number; is_hidden: boolean; group_id: string | null }>;

  // Only DM can hide/show or group tokens
  if ((is_hidden !== undefined || group_id !== undefined) && !ctx.isDM) {
    res.status(403).json({ error: { code: 'FORBIDDEN', message: 'DM only.', status: 403 } }); return;
  }

  const updates: Record<string, unknown> = {};
  if (cell_x     !== undefined) updates.cell_x     = cell_x;
  if (cell_y     !== undefined) updates.cell_y     = cell_y;
  if (label      !== undefined) updates.label      = label;
  if (token_url  !== undefined) updates.token_url  = token_url;
  if (scale      !== undefined) updates.scale      = Math.max(0.25, Math.min(4, scale));
  if (is_hidden  !== undefined) updates.is_hidden  = is_hidden;
  if (group_id   !== undefined) updates.group_id   = group_id; // null = ungroup

  const [updated] = await db.update(mapTokens).set(updates)
    .where(and(eq(mapTokens.id, tokenId), eq(mapTokens.session_id, sessionId)))
    .returning();

  res.json(updated);
});

// ── DELETE /vtt/sessions/:id/tokens/:tokenId ──────────────────────────────
router.delete('/sessions/:id/tokens/:tokenId', requireDM, async (req: Request, res: Response): Promise<void> => {
  const userId    = req.user!.user_id;
  const sessionId = param(req.params.id);
  const tokenId   = param(req.params.tokenId);

  const ctx = await resolveSession(sessionId, userId);
  if (!ctx || !ctx.isDM) { res.status(403).json({ error: { code: 'FORBIDDEN', message: 'DM only.', status: 403 } }); return; }

  await db.delete(mapTokens)
    .where(and(eq(mapTokens.id, tokenId), eq(mapTokens.session_id, sessionId)));
  res.status(204).send();
});

// ═══════════════════════════════════════════════════════════════════════════
// ENEMY INSTANCES
// ═══════════════════════════════════════════════════════════════════════════

// ── POST /vtt/sessions/:id/enemies ───────────────────────────────────────
// DM creates an enemy instance (before or after placing token)
router.post('/sessions/:id/enemies', requireDM, async (req: Request, res: Response): Promise<void> => {
  const userId    = req.user!.user_id;
  const sessionId = param(req.params.id);

  const ctx = await resolveSession(sessionId, userId);
  if (!ctx || !ctx.isDM) { res.status(403).json({ error: { code: 'FORBIDDEN', message: 'DM only.', status: 403 } }); return; }

  const { enemy_id, label, max_hp } = req.body as { enemy_id: string; label: string; max_hp: number };
  if (!enemy_id || !label || !max_hp) { res.status(422).json({ error: { code: 'VALIDATION_ERROR', message: 'enemy_id, label, and max_hp required.', status: 422 } }); return; }

  const [instance] = await db.insert(sessionEnemyInstances).values({
    session_id: sessionId,
    enemy_id,
    label,
    current_hp: BigInt(max_hp),
    max_hp:     BigInt(max_hp),
  }).returning();

  res.status(201).json(instance);
});

// ── PATCH /vtt/sessions/:id/enemies/:instanceId ───────────────────────────
// DM applies damage or healing to an enemy instance
router.patch('/sessions/:id/enemies/:instanceId', requireDM, async (req: Request, res: Response): Promise<void> => {
  const userId     = req.user!.user_id;
  const sessionId  = param(req.params.id);
  const instanceId = param(req.params.instanceId);

  const ctx = await resolveSession(sessionId, userId);
  if (!ctx || !ctx.isDM) { res.status(403).json({ error: { code: 'FORBIDDEN', message: 'DM only.', status: 403 } }); return; }

  const { current_hp, is_defeated } = req.body as { current_hp?: number; is_defeated?: boolean };
  const updates: Record<string, unknown> = {};
  if (current_hp   !== undefined) updates.current_hp   = BigInt(Math.max(0, current_hp));
  if (is_defeated  !== undefined) updates.is_defeated  = is_defeated;

  const [updated] = await db.update(sessionEnemyInstances).set(updates)
    .where(and(eq(sessionEnemyInstances.id, instanceId), eq(sessionEnemyInstances.session_id, sessionId)))
    .returning();

  res.json(updated);
});

// ── DELETE /vtt/sessions/:id/enemies/:instanceId ──────────────────────────
router.delete('/sessions/:id/enemies/:instanceId', requireDM, async (req: Request, res: Response): Promise<void> => {
  const userId     = req.user!.user_id;
  const sessionId  = param(req.params.id);
  const instanceId = param(req.params.instanceId);

  const ctx = await resolveSession(sessionId, userId);
  if (!ctx || !ctx.isDM) { res.status(403).json({ error: { code: 'FORBIDDEN', message: 'DM only.', status: 403 } }); return; }

  // Remove associated tokens too
  await db.delete(mapTokens)
    .where(and(eq(mapTokens.entity_id, instanceId), eq(mapTokens.session_id, sessionId)));
  await db.delete(sessionEnemyInstances)
    .where(and(eq(sessionEnemyInstances.id, instanceId), eq(sessionEnemyInstances.session_id, sessionId)));

  res.status(204).send();
});

// ═══════════════════════════════════════════════════════════════════════════
// CANVAS SHAPES
// ═══════════════════════════════════════════════════════════════════════════

// ── POST /vtt/sessions/:id/shapes ─────────────────────────────────────────
router.post('/sessions/:id/shapes', async (req: Request, res: Response): Promise<void> => {
  const userId    = req.user!.user_id;
  const sessionId = param(req.params.id);

  const ctx = await resolveSession(sessionId, userId);
  if (!ctx) { res.status(403).json({ error: { code: 'FORBIDDEN', message: 'Access denied.', status: 403 } }); return; }
  if (!ctx.session.active_map_id) { res.status(422).json({ error: { code: 'NO_ACTIVE_MAP', message: 'No active map.', status: 422 } }); return; }

  const { shape_type, color = '#ff0000', data } = req.body as { shape_type: string; color?: string; data: Record<string, unknown> };

  const [shape] = await db.insert(canvasShapes).values({
    session_id: sessionId,
    map_id:     ctx.session.active_map_id,
    shape_type, color, data,
    created_by: userId,
  }).returning();

  res.status(201).json(shape);
});

// ── DELETE /vtt/sessions/:id/shapes/:shapeId ──────────────────────────────
router.delete('/sessions/:id/shapes/:shapeId', async (req: Request, res: Response): Promise<void> => {
  const userId    = req.user!.user_id;
  const sessionId = param(req.params.id);
  const shapeId   = param(req.params.shapeId);

  const ctx = await resolveSession(sessionId, userId);
  if (!ctx) { res.status(403).json({ error: { code: 'FORBIDDEN', message: 'Access denied.', status: 403 } }); return; }

  // DM can delete any shape; players can only delete their own
  const [shape] = await db.select().from(canvasShapes)
    .where(and(eq(canvasShapes.id, shapeId), eq(canvasShapes.session_id, sessionId))).limit(1);

  if (!shape) { res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Shape not found.', status: 404 } }); return; }
  if (!ctx.isDM && shape.created_by !== userId) { res.status(403).json({ error: { code: 'FORBIDDEN', message: 'Can only delete your own shapes.', status: 403 } }); return; }

  await db.delete(canvasShapes).where(eq(canvasShapes.id, shapeId));
  res.status(204).send();
});

// ── PATCH /vtt/sessions/:id/shapes/:shapeId ──────────────────────────────
// Update shape geometry (data) or color — used after transform operations
router.patch('/sessions/:id/shapes/:shapeId', async (req: Request, res: Response): Promise<void> => {
  const userId    = req.user!.user_id;
  const sessionId = param(req.params.id);
  const shapeId   = param(req.params.shapeId);

  const ctx = await resolveSession(sessionId, userId);
  if (!ctx) { res.status(403).json({ error: { code: 'FORBIDDEN', message: 'Access denied.', status: 403 } }); return; }

  const [shape] = await db.select().from(canvasShapes)
    .where(and(eq(canvasShapes.id, shapeId), eq(canvasShapes.session_id, sessionId))).limit(1);
  if (!shape) { res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Shape not found.', status: 404 } }); return; }
  if (!ctx.isDM && shape.created_by !== userId) {
    res.status(403).json({ error: { code: 'FORBIDDEN', message: 'Can only edit your own shapes.', status: 403 } }); return;
  }

  const { data, color } = req.body as { data?: Record<string, unknown>; color?: string };
  const updates: Record<string, unknown> = {};
  if (data  !== undefined) updates.data  = data;
  if (color !== undefined) updates.color = color;

  const [updated] = await db.update(canvasShapes).set(updates)
    .where(eq(canvasShapes.id, shapeId))
    .returning();

  res.json(updated);
});


// DM clears all shapes on the active map
router.delete('/sessions/:id/shapes', requireDM, async (req: Request, res: Response): Promise<void> => {
  const userId    = req.user!.user_id;
  const sessionId = param(req.params.id);

  const ctx = await resolveSession(sessionId, userId);
  if (!ctx || !ctx.isDM) { res.status(403).json({ error: { code: 'FORBIDDEN', message: 'DM only.', status: 403 } }); return; }
  if (!ctx.session.active_map_id) { res.status(204).send(); return; }

  await db.delete(canvasShapes)
    .where(and(eq(canvasShapes.session_id, sessionId), eq(canvasShapes.map_id, ctx.session.active_map_id)));
  res.status(204).send();
});

// ═══════════════════════════════════════════════════════════════════════════
// DICE LOG
// ═══════════════════════════════════════════════════════════════════════════

// ── GET /vtt/sessions/:id/dice-log ────────────────────────────────────────
// Returns entries visible to the requesting user:
// - DM sees everything
// - Player sees: public + their own private/dm rolls
router.get('/sessions/:id/dice-log', async (req: Request, res: Response): Promise<void> => {
  const userId    = req.user!.user_id;
  const sessionId = param(req.params.id);

  const ctx = await resolveSession(sessionId, userId);
  if (!ctx) { res.status(403).json({ error: { code: 'FORBIDDEN', message: 'Access denied.', status: 403 } }); return; }

  const all = await db.select().from(diceLogEntries)
    .where(eq(diceLogEntries.session_id, sessionId));

  const visible = ctx.isDM
    ? all
    : all.filter(e =>
        e.visibility === 'public' ||
        (e.visibility !== 'public' && e.roller_id === userId)
      );

  res.json({ data: visible });
});

// ── POST /vtt/sessions/:id/dice-log ───────────────────────────────────────
// Persist a dice roll result (called after Socket.io broadcast)
router.post('/sessions/:id/dice-log', async (req: Request, res: Response): Promise<void> => {
  const userId    = req.user!.user_id;
  const sessionId = param(req.params.id);

  const ctx = await resolveSession(sessionId, userId);
  if (!ctx) { res.status(403).json({ error: { code: 'FORBIDDEN', message: 'Access denied.', status: 403 } }); return; }

  const { formula, results, total, label = '', visibility = 'public', source_label } = req.body as {
    formula:       string;
    results:       number[];
    total:         number;
    label?:        string;
    visibility?:   'public' | 'private' | 'dm';
    source_label?: string;
  };

  const [entry] = await db.insert(diceLogEntries).values({
    session_id: sessionId,
    roller_id:  userId,
    formula, results, total, label, visibility,
    source_label: source_label ?? null,
  }).returning();

  res.status(201).json(entry);
});

// ═══════════════════════════════════════════════════════════════════════════
// FOG OF WAR
// ═══════════════════════════════════════════════════════════════════════════

// ── POST /vtt/sessions/:id/fog ────────────────────────────────────────────
// DM updates fog cells in bulk. cells: [{ x, y, revealed }]
router.post('/sessions/:id/fog', requireDM, async (req: Request, res: Response): Promise<void> => {
  const userId    = req.user!.user_id;
  const sessionId = param(req.params.id);

  const ctx = await resolveSession(sessionId, userId);
  if (!ctx || !ctx.isDM) { res.status(403).json({ error: { code: 'FORBIDDEN', message: 'DM only.', status: 403 } }); return; }
  if (!ctx.session.active_map_id) { res.status(422).json({ error: { code: 'NO_ACTIVE_MAP', message: 'No active map.', status: 422 } }); return; }

  const { cells } = req.body as { cells: Array<{ x: number; y: number; revealed: boolean }> };
  if (!cells?.length) { res.status(422).json({ error: { code: 'VALIDATION_ERROR', message: 'cells array required.', status: 422 } }); return; }

  const { mapFogCells } = await import('../db/schema');
  const mapId = ctx.session.active_map_id;

  // Upsert each cell
  for (const cell of cells) {
    await db.insert(mapFogCells)
      .values({ map_id: mapId, cell_x: cell.x, cell_y: cell.y, is_revealed: cell.revealed })
      .onConflictDoUpdate({
        target: [mapFogCells.map_id, mapFogCells.cell_x, mapFogCells.cell_y],
        set:    { is_revealed: cell.revealed },
      });
  }

  res.json({ updated: cells.length });
});

// ── GET /vtt/sessions/:id/fog ─────────────────────────────────────────────
router.get('/sessions/:id/fog', async (req: Request, res: Response): Promise<void> => {
  const userId    = req.user!.user_id;
  const sessionId = param(req.params.id);

  const ctx = await resolveSession(sessionId, userId);
  if (!ctx) { res.status(403).json({ error: { code: 'FORBIDDEN', message: 'Access denied.', status: 403 } }); return; }
  if (!ctx.session.active_map_id) { res.json({ data: [] }); return; }

  const { mapFogCells } = await import('../db/schema');
  const cells = await db.select().from(mapFogCells)
    .where(eq(mapFogCells.map_id, ctx.session.active_map_id));

  res.json({ data: cells });
});

// FOG SECTIONS
// ═══════════════════════════════════════════════════════════════════════════

// ── GET /vtt/sessions/:id/fog-sections ───────────────────────────────────
router.get('/sessions/:id/fog-sections', async (req: Request, res: Response): Promise<void> => {
  const userId    = req.user!.user_id;
  const sessionId = param(req.params.id);
  const ctx = await resolveSession(sessionId, userId);
  if (!ctx) { res.status(403).json({ error: { code: 'FORBIDDEN', message: 'Access denied.', status: 403 } }); return; }
  if (!ctx.session.active_map_id) { res.json({ data: [] }); return; }
  const { fogSections } = await import('../db/schema');
  const sections = await db.select().from(fogSections).where(eq(fogSections.map_id, ctx.session.active_map_id));
  res.json({ data: sections });
});

// ── POST /vtt/sessions/:id/fog-sections ──────────────────────────────────
router.post('/sessions/:id/fog-sections', requireDM, async (req: Request, res: Response): Promise<void> => {
  const userId    = req.user!.user_id;
  const sessionId = param(req.params.id);
  const ctx = await resolveSession(sessionId, userId);
  if (!ctx || !ctx.isDM) { res.status(403).json({ error: { code: 'FORBIDDEN', message: 'DM only.', status: 403 } }); return; }
  if (!ctx.session.active_map_id) { res.status(422).json({ error: { code: 'NO_ACTIVE_MAP', message: 'No active map.', status: 422 } }); return; }

  const { name, cells } = req.body as { name: string; cells: Array<{ x: number; y: number }> };
  const { fogSections } = await import('../db/schema');
  const [section] = await db.insert(fogSections).values({
    map_id: ctx.session.active_map_id,
    name:   name ?? 'Section',
    cells:  cells ?? [],
    is_hidden: false,
  }).returning();

  const ns = req.app.get('io') as import('socket.io').Server;
  ns.to(`session:${sessionId}`).emit('fog_section:created', { section });
  res.json(section);
});

// ── PATCH /vtt/sessions/:id/fog-sections/:sectionId ──────────────────────
router.patch('/sessions/:id/fog-sections/:sectionId', requireDM, async (req: Request, res: Response): Promise<void> => {
  const userId    = req.user!.user_id;
  const sessionId = param(req.params.id);
  const sectionId = param(req.params.sectionId);
  const ctx = await resolveSession(sessionId, userId);
  if (!ctx || !ctx.isDM) { res.status(403).json({ error: { code: 'FORBIDDEN', message: 'DM only.', status: 403 } }); return; }

  const { name, is_hidden, cells } = req.body as { name?: string; is_hidden?: boolean; cells?: Array<{x:number;y:number}> };
  const { fogSections } = await import('../db/schema');
  const updates: Record<string, unknown> = {};
  if (name      !== undefined) updates.name      = name;
  if (is_hidden !== undefined) updates.is_hidden = is_hidden;
  if (cells     !== undefined) updates.cells     = cells;

  const [updated] = await db.update(fogSections).set(updates)
    .where(eq(fogSections.id, sectionId)).returning();
  if (!updated) { res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Section not found.', status: 404 } }); return; }

  const ns = req.app.get('io') as import('socket.io').Server;
  ns.to(`session:${sessionId}`).emit('fog_section:updated', { section: updated });
  res.json(updated);
});

// ── DELETE /vtt/sessions/:id/fog-sections/:sectionId ─────────────────────
router.delete('/sessions/:id/fog-sections/:sectionId', requireDM, async (req: Request, res: Response): Promise<void> => {
  const userId    = req.user!.user_id;
  const sessionId = param(req.params.id);
  const sectionId = param(req.params.sectionId);
  const ctx = await resolveSession(sessionId, userId);
  if (!ctx || !ctx.isDM) { res.status(403).json({ error: { code: 'FORBIDDEN', message: 'DM only.', status: 403 } }); return; }

  const { fogSections } = await import('../db/schema');
  await db.delete(fogSections).where(eq(fogSections.id, sectionId));

  const ns = req.app.get('io') as import('socket.io').Server;
  ns.to(`session:${sessionId}`).emit('fog_section:deleted', { section_id: sectionId });
  res.json({ deleted: true });
});

// ENCOUNTERS — add enemy to encounter from map
// ═══════════════════════════════════════════════════════════════════════════

// ── POST /vtt/sessions/:id/encounters/add-enemy ───────────────────────────
// DM clicks a token on the map and adds that enemy_instance to the current
// (or a newly-created) encounter.
router.post('/sessions/:id/encounters/add-enemy', requireDM, async (req: Request, res: Response): Promise<void> => {
  const userId    = req.user!.user_id;
  const sessionId = param(req.params.id);
  const ctx = await resolveSession(sessionId, userId);
  if (!ctx || !ctx.isDM) { res.status(403).json({ error: { code: 'FORBIDDEN', message: 'DM only.', status: 403 } }); return; }

  const { enemy_instance_id, encounter_id } = req.body as { enemy_instance_id: string; encounter_id?: string };
  if (!enemy_instance_id) { res.status(422).json({ error: { code: 'VALIDATION_ERROR', message: 'enemy_instance_id required.', status: 422 } }); return; }

  const { combatEncounters, combatParticipants, sessionEnemyInstances } = await import('../db/schema');

  // Verify enemy instance belongs to this session
  const [inst] = await db.select().from(sessionEnemyInstances).where(eq(sessionEnemyInstances.id, enemy_instance_id)).limit(1);
  if (!inst) { res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Enemy instance not found.', status: 404 } }); return; }

  let encounterId = encounter_id;
  if (!encounterId) {
    // Use most recent pending/active encounter, or create one
    const [existing] = await db.select().from(combatEncounters)
      .where(and(eq(combatEncounters.session_id, sessionId), sql`status != 'ended'`))
      .orderBy(sql`created_at desc`).limit(1);
    if (existing) {
      encounterId = existing.id;
    } else {
      const [newEnc] = await db.insert(combatEncounters).values({
        session_id: sessionId, name: 'Encounter', status: 'pending',
      }).returning();
      encounterId = newEnc.id;
    }
  }

  // Add participant (idempotent — skip if already in encounter)
  const [existing] = await db.select().from(combatParticipants)
    .where(and(eq(combatParticipants.encounter_id, encounterId!), eq(combatParticipants.enemy_instance_id as any, enemy_instance_id)))
    .limit(1);

  if (!existing) {
    await db.insert(combatParticipants).values({
      encounter_id:      encounterId!,
      participant_type:  'enemy_instance',
      enemy_instance_id: enemy_instance_id,
      current_hp:        inst.current_hp,
      max_hp_snapshot:   inst.max_hp,
    });
  }

  res.json({ encounter_id: encounterId, added: !existing });
});

export default router;