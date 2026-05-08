import { Router, Request, Response } from 'express';
import { v4 as uuidv4 }             from 'uuid';
import { eq, and, isNull }          from 'drizzle-orm';
import { requireAuth }               from '../middleware/auth';
import { getPresignedUploadUrl, getPresignedReadUrl, getPublicUrl, portraitKey, tokenArtworkKey } from '../lib/r2';
import { db }                        from '../db';
import { characters }                from '../db/schema';

const router = Router();
router.use(requireAuth);

const ALLOWED_TYPES = ['image/png', 'image/jpeg', 'image/webp'];

const parseR2Key = (rawUrl: string | undefined): string | null => {
  if (!rawUrl || typeof rawUrl !== 'string') return null;
  const trimmed = rawUrl.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith('r2://')) {
    const key = trimmed.slice('r2://'.length);
    return key || null;
  }
  try {
    const u = new URL(trimmed);
    let path = u.pathname.startsWith('/') ? u.pathname.slice(1) : u.pathname;
    if (!path) return null;
    // Some URL styles include bucket in path; strip it if present.
    const bucket = process.env.R2_BUCKET_NAME;
    if (bucket && path.startsWith(`${bucket}/`)) {
      path = path.slice(bucket.length + 1);
    }
    return path || null;
  } catch {
    return null;
  }
};

// ── POST /tokens/upload-url ───────────────────────────────────────────────
// Returns a presigned PUT URL. Client uploads directly to R2, then
// PATCHes the character with the returned public_url.
router.post('/upload-url', async (req: Request, res: Response): Promise<void> => {
  const userId = req.user!.user_id;
  const { character_id, filename, content_type, asset_type = 'portrait' } = req.body as {
    character_id: string;
    filename:     string;
    content_type: string;
    asset_type?:  'portrait' | 'token';
  };

  if (!character_id?.trim()) {
    res.status(422).json({ error: { code: 'VALIDATION_ERROR', message: 'character_id required.', status: 422 } });
    return;
  }

  const [charRow] = await db
    .select({ id: characters.id, user_id: characters.user_id })
    .from(characters)
    .where(and(eq(characters.id, character_id.trim()), isNull(characters.deleted_at)))
    .limit(1);

  if (!charRow) {
    res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Character not found.', status: 404 } });
    return;
  }
  if (charRow.user_id !== userId) {
    res.status(403).json({ error: { code: 'FORBIDDEN', message: 'Not your character.', status: 403 } });
    return;
  }

  if (!ALLOWED_TYPES.includes(content_type)) {
    res.status(422).json({ error: { code: 'INVALID_FILE_TYPE', message: 'Only PNG, JPEG, and WEBP are accepted.', status: 422 } });
    return;
  }

  const ext = filename.split('.').pop() ?? 'jpg';
  const key = asset_type === 'portrait'
    ? portraitKey(character_id, `${uuidv4()}.${ext}`)
    : tokenArtworkKey(character_id, `${uuidv4()}.${ext}`);

  const upload_url  = await getPresignedUploadUrl(key, content_type);
  const public_url  = getPublicUrl(key);

  res.json({ upload_url, public_url, key });
});

// ── POST /tokens/portrait/read-url ───────────────────────────────────────
// Returns a short-lived signed GET URL for portrait rendering.
router.post('/portrait/read-url', async (req: Request, res: Response): Promise<void> => {
  const userId = req.user!.user_id;
  const { character_id, portrait_url } = req.body as {
    character_id: string;
    portrait_url?: string;
  };

  if (!character_id?.trim()) {
    res.status(422).json({ error: { code: 'VALIDATION_ERROR', message: 'character_id required.', status: 422 } });
    return;
  }

  const [charRow] = await db
    .select({ user_id: characters.user_id, portrait_url: characters.portrait_url })
    .from(characters)
    .where(and(eq(characters.id, character_id.trim()), isNull(characters.deleted_at)))
    .limit(1);

  if (!charRow) {
    res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Character not found.', status: 404 } });
    return;
  }
  if (charRow.user_id !== userId) {
    res.status(403).json({ error: { code: 'FORBIDDEN', message: 'Not your character.', status: 403 } });
    return;
  }

  const source = (portrait_url && portrait_url.trim()) || charRow.portrait_url || '';
  if (!source) {
    res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Portrait not set.', status: 404 } });
    return;
  }

  const key = parseR2Key(source);
  if (!key) {
    res.status(422).json({ error: { code: 'VALIDATION_ERROR', message: 'Portrait URL is not a recognized R2 object path.', status: 422 } });
    return;
  }

  const read_url = await getPresignedReadUrl(key);
  res.json({ read_url, key });
});

export default router;
