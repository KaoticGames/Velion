import { Router, Request, Response } from 'express';
import { v4 as uuidv4 }             from 'uuid';
import { requireAuth }               from '../middleware/auth';
import { getPresignedUploadUrl, getPublicUrl, portraitKey, tokenArtworkKey } from '../lib/r2';

const router = Router();
router.use(requireAuth);

const ALLOWED_TYPES = ['image/png', 'image/jpeg', 'image/webp'];

// ── POST /tokens/upload-url ───────────────────────────────────────────────
// Returns a presigned PUT URL. Client uploads directly to R2, then
// PATCHes the character with the returned public_url.
router.post('/upload-url', async (req: Request, res: Response): Promise<void> => {
  const { character_id, filename, content_type, asset_type = 'portrait' } = req.body as {
    character_id: string;
    filename:     string;
    content_type: string;
    asset_type?:  'portrait' | 'token';
  };

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
