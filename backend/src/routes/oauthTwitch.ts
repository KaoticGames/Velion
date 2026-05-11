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

const PROVIDER = 'twitch';

const TWITCH_AUTH = 'https://id.twitch.tv/oauth2/authorize';
const TWITCH_TOKEN = 'https://id.twitch.tv/oauth2/token';
const TWITCH_USERS = 'https://api.twitch.tv/helix/users';

const OAUTH_STATE_COOKIE = 'oauth_twitch_state';
const OAUTH_ORIGIN_COOKIE = 'oauth_twitch_origin';
const OAUTH_POPUP_COOKIE = 'oauth_twitch_popup';

function clearOauthCookies(res: Response) {
  const o = shortLivedCookieOptions();
  res.clearCookie(OAUTH_STATE_COOKIE, { ...o, maxAge: undefined });
  res.clearCookie(OAUTH_ORIGIN_COOKIE, { ...o, maxAge: undefined });
  res.clearCookie(OAUTH_POPUP_COOKIE, { ...o, maxAge: undefined });
}

type TwitchUser = {
  id: string;
  login: string;
  display_name: string;
  email?: string;
  profile_image_url?: string;
};

type TwitchUsersResponse = { data: TwitchUser[] };

const twitchRedirectUri = (): string => `${apiPublicBase()}/api/v1/auth/oauth/twitch/callback`;

async function exchangeTwitchCode(code: string): Promise<{ access_token: string }> {
  const client_id = process.env.TWITCH_OAUTH_CLIENT_ID!;
  const client_secret = process.env.TWITCH_OAUTH_CLIENT_SECRET!;
  const body = new URLSearchParams({
    client_id,
    client_secret,
    code,
    grant_type:   'authorization_code',
    redirect_uri: twitchRedirectUri(),
  });
  const r = await fetch(TWITCH_TOKEN, {
    method:  'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body:    body.toString(),
  });
  if (!r.ok) {
    const t = await r.text();
    throw new Error(`Twitch token exchange failed: ${r.status} ${t}`);
  }
  return r.json() as Promise<{ access_token: string }>;
}

async function fetchTwitchUser(accessToken: string, clientId: string): Promise<TwitchUser | null> {
  const r = await fetch(TWITCH_USERS, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Client-Id':   clientId,
    },
  });
  if (!r.ok) {
    const t = await r.text();
    throw new Error(`Twitch user lookup failed: ${r.status} ${t}`);
  }
  const json = (await r.json()) as TwitchUsersResponse;
  return json.data?.[0] ?? null;
}

export function attachTwitchOAuthRoutes(router: Router): void {
  router.get('/oauth/twitch/start', async (req: Request, res: Response): Promise<void> => {
    if (!process.env.TWITCH_OAUTH_CLIENT_ID || !process.env.TWITCH_OAUTH_CLIENT_SECRET) {
      res.status(501).json({
        error: { code: 'TWITCH_OAUTH_DISABLED', message: 'Twitch sign-in is not configured.', status: 501 },
      });
      return;
    }

    let redirectUri: string;
    try {
      redirectUri = twitchRedirectUri();
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
      client_id:     process.env.TWITCH_OAUTH_CLIENT_ID,
      redirect_uri:  redirectUri,
      response_type: 'code',
      scope:         'user:read:email',
      state,
      force_verify:  'true',
    });

    res.redirect(`${TWITCH_AUTH}?${params.toString()}`);
  });

  router.get('/oauth/twitch/callback', async (req: Request, res: Response): Promise<void> => {
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
      fail('Twitch sign-in was cancelled or denied.', 'OAUTH_DENIED');
      return;
    }

    const state = req.query.state as string | undefined;
    const code = req.query.code as string | undefined;
    if (!cookieState || !state || cookieState !== state || !code) {
      fail('Invalid OAuth state. Please try again.', 'OAUTH_STATE');
      return;
    }

    const clientId = process.env.TWITCH_OAUTH_CLIENT_ID;
    if (!clientId || !process.env.TWITCH_OAUTH_CLIENT_SECRET) {
      fail('Twitch sign-in is not configured.', 'TWITCH_OAUTH_DISABLED');
      return;
    }

    let twUser: TwitchUser | null;
    try {
      const tok = await exchangeTwitchCode(code);
      twUser = await fetchTwitchUser(tok.access_token, clientId);
    } catch (e) {
      fail(e instanceof Error ? e.message : 'Twitch authentication failed.', 'OAUTH_TWITCH');
      return;
    }

    if (!twUser?.id) {
      fail('Twitch did not return a user id.', 'OAUTH_PROFILE');
      return;
    }
    if (!twUser.email?.trim()) {
      fail(
        'Twitch did not return an email. Ensure your Twitch account has a verified email and you granted email access.',
        'OAUTH_EMAIL',
      );
      return;
    }

    const emailLower = twUser.email.trim().toLowerCase();
    const displayName =
      (twUser.display_name && twUser.display_name.trim()) ||
      (twUser.login && twUser.login.trim()) ||
      emailLower.split('@')[0] ||
      'Player';

    const user = await findOrCreateOAuthUser({
      provider:          PROVIDER,
      providerUserId:    twUser.id,
      emailLower,
      displayName,
      avatarUrl:         twUser.profile_image_url ?? null,
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
