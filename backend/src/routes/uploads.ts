import { Router, Request, Response } from 'express';
import { v4 as uuidv4 }             from 'uuid';
import { eq, and, isNull }          from 'drizzle-orm';
import { requireAuth }               from '../middleware/auth';
import { getPresignedUploadUrl, getPublicUrl, portraitKey, tokenArtworkKey } from '../lib/r2';
import { db }                        from '../db';
import { characters }                from '../db/schema';

const router = Router();
router.use(requireAuth);

const ALLOWED_TYPES = ['image/png', 'image/jpeg', 'image/webp'];

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

export default router;
