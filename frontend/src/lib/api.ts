/**
 * api.ts — Axios instance for Velion Mythera
 *
 * • Base URL set from VITE_API_URL env variable (differs per mode)
 * • In dev mode with VITE_ENABLE_MOCK_AUTH=true, the /api/* proxy in
 *   vite.config.ts forwards calls to localhost:3001
 * • Access token is kept in memory (Zustand authStore) — never localStorage
 * • Refresh token lives in an HttpOnly cookie (set by the backend)
 * • On 401, attempts one silent `/auth/refresh` before clearing the session
 */

import axios, { type AxiosError, type InternalAxiosRequestConfig } from 'axios';
import { kickToLogin } from '@/lib/authSession';

const BASE_URL = import.meta.env.VITE_API_URL as string;

export const api = axios.create({
  baseURL:         BASE_URL,
  withCredentials: true,   // Required: sends the HttpOnly refresh cookie
  timeout:         15_000,
  headers: {
    'Content-Type': 'application/json',
  },
});

// ── Request interceptor: attach access token ─────────────────────────────
api.interceptors.request.use((config: InternalAxiosRequestConfig) => {
  // Import lazily to avoid circular dep with authStore
  const token = getAccessToken();
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// ── Response interceptor: silent refresh on 401 ──────────────────────────
let isRefreshing = false;
let refreshQueue: Array<(token: string) => void> = [];

api.interceptors.response.use(
  (response) => response,
  async (error: AxiosError) => {
    const original = error.config as (InternalAxiosRequestConfig & { _retry?: boolean }) | undefined;
    if (!original) return Promise.reject(error);

    // Access token rejected after a refresh attempt — end session immediately
    if (error.response?.status === 401 && original._retry) {
      kickToLogin();
      return Promise.reject(error);
    }

    // Only attempt refresh on 401 — not on auth endpoints that use the cookie alone
    if (
      error.response?.status === 401 &&
      !original._retry &&
      !original.url?.includes('/auth/refresh') &&
      !original.url?.includes('/auth/touch')
    ) {
      original._retry = true;

      if (isRefreshing) {
        // Queue this request until refresh completes
        return new Promise((resolve, reject) => {
          refreshQueue.push((newToken) => {
            original.headers.Authorization = `Bearer ${newToken}`;
            // Retries must not reuse an AbortSignal that may already be aborted (e.g. React StrictMode cleanup).
            delete original.signal;
            resolve(api(original));
          });
          // If refresh fails, reject all queued requests
          setTimeout(() => reject(error), 10_000);
        });
      }

      isRefreshing = true;

      try {
        const { data } = await api.post<{ access_token: string }>('/auth/refresh');
        const newToken = data.access_token;

        // Update in-memory token via authStore
        setAccessToken(newToken);

        // Replay queued requests
        refreshQueue.forEach((cb) => cb(newToken));
        refreshQueue = [];

        original.headers.Authorization = `Bearer ${newToken}`;
        delete original.signal;
        return api(original);
      } catch {
        refreshQueue = [];
        kickToLogin();
        return Promise.reject(error);
      } finally {
        isRefreshing = false;
      }
    }

    return Promise.reject(error);
  }
);

// ── Token accessors ───────────────────────────────────────────────────────
// These are set by authStore.ts — defined here to avoid circular imports.
// authStore calls setTokenAccessors() on init to wire these up.

let _getToken: (() => string | null) = () => null;
let _setToken: ((t: string) => void) = () => {};
let _clearAuth: (() => void) = () => {};

export const setTokenAccessors = (
  get: () => string | null,
  set: (t: string) => void,
  clear: () => void,
) => {
  _getToken  = get;
  _setToken  = set;
  _clearAuth = clear;
};

const getAccessToken = () => _getToken();
const setAccessToken = (t: string) => _setToken(t);
const clearAuth      = () => _clearAuth();

// ── API error helper ──────────────────────────────────────────────────────
export interface ApiError {
  code:    string;
  message: string;
  status:  number;
}

export const extractApiError = (err: unknown): ApiError => {
  if (axios.isAxiosError(err) && err.response?.data?.error) {
    return err.response.data.error as ApiError;
  }
  return { code: 'UNKNOWN', message: 'An unexpected error occurred.', status: 500 };
};

export default api;
