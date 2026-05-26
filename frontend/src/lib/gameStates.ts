/** Canonical active-state definitions (Compendium + character sheet). */
export type GameStateCategory = 'Control' | 'Capacity' | 'Damage' | 'Altered' | 'Structural';

export type GameState = {
  name: string;
  cat: GameStateCategory;
  /** Optional Compendium display label (e.g. "CAPACITY — SEVERE"). */
  catLabel?: string;
  color: string;
  effect: string;
};

export const GAME_STATES: GameState[] = [
  {
    name: 'Stunned',
    cat: 'Control',
    color: '#cc5050',
    effect:
      'Cannot generate Pressure Steps. Cannot commit any RP reactively. Cannot make opportunity attacks. Auto Save Target 20 for all attacks against them. Ends at end of next turn.',
  },
  {
    name: 'Restrained',
    cat: 'Control',
    color: '#cc5050',
    effect:
      'Pressure Steps capped at 3. Effective reactive RP pool treated as halved for defensive bonus calculation. Cannot bank RP. Movement restricted.',
  },
  {
    name: 'Grappled',
    cat: 'Control',
    color: '#cc5050',
    effect:
      'May still generate Pressure Steps and commit RP reactively. Cannot change targets without additional RP commitment. Movement limited.',
  },
  {
    name: 'Silenced',
    cat: 'Control',
    color: '#cc5050',
    effect:
      'No Focus-based abilities. No Pressure Steps from spell-based attacks. Physical actions and reactive defense proceed normally.',
  },
  {
    name: 'Exhausted',
    cat: 'Capacity',
    color: '#cc9020',
    effect:
      'Base RP −25%. Because Base RP is the reference for defensive bonus calculation, defensive tiers shift downward even if all remaining RP are held in reserve. No banking.',
  },
  {
    name: 'Suppressed',
    cat: 'Capacity',
    color: '#cc9020',
    effect: 'Pressure Steps capped at 2. Reactive defense proceeds normally.',
  },
  {
    name: 'Overextended',
    cat: 'Capacity',
    catLabel: 'CAPACITY — SEVERE',
    color: '#ff2020',
    effect:
      'Base RP −50%. No banking. No reactions or opportunity attacks. All Pressure capped at 2. Saves at disadvantage. +Vulnerable. Until Long Rest. Cannot attempt Overextension again.',
  },
  {
    name: 'Burned',
    cat: 'Damage',
    color: '#e84020',
    effect: 'Takes fixed % of last damage multiplier at turn start. Ends with a countermeasure action.',
  },
  {
    name: 'Poisoned',
    cat: 'Damage',
    color: '#50c040',
    effect:
      'Pressure capped at 3. Reduced reactive capacity. Saves at disadvantage if no RP committed reactively.',
  },
  {
    name: 'Bleeding',
    cat: 'Damage',
    color: '#c02020',
    effect: 'Minor HP loss per turn. Ends when healed above severity threshold.',
  },
  {
    name: 'Charmed',
    cat: 'Altered',
    color: '#e860a8',
    effect:
      'Cannot target the charm source. Defensive bonus calculation against the source is halved.',
  },
  {
    name: 'Frightened',
    cat: 'Altered',
    color: '#a050e8',
    effect:
      'Pressure ≤2 vs fear source. Resistance Modifier +1 vs source — survival instinct compensates for failing courage.',
  },
  {
    name: 'Asleep',
    cat: 'Altered',
    color: '#6080a0',
    effect:
      'Cannot act or commit any RP. Auto Save Target 20 against them. Wakes on damage or specific ally action.',
  },
  {
    name: 'Vulnerable',
    cat: 'Structural',
    color: '#e05030',
    effect: 'Armor mitigation −50%. Elemental resistance −50%.',
  },
  {
    name: 'Fortified',
    cat: 'Structural',
    color: '#50a0e0',
    effect:
      'Armor mitigation +10% (temporary). Effective defensive tier treated as minimum 1, even with 0 RP remaining for reactive commitment.',
  },
  {
    name: 'Enraged',
    cat: 'Structural',
    color: '#e03020',
    effect:
      'Pressure Steps ≤6 (cap +1). Cannot commit any RP reactively. Cannot bank RP. Aggressive momentum overrides all defensive instinct.',
  },
];

export const GAME_STATE_BY_NAME: Record<string, GameState> = Object.fromEntries(
  GAME_STATES.map((s) => [s.name, s]),
);

export const STATE_CAT_COLOR: Record<GameStateCategory, string> = {
  Control: '#cc5050',
  Capacity: '#cc9020',
  Damage: '#e84020',
  Altered: '#a050e8',
  Structural: '#50a0e0',
};

/** Split compendium effect prose into display bullets. */
export function effectBullets(effect: string): string[] {
  return effect
    .split(/\.\s+/)
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => (s.endsWith('.') ? s : `${s}.`));
}

type BulletKind = 'restrict' | 'allow' | 'effect';

export function classifyEffectBullet(text: string): BulletKind {
  const t = text.toLowerCase();
  if (
    /^(cannot|no |pressure capped|pressure ≤|pressure steps ≤|pressure steps capped|all pressure capped|until long rest|cannot attempt|movement restricted|movement limited|wakes on|minor hp loss)/.test(
      t,
    ) ||
    /\bno banking\b/.test(t)
  ) {
    return 'restrict';
  }
  if (/\bproceed normally\b|\bmay still\b|^\+/.test(t)) {
    return 'allow';
  }
  return 'effect';
}
