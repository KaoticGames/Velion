import type { Request, Response, Router } from 'express';
import crypto from 'crypto';
import { shortLivedCookieOptions } from '../lib/refreshCookie';
import {
  apiPublicBase,
  findOrCreateOAuthUser,
  isAllowedFrontendOrigin,
  issueOAuthSession,
  popupResultPage,
} from '../lib/oauthCommon';

const PROVIDER = 'google';

const GOOGLE_AUTH = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN = 'https://oauth2.googleapis.com/token';
const GOOGLE_USERINFO = 'https://www.googleapis.com/oauth2/v3/userinfo';

const OAUTH_STATE_COOKIE = 'oauth_google_state';
const OAUTH_ORIGIN_COOKIE = 'oauth_google_origin';
const OAUTH_POPUP_COOKIE = 'oauth_google_popup';

function clearOauthCookies(res: Response) {
  const o = shortLivedCookieOptions();
  res.clearCookie(OAUTH_STATE_COOKIE, { ...o, maxAge: undefined });
  res.clearCookie(OAUTH_ORIGIN_COOKIE, { ...o, maxAge: undefined });
  res.clearCookie(OAUTH_POPUP_COOKIE, { ...o, maxAge: undefined });
}

type GoogleProfile = {
  sub: string;
  email?: string;
  email_verified?: boolean;
  name?: string;
  picture?: string;
};

const googleRedirectUri = (): string => `${apiPublicBase()}/api/v1/auth/oauth/google/callback`;

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
    const display_name =
      (profile.name && profile.name.trim()) || emailLower.split('@')[0] || 'Player';

    const user = await findOrCreateOAuthUser({
      provider:          PROVIDER,
      providerUserId:    profile.sub,
      emailLower,
      displayName:       display_name,
      avatarUrl:         profile.picture ?? null,
      isPopup,
      frontendOrigin,
      clearOauthCookies,
      fail,
      res,
    });

    if (!user) return;

    clearOauthCookies(res);
    const session = await issueOAuthSession(res, user);

    if (isPopup) {
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.send(popupResultPage(frontendOrigin, {
        ok:            true,
        access_token:  session.access_token,
        user:          session.user,
      }));
      return;
    }

    res.redirect(`${frontendOrigin}/home`);
  });
}
