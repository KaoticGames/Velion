import type { Response } from 'express';

const REFRESH_DAYS = 7;
const COOKIE_PATH = '/api/v1/auth';

type CookieSameSite = 'strict' | 'lax' | 'none';

const cookieSameSite = (): CookieSameSite => {
  const raw = (process.env.AUTH_COOKIE_SAMESITE ?? '').toLowerCase();
  if (raw === 'none') return 'none';
  if (raw === 'lax') return 'lax';
  if (raw === 'strict') return 'strict';
  return process.env.NODE_ENV === 'production' ? 'none' : 'strict';
};

export const refreshCookieOptions = () => {
  const sameSite = cookieSameSite();
  const secure = process.env.NODE_ENV === 'production' || sameSite === 'none';
  return {
    httpOnly: true,
    secure,
    sameSite,
    maxAge: REFRESH_DAYS * 24 * 60 * 60 * 1000,
    path: COOKIE_PATH,
    domain: process.env.AUTH_COOKIE_DOMAIN || undefined,
  } as const;
};

export const refreshCookieClearOptions = () => {
  const { httpOnly, secure, sameSite, path, domain } = refreshCookieOptions();
  return { httpOnly, secure, sameSite, path, domain } as const;
};

export const setRefreshTokenCookie = (res: Response, token: string) => {
  res.cookie('refresh_token', token, refreshCookieOptions());
};

/** Short-lived OAuth CSRF cookies (same path as auth). */
export const shortLivedCookieOptions = () => {
  const { secure, sameSite, path, domain } = refreshCookieOptions();
  return { httpOnly: true, secure, sameSite, path, domain, maxAge: 600_000 } as const;
};
