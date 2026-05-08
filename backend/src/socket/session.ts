/**
 * socket/session.ts — Socket.io session namespace
 *
 * Namespace:  /session
 * Auth:       access_token in handshake.auth
 * Room:       session:{session_id}
 * DM room:    session:{session_id}:dm
 * OBS room:   obs:{campaign_id}:{source_type}
 */

import { Server, Socket }        from 'socket.io';
import { verifyAccessToken }     from '../lib/jwt';
import { db }                    from '../db';
import {
  sessions, campaigns, campaignCharacters,
  mapTokens, sessionEnemyInstances, canvasShapes, diceLogEntries, maps, fogSections,
} from '../db/schema';
import { eq, and, isNull }       from 'drizzle-orm';
import { rollDiceAuthoritative } from '../lib/sessionDiceRoll';

const isJsonColumnInputError = (err: unknown): boolean => {
  const code = (err as { code?: string } | null)?.code;
  return code === '22P02';
};

const persistFogSectionImage = async (sectionId: string, imageData: string): Promise<void> => {
  try {
    await db.update(fogSections).set({ image_data: imageData }).where(eq(fogSections.id, sectionId));
  } catch (err) {
    // Some local DBs still have fog_sections.image_data as json/jsonb from older migrations.
    // Retry with JSON-encoded text to stay compatible until schema is normalized.
    if (!isJsonColumnInputError(err)) throw err;
    await db
      .update(fogSections)
      .set({ image_data: JSON.stringify(imageData) as unknown as string })
      .where(eq(fogSections.id, sectionId));
  }
};

export const registerSessionNamespace = (io: Server): void => {
  const ns = io.of('/session');

  ns.use((socket, next) => {
    const token = socket.handshake.auth?.token as string | undefined;
    if (!token) return next(new Error('UNAUTHORIZED'));
    try {
      socket.data.user = verifyAccessToken(token);
      next();
    } catch {
      next(new Error('TOKEN_INVALID'));
    }
  });

  ns.on('connection', (socket: Socket) => {
    const userId = socket.data.user?.user_id as string;

    // ── session:join ─────────────────────────────────────────────────
    socket.on('session:join', async ({ session_id, character_id }: {
      session_id: string; character_id?: string;
    }) => {
      try {
        const [sess] = await db.select().from(sessions).where(eq(sessions.id, session_id)).limit(1);
        if (!sess) { socket.emit('session:error', { code: 'NOT_FOUND' }); return; }

        const [campaign] = await db.select().from(campaigns).where(eq(campaigns.id, sess.campaign_id)).limit(1);
        if (!campaign) { socket.emit('session:error', { code: 'NOT_FOUND' }); return; }

        const isDM = campaign.dm_user_id === userId;
        if (!isDM) {
          const [membership] = await db.select().from(campaignCharacters)
            .where(and(
              eq(campaignCharacters.campaign_id, sess.campaign_id),
              eq(campaignCharacters.user_id, userId),
              isNull(campaignCharacters.removed_at),
            )).limit(1);
          if (!membership) { socket.emit('session:error', { code: 'FORBIDDEN' }); return; }
        }

        const room = `session:${session_id}`;
        await socket.join(room);
        socket.data.session_id   = session_id;
        socket.data.campaign_id  = sess.campaign_id;
        socket.data.character_id = character_id;
        socket.data.is_dm        = isDM;
        if (isDM) await socket.join(`${room}:dm`);

        const activeMap = sess.active_map_id
          ? (await db.select().from(maps).where(eq(maps.id, sess.active_map_id)).limit(1))[0] ?? null
          : null;

        const tokens = sess.active_map_id
          ? await db.select().from(mapTokens).where(and(eq(mapTokens.session_id, session_id), eq(mapTokens.map_id, sess.active_map_id)))
          : [];

        const enemyInst = await db.select().from(sessionEnemyInstances).where(eq(sessionEnemyInstances.session_id, session_id));

        const shapes = sess.active_map_id
          ? await db.select().from(canvasShapes).where(and(eq(canvasShapes.session_id, session_id), eq(canvasShapes.map_id, sess.active_map_id)))
          : [];

        const fogSectionsList = activeMap
          ? await db.select().from(fogSections).where(eq(fogSections.map_id, activeMap.id))
          : [];

        const allDice = await db.select().from(diceLogEntries).where(eq(diceLogEntries.session_id, session_id));
        const diceLog = isDM ? allDice : allDice.filter(e => e.visibility === 'public' || e.roller_id === userId);

        const campaignMaps = isDM ? await db.select().from(maps).where(eq(maps.campaign_id, sess.campaign_id)) : [];

        socket.emit('session:state', { session: sess, activeMap, tokens, enemyInstances: enemyInst, shapes, fogCells: [], fogSections: fogSectionsList, diceLog, campaignMaps, isDM });
        socket.to(room).emit('session:user_joined', { user_id: userId, character_id, is_dm: isDM });
        console.log(`[socket] ${isDM ? 'DM' : 'Player'} joined session ${session_id}: ${userId}`);
      } catch (err) {
        console.error('[socket] session:join error:', err);
        socket.emit('session:error', { code: 'INTERNAL_ERROR' });
      }
    });

    // ── session:start ─────────────────────────────────────────────────
    socket.on('session:start', async () => {
      if (!socket.data.is_dm) return;
      const session_id = socket.data.session_id as string;
      try {
        const [updated] = await db.update(sessions).set({ is_started: true }).where(eq(sessions.id, session_id)).returning();
        ns.to(`session:${session_id}`).emit('session:started', { session: updated });
        console.log(`[socket] Session started: ${session_id}`);
      } catch (err) { console.error('[socket] session:start error:', err); }
    });

    // ── session:map_change ────────────────────────────────────────────
    socket.on('session:map_change', async ({ map_id }: { map_id: string }) => {
      if (!socket.data.is_dm) return;
      const session_id = socket.data.session_id as string;
      try {
        const [map] = await db.select().from(maps).where(eq(maps.id, map_id)).limit(1);
        if (!map) return;
        await db.update(sessions).set({ active_map_id: map_id }).where(eq(sessions.id, session_id));
        const tokens          = await db.select().from(mapTokens).where(and(eq(mapTokens.session_id, session_id), eq(mapTokens.map_id, map_id)));
        const shapes          = await db.select().from(canvasShapes).where(and(eq(canvasShapes.session_id, session_id), eq(canvasShapes.map_id, map_id)));
        const fogSectionsList = await db.select().from(fogSections).where(eq(fogSections.map_id, map_id));
        ns.to(`session:${session_id}`).emit('session:map_changed', { map, tokens, shapes, fogCells: [], fogSections: fogSectionsList });
      } catch (err) { console.error('[socket] session:map_change error:', err); }
    });

    // ── token:move ────────────────────────────────────────────────────
    socket.on('token:move', async ({ token_id, cell_x, cell_y }: { token_id: string; cell_x: number; cell_y: number }) => {
      try {
        await db.update(mapTokens).set({ cell_x, cell_y }).where(eq(mapTokens.id, token_id));
        socket.to(`session:${socket.data.session_id}`).emit('token:moved', { token_id, cell_x, cell_y, moved_by: userId });
      } catch (err) { console.error('[socket] token:move error:', err); }
    });

    // ── token:placed / token:removed ──────────────────────────────────
    socket.on('token:placed', (token: Record<string, unknown>) => {
      if (!socket.data.is_dm) return;
      socket.to(`session:${socket.data.session_id}`).emit('token:placed', token);
    });
    socket.on('token:removed', ({ token_id }: { token_id: string }) => {
      if (!socket.data.is_dm) return;
      socket.to(`session:${socket.data.session_id}`).emit('token:removed', { token_id });
    });

    // ── enemy:hp_update ───────────────────────────────────────────────
    socket.on('enemy:hp_update', async ({ instance_id, current_hp, is_defeated }: { instance_id: string; current_hp: number; is_defeated?: boolean }) => {
      if (!socket.data.is_dm) return;
      try {
        const updates: Record<string, unknown> = { current_hp: BigInt(Math.max(0, current_hp)) };
        if (is_defeated !== undefined) updates.is_defeated = is_defeated;
        await db.update(sessionEnemyInstances).set(updates).where(eq(sessionEnemyInstances.id, instance_id));
        ns.to(`session:${socket.data.session_id}`).emit('enemy:hp_updated', { instance_id, current_hp, is_defeated });
      } catch (err) { console.error('[socket] enemy:hp_update error:', err); }
    });

    // ── fog:section_image ─────────────────────────────────────────────
    // DM saves the pixel-precise fog PNG for a specific layer on pointer-up.
    socket.on('fog:section_image', async ({ section_id, image_data }: { section_id: string; image_data: string }) => {
      if (!socket.data.is_dm) return;
      const sid = socket.data.session_id as string;
      if (!sid) return;
      try {
        await persistFogSectionImage(section_id, image_data);
        socket.to(`session:${sid}`).emit('fog_section:image_updated', { section_id, image_data });
      } catch (err) { console.error('[socket] fog:section_image error:', err); }
    });

    // ── shapes ────────────────────────────────────────────────────────
    socket.on('shape:add',       (shape: Record<string, unknown>) => {
      socket.to(`session:${socket.data.session_id}`).emit('shape:added', shape);
    });
    socket.on('shape:remove',    ({ shape_id }: { shape_id: string }) => {
      socket.to(`session:${socket.data.session_id}`).emit('shape:removed', { shape_id });
    });
    socket.on('shape:clear_all', () => {
      if (!socket.data.is_dm) return;
      socket.to(`session:${socket.data.session_id}`).emit('shape:all_cleared');
    });

    // ── ruler ──────────────────────────────────────────────────────────
    // Never persisted — purely visual sync
    socket.on('ruler:update', ({ start, end }: { start: { x: number; y: number }; end: { x: number; y: number } }) => {
      socket.to(`session:${socket.data.session_id}`).emit('ruler:updated', { user_id: userId, start, end });
    });
    socket.on('ruler:clear', () => {
      socket.to(`session:${socket.data.session_id}`).emit('ruler:cleared', { user_id: userId });
    });

    // ── dice:roll_start (no DB) — all clients can show a synchronized “rolling” state
    // before dice:roll arrives with the authoritative faces.
    socket.on('dice:roll_start', (payload: {
      roll_id: string; physics_notation: string; label: string; visibility: 'public' | 'private' | 'dm';
      source_label?: string;
    }) => {
      const session_id  = socket.data.session_id as string;
      const campaign_id = socket.data.campaign_id as string;
      const room        = `session:${session_id}`;
      if (!payload?.roll_id || !payload?.physics_notation) return;
      const broadcast = {
        roller_id:    userId,
        roll_id:      payload.roll_id,
        physics_notation: payload.physics_notation.trim(),
        label:        payload.label,
        visibility:   payload.visibility,
        source_label: payload.source_label ?? null,
      };
      if (payload.visibility === 'public') {
        ns.to(room).emit('dice:roll_start', broadcast);
        ns.to(`obs:${campaign_id}:dice_log`).emit('dice:roll_start', broadcast);
      } else if (payload.visibility === 'dm') {
        socket.emit('dice:roll_start', broadcast);
        if (!socket.data.is_dm) socket.to(`${room}:dm`).emit('dice:roll_start', broadcast);
      } else {
        socket.emit('dice:roll_start', broadcast);
      }
    });

    // ── dice:roll ──────────────────────────────────────────────────────
    // Client 3D dice (physics) submits faces; or `authority: 'server'` rolls here with crypto RNG.
    socket.on('dice:roll', async (payload: {
      authority?: 'server';
      formula: string;
      label: string;
      visibility: 'public' | 'private' | 'dm';
      results?: number[];
      total?: number;
      source_label?: string;
      animation_spec?: Array<{ sides: number; value: number }>;
      physics_notation?: string;
      roll_id?: string;
      modifier?: number;
      postMultiplier?: number;
      advantageKeep?: 'high' | 'low';
      /** Echoed on `dice:result` only (not persisted) — correlates client-sheet UI with the roll. */
      request_meta?: unknown;
    }) => {
      const session_id  = socket.data.session_id as string;
      const campaign_id = socket.data.campaign_id as string;
      const room        = `session:${session_id}`;

      let formulaOut: string;
      let resultsOut: number[];
      let totalOut: number;
      let animation_server: Array<{ sides: number; value: number }> | undefined;
      let physics_server: string | undefined;

      if (payload.authority === 'server') {
        try {
          const rolled = rollDiceAuthoritative({
            diceExpr: typeof payload.formula === 'string' ? payload.formula : '',
            modifier: payload.modifier,
            postMultiplier: payload.postMultiplier,
            advantageKeep: payload.advantageKeep,
          });
          formulaOut = rolled.formula;
          resultsOut = rolled.results;
          totalOut = rolled.total;
          animation_server = rolled.animation_spec;
          physics_server = rolled.physics_notation;
        } catch (err) {
          console.error('[socket] dice:roll server authority error:', err);
          socket.emit('dice:error', { message: 'Invalid dice roll request.' });
          return;
        }
      } else {
        if (!Array.isArray(payload.results) || typeof payload.total !== 'number') return;
        formulaOut = payload.formula;
        resultsOut = payload.results;
        totalOut = payload.total;
        animation_server = Array.isArray(payload.animation_spec) ? payload.animation_spec : undefined;
        physics_server =
          typeof payload.physics_notation === 'string' && payload.physics_notation.trim()
            ? payload.physics_notation.trim()
            : undefined;
      }

      const row = {
        roller_id:    userId,
        formula:      formulaOut,
        results:      resultsOut,
        total:        totalOut,
        label:        payload.label,
        visibility:   payload.visibility,
        source_label: payload.source_label ?? null,
      };

      try { await db.insert(diceLogEntries).values({ session_id, ...row }); }
      catch (err) { console.error('[socket] dice:roll persist error:', err); }

      const extras: Record<string, unknown> = {};
      if (animation_server?.length) extras.animation_spec = animation_server;
      if (physics_server) extras.physics_notation = physics_server;
      const roll_id = typeof payload.roll_id === 'string' && payload.roll_id.trim() ? payload.roll_id.trim() : undefined;
      if (roll_id) extras.roll_id = roll_id;
      if (payload.request_meta !== undefined) extras.request_meta = payload.request_meta;
      const broadcastEntry = Object.keys(extras).length ? { ...row, ...extras } : row;

      if (payload.visibility === 'public') {
        ns.to(room).emit('dice:result', broadcastEntry);
        ns.to(`obs:${campaign_id}:dice_log`).emit('dice:result', broadcastEntry);
      } else if (payload.visibility === 'dm') {
        socket.emit('dice:result', broadcastEntry);
        if (!socket.data.is_dm) socket.to(`${room}:dm`).emit('dice:result', broadcastEntry);
      } else {
        socket.emit('dice:result', broadcastEntry);
      }
    });

    // ── attack:rolled ──────────────────────────────────────────────────
    // Stat block roll with source context. Same visibility rules as dice:roll.
    socket.on('attack:rolled', async (payload: {
      source_label: string; formula: string; results: number[]; total: number;
      damage_type?: string; visibility: 'public' | 'dm';
    }) => {
      const session_id  = socket.data.session_id as string;
      const campaign_id = socket.data.campaign_id as string;
      const room        = `session:${session_id}`;
      const label       = payload.damage_type ? `${payload.source_label} (${payload.damage_type})` : payload.source_label;
      const entry       = { roller_id: userId, formula: payload.formula, results: payload.results, total: payload.total, label, visibility: payload.visibility, source_label: payload.source_label };

      try { await db.insert(diceLogEntries).values({ session_id, ...entry }); }
      catch (err) { console.error('[socket] attack:rolled persist error:', err); }

      if (payload.visibility === 'public') {
        ns.to(room).emit('dice:result', entry);
        ns.to(`obs:${campaign_id}:dice_log`).emit('dice:result', entry);
      } else {
        socket.emit('dice:result', entry);
        if (!socket.data.is_dm) socket.to(`${room}:dm`).emit('dice:result', entry);
      }
    });

    // ── obs:join ───────────────────────────────────────────────────────
    socket.on('obs:join', ({ campaign_id, source_type }: { campaign_id: string; source_type: string }) => {
      socket.join(`obs:${campaign_id}:${source_type}`);
    });

    // ── disconnect ─────────────────────────────────────────────────────
    socket.on('disconnect', () => {
      socket.to(`session:${socket.data.session_id}`).emit('session:user_left', { user_id: userId, is_dm: socket.data.is_dm });
      console.log(`[socket] Disconnected: ${userId}`);
    });
  });
};