import { useEffect, useRef } from 'react';

/**
 * Listens for postMessage from the Google OAuth popup (callback page on the API origin).
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
    let apiOrigin: string;
    try {
      apiOrigin = new URL(import.meta.env.VITE_API_URL as string).origin;
    } catch {
      return;
    }

    const handler = async (e: MessageEvent) => {
      if (e.origin !== apiOrigin) return;
      if (!e.data || e.data.type !== 'velion-oauth') return;
      if (e.data.ok) {
        await Promise.resolve(onSuccessRef.current());
      } else {
        const msg = typeof e.data.message === 'string' ? e.data.message : 'Google sign-in failed.';
        onErrorRef.current(msg);
      }
    };

    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  }, []);
}
