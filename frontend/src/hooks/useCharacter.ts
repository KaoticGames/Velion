/**
 * useCharacter.ts — Data fetching and mutations for a single character.
 *
 * All REST operations defined in the SheetSpec Section 4.2 flow through here.
 * The character sheet component calls these instead of calling api.* directly,
 * keeping async logic out of the UI layer.
 *
 * When the backend is not yet running (dev, mock mode), calls will fail
 * gracefully — the character sheet continues to work in local-state mode.
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api, { extractApiError } from '@/lib/api';

// ── Types ─────────────────────────────────────────────────────────────────

export interface CharacterSummary {
  id:            string;
  name:          string;
  level:         number;
  portrait_url:  string | null;
  chosen_attribute: string;
  base_rp:       number;
  /** Spendable RP this turn (persisted; VTT + sheet). */
  current_rp?:   number;
  rp_banked?:    number;
  rp_banking?:   boolean;
  max_hp:        number;
  current_hp:    number;
  updated_at?:   string;
}

export interface CharacterDetail extends CharacterSummary {
  power:             number;
  agility:           number;
  focus:             number;
  presence:          number;
  growth_pool_total: number;
  backstory:         string;
  notes?:            string;
  gold?:             number;
  equipment:         EquipmentSlot[];
  bracer_gems:       BracerGem[];
  growth_pool_history: GrowthPoolEntry[];
}

export interface EquipmentSlot {
  slot:      string;
  item_type: 'weapon' | 'armor' | 'focus_bracer';
  item_id:   string;
  item:      Record<string, unknown>;
}

export interface BracerGem {
  gem_slot_index: number;
  spell_gem_id:   string;
  gem:            Record<string, unknown>;
}

export interface GrowthPoolEntry {
  level_gained: number;
  roll_result:  number;
}

// ── Keys ──────────────────────────────────────────────────────────────────

export const characterKeys = {
  all:    ()   => ['characters'] as const,
  list:   ()   => [...characterKeys.all(), 'list'] as const,
  detail: (id: string) => [...characterKeys.all(), 'detail', id] as const,
};

// ── Hooks ──────────────────────────────────────────────────────────────────

/**
 * Fetch a single character's full detail.
 * Returns null silently if characterId is undefined (not yet known).
 */
export function useCharacter(characterId: string | undefined) {
  return useQuery({
    queryKey:  characterKeys.detail(characterId ?? ''),
    queryFn:   async () => {
      const { data } = await api.get<CharacterDetail>(`/characters/${characterId}`);
      return data;
    },
    enabled:   !!characterId,
    staleTime: 30_000,
    refetchOnWindowFocus: true,
  });
}

/**
 * Fetch all characters belonging to the current user.
 */
export function useCharacterList() {
  return useQuery({
    queryKey: characterKeys.list(),
    queryFn:  async () => {
      const { data } = await api.get<{ data: CharacterSummary[] }>('/characters');
      return data.data;
    },
    staleTime: 60_000,
  });
}

/**
 * Generic PATCH mutation for character fields.
 * Used for: name, backstory, notes, gold, current_hp, chosen_attribute.
 */
export function usePatchCharacter(characterId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (patch: Partial<CharacterDetail>) => {
      const { data } = await api.patch<CharacterDetail>(`/characters/${characterId}`, patch);
      return data;
    },
    onSuccess: (updated) => {
      qc.setQueryData(characterKeys.detail(characterId), updated);
    },
    onError: (err) => {
      console.warn('[useCharacter] PATCH failed:', extractApiError(err));
    },
  });
}

/**
 * Level-up mutation — POST /characters/:id/level-up
 * Rolls 1d6 growth pool, validates attribute distribution, optionally changes
 * chosen attribute.
 */
export function useLevelUp(characterId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (payload: {
      attribute_points: Record<string, number>;
      chosen_attribute: string;
      growth_roll:      number;
    }) => {
      const { data } = await api.post<CharacterDetail>(
        `/characters/${characterId}/level-up`,
        payload,
      );
      return data;
    },
    onSuccess: (updated) => {
      qc.setQueryData(characterKeys.detail(characterId), updated);
      qc.invalidateQueries({ queryKey: characterKeys.list() });
    },
  });
}

/**
 * Equip an item to a slot.
 * PUT /characters/:id/equipment/:slot
 */
export function useEquipItem(characterId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (payload: {
      slot:      string;
      item_type: 'weapon' | 'armor' | 'focus_bracer';
      item_id:   string;
    }) => {
      const { data } = await api.put(
        `/characters/${characterId}/equipment/${payload.slot}`,
        { item_type: payload.item_type, item_id: payload.item_id },
      );
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: characterKeys.detail(characterId) });
    },
  });
}

/**
 * Unequip a slot.
 * DELETE /characters/:id/equipment/:slot
 */
export function useUnequipSlot(characterId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (slot: string) => {
      await api.delete(`/characters/${characterId}/equipment/${slot}`);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: characterKeys.detail(characterId) });
    },
  });
}

/**
 * Update bracer gems.
 * PUT /characters/:id/bracer-gems
 */
export function useUpdateBracerGems(characterId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (gems: Array<{ slot_index: number; spell_gem_id: string }>) => {
      const { data } = await api.put(`/characters/${characterId}/bracer-gems`, { gems });
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: characterKeys.detail(characterId) });
    },
  });
}

/**
 * Create a new character.
 * POST /characters
 */
export function useCreateCharacter() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (payload: Record<string, unknown>) => {
      const { data } = await api.post<CharacterDetail>('/characters', payload);
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: characterKeys.list() });
    },
  });
}
