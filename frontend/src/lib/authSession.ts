/**
 * Session management + forced re-auth (no React context).
 * kickHandler is wired from authStore on module load.
 *
 * Access tokens eventually expire; we call **`/auth/touch`** before `exp` to slide the
 * 7-day session window and mint a new access JWT. We do not log out at access `exp`.
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
 * Schedule `/auth/touch` before the access JWT expires (slides the 7-day window).
 * The callback should swallow non-fatal errors; 401 is handled inside `touchSession`.
 */
export function scheduleProactiveAccessRefresh(
  getToken: () => string | null,
  touch: () => Promise<void>,
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
  refreshTimer = setTimeout(() => {
    refreshTimer = null;
    void touch();
  }, delay);
}

/** Socket.io handshake failures when the access token is rejected or expired. */
export function isSocketSessionAuthFailure(err: unknown): boolean {
  const m = String((err as Error)?.message ?? err ?? '');
  return /TOKEN_INVALID|UNAUTHORIZED|jwt expired|invalid token/i.test(m);
}
