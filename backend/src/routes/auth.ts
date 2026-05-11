import { Router, Request, Response }  from 'express';
import bcrypt                          from 'bcrypt';
import { eq, and, isNull, gt }         from 'drizzle-orm';
import { v4 as uuidv4 }               from 'uuid';
import { db }                          from '../db';
import { users, refreshTokens, earlyAccessSignups, oauthAccounts } from '../db/schema';
import { signAccessToken, signRefreshToken, verifyRefreshToken } from '../lib/jwt';
import {
  refreshCookieClearOptions,
  setRefreshTokenCookie,
} from '../lib/refreshCookie';
import { requireAuth }                 from '../middleware/auth';
import { getPresignedUploadUrl, getPublicUrl, userAvatarKey } from '../lib/r2';
import { attachGoogleOAuthRoutes }     from './oauthGoogle';
import { attachTwitchOAuthRoutes }     from './oauthTwitch';
import { attachDiscordOAuthRoutes }    from './oauthDiscord';

const AVATAR_TYPES = ['image/png', 'image/jpeg', 'image/webp'] as const;

const router = Router();
const BCRYPT_ROUNDS = 12;
/** HttpOnly refresh cookie, DB `expires_at`, and JWT refresh `exp` — align with `signRefreshToken` in lib/jwt.ts */
const REFRESH_DAYS  = 7;

const betaGateEnabled = () => process.env.BETA_GATE_ENABLED !== 'false';

const userPublic = (u: typeof users.$inferSelect) => ({
  id:                u.id,
  email:             u.email,
  display_name:      u.display_name,
  avatar_url:        u.avatar_url,
  bio:               u.bio,
  social_handle:     u.social_handle,
  subscription_tier: u.subscription_tier,
  beta_access:       u.beta_access,
});

/** When the env beta gate is on, block session unless the user row allows access (set `users.beta_access = true` to bypass). */
const rejectIfBetaRevoked = (res: Response, u: typeof users.$inferSelect): boolean => {
  if (!betaGateEnabled()) return false;
  if (u.beta_access) return false;
  res.status(403).json({
    error: {
      code:    'BETA_REQUIRED',
      message: 'Beta access is not enabled for this account. Contact support if you believe this is an error.',
      status:  403,
    },
  });
  return true;
};

// ── POST /auth/register ───────────────────────────────────────────────────
router.post('/register', async (req: Request, res: Response): Promise<void> => {
  const { email, password, display_name } = req.body as {
    email: string; password: string; display_name: string;
  };

  if (!email || !password || !display_name) {
    res.status(422).json({ error: { code: 'MISSING_FIELDS', message: 'email, password, and display_name are required.', status: 422 } });
    return;
  }
  if (password.length < 8) {
    res.status(422).json({ error: { code: 'PASSWORD_TOO_SHORT', message: 'Password must be at least 8 characters.', status: 422 } });
    return;
  }

  const existing = await db.select().from(users).where(eq(users.email, email.toLowerCase())).limit(1);
  if (existing.length > 0) {
    res.status(422).json({ error: { code: 'EMAIL_TAKEN', message: 'An account with this email already exists.', status: 422 } });
    return;
  }

  // ── Beta gate: only granted early-access emails may register ─────────────
  // Set BETA_GATE_ENABLED=false in env to open registration to everyone (full public launch).
  if (betaGateEnabled()) {
    const betaRow = await db
      .select({ beta_granted: earlyAccessSignups.beta_granted })
      .from(earlyAccessSignups)
      .where(eq(earlyAccessSignups.email, email.toLowerCase()))
      .limit(1);

    if (!betaRow[0]?.beta_granted) {
      res.status(403).json({ error: { code: 'BETA_REQUIRED', message: 'Early access has not yet been granted for this email. Sign up at playvelion.com to join the waitlist.', status: 403 } });
      return;
    }
  }

  const password_hash = await bcrypt.hash(password, BCRYPT_ROUNDS);
  const [user] = await db.insert(users).values({
    email:         email.toLowerCase(),
    password_hash,
    display_name,
    beta_access:   true,
  }).returning();

  const access_token    = signAccessToken({ user_id: user.id, email: user.email, subscription_tier: user.subscription_tier });
  const token_id        = uuidv4();
  const refresh_token   = signRefreshToken({ user_id: user.id, token_id });
  const expires_at      = new Date(Date.now() + REFRESH_DAYS * 24 * 60 * 60 * 1000);

  await db.insert(refreshTokens).values({ id: token_id, user_id: user.id, expires_at });
  setRefreshTokenCookie(res, refresh_token);

  res.status(201).json({ access_token, user: userPublic(user) });
});

// ── POST /auth/login ──────────────────────────────────────────────────────
router.post('/login', async (req: Request, res: Response): Promise<void> => {
  const { email, password } = req.body as { email: string; password: string };

  const [user] = await db.select().from(users)
    .where(and(eq(users.email, email?.toLowerCase()), isNull(users.deleted_at)))
    .limit(1);

  if (!user) {
    const hash = '$2b$12$invalidhashpadding000000000000000000';
    await bcrypt.compare(password ?? '', hash);
    res.status(401).json({ error: { code: 'INVALID_CREDENTIALS', message: 'Invalid email or password.', status: 401 } });
    return;
  }

  if (!user.password_hash) {
    res.status(401).json({
      error: { code: 'OAUTH_ONLY', message: 'This account signs in with Google or Twitch.', status: 401 },
    });
    return;
  }

  const valid = await bcrypt.compare(password ?? '', user.password_hash);
  if (!valid) {
    res.status(401).json({ error: { code: 'INVALID_CREDENTIALS', message: 'Invalid email or password.', status: 401 } });
    return;
  }

  if (rejectIfBetaRevoked(res, user)) return;

  const access_token  = signAccessToken({ user_id: user.id, email: user.email, subscription_tier: user.subscription_tier });
  const token_id      = uuidv4();
  const refresh_token = signRefreshToken({ user_id: user.id, token_id });
  const expires_at    = new Date(Date.now() + REFRESH_DAYS * 24 * 60 * 60 * 1000);

  await db.insert(refreshTokens).values({ id: token_id, user_id: user.id, expires_at });
  setRefreshTokenCookie(res, refresh_token);

  res.json({ access_token, user: userPublic(user) });
});

// ── POST /auth/refresh ────────────────────────────────────────────────────
router.post('/refresh', async (req: Request, res: Response): Promise<void> => {
  const cookie = req.cookies?.refresh_token;
  if (!cookie) {
    res.status(401).json({ error: { code: 'NO_REFRESH_TOKEN', message: 'No refresh token.', status: 401 } });
    return;
  }

  let payload: ReturnType<typeof verifyRefreshToken>;
  try {
    payload = verifyRefreshToken(cookie);
  } catch {
    res.status(401).json({ error: { code: 'REFRESH_TOKEN_INVALID', message: 'Refresh token invalid.', status: 401 } });
    return;
  }

  const [stored] = await db.select().from(refreshTokens)
    .where(and(eq(refreshTokens.id, payload.token_id), isNull(refreshTokens.revoked_at), gt(refreshTokens.expires_at, new Date())))
    .limit(1);

  if (!stored) {
    res.status(401).json({ error: { code: 'REFRESH_TOKEN_REVOKED', message: 'Refresh token revoked or expired.', status: 401 } });
    return;
  }

  // Token rotation — revoke old, issue new
  await db.update(refreshTokens).set({ revoked_at: new Date() }).where(eq(refreshTokens.id, stored.id));

  const [user] = await db.select().from(users).where(eq(users.id, stored.user_id)).limit(1);
  if (!user) {
    res.status(401).json({ error: { code: 'USER_NOT_FOUND', message: 'Account not found.', status: 401 } });
    return;
  }
  if (rejectIfBetaRevoked(res, user)) return;

  const new_token_id      = uuidv4();
  const new_access_token  = signAccessToken({ user_id: user.id, email: user.email, subscription_tier: user.subscription_tier });
  const new_refresh_token = signRefreshToken({ user_id: user.id, token_id: new_token_id });
  const expires_at        = new Date(Date.now() + REFRESH_DAYS * 24 * 60 * 60 * 1000);

  await db.insert(refreshTokens).values({ id: new_token_id, user_id: user.id, expires_at });
  setRefreshTokenCookie(res, new_refresh_token);

  res.json({ access_token: new_access_token, user: userPublic(user) });
});

/**
 * Sliding session: extend the **same** refresh row to now+REFRESH_DAYS (no rotation).
 * Call from the client on user activity (throttled) so “7 days” restarts from last use.
 */
router.post('/touch', async (req: Request, res: Response): Promise<void> => {
  const cookie = req.cookies?.refresh_token;
  if (!cookie) {
    res.status(401).json({ error: { code: 'NO_REFRESH_TOKEN', message: 'No refresh token.', status: 401 } });
    return;
  }

  let payload: ReturnType<typeof verifyRefreshToken>;
  try {
    payload = verifyRefreshToken(cookie);
  } catch {
    res.status(401).json({ error: { code: 'REFRESH_TOKEN_INVALID', message: 'Refresh token invalid.', status: 401 } });
    return;
  }

  const [stored] = await db.select().from(refreshTokens)
    .where(and(eq(refreshTokens.id, payload.token_id), isNull(refreshTokens.revoked_at), gt(refreshTokens.expires_at, new Date())))
    .limit(1);

  if (!stored) {
    res.status(401).json({ error: { code: 'REFRESH_TOKEN_REVOKED', message: 'Refresh token revoked or expired.', status: 401 } });
    return;
  }

  const [user] = await db.select().from(users).where(eq(users.id, stored.user_id)).limit(1);
  if (!user) {
    res.status(401).json({ error: { code: 'USER_NOT_FOUND', message: 'Account not found.', status: 401 } });
    return;
  }
  if (rejectIfBetaRevoked(res, user)) return;

  const expires_at = new Date(Date.now() + REFRESH_DAYS * 24 * 60 * 60 * 1000);
  await db.update(refreshTokens).set({ expires_at }).where(eq(refreshTokens.id, stored.id));

  const access_token    = signAccessToken({ user_id: user.id, email: user.email, subscription_tier: user.subscription_tier });
  const refresh_token = signRefreshToken({ user_id: user.id, token_id: stored.id });
  setRefreshTokenCookie(res, refresh_token);

  res.json({ access_token, user: userPublic(user) });
});

// ── POST /auth/logout ─────────────────────────────────────────────────────
router.post('/logout', requireAuth, async (req: Request, res: Response): Promise<void> => {
  const cookie = req.cookies?.refresh_token;
  if (cookie) {
    try {
      const payload = verifyRefreshToken(cookie);
      await db.update(refreshTokens).set({ revoked_at: new Date() }).where(eq(refreshTokens.id, payload.token_id));
    } catch { /* ignore invalid token on logout */ }
  }
  res.clearCookie('refresh_token', refreshCookieClearOptions());
  res.json({ success: true });
});

// ── PATCH /auth/password ──────────────────────────────────────────────────
router.patch('/password', requireAuth, async (req: Request, res: Response): Promise<void> => {
  const { current_password, new_password } = req.body as { current_password: string; new_password: string };
  const userId = req.user!.user_id;

  if (!new_password || new_password.length < 8) {
    res.status(422).json({ error: { code: 'PASSWORD_TOO_SHORT', message: 'New password must be at least 8 characters.', status: 422 } });
    return;
  }

  const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  if (!user.password_hash) {
    res.status(422).json({
      error: {
        code:    'NO_PASSWORD_SET',
        message: 'This account uses social sign-in. Link a password below, or manage access through your linked provider.',
        status:  422,
      },
    });
    return;
  }
  const valid = await bcrypt.compare(current_password ?? '', user.password_hash);
  if (!valid) {
    res.status(401).json({ error: { code: 'INVALID_CREDENTIALS', message: 'Current password is incorrect.', status: 401 } });
    return;
  }

  const new_hash = await bcrypt.hash(new_password, BCRYPT_ROUNDS);
  await db.update(users).set({ password_hash: new_hash }).where(eq(users.id, userId));
  // Revoke all refresh tokens for security
  await db.update(refreshTokens).set({ revoked_at: new Date() }).where(eq(refreshTokens.user_id, userId));

  res.clearCookie('refresh_token', refreshCookieClearOptions());
  res.json({ success: true });
});

// ── GET /auth/account ─────────────────────────────────────────────────────
router.get('/account', requireAuth, async (req: Request, res: Response): Promise<void> => {
  const userId = req.user!.user_id;
  const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  if (!user) {
    res.status(404).json({ error: { code: 'USER_NOT_FOUND', message: 'Account not found.', status: 404 } });
    return;
  }
  const links = await db
    .select({ provider: oauthAccounts.provider })
    .from(oauthAccounts)
    .where(eq(oauthAccounts.user_id, userId));
  const oauth_providers = [...new Set(links.map((r) => r.provider))].sort();
  res.json({
    user:            userPublic(user),
    has_password:    Boolean(user.password_hash),
    oauth_providers: oauth_providers,
  });
});

// ── POST /auth/avatar/upload-url ──────────────────────────────────────────
router.post('/avatar/upload-url', requireAuth, async (req: Request, res: Response): Promise<void> => {
  const userId = req.user!.user_id;
  const { filename, content_type } = req.body as { filename?: string; content_type?: string };
  const ct = content_type === 'image/jpg' ? 'image/jpeg' : content_type;
  if (!filename?.trim() || !ct || !AVATAR_TYPES.includes(ct as (typeof AVATAR_TYPES)[number])) {
    res.status(422).json({
      error: { code: 'INVALID_FILE_TYPE', message: 'filename and a valid image type (PNG, JPEG, WEBP) are required.', status: 422 },
    });
    return;
  }
  try {
    const ext   = filename.split('.').pop() ?? 'jpg';
    const key   = userAvatarKey(userId, `${uuidv4()}.${ext}`);
    const upload_url = await getPresignedUploadUrl(key, ct);
    const public_url = getPublicUrl(key);
    res.json({ upload_url, public_url, key });
  } catch (e) {
    console.error('[auth/avatar/upload-url]', e);
    res.status(503).json({
      error: { code: 'STORAGE_UNAVAILABLE', message: 'File storage is not configured or unavailable.', status: 503 },
    });
  }
});

// ── PATCH /auth/profile ───────────────────────────────────────────────────
router.patch('/profile', requireAuth, async (req: Request, res: Response): Promise<void> => {
  const userId = req.user!.user_id;
  const body = req.body as Partial<{
    display_name:   string;
    bio:            string | null;
    social_handle:  string | null;
    avatar_url:     string | null;
  }>;

  const patch: {
    display_name?:   string;
    bio?:            string | null;
    social_handle?:  string | null;
    avatar_url?:     string | null;
  } = {};

  if (body.display_name !== undefined) {
    const name = typeof body.display_name === 'string' ? body.display_name.trim() : '';
    if (!name || name.length > 120) {
      res.status(422).json({
        error: { code: 'INVALID_DISPLAY_NAME', message: 'Display name must be 1–120 characters.', status: 422 },
      });
      return;
    }
    patch.display_name = name;
  }

  if (body.bio !== undefined) {
    if (body.bio === null) {
      patch.bio = null;
    } else if (typeof body.bio === 'string') {
      const t = body.bio.trim();
      patch.bio = t.length ? t.slice(0, 2000) : null;
    } else {
      res.status(422).json({ error: { code: 'VALIDATION_ERROR', message: 'bio must be a string or null.', status: 422 } });
      return;
    }
  }

  if (body.social_handle !== undefined) {
    if (body.social_handle === null) {
      patch.social_handle = null;
    } else if (typeof body.social_handle === 'string') {
      const t = body.social_handle.trim();
      patch.social_handle = t.length ? t.slice(0, 80) : null;
    } else {
      res.status(422).json({ error: { code: 'VALIDATION_ERROR', message: 'social_handle must be a string or null.', status: 422 } });
      return;
    }
  }

  if (body.avatar_url !== undefined) {
    if (body.avatar_url === null) {
      patch.avatar_url = null;
    } else if (typeof body.avatar_url === 'string') {
      const u = body.avatar_url.trim();
      if (!u) {
        patch.avatar_url = null;
      } else if (u.length > 512 || (!u.startsWith('https://') && !u.startsWith('http://'))) {
        res.status(422).json({
          error: { code: 'INVALID_AVATAR_URL', message: 'Avatar URL must be an http(s) URL.', status: 422 },
        });
        return;
      } else {
        patch.avatar_url = u;
      }
    } else {
      res.status(422).json({ error: { code: 'VALIDATION_ERROR', message: 'avatar_url must be a string or null.', status: 422 } });
      return;
    }
  }

  if (Object.keys(patch).length === 0) {
    res.status(422).json({
      error: { code: 'NO_FIELDS', message: 'Provide at least one of: display_name, bio, social_handle, avatar_url.', status: 422 },
    });
    return;
  }

  const [updated] = await db.update(users).set(patch).where(eq(users.id, userId)).returning();
  if (!updated) {
    res.status(404).json({ error: { code: 'USER_NOT_FOUND', message: 'Account not found.', status: 404 } });
    return;
  }
  res.json({ user: userPublic(updated) });
});

const emailLooksValid = (raw: string): boolean => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(raw);

// ── PATCH /auth/email ─────────────────────────────────────────────────────
router.patch('/email', requireAuth, async (req: Request, res: Response): Promise<void> => {
  const userId = req.user!.user_id;
  const { new_email, current_password } = req.body as { new_email?: string; current_password?: string };

  const next = typeof new_email === 'string' ? new_email.trim().toLowerCase() : '';
  if (!next || !emailLooksValid(next)) {
    res.status(422).json({ error: { code: 'INVALID_EMAIL', message: 'A valid new email is required.', status: 422 } });
    return;
  }

  const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  if (!user) {
    res.status(404).json({ error: { code: 'USER_NOT_FOUND', message: 'Account not found.', status: 404 } });
    return;
  }

  if (!user.password_hash) {
    res.status(422).json({
      error: {
        code:    'PASSWORD_REQUIRED_FOR_EMAIL',
        message: 'Add a password to this account before changing email, or contact support.',
        status:  422,
      },
    });
    return;
  }

  const valid = await bcrypt.compare(current_password ?? '', user.password_hash);
  if (!valid) {
    res.status(401).json({ error: { code: 'INVALID_CREDENTIALS', message: 'Current password is incorrect.', status: 401 } });
    return;
  }

  if (next === user.email.toLowerCase()) {
    res.status(422).json({ error: { code: 'SAME_EMAIL', message: 'That is already your email address.', status: 422 } });
    return;
  }

  const [taken] = await db.select({ id: users.id }).from(users).where(eq(users.email, next)).limit(1);
  if (taken) {
    res.status(422).json({ error: { code: 'EMAIL_TAKEN', message: 'Another account already uses this email.', status: 422 } });
    return;
  }

  const [updated] = await db.update(users).set({ email: next }).where(eq(users.id, userId)).returning();
  if (!updated) {
    res.status(404).json({ error: { code: 'USER_NOT_FOUND', message: 'Account not found.', status: 404 } });
    return;
  }

  res.json({ user: userPublic(updated) });
});

// ── POST /auth/password/create ──────────────────────────────────────────────
/** For OAuth-only accounts: set an email/password login without revoking the current session. */
router.post('/password/create', requireAuth, async (req: Request, res: Response): Promise<void> => {
  const { new_password } = req.body as { new_password: string };
  const userId = req.user!.user_id;

  if (!new_password || new_password.length < 8) {
    res.status(422).json({ error: { code: 'PASSWORD_TOO_SHORT', message: 'Password must be at least 8 characters.', status: 422 } });
    return;
  }

  const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  if (!user) {
    res.status(404).json({ error: { code: 'USER_NOT_FOUND', message: 'Account not found.', status: 404 } });
    return;
  }
  if (user.password_hash) {
    res.status(422).json({
      error: {
        code:    'PASSWORD_ALREADY_SET',
        message: 'This account already has a password. Use “Change password” instead.',
        status:  422,
      },
    });
    return;
  }

  const new_hash = await bcrypt.hash(new_password, BCRYPT_ROUNDS);
  await db.update(users).set({ password_hash: new_hash }).where(eq(users.id, userId));
  res.json({ success: true });
});

attachGoogleOAuthRoutes(router);
attachTwitchOAuthRoutes(router);
attachDiscordOAuthRoutes(router);

export default router;