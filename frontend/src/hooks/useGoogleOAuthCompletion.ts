import { useEffect, useRef } from 'react';
import type { AuthUser } from '@/store/authStore';

/** Payload from `popupResultPage` after Google / Twitch / Discord OAuth. */
export type VelionOAuthMessage = {
  type: 'velion-oauth';
  ok?: boolean;
  access_token?: string;
  user?: AuthUser;
  message?: string;
  code?: string;
};

/** Origin that serves `/auth/oauth/.../callback` HTML (the popup's document origin when it posts back). */
function oauthPopupOrigin(): string {
  const raw = (import.meta.env.VITE_API_URL as string | undefined) ?? '';
  try {
    return new URL(raw).origin;
  } catch {
    // Relative base (e.g. `/api/v1` with Vite proxy) — OAuth runs on the same host as the SPA.
    if (typeof window !== 'undefined') return window.location.origin;
    return '';
  }
}

function allowedMessageOrigins(): Set<string> {
  const s = new Set<string>();
  const api = oauthPopupOrigin();
  if (api) s.add(api);
  if (typeof window !== 'undefined') s.add(window.location.origin);
  return s;
}

/**
 * Listens for postMessage from OAuth popups (Google, Twitch, etc.).
 * Accepts messages from the API host and the SPA host so proxy / split deployments still work.
 */
export function useGoogleOAuthCompletion(
  onSuccess: (msg: VelionOAuthMessage) => void | Promise<void>,
  onError: (message: string) => void,
) {
  const onSuccessRef = useRef(onSuccess);
  const onErrorRef = useRef(onError);
  onSuccessRef.current = onSuccess;
  onErrorRef.current = onError;

  useEffect(() => {
    const origins = allowedMessageOrigins();
    if (origins.size === 0) return;

    const handler = async (e: MessageEvent) => {
      if (!origins.has(e.origin)) return;
      const data = e.data as VelionOAuthMessage | null;
      if (!data || data.type !== 'velion-oauth') return;
      if (data.ok) {
        await Promise.resolve(onSuccessRef.current(data));
      } else {
        const msg = typeof data.message === 'string' ? data.message : 'Sign-in failed.';
        onErrorRef.current(msg);
      }
    };

    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  }, []);
}
