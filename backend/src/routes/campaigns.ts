import { Router, Request, Response } from 'express';
import { eq, and, isNull }           from 'drizzle-orm';
import { randomBytes }               from 'crypto';
import { db }                        from '../db';
import {
  campaigns, campaignCharacters, campaignInvites,
  sessions, characters, users, campaignAssets,
} from '../db/schema';
import { v4 as uuidv4 } from 'uuid';
import { getPresignedUploadUrl, getPublicUrl, deleteObject, campaignAssetKey } from '../lib/r2';
import { requireAuth, requireDM }    from '../middleware/auth';

export const campaignsRouter = Router();
campaignsRouter.use(requireAuth);

const param = (p: string | string[]): string => (Array.isArray(p) ? p[0] : p);
const generateToken = (): string => randomBytes(18).toString('base64url');

// ── Ownership guard ────────────────────────────────────────────────────────
const ownCampaign = async (campaignId: string, userId: string) => {
  const [c] = await db
    .select().from(campaigns)
    .where(and(eq(campaigns.id, campaignId), isNull(campaigns.deleted_at)))
    .limit(1);
  if (!c)                    return { campaign: null as typeof c | null, err: 'NOT_FOUND' as const };
  if (c.dm_user_id !== userId) return { campaign: null as typeof c | null, err: 'FORBIDDEN' as const };
  return { campaign: c, err: null };
};

// ── Membership check ───────────────────────────────────────────────────────
const memberOfCampaign = async (campaignId: string, userId: string): Promise<boolean> => {
  const rows = await db
    .select().from(campaignCharacters)
    .where(and(
      eq(campaignCharacters.campaign_id, campaignId),
      eq(campaignCharacters.user_id, userId),
      isNull(campaignCharacters.removed_at),
    ));
  return rows.length > 0;
};

// ═══════════════════════════════════════════════════════════════════════════
// CAMPAIGNS
// ═══════════════════════════════════════════════════════════════════════════

// ── GET /campaigns ─────────────────────────────────────────────────────────
campaignsRouter.get('/', async (req: Request, res: Response): Promise<void> => {
  const userId = req.user!.user_id;
  const isDM   = req.user!.subscription_tier === 'dm';

  if (isDM) {
    const list = await db
      .select().from(campaigns)
      .where(and(eq(campaigns.dm_user_id, userId), isNull(campaigns.deleted_at)));
    res.json({ data: list, meta: { total: list.length } });
    return;
  }

  // Player: find campaigns via active memberships
  const memberships = await db
    .select().from(campaignCharacters)
    .where(and(eq(campaignCharacters.user_id, userId), isNull(campaignCharacters.removed_at)));

  if (!memberships.length) { res.json({ data: [], meta: { total: 0 } }); return; }

  const ids  = [...new Set(memberships.map((m: typeof memberships[0]) => m.campaign_id))];
  const all  = await db.select().from(campaigns).where(isNull(campaigns.deleted_at));
  const list = all.filter((c: typeof all[0]) => ids.includes(c.id));
  res.json({ data: list, meta: { total: list.length } });
});

// ── POST /campaigns ────────────────────────────────────────────────────────
campaignsRouter.post('/', requireDM, async (req: Request, res: Response): Promise<void> => {
  const userId = req.user!.user_id;
  const { name, world_tier_baseline = 'local', settings = {} } = req.body as {
    name: string; world_tier_baseline?: string; settings?: Record<string, unknown>;
  };

  if (!name?.trim()) {
    res.status(422).json({ error: { code: 'VALIDATION_ERROR', message: 'Campaign name is required.', status: 422 } });
    return;
  }

  const [campaign] = await db
    .insert(campaigns)
    .values({ dm_user_id: userId, name: name.trim(), world_tier_baseline, settings })
    .returning();

  res.status(201).json(campaign);
});

// ── GET /campaigns/invite-preview/:token ───────────────────────────────────
// Must be defined BEFORE /:id to prevent token being treated as an ID
campaignsRouter.get('/invite-preview/:token', async (req: Request, res: Response): Promise<void> => {
  const token = param(req.params.token);

  const [invite] = await db
    .select().from(campaignInvites)
    .where(eq(campaignInvites.token, token))
    .limit(1);

  if (!invite) {
    res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Invite link is invalid.', status: 404 } });
    return;
  }
  if (invite.expires_at && invite.expires_at < new Date()) {
    res.status(410).json({ error: { code: 'INVITE_EXPIRED', message: 'This invite has expired.', status: 410 } });
    return;
  }
  if (invite.max_uses !== null && invite.use_count >= invite.max_uses) {
    res.status(410).json({ error: { code: 'INVITE_EXHAUSTED', message: 'This invite has reached its maximum uses.', status: 410 } });
    return;
  }

  const [campaign] = await db
    .select().from(campaigns)
    .where(eq(campaigns.id, invite.campaign_id))
    .limit(1);

  const [dm] = await db
    .select({ id: users.id, email: users.email })
    .from(users)
    .where(eq(users.id, campaign.dm_user_id))
    .limit(1);

  res.json({
    campaign: { id: campaign.id, name: campaign.name, world_tier_baseline: campaign.world_tier_baseline },
    dm:       { email: dm.email },
    invite:   { max_uses: invite.max_uses, use_count: invite.use_count, expires_at: invite.expires_at },
  });
});

// ── POST /campaigns/join/:token ────────────────────────────────────────────
campaignsRouter.post('/join/:token', async (req: Request, res: Response): Promise<void> => {
  const userId       = req.user!.user_id;
  const token        = param(req.params.token);
  const { character_id } = req.body as { character_id: string };

  if (!character_id) {
    res.status(422).json({ error: { code: 'VALIDATION_ERROR', message: 'character_id is required.', status: 422 } });
    return;
  }

  // Validate invite
  const [invite] = await db
    .select().from(campaignInvites)
    .where(eq(campaignInvites.token, token))
    .limit(1);

  if (!invite) {
    res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Invite link is invalid.', status: 404 } });
    return;
  }
  if (invite.expires_at && invite.expires_at < new Date()) {
    res.status(410).json({ error: { code: 'INVITE_EXPIRED', message: 'This invite has expired.', status: 410 } });
    return;
  }
  if (invite.max_uses !== null && invite.use_count >= invite.max_uses) {
    res.status(410).json({ error: { code: 'INVITE_EXHAUSTED', message: 'This invite has reached its maximum uses.', status: 410 } });
    return;
  }

  // Character must belong to the requesting user
  const [character] = await db
    .select().from(characters)
    .where(and(eq(characters.id, character_id), eq(characters.user_id, userId), isNull(characters.deleted_at)))
    .limit(1);

  if (!character) {
    res.status(403).json({ error: { code: 'FORBIDDEN', message: 'Character not found or does not belong to you.', status: 403 } });
    return;
  }

  // Single-campaign rule: character may only be in one active campaign
  const [existingChar] = await db
    .select().from(campaignCharacters)
    .where(and(eq(campaignCharacters.character_id, character_id), isNull(campaignCharacters.removed_at)))
    .limit(1);

  if (existingChar) {
    res.status(409).json({ error: { code: 'CHARACTER_ALREADY_IN_CAMPAIGN', message: 'This character is already enrolled in a campaign. Remove them first or use a different character.', status: 409 } });
    return;
  }

  // User may not have two characters in the same campaign
  const [existingUser] = await db
    .select().from(campaignCharacters)
    .where(and(
      eq(campaignCharacters.campaign_id, invite.campaign_id),
      eq(campaignCharacters.user_id, userId),
      isNull(campaignCharacters.removed_at),
    ))
    .limit(1);

  if (existingUser) {
    res.status(409).json({ error: { code: 'ALREADY_IN_CAMPAIGN', message: 'You already have a character in this campaign.', status: 409 } });
    return;
  }

  // Enroll
  const [membership] = await db
    .insert(campaignCharacters)
    .values({ campaign_id: invite.campaign_id, character_id, user_id: userId })
    .returning();

  await db
    .update(campaignInvites)
    .set({ use_count: invite.use_count + 1 })
    .where(eq(campaignInvites.id, invite.id));

  const [campaign] = await db
    .select().from(campaigns)
    .where(eq(campaigns.id, invite.campaign_id))
    .limit(1);

  res.status(201).json({ membership, campaign, character });
});

// ── GET /campaigns/:id ─────────────────────────────────────────────────────
campaignsRouter.get('/:id', async (req: Request, res: Response): Promise<void> => {
  const userId     = req.user!.user_id;
  const campaignId = param(req.params.id);
  const isDM       = req.user!.subscription_tier === 'dm';

  const [campaign] = await db
    .select().from(campaigns)
    .where(and(eq(campaigns.id, campaignId), isNull(campaigns.deleted_at)))
    .limit(1);

  if (!campaign) {
    res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Campaign not found.', status: 404 } });
    return;
  }

  const isOwner = campaign.dm_user_id === userId;
  if (!isOwner && !(await memberOfCampaign(campaignId, userId))) {
    res.status(403).json({ error: { code: 'FORBIDDEN', message: 'You are not part of this campaign.', status: 403 } });
    return;
  }

  const memberRows = await db
    .select().from(campaignCharacters)
    .where(and(eq(campaignCharacters.campaign_id, campaignId), isNull(campaignCharacters.removed_at)));

  const members = await Promise.all(memberRows.map(async (m: typeof memberRows[0]) => {
    const [char] = await db.select().from(characters).where(eq(characters.id, m.character_id)).limit(1);
    const [user] = await db.select({ id: users.id, email: users.email }).from(users).where(eq(users.id, m.user_id)).limit(1);
    return { membership: m, character: char ?? null, user: user ?? null };
  }));

  // Ensure DM always has one active invite (create lazily if none exist)
  let activeInvite = null;
  if (isDM && isOwner) {
    const invites = await db.select().from(campaignInvites)
      .where(eq(campaignInvites.campaign_id, campaignId));
    // Find a non-expired, non-exhausted invite
    activeInvite = invites.find((inv: typeof invites[0]) =>
      (!inv.expires_at || inv.expires_at > new Date()) &&
      (inv.max_uses === null || inv.use_count < inv.max_uses)
    ) ?? null;
    // None exist — create one automatically
    if (!activeInvite) {
      [activeInvite] = await db.insert(campaignInvites)
        .values({ campaign_id: campaignId, token: generateToken(), max_uses: null })
        .returning();
    }
  }

  // Strip dm_notes for non-owners
  const payload = isOwner ? campaign : { ...campaign, dm_notes: undefined };
  res.json({ ...payload, members, invite: activeInvite });
});

// ── PATCH /campaigns/:id ───────────────────────────────────────────────────
campaignsRouter.patch('/:id', requireDM, async (req: Request, res: Response): Promise<void> => {
  const userId     = req.user!.user_id;
  const campaignId = param(req.params.id);
  const { campaign, err } = await ownCampaign(campaignId, userId);

  if (err === 'NOT_FOUND') { res.status(404).json({ error: { code: 'NOT_FOUND',  message: 'Campaign not found.', status: 404 } }); return; }
  if (err === 'FORBIDDEN') { res.status(403).json({ error: { code: 'FORBIDDEN',  message: 'Not your campaign.', status: 403 } }); return; }

  const { name, world_tier_baseline, settings, summary, dm_notes } = req.body as Partial<{
    name: string; world_tier_baseline: string; settings: Record<string, unknown>;
    summary: string; dm_notes: string;
  }>;

  const updates: Record<string, unknown> = {};
  if (name              !== undefined) updates.name                = name.trim();
  if (world_tier_baseline !== undefined) updates.world_tier_baseline = world_tier_baseline;
  if (settings          !== undefined) updates.settings            = settings;
  if (summary           !== undefined) updates.summary             = summary;
  if (dm_notes          !== undefined) updates.dm_notes            = dm_notes;

  if (!Object.keys(updates).length) {
    res.status(422).json({ error: { code: 'VALIDATION_ERROR', message: 'No fields to update.', status: 422 } });
    return;
  }

  const [updated] = await db
    .update(campaigns).set(updates).where(eq(campaigns.id, campaignId)).returning();

  res.json(updated);
});

// ── DELETE /campaigns/:id ──────────────────────────────────────────────────
campaignsRouter.delete('/:id', requireDM, async (req: Request, res: Response): Promise<void> => {
  const userId     = req.user!.user_id;
  const campaignId = param(req.params.id);
  const { err }    = await ownCampaign(campaignId, userId);

  if (err === 'NOT_FOUND') { res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Campaign not found.', status: 404 } }); return; }
  if (err === 'FORBIDDEN') { res.status(403).json({ error: { code: 'FORBIDDEN', message: 'Not your campaign.', status: 403 } }); return; }

  await db.update(campaigns).set({ deleted_at: new Date() }).where(eq(campaigns.id, campaignId));
  res.status(204).send();
});

// ═══════════════════════════════════════════════════════════════════════════
// INVITES (DM management)
// ═══════════════════════════════════════════════════════════════════════════

// ── POST /campaigns/:id/invites ────────────────────────────────────────────
campaignsRouter.post('/:id/invites', requireDM, async (req: Request, res: Response): Promise<void> => {
  const userId     = req.user!.user_id;
  const campaignId = param(req.params.id);
  const { err }    = await ownCampaign(campaignId, userId);

  if (err === 'NOT_FOUND') { res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Campaign not found.', status: 404 } }); return; }
  if (err === 'FORBIDDEN') { res.status(403).json({ error: { code: 'FORBIDDEN', message: 'Not your campaign.', status: 403 } }); return; }

  const { max_uses = null, expires_hours = null } = req.body as {
    max_uses?: number | null; expires_hours?: number | null;
  };

  const expires_at = expires_hours
    ? new Date(Date.now() + expires_hours * 60 * 60 * 1000)
    : undefined;

  const [invite] = await db
    .insert(campaignInvites)
    .values({ campaign_id: campaignId, token: generateToken(), max_uses, expires_at })
    .returning();

  res.status(201).json(invite);
});

// ── GET /campaigns/:id/invites ─────────────────────────────────────────────
campaignsRouter.get('/:id/invites', requireDM, async (req: Request, res: Response): Promise<void> => {
  const userId     = req.user!.user_id;
  const campaignId = param(req.params.id);
  const { err }    = await ownCampaign(campaignId, userId);

  if (err === 'NOT_FOUND') { res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Campaign not found.', status: 404 } }); return; }
  if (err === 'FORBIDDEN') { res.status(403).json({ error: { code: 'FORBIDDEN', message: 'Not your campaign.', status: 403 } }); return; }

  const list = await db
    .select().from(campaignInvites)
    .where(eq(campaignInvites.campaign_id, campaignId));

  res.json({ data: list, meta: { total: list.length } });
});

// ── DELETE /campaigns/:id/invites/:inviteId ────────────────────────────────
campaignsRouter.delete('/:id/invites/:inviteId', requireDM, async (req: Request, res: Response): Promise<void> => {
  const userId     = req.user!.user_id;
  const campaignId = param(req.params.id);
  const inviteId   = param(req.params.inviteId);
  const { err }    = await ownCampaign(campaignId, userId);

  if (err === 'NOT_FOUND') { res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Campaign not found.', status: 404 } }); return; }
  if (err === 'FORBIDDEN') { res.status(403).json({ error: { code: 'FORBIDDEN', message: 'Not your campaign.', status: 403 } }); return; }

  const deleted = await db
    .delete(campaignInvites)
    .where(and(eq(campaignInvites.id, inviteId), eq(campaignInvites.campaign_id, campaignId)))
    .returning();

  if (!deleted.length) {
    res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Invite not found.', status: 404 } });
    return;
  }

  res.status(204).send();
});

// ═══════════════════════════════════════════════════════════════════════════
// MEMBERS
// ═══════════════════════════════════════════════════════════════════════════

// ── DELETE /campaigns/:id/members/:characterId ─────────────────────────────
// DM can remove anyone. Player can only remove their own character.
campaignsRouter.delete('/:id/members/:characterId', async (req: Request, res: Response): Promise<void> => {
  const userId      = req.user!.user_id;
  const campaignId  = param(req.params.id);
  const characterId = param(req.params.characterId);

  const [campaign] = await db
    .select().from(campaigns)
    .where(and(eq(campaigns.id, campaignId), isNull(campaigns.deleted_at)))
    .limit(1);

  if (!campaign) {
    res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Campaign not found.', status: 404 } });
    return;
  }

  const [membership] = await db
    .select().from(campaignCharacters)
    .where(and(
      eq(campaignCharacters.campaign_id, campaignId),
      eq(campaignCharacters.character_id, characterId),
      isNull(campaignCharacters.removed_at),
    ))
    .limit(1);

  if (!membership) {
    res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Member not found.', status: 404 } });
    return;
  }

  const isOwner = campaign.dm_user_id === userId;
  if (!isOwner && membership.user_id !== userId) {
    res.status(403).json({ error: { code: 'FORBIDDEN', message: 'You cannot remove this member.', status: 403 } });
    return;
  }

  await db
    .update(campaignCharacters)
    .set({ removed_at: new Date() })
    .where(eq(campaignCharacters.id, membership.id));

  res.status(204).send();
});

// ═══════════════════════════════════════════════════════════════════════════
// SESSIONS
// ═══════════════════════════════════════════════════════════════════════════

// ── GET /campaigns/:id/sessions ────────────────────────────────────────────
campaignsRouter.get('/:id/sessions', async (req: Request, res: Response): Promise<void> => {
  const userId     = req.user!.user_id;
  const campaignId = param(req.params.id);

  const [campaign] = await db
    .select().from(campaigns)
    .where(and(eq(campaigns.id, campaignId), isNull(campaigns.deleted_at)))
    .limit(1);

  if (!campaign) {
    res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Campaign not found.', status: 404 } });
    return;
  }

  const isOwner = campaign.dm_user_id === userId;
  if (!isOwner && !(await memberOfCampaign(campaignId, userId))) {
    res.status(403).json({ error: { code: 'FORBIDDEN', message: 'You are not part of this campaign.', status: 403 } });
    return;
  }

  const list = await db
    .select().from(sessions)
    .where(eq(sessions.campaign_id, campaignId));

  res.json({ data: list, meta: { total: list.length } });
});

// ── POST /campaigns/:id/sessions ───────────────────────────────────────────
campaignsRouter.post('/:id/sessions', requireDM, async (req: Request, res: Response): Promise<void> => {
  const userId     = req.user!.user_id;
  const campaignId = param(req.params.id);
  const { err }    = await ownCampaign(campaignId, userId);

  if (err === 'NOT_FOUND') { res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Campaign not found.', status: 404 } }); return; }
  if (err === 'FORBIDDEN') { res.status(403).json({ error: { code: 'FORBIDDEN', message: 'Not your campaign.', status: 403 } }); return; }

  const { name } = req.body as { name: string };
  if (!name?.trim()) {
    res.status(422).json({ error: { code: 'VALIDATION_ERROR', message: 'Session name is required.', status: 422 } });
    return;
  }

  const [session] = await db
    .insert(sessions)
    .values({ campaign_id: campaignId, name: name.trim(), status: 'scheduled' })
    .returning();

  res.status(201).json(session);
});

// ═══════════════════════════════════════════════════════════════════════════
// INVITE REFRESH
// ═══════════════════════════════════════════════════════════════════════════

// ── POST /campaigns/:id/invites/refresh ───────────────────────────────────
// Revokes all existing invites and generates a fresh one.
campaignsRouter.post('/:id/invites/refresh', requireDM, async (req: Request, res: Response): Promise<void> => {
  const userId     = req.user!.user_id;
  const campaignId = param(req.params.id);
  const { err }    = await ownCampaign(campaignId, userId);

  if (err === 'NOT_FOUND') { res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Campaign not found.', status: 404 } }); return; }
  if (err === 'FORBIDDEN') { res.status(403).json({ error: { code: 'FORBIDDEN', message: 'Not your campaign.', status: 403 } }); return; }

  // Delete all existing invites for this campaign
  await db.delete(campaignInvites).where(eq(campaignInvites.campaign_id, campaignId));

  // Create a fresh one
  const [invite] = await db
    .insert(campaignInvites)
    .values({ campaign_id: campaignId, token: generateToken(), max_uses: null })
    .returning();

  res.status(201).json(invite);
});

// ═══════════════════════════════════════════════════════════════════════════
// CAMPAIGN ASSETS
// ═══════════════════════════════════════════════════════════════════════════

const ALLOWED_ASSET_TYPES = ['image/png', 'image/jpeg', 'image/webp'];
const ASSET_TYPE_FROM_NAME = (name: string): string => {
  const lower = name.toLowerCase();
  if (lower.includes('map'))   return 'map';
  if (lower.includes('token')) return 'token';
  return 'image';
};

// ── GET /campaigns/:id/assets ─────────────────────────────────────────────
campaignsRouter.get('/:id/assets', async (req: Request, res: Response): Promise<void> => {
  const userId     = req.user!.user_id;
  const campaignId = param(req.params.id);

  const [campaign] = await db.select().from(campaigns)
    .where(and(eq(campaigns.id, campaignId), isNull(campaigns.deleted_at))).limit(1);
  if (!campaign) { res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Campaign not found.', status: 404 } }); return; }

  const isOwner = campaign.dm_user_id === userId;
  if (!isOwner && !(await memberOfCampaign(campaignId, userId))) {
    res.status(403).json({ error: { code: 'FORBIDDEN', message: 'Not part of this campaign.', status: 403 } });
    return;
  }

  const list = await db.select().from(campaignAssets)
    .where(eq(campaignAssets.campaign_id, campaignId));
  res.json({ data: list, meta: { total: list.length } });
});

// ── POST /campaigns/:id/assets/upload-url ────────────────────────────────
// Returns a presigned PUT URL. Client uploads to R2 directly, then calls
// POST /campaigns/:id/assets/confirm to register the asset.
campaignsRouter.post('/:id/assets/upload-url', requireDM, async (req: Request, res: Response): Promise<void> => {
  const userId     = req.user!.user_id;
  const campaignId = param(req.params.id);
  const { err }    = await ownCampaign(campaignId, userId);

  if (err === 'NOT_FOUND') { res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Campaign not found.', status: 404 } }); return; }
  if (err === 'FORBIDDEN') { res.status(403).json({ error: { code: 'FORBIDDEN', message: 'Not your campaign.', status: 403 } }); return; }

  const { filename, content_type, name } = req.body as {
    filename:     string;
    content_type: string;
    name?:        string;
  };

  if (!ALLOWED_ASSET_TYPES.includes(content_type)) {
    res.status(422).json({ error: { code: 'INVALID_FILE_TYPE', message: 'Only PNG, JPEG, and WEBP are supported.', status: 422 } });
    return;
  }

  const assetId  = uuidv4();
  const ext      = filename.split('.').pop() ?? 'jpg';
  const key      = campaignAssetKey(campaignId, assetId, `${uuidv4()}.${ext}`);
  const uploadUrl = await getPresignedUploadUrl(key, content_type);
  const publicUrl = getPublicUrl(key);

  res.json({
    asset_id:   assetId,
    upload_url: uploadUrl,
    public_url: publicUrl,
    r2_key:     key,
    name:       name ?? filename,
  });
});

// ── POST /campaigns/:id/assets/confirm ───────────────────────────────────
// Called after a successful R2 upload to register the asset in the DB.
campaignsRouter.post('/:id/assets/confirm', requireDM, async (req: Request, res: Response): Promise<void> => {
  const userId     = req.user!.user_id;
  const campaignId = param(req.params.id);
  const { err }    = await ownCampaign(campaignId, userId);

  if (err === 'NOT_FOUND') { res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Campaign not found.', status: 404 } }); return; }
  if (err === 'FORBIDDEN') { res.status(403).json({ error: { code: 'FORBIDDEN', message: 'Not your campaign.', status: 403 } }); return; }

  const { name, url, r2_key, size_bytes = 0 } = req.body as {
    name:        string;
    url:         string;
    r2_key:      string;
    size_bytes?: number;
  };

  if (!name || !url || !r2_key) {
    res.status(422).json({ error: { code: 'VALIDATION_ERROR', message: 'name, url, and r2_key are required.', status: 422 } });
    return;
  }

  const [asset] = await db.insert(campaignAssets).values({
    campaign_id: campaignId,
    name,
    asset_type:  ASSET_TYPE_FROM_NAME(name),
    url,
    r2_key,
    size_bytes,
  }).returning();

  res.status(201).json(asset);
});

// ── DELETE /campaigns/:id/assets/:assetId ────────────────────────────────
campaignsRouter.delete('/:id/assets/:assetId', requireDM, async (req: Request, res: Response): Promise<void> => {
  const userId     = req.user!.user_id;
  const campaignId = param(req.params.id);
  const assetId    = param(req.params.assetId);
  const { err }    = await ownCampaign(campaignId, userId);

  if (err === 'NOT_FOUND') { res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Campaign not found.', status: 404 } }); return; }
  if (err === 'FORBIDDEN') { res.status(403).json({ error: { code: 'FORBIDDEN', message: 'Not your campaign.', status: 403 } }); return; }

  const [asset] = await db.select().from(campaignAssets)
    .where(and(eq(campaignAssets.id, assetId), eq(campaignAssets.campaign_id, campaignId)))
    .limit(1);

  if (!asset) {
    res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Asset not found.', status: 404 } });
    return;
  }

  // Delete from R2
  try { await deleteObject(asset.r2_key); } catch { /* R2 delete is best-effort */ }

  await db.delete(campaignAssets)
    .where(eq(campaignAssets.id, assetId));

  res.status(204).send();
});