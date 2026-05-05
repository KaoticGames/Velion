import { useEffect } from 'react';
import { useAuthStore } from '@/store/authStore';

/**
 * Sliding 7-day session: on real user activity, call `/auth/touch` (throttled + debounced).
 * Covers character sheet, VTT, compendium — any route using the SPA window.
 */
const TOUCH_MIN_INTERVAL_MS = 5 * 60 * 1000;
const TOUCH_DEBOUNCE_MS = 2000;

export function useSessionActivityExtend() {
  const mockAuth = import.meta.env.VITE_ENABLE_MOCK_AUTH === 'true';
  const user = useAuthStore((s) => s.user);
  const isReady = useAuthStore((s) => s.isReady);
  const touchSession = useAuthStore((s) => s.touchSession);

  useEffect(() => {
    if (mockAuth || !isReady || !user) return;

    let debounceId: ReturnType<typeof setTimeout> | null = null;
    let lastTouchAt = 0;

    const maybeTouch = () => {
      const now = Date.now();
      if (now - lastTouchAt < TOUCH_MIN_INTERVAL_MS) return;
      lastTouchAt = now;
      void touchSession();
    };

    const schedule = () => {
      if (debounceId != null) clearTimeout(debounceId);
      debounceId = setTimeout(() => {
        debounceId = null;
        maybeTouch();
      }, TOUCH_DEBOUNCE_MS);
    };

    const opts: AddEventListenerOptions = { capture: true, passive: true };
    window.addEventListener('pointerdown', schedule, opts);
    window.addEventListener('keydown', schedule, opts);
    window.addEventListener('wheel', schedule, opts);

    const onVis = () => {
      if (document.visibilityState === 'visible') schedule();
    };
    document.addEventListener('visibilitychange', onVis);

    return () => {
      if (debounceId != null) clearTimeout(debounceId);
      window.removeEventListener('pointerdown', schedule, opts);
      window.removeEventListener('keydown', schedule, opts);
      window.removeEventListener('wheel', schedule, opts);
      document.removeEventListener('visibilitychange', onVis);
    };
  }, [mockAuth, isReady, user, touchSession]);
}
