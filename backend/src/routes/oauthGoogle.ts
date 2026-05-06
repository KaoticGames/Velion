import type { Request, Response, Router } from 'express';
import crypto from 'crypto';
import { eq, and, isNull } from 'drizzle-orm';
import { v4 as uuidv4 } from 'uuid';
import { db } from '../db';
import { users, refreshTokens, earlyAccessSignups, oauthAccounts } from '../db/schema';
import { signAccessToken, signRefreshToken } from '../lib/jwt';
import { setRefreshTokenCookie, shortLivedCookieOptions } from '../lib/refreshCookie';

const PROVIDER = 'google';
const REFRESH_DAYS = 7;

const GOOGLE_AUTH = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN = 'https://oauth2.googleapis.com/token';
const GOOGLE_USERINFO = 'https://www.googleapis.com/oauth2/v3/userinfo';

const OAUTH_STATE_COOKIE = 'oauth_google_state';
const OAUTH_ORIGIN_COOKIE = 'oauth_google_origin';
const OAUTH_POPUP_COOKIE = 'oauth_google_popup';

const betaGateEnabled = () => process.env.BETA_GATE_ENABLED !== 'false';

const corsOriginsList = (): string[] =>
  (process.env.CORS_ORIGIN ?? 'http://localhost:5173')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);

const isAllowedFrontendOrigin = (origin: string): boolean => corsOriginsList().includes(origin);

const apiPublicBase = (): string => {
  const base = (process.env.API_PUBLIC_URL ?? '').replace(/\/$/, '');
  if (!base) {
    throw new Error('API_PUBLIC_URL is required for Google OAuth (e.g. https://api.playvelion.com)');
  }
  return base;
};

const googleRedirectUri = (): string => `${apiPublicBase()}/api/v1/auth/oauth/google/callback`;

type GoogleProfile = {
  sub: string;
  email?: string;
  email_verified?: boolean;
  name?: string;
  picture?: string;
};

const userPublic = (u: typeof users.$inferSelect) => ({
  id:                u.id,
  email:             u.email,
  display_name:      u.display_name,
  avatar_url:        u.avatar_url,
  subscription_tier: u.subscription_tier,
  beta_access:       u.beta_access,
});

function clearOauthCookies(res: Response) {
  const o = shortLivedCookieOptions();
  res.clearCookie(OAUTH_STATE_COOKIE, { ...o, maxAge: undefined });
  res.clearCookie(OAUTH_ORIGIN_COOKIE, { ...o, maxAge: undefined });
  res.clearCookie(OAUTH_POPUP_COOKIE, { ...o, maxAge: undefined });
}

function popupResultPage(frontendOrigin: string, data: Record<string, unknown>): string {
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

async function exchangeGoogleCode(code: string): Promise<{ access_token: string }> {
  const client_id = process.env.GOOGLE_OAUTH_CLIENT_ID!;
  const client_secret = process.env.GOOGLE_OAUTH_CLIENT_SECRET!;
  const body = new URLSearchParams({
    code,
    client_id,
    client_secret,
    redirect_uri: googleRedirectUri(),
    grant_type: 'authorization_code',
  });
  const r = await fetch(GOOGLE_TOKEN, {
    method:  'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body:    body.toString(),
  });
  if (!r.ok) {
    const t = await r.text();
    throw new Error(`Google token exchange failed: ${r.status} ${t}`);
  }
  return r.json() as Promise<{ access_token: string }>;
}

async function fetchGoogleProfile(accessToken: string): Promise<GoogleProfile> {
  const r = await fetch(GOOGLE_USERINFO, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!r.ok) {
    const t = await r.text();
    throw new Error(`Google userinfo failed: ${r.status} ${t}`);
  }
  return r.json() as Promise<GoogleProfile>;
}

async function issueSession(res: Response, user: typeof users.$inferSelect) {
  const access_token  = signAccessToken({ user_id: user.id, email: user.email, subscription_tier: user.subscription_tier });
  const token_id      = uuidv4();
  const refresh_token = signRefreshToken({ user_id: user.id, token_id });
  const expires_at    = new Date(Date.now() + REFRESH_DAYS * 24 * 60 * 60 * 1000);
  await db.insert(refreshTokens).values({ id: token_id, user_id: user.id, expires_at });
  setRefreshTokenCookie(res, refresh_token);
  return { access_token, user: userPublic(user) };
}

export function attachGoogleOAuthRoutes(router: Router): void {
  router.get('/oauth/google/start', async (req: Request, res: Response): Promise<void> => {
    if (!process.env.GOOGLE_OAUTH_CLIENT_ID || !process.env.GOOGLE_OAUTH_CLIENT_SECRET) {
      res.status(501).json({
        error: { code: 'GOOGLE_OAUTH_DISABLED', message: 'Google sign-in is not configured.', status: 501 },
      });
      return;
    }

    let redirectUri: string;
    try {
      redirectUri = googleRedirectUri();
    } catch (e) {
      res.status(500).json({
        error: {
          code:    'OAUTH_CONFIG',
          message: e instanceof Error ? e.message : 'OAuth configuration error.',
          status:  500,
        },
      });
      return;
    }

    const originParam = typeof req.query.origin === 'string' ? req.query.origin : '';
    if (!originParam || !isAllowedFrontendOrigin(originParam)) {
      res.status(400).json({
        error: { code: 'INVALID_ORIGIN', message: 'Missing or disallowed origin parameter.', status: 400 },
      });
      return;
    }

    const popup = req.query.popup === '1' || req.query.popup === 'true';
    const state = crypto.randomBytes(24).toString('hex');
    const cookieOpts = shortLivedCookieOptions();

    res.cookie(OAUTH_STATE_COOKIE, state, cookieOpts);
    res.cookie(OAUTH_ORIGIN_COOKIE, originParam, cookieOpts);
    res.cookie(OAUTH_POPUP_COOKIE, popup ? '1' : '0', cookieOpts);

    const params = new URLSearchParams({
      client_id:     process.env.GOOGLE_OAUTH_CLIENT_ID,
      redirect_uri:  redirectUri,
      response_type: 'code',
      scope:         'openid email profile',
      state,
      prompt:        'select_account',
    });

    res.redirect(`${GOOGLE_AUTH}?${params.toString()}`);
  });

  router.get('/oauth/google/callback', async (req: Request, res: Response): Promise<void> => {
    const frontendOrigin = req.cookies?.[OAUTH_ORIGIN_COOKIE] as string | undefined;
    const cookieState = req.cookies?.[OAUTH_STATE_COOKIE] as string | undefined;
    const popupCookie = req.cookies?.[OAUTH_POPUP_COOKIE] as string | undefined;
    const isPopup = popupCookie === '1';

    const fail = (message: string, code: string) => {
      clearOauthCookies(res);
      if (isPopup && frontendOrigin && isAllowedFrontendOrigin(frontendOrigin)) {
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        res.send(popupResultPage(frontendOrigin, { ok: false, message, code }));
        return;
      }
      res.status(400).send(message);
    };

    if (!frontendOrigin || !isAllowedFrontendOrigin(frontendOrigin)) {
      clearOauthCookies(res);
      res.status(400).send('Invalid OAuth session.');
      return;
    }

    const err = req.query.error as string | undefined;
    if (err) {
      fail('Google sign-in was cancelled or denied.', 'OAUTH_DENIED');
      return;
    }

    const state = req.query.state as string | undefined;
    const code = req.query.code as string | undefined;
    if (!cookieState || !state || cookieState !== state || !code) {
      fail('Invalid OAuth state. Please try again.', 'OAUTH_STATE');
      return;
    }

    if (!process.env.GOOGLE_OAUTH_CLIENT_ID || !process.env.GOOGLE_OAUTH_CLIENT_SECRET) {
      fail('Google sign-in is not configured.', 'GOOGLE_OAUTH_DISABLED');
      return;
    }

    let profile: GoogleProfile;
    try {
      const tok = await exchangeGoogleCode(code);
      profile = await fetchGoogleProfile(tok.access_token);
    } catch (e) {
      fail(e instanceof Error ? e.message : 'Google authentication failed.', 'OAUTH_GOOGLE');
      return;
    }

    if (!profile.sub) {
      fail('Google did not return a user id.', 'OAUTH_PROFILE');
      return;
    }
    if (!profile.email || !profile.email_verified) {
      fail('Google did not return a verified email address.', 'OAUTH_EMAIL');
      return;
    }

    const emailLower = profile.email.toLowerCase();

    const [existingLink] = await db.select().from(oauthAccounts)
      .where(and(eq(oauthAccounts.provider, PROVIDER), eq(oauthAccounts.provider_user_id, profile.sub)))
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
          provider:         PROVIDER,
          provider_user_id: profile.sub,
        });
        const [u] = await db.select().from(users).where(eq(users.id, byEmail.id)).limit(1);
        user = u;
        if (profile.picture && !user.avatar_url) {
          await db.update(users).set({ avatar_url: profile.picture }).where(eq(users.id, user.id));
          user = { ...user, avatar_url: profile.picture };
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
            return;
          }
          res.status(403).json({
            error: {
              code:    'BETA_REQUIRED',
              message: 'Early access has not yet been granted for this email.',
              status:  403,
            },
          });
          return;
        }
      }

      const display_name = (profile.name && profile.name.trim()) || emailLower.split('@')[0] || 'Player';

      const [created] = await db.insert(users).values({
        email:         emailLower,
        password_hash: null,
        display_name,
        avatar_url:    profile.picture ?? null,
        beta_access:   true,
      }).returning();

      await db.insert(oauthAccounts).values({
        user_id:          created.id,
        provider:         PROVIDER,
        provider_user_id: profile.sub,
      });

      user = created;
    }

    if (!user) {
      fail('Could not create or load account.', 'OAUTH_USER');
      return;
    }

    if (betaGateEnabled() && !user.beta_access) {
      fail(
        'Beta access is not enabled for this account. Contact support if you believe this is an error.',
        'BETA_REQUIRED',
      );
      return;
    }

    clearOauthCookies(res);

    await issueSession(res, user);

    if (isPopup) {
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.send(popupResultPage(frontendOrigin, { ok: true }));
      return;
    }

    res.redirect(`${frontendOrigin}/characters`);
  });
}
