/**
 * sessions.ts — Auto-managed VTT session routes
 *
 * Sessions are not named by users. They are created automatically when a DM
 * launches the VTT and end automatically after 30 minutes of inactivity.
 *
 * Routes:
 *   POST /sessions/campaigns/:id/launch  — DM launches VTT (create or resume)
 *   POST /sessions/:id/heartbeat         — Client activity ping (DM + players)
 *   GET  /sessions/:id                   — Session status check
 *   POST /sessions/:id/end               — DM explicitly ends session
 */

import { Router, Request, Response } from 'express';
import { eq, and, isNull }           from 'drizzle-orm';
import { db }                        from '../db';
import { sessions, campaigns, campaignCharacters } from '../db/schema';
import { requireAuth, requireDM }    from '../middleware/auth';

const router = Router();
router.use(requireAuth);

const param = (p: string | string[]): string => (Array.isArray(p) ? p[0] : p);

const INACTIVITY_MS = 30 * 60 * 1000; // 30 minutes

/** Auto-generate a session label from the current date */
const sessionLabel = (): string => {
  const d = new Date();
  return `Session — ${d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`;
};

/** Check if a session has been inactive long enough to be considered ended */
const isStale = (lastActivity: Date): boolean =>
  Date.now() - lastActivity.getTime() > INACTIVITY_MS;

/** Lazily expire stale active sessions for a campaign, return their IDs */
const expireStale = async (campaignId: string): Promise<void> => {
  const active = await db
    .select()
    .from(sessions)
    .where(and(eq(sessions.campaign_id, campaignId), eq(sessions.status, 'active')));

  for (const s of active) {
    if (isStale(s.last_activity_at)) {
      await db
        .update(sessions)
        .set({ status: 'ended', ended_at: new Date() })
        .where(eq(sessions.id, s.id));
    }
  }
};

// ── POST /sessions/campaigns/:campaignId/launch ───────────────────────────
// DM only. Creates a new active session, or resumes an existing one if
// it was started in the last 30 minutes. Lazily expires stale sessions.
router.post('/campaigns/:campaignId/launch', requireDM, async (req: Request, res: Response): Promise<void> => {
  const userId     = req.user!.user_id;
  const campaignId = param(req.params.campaignId);

  // Verify DM owns this campaign
  const [campaign] = await db
    .select()
    .from(campaigns)
    .where(and(eq(campaigns.id, campaignId), isNull(campaigns.deleted_at)))
    .limit(1);

  if (!campaign) {
    res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Campaign not found.', status: 404 } });
    return;
  }
  if (campaign.dm_user_id !== userId) {
    res.status(403).json({ error: { code: 'FORBIDDEN', message: 'Only the DM can launch a session.', status: 403 } });
    return;
  }

  // Expire any stale active sessions for this campaign
  await expireStale(campaignId);

  // Check for an existing live session
  const [existing] = await db
    .select()
    .from(sessions)
    .where(and(eq(sessions.campaign_id, campaignId), eq(sessions.status, 'active')))
    .limit(1);

  if (existing) {
    // Resume — bump last_activity_at
    const [resumed] = await db
      .update(sessions)
      .set({ last_activity_at: new Date() })
      .where(eq(sessions.id, existing.id))
      .returning();
    res.json({ session: resumed, resumed: true });
    return;
  }

  // Create a fresh session
  const [session] = await db
    .insert(sessions)
    .values({
      campaign_id:      campaignId,
      name:             sessionLabel(),
      status:           'active',
      started_at:       new Date(),
      last_activity_at: new Date(),
    })
    .returning();

  res.status(201).json({ session, resumed: false });
});

// ── POST /sessions/:id/heartbeat ──────────────────────────────────────────
// Called by the VTT client (DM and players) every ~2 minutes while the tab
// is open. Keeps the session alive. If the session has already been marked
// ended (e.g. by the DM or by stale expiry), returns 410 so the client can
// show a "session ended" banner.
router.post('/:id/heartbeat', async (req: Request, res: Response): Promise<void> => {
  const sessionId = param(req.params.id);

  const [session] = await db
    .select()
    .from(sessions)
    .where(eq(sessions.id, sessionId))
    .limit(1);

  if (!session) {
    res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Session not found.', status: 404 } });
    return;
  }

  if (session.status === 'ended') {
    res.status(410).json({ error: { code: 'SESSION_ENDED', message: 'This session has ended.', status: 410 } });
    return;
  }

  // Check for stale — someone may have stopped sending heartbeats then resumed
  if (isStale(session.last_activity_at) && session.status === 'active') {
    await db
      .update(sessions)
      .set({ status: 'ended', ended_at: new Date() })
      .where(eq(sessions.id, sessionId));
    res.status(410).json({ error: { code: 'SESSION_ENDED', message: 'Session ended due to inactivity.', status: 410 } });
    return;
  }

  const [updated] = await db
    .update(sessions)
    .set({ last_activity_at: new Date() })
    .where(eq(sessions.id, sessionId))
    .returning();

  res.json({ session: updated });
});

// ── GET /sessions/:id ─────────────────────────────────────────────────────
// Returns session status. Used by the VTT on load to confirm the session
// is still active before rendering. Also checks campaign membership.
router.get('/:id', async (req: Request, res: Response): Promise<void> => {
  const userId    = req.user!.user_id;
  const sessionId = param(req.params.id);

  const [session] = await db
    .select()
    .from(sessions)
    .where(eq(sessions.id, sessionId))
    .limit(1);

  if (!session) {
    res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Session not found.', status: 404 } });
    return;
  }

  // Verify user belongs to this campaign (DM or active member)
  const [campaign] = await db
    .select()
    .from(campaigns)
    .where(eq(campaigns.id, session.campaign_id))
    .limit(1);

  const isOwner = campaign?.dm_user_id === userId;

  if (!isOwner) {
    const [membership] = await db
      .select()
      .from(campaignCharacters)
      .where(
        and(
          eq(campaignCharacters.campaign_id, session.campaign_id),
          eq(campaignCharacters.user_id, userId),
          isNull(campaignCharacters.removed_at),
        ),
      )
      .limit(1);

    if (!membership) {
      res.status(403).json({ error: { code: 'FORBIDDEN', message: 'You are not part of this campaign.', status: 403 } });
      return;
    }
  }

  // Lazy stale check on read
  if (session.status === 'active' && isStale(session.last_activity_at)) {
    const [ended] = await db
      .update(sessions)
      .set({ status: 'ended', ended_at: new Date() })
      .where(eq(sessions.id, sessionId))
      .returning();
    res.json(ended);
    return;
  }

  res.json(session);
});

// ── POST /sessions/:id/end ────────────────────────────────────────────────
// DM explicitly ends a session early.
router.post('/:id/end', requireDM, async (req: Request, res: Response): Promise<void> => {
  const userId    = req.user!.user_id;
  const sessionId = param(req.params.id);

  const [session] = await db
    .select()
    .from(sessions)
    .where(eq(sessions.id, sessionId))
    .limit(1);

  if (!session) {
    res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Session not found.', status: 404 } });
    return;
  }

  // Verify ownership via campaign
  const [campaign] = await db
    .select()
    .from(campaigns)
    .where(eq(campaigns.id, session.campaign_id))
    .limit(1);

  if (campaign?.dm_user_id !== userId) {
    res.status(403).json({ error: { code: 'FORBIDDEN', message: 'Only the DM can end a session.', status: 403 } });
    return;
  }

  const [ended] = await db
    .update(sessions)
    .set({ status: 'ended', ended_at: new Date() })
    .where(eq(sessions.id, sessionId))
    .returning();

  res.json(ended);
});

export default router;