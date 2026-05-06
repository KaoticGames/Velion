import { Router, Request, Response }  from 'express';
import bcrypt                          from 'bcrypt';
import { eq, and, isNull, gt }         from 'drizzle-orm';
import { v4 as uuidv4 }               from 'uuid';
import { db }                          from '../db';
import { users, refreshTokens, earlyAccessSignups } from '../db/schema';
import { signAccessToken, signRefreshToken, verifyRefreshToken } from '../lib/jwt';
import {
  refreshCookieClearOptions,
  setRefreshTokenCookie,
} from '../lib/refreshCookie';
import { requireAuth }                 from '../middleware/auth';
import { attachGoogleOAuthRoutes }     from './oauthGoogle';
import { attachTwitchOAuthRoutes }     from './oauthTwitch';

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
        message: 'This account uses social sign-in. Use Google or Twitch to manage access, or contact support to add a password.',
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

attachGoogleOAuthRoutes(router);
attachTwitchOAuthRoutes(router);

export default router;