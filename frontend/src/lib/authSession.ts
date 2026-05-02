/**
 * Session expiry + forced re-auth (no React context).
 * kickHandler is wired from authStore on module load.
 */

let kickHandler: () => void = () => {};

export function setSessionKickHandler(fn: () => void) {
  kickHandler = fn;
}

/** Clear session and let ProtectedRoute send the user to /login (SPA). */
export function kickToLogin() {
  kickHandler();
}

let expiryTimer: ReturnType<typeof setTimeout> | null = null;

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

/** Re-schedule client-side logout when the access JWT expires (no HTTP round-trip). */
export function scheduleAccessTokenExpiry(getToken: () => string | null) {
  if (expiryTimer) {
    clearTimeout(expiryTimer);
    expiryTimer = null;
  }
  const token = getToken();
  if (!token) return;
  const expMs = decodeJwtExpMs(token);
  if (!expMs) return;
  const delay = Math.max(0, expMs - Date.now());
  expiryTimer = setTimeout(() => {
    expiryTimer = null;
    kickToLogin();
  }, delay);
}

/** Socket.io handshake failures when the access token is rejected or expired. */
export function isSocketSessionAuthFailure(err: unknown): boolean {
  const m = String((err as Error)?.message ?? err ?? '');
  return /TOKEN_INVALID|UNAUTHORIZED|jwt expired|invalid token/i.test(m);
}
