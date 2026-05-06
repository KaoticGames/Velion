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

const PROVIDER = 'discord';

const DISCORD_AUTH = 'https://discord.com/oauth2/authorize';
const DISCORD_TOKEN = 'https://discord.com/api/oauth2/token';
const DISCORD_ME = 'https://discord.com/api/users/@me';

const OAUTH_STATE_COOKIE = 'oauth_discord_state';
const OAUTH_ORIGIN_COOKIE = 'oauth_discord_origin';
const OAUTH_POPUP_COOKIE = 'oauth_discord_popup';

function clearOauthCookies(res: Response) {
  const o = shortLivedCookieOptions();
  res.clearCookie(OAUTH_STATE_COOKIE, { ...o, maxAge: undefined });
  res.clearCookie(OAUTH_ORIGIN_COOKIE, { ...o, maxAge: undefined });
  res.clearCookie(OAUTH_POPUP_COOKIE, { ...o, maxAge: undefined });
}

type DiscordMe = {
  id: string;
  username: string;
  global_name?: string | null;
  email?: string | null;
  verified?: boolean;
  avatar?: string | null;
};

const discordRedirectUri = (): string => `${apiPublicBase()}/api/v1/auth/oauth/discord/callback`;

async function exchangeDiscordCode(code: string): Promise<{ access_token: string; token_type: string }> {
  const client_id = process.env.DISCORD_OAUTH_CLIENT_ID!;
  const client_secret = process.env.DISCORD_OAUTH_CLIENT_SECRET!;
  const body = new URLSearchParams({
    client_id,
    client_secret,
    grant_type:   'authorization_code',
    code,
    redirect_uri: discordRedirectUri(),
  });
  const r = await fetch(DISCORD_TOKEN, {
    method:  'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body:    body.toString(),
  });
  if (!r.ok) {
    const t = await r.text();
    throw new Error(`Discord token exchange failed: ${r.status} ${t}`);
  }
  return r.json() as Promise<{ access_token: string; token_type: string }>;
}

async function fetchDiscordMe(accessToken: string): Promise<DiscordMe> {
  const r = await fetch(DISCORD_ME, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!r.ok) {
    const t = await r.text();
    throw new Error(`Discord user lookup failed: ${r.status} ${t}`);
  }
  return r.json() as Promise<DiscordMe>;
}

function discordAvatarUrl(u: DiscordMe): string | null {
  if (!u.avatar) return null;
  // Prefer PNG; Discord avatars can be animated (a_...), but PNG is fine for profile.
  return `https://cdn.discordapp.com/avatars/${u.id}/${u.avatar}.png?size=256`;
}

export function attachDiscordOAuthRoutes(router: Router): void {
  router.get('/oauth/discord/start', async (req: Request, res: Response): Promise<void> => {
    if (!process.env.DISCORD_OAUTH_CLIENT_ID || !process.env.DISCORD_OAUTH_CLIENT_SECRET) {
      res.status(501).json({
        error: { code: 'DISCORD_OAUTH_DISABLED', message: 'Discord sign-in is not configured.', status: 501 },
      });
      return;
    }

    let redirectUri: string;
    try {
      redirectUri = discordRedirectUri();
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
      client_id:     process.env.DISCORD_OAUTH_CLIENT_ID,
      redirect_uri:  redirectUri,
      response_type: 'code',
      scope:         'identify email',
      state,
      prompt:        'consent',
    });

    res.redirect(`${DISCORD_AUTH}?${params.toString()}`);
  });

  router.get('/oauth/discord/callback', async (req: Request, res: Response): Promise<void> => {
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
      fail('Discord sign-in was cancelled or denied.', 'OAUTH_DENIED');
      return;
    }

    const state = req.query.state as string | undefined;
    const code = req.query.code as string | undefined;
    if (!cookieState || !state || cookieState !== state || !code) {
      fail('Invalid OAuth state. Please try again.', 'OAUTH_STATE');
      return;
    }

    if (!process.env.DISCORD_OAUTH_CLIENT_ID || !process.env.DISCORD_OAUTH_CLIENT_SECRET) {
      fail('Discord sign-in is not configured.', 'DISCORD_OAUTH_DISABLED');
      return;
    }

    let me: DiscordMe;
    try {
      const tok = await exchangeDiscordCode(code);
      me = await fetchDiscordMe(tok.access_token);
    } catch (e) {
      fail(e instanceof Error ? e.message : 'Discord authentication failed.', 'OAUTH_DISCORD');
      return;
    }

    if (!me.id) {
      fail('Discord did not return a user id.', 'OAUTH_PROFILE');
      return;
    }
    if (!me.email || !me.verified) {
      fail('Discord did not return a verified email address.', 'OAUTH_EMAIL');
      return;
    }

    const emailLower = me.email.toLowerCase();
    const displayName =
      (me.global_name && me.global_name.trim()) ||
      (me.username && me.username.trim()) ||
      emailLower.split('@')[0] ||
      'Player';

    const user = await findOrCreateOAuthUser({
      provider:          PROVIDER,
      providerUserId:    me.id,
      emailLower,
      displayName,
      avatarUrl:         discordAvatarUrl(me),
      isPopup,
      frontendOrigin,
      clearOauthCookies,
      fail,
      res,
    });

    if (!user) return;

    clearOauthCookies(res);
    await issueOAuthSession(res, user);

    if (isPopup) {
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.send(popupResultPage(frontendOrigin, { ok: true }));
      return;
    }

    res.redirect(`${frontendOrigin}/characters`);
  });
}

