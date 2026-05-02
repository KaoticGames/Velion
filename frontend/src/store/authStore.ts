/**
 * authStore.ts — Global authentication state (Zustand)
 *
 * Access token is stored IN MEMORY ONLY (never localStorage/sessionStorage).
 * Refresh token is an HttpOnly cookie managed by the browser + backend.
 *
 * On app load, the store attempts a silent token refresh to restore session
 * from the existing cookie, enabling persistent login without XSS exposure.
 */

import { create } from 'zustand';
import api, { setTokenAccessors, extractApiError } from '@/lib/api';
import { setSessionKickHandler, scheduleAccessTokenExpiry } from '@/lib/authSession';

export type SubscriptionTier = 'free' | 'player' | 'dm';

export interface AuthUser {
  id:                string;
  email:             string;
  display_name:      string;
  avatar_url:        string | null;
  subscription_tier: SubscriptionTier;
  /** From API; when beta gate is on, server requires this to be true to log in / refresh. */
  beta_access?:      boolean;
}

interface AuthState {
  user:        AuthUser | null;
  accessToken: string | null;
  isLoading:   boolean;    // true during initial hydration
  isReady:     boolean;    // true once hydration attempt is done

  // Actions
  login:    (email: string, password: string) => Promise<void>;
  register: (email: string, password: string, displayName: string) => Promise<void>;
  logout:   () => Promise<void>;
  hydrate:  () => Promise<void>;          // called once on app mount

  // Internal — used by api.ts interceptor
  _setToken: (token: string) => void;
  _clearAuth: () => void;
}

export const useAuthStore = create<AuthState>((set, get) => ({
  user:        null,
  accessToken: null,
  isLoading:   true,
  isReady:     false,

  // ── Login ──────────────────────────────────────────────────────────────
  login: async (email, password) => {
    const { data } = await api.post<{ access_token: string; user: AuthUser }>('/auth/login', {
      email,
      password,
    });
    set({ user: data.user, accessToken: data.access_token });
  },

  // ── Register ───────────────────────────────────────────────────────────
  register: async (email, password, displayName) => {
    const { data } = await api.post<{ access_token: string; user: AuthUser }>('/auth/register', {
      email,
      password,
      display_name: displayName,
    });
    set({ user: data.user, accessToken: data.access_token });
  },

  // ── Logout ─────────────────────────────────────────────────────────────
  logout: async () => {
    try {
      await api.post('/auth/logout');
    } catch {
      // Best-effort — clear local state regardless
    }
    set({ user: null, accessToken: null });
  },

  // ── Hydrate (silent refresh on app load) ───────────────────────────────
  hydrate: async () => {
    set({ isLoading: true });
    try {
      const { data } = await api.post<{ access_token: string; user: AuthUser }>('/auth/refresh');
      set({ user: data.user, accessToken: data.access_token });
    } catch {
      // No valid session — user will need to log in
      set({ user: null, accessToken: null });
    } finally {
      set({ isLoading: false, isReady: true });
    }
  },

  // ── Internal token management (wired to api.ts interceptor) ───────────
  _setToken:  (token) => set({ accessToken: token }),
  _clearAuth: ()      => set({ user: null, accessToken: null }),
}));

// Wire the api interceptor to the store's token management
// This runs once when the module is imported, before any component mounts.
const store = useAuthStore.getState();
setTokenAccessors(
  ()      => useAuthStore.getState().accessToken,
  (token) => useAuthStore.getState()._setToken(token),
  ()      => useAuthStore.getState()._clearAuth(),
);
// Suppress unused var warning — store access intentional
void store;

setSessionKickHandler(() => {
  useAuthStore.getState()._clearAuth();
});

let lastScheduledAccessToken: string | null | undefined = undefined;
useAuthStore.subscribe((state) => {
  if (state.accessToken === lastScheduledAccessToken) return;
  lastScheduledAccessToken = state.accessToken ?? null;
  scheduleAccessTokenExpiry(() => useAuthStore.getState().accessToken);
});
scheduleAccessTokenExpiry(() => useAuthStore.getState().accessToken);

// ── Convenience selectors ─────────────────────────────────────────────────
export const selectUser    = (s: AuthState) => s.user;
export const selectIsDM    = (s: AuthState) => s.user?.subscription_tier === 'dm';
export const selectIsReady = (s: AuthState) => s.isReady;
