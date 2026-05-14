/**
 * authStore.ts — Global authentication state (Zustand)
 *
 * Access token is stored IN MEMORY ONLY (never localStorage/sessionStorage).
 * Refresh token is an HttpOnly cookie managed by the browser + backend.
 *
 * Session length is a **sliding 7-day** window: `POST /auth/touch` (activity, throttled)
 * and proactive timers extend `expires_at` + new JWTs. Full rotation uses `/auth/refresh`
 * (login hydrate, 401 recovery).
 */

import axios from 'axios';
import { create } from 'zustand';
import api, { setTokenAccessors } from '@/lib/api';
import { setSessionKickHandler, scheduleProactiveAccessRefresh } from '@/lib/authSession';

const AUTH_SYNC_CHANNEL = 'velion-auth-sync';
const AUTH_SYNC_STORAGE_KEY = 'velion:auth-sync';
const authSyncSourceId =
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;

type AuthSyncEvent = {
  id: string;
  sourceId: string;
  type: 'login' | 'logout';
  at: number;
};

function createAuthSyncEvent(type: AuthSyncEvent['type']): AuthSyncEvent {
  const at = Date.now();
  return {
    id: `${authSyncSourceId}:${type}:${at}`,
    sourceId: authSyncSourceId,
    type,
    at,
  };
}

function broadcastAuthSync(type: AuthSyncEvent['type']) {
  if (typeof window === 'undefined') return;

  const event = createAuthSyncEvent(type);

  if ('BroadcastChannel' in window) {
    const channel = new BroadcastChannel(AUTH_SYNC_CHANNEL);
    channel.postMessage(event);
    channel.close();
  }

  try {
    localStorage.setItem(AUTH_SYNC_STORAGE_KEY, JSON.stringify(event));
    localStorage.removeItem(AUTH_SYNC_STORAGE_KEY);
  } catch {
    // Some privacy modes block localStorage; BroadcastChannel is enough when available.
  }
}

function isAuthSyncEvent(value: unknown): value is AuthSyncEvent {
  if (!value || typeof value !== 'object') return false;
  const event = value as Partial<AuthSyncEvent>;
  return (
    typeof event.id === 'string' &&
    typeof event.sourceId === 'string' &&
    (event.type === 'login' || event.type === 'logout') &&
    typeof event.at === 'number'
  );
}

export type SubscriptionTier = 'free' | 'player' | 'dm';

export interface AuthUser {
  id:                string;
  email:             string;
  display_name:      string;
  avatar_url:        string | null;
  bio?:              string | null;
  social_handle?:    string | null;
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
  /** POST /auth/refresh — token rotation; hydrate + 401 recovery */
  refreshSession: () => Promise<void>;
  /** Apply access token + user from OAuth popup (avoids refresh race before cookie is visible to parent). */
  bootstrapSession: (access_token: string, user: AuthUser) => void;
  /** POST /auth/touch — slide 7-day window (same refresh row); activity + proactive timer */
  touchSession: () => Promise<void>;

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
    broadcastAuthSync('login');
  },

  // ── Register ───────────────────────────────────────────────────────────
  register: async (email, password, displayName) => {
    const { data } = await api.post<{ access_token: string; user: AuthUser }>('/auth/register', {
      email,
      password,
      display_name: displayName,
    });
    set({ user: data.user, accessToken: data.access_token });
    broadcastAuthSync('login');
  },

  // ── Logout ─────────────────────────────────────────────────────────────
  logout: async () => {
    try {
      await api.post('/auth/logout');
    } catch {
      // Best-effort — clear local state regardless
    }
    set({ user: null, accessToken: null });
    broadcastAuthSync('logout');
  },

  refreshSession: async () => {
    const { data } = await api.post<{ access_token: string; user: AuthUser }>('/auth/refresh');
    set({ user: data.user, accessToken: data.access_token });
  },

  bootstrapSession: (access_token, user) => {
    set({ accessToken: access_token, user });
    broadcastAuthSync('login');
  },

  touchSession: async () => {
    try {
      const { data } = await api.post<{ access_token: string; user: AuthUser }>('/auth/touch');
      set({ user: data.user, accessToken: data.access_token });
    } catch (e) {
      if (axios.isAxiosError(e) && e.response?.status === 401) {
        try {
          // Touch can fail transiently (stale cookie/token race). Try full rotation once.
          await get().refreshSession();
        } catch {
          set({ user: null, accessToken: null });
        }
      }
    }
  },

  // ── Hydrate (silent refresh on app load) ───────────────────────────────
  hydrate: async () => {
    set({ isLoading: true });
    try {
      await get().refreshSession();
    } catch {
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

const handledAuthSyncEventIds = new Set<string>();

function handleAuthSyncEvent(value: unknown) {
  if (!isAuthSyncEvent(value)) return;
  if (value.sourceId === authSyncSourceId) return;
  if (handledAuthSyncEventIds.has(value.id)) return;
  handledAuthSyncEventIds.add(value.id);

  if (value.type === 'logout') {
    useAuthStore.getState()._clearAuth();
    return;
  }

  void useAuthStore.getState().refreshSession().catch(() => {
    // Another tab may have emitted before the cookie was visible here; leave this tab unchanged.
  });
}

if (typeof window !== 'undefined') {
  if ('BroadcastChannel' in window) {
    const channel = new BroadcastChannel(AUTH_SYNC_CHANNEL);
    channel.addEventListener('message', (event) => handleAuthSyncEvent(event.data));
  }

  window.addEventListener('storage', (event) => {
    if (event.key !== AUTH_SYNC_STORAGE_KEY || !event.newValue) return;
    try {
      handleAuthSyncEvent(JSON.parse(event.newValue) as unknown);
    } catch {
      // Ignore malformed cross-tab notifications.
    }
  });
}

let lastScheduledAccessToken: string | null | undefined = undefined;
useAuthStore.subscribe((state) => {
  if (state.accessToken === lastScheduledAccessToken) return;
  lastScheduledAccessToken = state.accessToken ?? null;
  scheduleProactiveAccessRefresh(
    () => useAuthStore.getState().accessToken,
    () => useAuthStore.getState().touchSession(),
  );
});
scheduleProactiveAccessRefresh(
  () => useAuthStore.getState().accessToken,
  () => useAuthStore.getState().touchSession(),
);

// ── Convenience selectors ─────────────────────────────────────────────────
export const selectUser    = (s: AuthState) => s.user;
export const selectIsDM    = (s: AuthState) => s.user?.subscription_tier === 'dm';
export const selectIsReady = (s: AuthState) => s.isReady;
