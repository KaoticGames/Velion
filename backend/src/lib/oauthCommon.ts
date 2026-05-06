import type { Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { eq, and, isNull } from 'drizzle-orm';
import { db } from '../db';
import { users, refreshTokens, earlyAccessSignups, oauthAccounts } from '../db/schema';
import { signAccessToken, signRefreshToken } from '../lib/jwt';
import { setRefreshTokenCookie } from '../lib/refreshCookie';

export const OAUTH_REFRESH_DAYS = 7;

export const betaGateEnabled = () => process.env.BETA_GATE_ENABLED !== 'false';

export const corsOriginsList = (): string[] =>
  (process.env.CORS_ORIGIN ?? 'http://localhost:5173')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);

export const isAllowedFrontendOrigin = (origin: string): boolean =>
  corsOriginsList().includes(origin);

export const apiPublicBase = (): string => {
  const base = (process.env.API_PUBLIC_URL ?? '').replace(/\/$/, '');
  if (!base) {
    throw new Error('API_PUBLIC_URL is required (e.g. https://api.playvelion.com)');
  }
  return base;
};

export const userPublic = (u: typeof users.$inferSelect) => ({
  id:                u.id,
  email:             u.email,
  display_name:      u.display_name,
  avatar_url:        u.avatar_url,
  subscription_tier: u.subscription_tier,
  beta_access:       u.beta_access,
});

export function popupResultPage(frontendOrigin: string, data: Record<string, unknown>): string {
  const payload = JSON.stringify({ type: 'velion-oauth', ...data });
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Sign in</title></head><body>
<script>
(function () {
  var payload = ${payload};
  try {
    if (window.opener && !window.opener.closed) {
      window.opener.postMessage(payload, ${JSON.stringify(frontendOrigin)});
    }
  } catch (e) {}
  window.close();
})();
</script>
<p style="font-family:system-ui,sans-serif;text-align:center;margin-top:48px;color:#444">You can close this window.</p>
</body></html>`;
}

export async function issueOAuthSession(res: Response, user: typeof users.$inferSelect) {
  const access_token  = signAccessToken({ user_id: user.id, email: user.email, subscription_tier: user.subscription_tier });
  const token_id      = uuidv4();
  const refresh_token = signRefreshToken({ user_id: user.id, token_id });
  const expires_at    = new Date(Date.now() + OAUTH_REFRESH_DAYS * 24 * 60 * 60 * 1000);
  await db.insert(refreshTokens).values({ id: token_id, user_id: user.id, expires_at });
  setRefreshTokenCookie(res, refresh_token);
  return { access_token, user: userPublic(user) };
}

type FindOrCreateParams = {
  provider:         string;
  providerUserId:   string;
  emailLower:       string;
  displayName:      string;
  avatarUrl:        string | null;
  isPopup:          boolean;
  frontendOrigin:   string;
  clearOauthCookies: (res: Response) => void;
  fail:             (message: string, code: string) => void;
  res:              Response;
};

/** Returns user row or null if `fail` was invoked (e.g. beta). */
export async function findOrCreateOAuthUser(p: FindOrCreateParams): Promise<typeof users.$inferSelect | null> {
  const {
    provider,
    providerUserId,
    emailLower,
    displayName,
    avatarUrl,
    isPopup,
    frontendOrigin,
    clearOauthCookies,
    fail,
    res,
  } = p;

  const [existingLink] = await db.select().from(oauthAccounts)
    .where(and(eq(oauthAccounts.provider, provider), eq(oauthAccounts.provider_user_id, providerUserId)))
    .limit(1);

  let user: typeof users.$inferSelect | undefined;

  if (existingLink) {
    const [u] = await db.select().from(users)
      .where(and(eq(users.id, existingLink.user_id), isNull(users.deleted_at)))
      .limit(1);
    user = u;
  }

  if (!user) {
    const [byEmail] = await db.select().from(users)
      .where(and(eq(users.email, emailLower), isNull(users.deleted_at)))
      .limit(1);

    if (byEmail) {
      await db.insert(oauthAccounts).values({
        user_id:          byEmail.id,
        provider,
        provider_user_id: providerUserId,
      });
      const [u] = await db.select().from(users).where(eq(users.id, byEmail.id)).limit(1);
      user = u;
      if (avatarUrl && user && !user.avatar_url) {
        await db.update(users).set({ avatar_url: avatarUrl }).where(eq(users.id, user.id));
        user = { ...user, avatar_url: avatarUrl };
      }
    }
  }

  if (!user) {
    if (betaGateEnabled()) {
      const betaRow = await db
        .select({ beta_granted: earlyAccessSignups.beta_granted })
        .from(earlyAccessSignups)
        .where(eq(earlyAccessSignups.email, emailLower))
        .limit(1);
      if (!betaRow[0]?.beta_granted) {
        clearOauthCookies(res);
        if (isPopup) {
          res.setHeader('Content-Type', 'text/html; charset=utf-8');
          res.send(popupResultPage(frontendOrigin, {
            ok:      false,
            code:    'BETA_REQUIRED',
            message: 'Early access has not yet been granted for this email.',
          }));
          return null;
        }
        res.status(403).json({
          error: {
            code:    'BETA_REQUIRED',
            message: 'Early access has not yet been granted for this email.',
            status:  403,
          },
        });
        return null;
      }
    }

    const [created] = await db.insert(users).values({
      email:         emailLower,
      password_hash: null,
      display_name:  displayName,
      avatar_url:    avatarUrl ?? null,
      beta_access:   true,
    }).returning();

    await db.insert(oauthAccounts).values({
      user_id:          created.id,
      provider,
      provider_user_id: providerUserId,
    });

    user = created;
  }

  if (!user) {
    fail('Could not create or load account.', 'OAUTH_USER');
    return null;
  }

  if (betaGateEnabled() && !user.beta_access) {
    fail(
      'Beta access is not enabled for this account. Contact support if you believe this is an error.',
      'BETA_REQUIRED',
    );
    return null;
  }

  return user;
}
