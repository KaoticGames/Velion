/** Shared types for special abilities (library templates + character instances). */

export type ResolutionModel =
  | 'narrative'
  | 'weapon_like'
  | 'gem_like'
  | 'healing'
  | 'state_only';

export interface SpecialAbilityTemplate {
  id: string;
  name: string;
  description: string;
  resolution_model: ResolutionModel;
  num_dice?: number | null;
  die_type?: number | null;
  damage_type?: string | null;
  suggested_rp_note?: string | null;
  applies_states?: string[];
  secondary_effect_text?: string | null;
  is_homebrew?: boolean;
  is_public?: boolean;
  created_by?: string | null;
}

export interface CharacterSpecialAbility {
  id: string;
  character_id?: string;
  ability_id?: string | null;
  name: string;
  description: string;
  resolution_model: ResolutionModel;
  num_dice?: number | null;
  die_type?: number | null;
  damage_type?: string | null;
  suggested_rp_note?: string | null;
  applies_states?: string[];
  secondary_effect_text?: string | null;
  sort_order?: number;
}

export type SpecialAbilityDraft = {
  ability_id?: string | null;
  name: string;
  description: string;
  resolution_model: ResolutionModel;
  num_dice?: number | '';
  die_type?: number | '';
  damage_type?: string;
  suggested_rp_note?: string;
  applies_states?: string[];
  secondary_effect_text?: string;
  is_public?: boolean;
  create_library?: boolean;
};

export const RESOLUTION_OPTIONS: { value: ResolutionModel; label: string }[] = [
  { value: 'narrative', label: 'Narrative (table adjudicates)' },
  { value: 'weapon_like', label: 'Attack roll + save (weapon-like)' },
  { value: 'gem_like', label: 'Auto-hit (spell-like)' },
  { value: 'healing', label: 'Healing / recovery' },
  { value: 'state_only', label: 'Apply states' },
];

export const DIE_TYPES = [4, 6, 8, 10, 12, 20] as const;

export const DAMAGE_TYPES = [
  'Physical', 'Fire', 'Ice', 'Lightning', 'Poison', 'Shadow',
  'Radiant', 'Arcane', 'Nature', 'Earth', 'Wind',
];

export const emptyAbilityDraft = (): SpecialAbilityDraft => ({
  name: '',
  description: '',
  resolution_model: 'narrative',
  num_dice: '',
  die_type: 6,
  damage_type: 'Physical',
  suggested_rp_note: '',
  applies_states: [],
  secondary_effect_text: '',
  is_public: false,
});

export const draftFromCharacterRow = (row: CharacterSpecialAbility): SpecialAbilityDraft => ({
  ability_id: row.ability_id,
  name: row.name,
  description: row.description,
  resolution_model: row.resolution_model,
  num_dice: row.num_dice ?? '',
  die_type: row.die_type ?? 6,
  damage_type: row.damage_type ?? 'Physical',
  suggested_rp_note: row.suggested_rp_note ?? '',
  applies_states: Array.isArray(row.applies_states) ? row.applies_states : [],
  secondary_effect_text: row.secondary_effect_text ?? '',
});

export const draftToPayload = (d: SpecialAbilityDraft) => ({
  ability_id: d.ability_id || undefined,
  name: d.name.trim(),
  description: d.description.trim(),
  resolution_model: d.resolution_model,
  num_dice: d.num_dice === '' ? null : Number(d.num_dice),
  die_type: d.die_type === '' ? null : Number(d.die_type),
  damage_type: d.damage_type || null,
  suggested_rp_note: d.suggested_rp_note?.trim() || null,
  applies_states: d.applies_states ?? [],
  secondary_effect_text: d.secondary_effect_text?.trim() || null,
  is_public: d.is_public,
  create_library: !d.ability_id,
});

/** Shim for reusing weapon attack modal. */
export const abilityAsWeapon = (a: CharacterSpecialAbility) => ({
  id: a.id,
  name: a.name,
  rarity: 'Common',
  dieType: `d${a.die_type || 6}`,
  channels: [{
    element: a.damage_type || 'Physical',
    dice: Number(a.num_dice) || 1,
  }],
  attrReq: '',
  notes: a.description,
});

/** Shim for reusing gem attack modal. */
export const abilityAsGem = (a: CharacterSpecialAbility) => ({
  id: a.id,
  element: a.damage_type || 'Arcane',
  rarity: 'Common',
  num_dice: Number(a.num_dice) || 1,
  die_type: Number(a.die_type) || 6,
  notes: a.suggested_rp_note || a.description,
});

export const canRollAbility = (a: CharacterSpecialAbility) =>
  a.resolution_model === 'weapon_like' || a.resolution_model === 'gem_like';
