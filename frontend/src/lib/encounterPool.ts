/** Mirrors backend/src/lib/rules.ts — encounter pool sizing. */

export type EncounterDifficulty = 'easy' | 'standard' | 'hard' | 'deadly' | 'horde';

const POOL_FACTORS: Record<EncounterDifficulty, number> = {
  easy:     0.25,
  standard: 0.50,
  hard:     0.75,
  deadly:   1.00,
  horde:    1.25,
};

export const ENEMY_WEIGHT_BY_CLASS: Record<string, number> = {
  minion:   0.5,
  standard: 1,
  elite:    2,
  boss:     4,
};

export function enemyWeightFromClassification(classification: string): number {
  return ENEMY_WEIGHT_BY_CLASS[classification?.toLowerCase()] ?? 1;
}

/**
 * Pool Size = Avg Party Base RP × Party Size × Enemy Weight × Pool Factor
 * `enemyWeight` is the sum of per-enemy weights in the encounter.
 */
export function calcEncounterPool(
  avgPartyBaseRP: number,
  partySize: number,
  totalEnemyWeight: number,
  difficulty: EncounterDifficulty,
): number {
  const factor = POOL_FACTORS[difficulty] ?? 0.5;
  return Math.round(avgPartyBaseRP * partySize * totalEnemyWeight * factor);
}
