import { S3Client, PutObjectCommand, DeleteObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

// R2 is S3-compatible — endpoint format is required
const r2 = new S3Client({
  region:   'auto',
  endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId:     process.env.R2_ACCESS_KEY_ID!,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
  },
});

const BUCKET = process.env.R2_BUCKET_NAME!;
const PUBLIC = process.env.R2_PUBLIC_URL!;

/**
 * Generate a presigned PUT URL for direct client upload.
 * The client PUTs the file directly to R2 — it never goes through Express.
 */
export const getPresignedUploadUrl = async (
  key:         string,
  contentType: string,
  expiresIn =  300,   // 5 minutes
): Promise<string> => {
  const command = new PutObjectCommand({
    Bucket:      BUCKET,
    Key:         key,
    ContentType: contentType,
  });
  return getSignedUrl(r2, command, { expiresIn });
};

/** Generate a presigned GET URL for reading a private/public object safely. */
export const getPresignedReadUrl = async (
  key: string,
  expiresIn = 900, // 15 minutes
): Promise<string> => {
  const command = new GetObjectCommand({
    Bucket: BUCKET,
    Key: key,
  });
  return getSignedUrl(r2, command, { expiresIn });
};

/** Fetch an object through the backend when direct public/CORS reads are unreliable. */
export const getObject = async (key: string) =>
  r2.send(new GetObjectCommand({
    Bucket: BUCKET,
    Key:    key,
  }));

/** Public URL for a stored object (no signing needed for public buckets) */
export const getPublicUrl = (key: string): string =>
  `${PUBLIC}/${key}`;

/** Delete an object from R2 */
export const deleteObject = async (key: string): Promise<void> => {
  await r2.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: key }));
};

// ── Key generators (match TDD file storage architecture) ─────────────────

export const mapImageKey      = (campaignId: string, mapId: string, filename: string) =>
  `maps/${campaignId}/${mapId}/${filename}`;

export const tokenArtworkKey  = (entityId: string, filename: string) =>
  `tokens/${entityId}/${filename}`;

export const portraitKey      = (characterId: string, filename: string) =>
  `portraits/${characterId}/${filename}`;

export const userAvatarKey    = (userId: string, filename: string) =>
  `avatars/${userId}/${filename}`;

export const campaignAssetKey = (campaignId: string, assetId: string, filename: string) =>
  `campaign-assets/${campaignId}/${assetId}/${filename}`;