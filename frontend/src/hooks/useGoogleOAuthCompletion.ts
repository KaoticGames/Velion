import { useEffect, useRef } from 'react';

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

/**
 * Listens for postMessage from OAuth popups (Google, Twitch, etc.) on the API origin.
 */
export function useGoogleOAuthCompletion(
  onSuccess: () => void | Promise<void>,
  onError: (message: string) => void,
) {
  const onSuccessRef = useRef(onSuccess);
  const onErrorRef = useRef(onError);
  onSuccessRef.current = onSuccess;
  onErrorRef.current = onError;

  useEffect(() => {
    const messageOrigin = oauthPopupOrigin();
    if (!messageOrigin) return;

    const handler = async (e: MessageEvent) => {
      if (e.origin !== messageOrigin) return;
      if (!e.data || e.data.type !== 'velion-oauth') return;
      if (e.data.ok) {
        await Promise.resolve(onSuccessRef.current());
      } else {
        const msg = typeof e.data.message === 'string' ? e.data.message : 'Sign-in failed.';
        onErrorRef.current(msg);
      }
    };

    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  }, []);
}
