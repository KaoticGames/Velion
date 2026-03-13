/**
 * useHomebrew.ts
 *
 * Data hooks for the Homebrew Workshop.
 * All write operations require a paid subscription (enforced server-side).
 *
 * Item types:
 *   weapon | armor | spell-gem | enemy | pet
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '@/lib/api';

// ── Types ─────────────────────────────────────────────────────────────────

export type HomebrewType =
  | 'weapon'
  | 'armor'
  | 'spell-gem'
  | 'enemy'
  | 'pet';

const ENDPOINT: Record<HomebrewType, string> = {
  'weapon':    'weapons',
  'armor':     'armor',
  'spell-gem': 'spell-gems',
  'enemy':     'enemies',
  'pet':       'pets',
};

export interface DuplicateMatch {
  id:   string;
  name: string;
}

export interface VersionEntry {
  id:       string;
  version:  number;
  snapshot: Record<string, unknown>;
  saved_at: string;
}

// ── Query keys ────────────────────────────────────────────────────────────

export const homebrewKeys = {
  mine:     (type: HomebrewType) => ['homebrew', 'mine', type] as const,
  versions: (type: HomebrewType, id: string) => ['homebrew', 'versions', type, id] as const,
};

// ── Hooks ─────────────────────────────────────────────────────────────────

/** Fetch all homebrew items of one type owned by the current user */
export function useMyHomebrew(type: HomebrewType) {
  const ep = ENDPOINT[type];
  return useQuery({
    queryKey: homebrewKeys.mine(type),
    queryFn:  async () => {
      const { data } = await api.get<{ data: Record<string, unknown>[] }>(`/library/${ep}/mine`);
      return data.data;
    },
    staleTime: 60_000,
  });
}

/** Create a new homebrew item */
export function useCreateHomebrew(type: HomebrewType) {
  const qc = useQueryClient();
  const ep = ENDPOINT[type];
  return useMutation({
    mutationFn: async (payload: Record<string, unknown>) => {
      const { data } = await api.post<Record<string, unknown>>(`/library/${ep}`, payload);
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: homebrewKeys.mine(type) });
    },
  });
}

/** Update an existing homebrew item — automatically snapshots the previous version */
export function usePatchHomebrew(type: HomebrewType) {
  const qc = useQueryClient();
  const ep = ENDPOINT[type];
  return useMutation({
    mutationFn: async ({ id, ...patch }: Record<string, unknown>) => {
      const { data } = await api.patch<Record<string, unknown>>(`/library/${ep}/${id}`, patch);
      return data;
    },
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: homebrewKeys.mine(type) });
      qc.invalidateQueries({ queryKey: homebrewKeys.versions(type, vars.id as string) });
    },
  });
}

/** Delete a homebrew item (owner only) */
export function useDeleteHomebrew(type: HomebrewType) {
  const qc = useQueryClient();
  const ep = ENDPOINT[type];
  return useMutation({
    mutationFn: async (id: string) => {
      await api.delete(`/library/${ep}/${id}`);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: homebrewKeys.mine(type) });
    },
  });
}

/**
 * Check for near-duplicate items before saving.
 * Returns an array of existing items with matching stats.
 */
export function useDuplicateCheck() {
  return useMutation({
    mutationFn: async (payload: Record<string, unknown>): Promise<DuplicateMatch[]> => {
      const { data } = await api.post<{ duplicates: DuplicateMatch[] }>('/library/duplicate-check', payload);
      return data.duplicates;
    },
  });
}

/** Fetch the version history for a specific homebrew item */
export function useVersionHistory(type: HomebrewType, id: string | null) {
  const ep = ENDPOINT[type];
  return useQuery({
    queryKey: homebrewKeys.versions(type, id ?? ''),
    queryFn:  async () => {
      const { data } = await api.get<{ data: VersionEntry[] }>(`/library/${ep}/${id}/versions`);
      return data.data;
    },
    enabled:   !!id,
    staleTime: 30_000,
  });
}