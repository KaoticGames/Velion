/**
 * Session management + forced re-auth (no React context).
 * kickHandler is wired from authStore on module load.
 *
 * Access tokens eventually expire; we **refresh** before `exp` using the HttpOnly
 * refresh cookie (same as `/auth/refresh` on 401). We do not log out at `exp` —
 * that was forcing ~15m logouts when the JWT lifetime was short and bypassed
 * the refresh flow.
 */

let kickHandler: () => void = () => {};

export function setSessionKickHandler(fn: () => void) {
  kickHandler = fn;
}

/** Clear session and let ProtectedRoute send the user to /login (SPA). */
export function kickToLogin() {
  kickHandler();
}

let refreshTimer: ReturnType<typeof setTimeout> | null = null;

function decodeJwtExpMs(token: string): number | null {
  try {
    const seg = token.split('.')[1];
    if (!seg) return null;
    const b64 = seg.replace(/-/g, '+').replace(/_/g, '/');
    const pad = b64.length % 4 === 0 ? '' : '='.repeat(4 - (b64.length % 4));
    const payload = JSON.parse(atob(b64 + pad)) as { exp?: number };
    return typeof payload.exp === 'number' ? payload.exp * 1000 : null;
  } catch {
    return null;
  }
}

/** Refresh this long before access JWT `exp` (rolling session / avoids idle expiry). */
const REFRESH_BEFORE_EXPIRY_MS = 2 * 60 * 1000;

/**
 * Schedule a silent `/auth/refresh` before the access JWT expires.
 * On refresh failure, kicks to login (cookie revoked / expired).
 */
export function scheduleProactiveAccessRefresh(
  getToken: () => string | null,
  refresh: () => Promise<void>,
) {
  if (refreshTimer) {
    clearTimeout(refreshTimer);
    refreshTimer = null;
  }
  const token = getToken();
  if (!token) return;
  const expMs = decodeJwtExpMs(token);
  if (!expMs) return;
  const now = Date.now();
  const msUntilExp = expMs - now;
  let delay: number;
  if (msUntilExp <= 0) {
    delay = 0;
  } else {
    const ideal = msUntilExp - REFRESH_BEFORE_EXPIRY_MS;
    delay = ideal > 0 ? ideal : Math.max(5_000, Math.floor(msUntilExp / 2));
  }
  refreshTimer = setTimeout(async () => {
    refreshTimer = null;
    try {
      await refresh();
    } catch {
      kickToLogin();
    }
  }, delay);
}

/** Socket.io handshake failures when the access token is rejected or expired. */
export function isSocketSessionAuthFailure(err: unknown): boolean {
  const m = String((err as Error)?.message ?? err ?? '');
  return /TOKEN_INVALID|UNAUTHORIZED|jwt expired|invalid token/i.test(m);
}
