import type { SpecialAbility } from '../db/schema';

export type SpecialAbilityPayload = {
  name: string;
  description?: string;
  resolution_model?: string;
  num_dice?: number | null;
  die_type?: number | null;
  damage_type?: string | null;
  suggested_rp_note?: string | null;
  applies_states?: string[] | unknown;
  secondary_effect_text?: string | null;
  ability_id?: string | null;
};

const RESOLUTION_MODELS = new Set([
  'narrative', 'weapon_like', 'gem_like', 'healing', 'state_only',
]);

export const normalizeResolutionModel = (v?: string): string =>
  v && RESOLUTION_MODELS.has(v) ? v : 'narrative';

const normalizeAppliesStates = (v: unknown): string[] => {
  if (Array.isArray(v)) return v.filter((x): x is string => typeof x === 'string');
  return [];
};

export const rowFromTemplate = (template: SpecialAbility) => ({
  ability_id: template.id,
  name: template.name,
  description: template.description ?? '',
  resolution_model: template.resolution_model ?? 'narrative',
  num_dice: template.num_dice ?? null,
  die_type: template.die_type ?? null,
  damage_type: template.damage_type ?? null,
  suggested_rp_note: template.suggested_rp_note ?? null,
  applies_states: normalizeAppliesStates(template.applies_states),
  secondary_effect_text: template.secondary_effect_text ?? null,
});

export const rowFromPayload = (payload: SpecialAbilityPayload, abilityId: string | null = null) => ({
  ability_id: abilityId ?? payload.ability_id ?? null,
  name: String(payload.name ?? '').trim(),
  description: String(payload.description ?? '').trim(),
  resolution_model: normalizeResolutionModel(payload.resolution_model),
  num_dice: payload.num_dice != null ? Number(payload.num_dice) : null,
  die_type: payload.die_type != null ? Number(payload.die_type) : null,
  damage_type: payload.damage_type ?? null,
  suggested_rp_note: payload.suggested_rp_note ?? null,
  applies_states: normalizeAppliesStates(payload.applies_states),
  secondary_effect_text: payload.secondary_effect_text ?? null,
});

export const validateAbilityPayload = (payload: SpecialAbilityPayload): string | null => {
  if (!payload.name || String(payload.name).trim().length < 1) {
    return 'Ability name is required.';
  }
  return null;
};
