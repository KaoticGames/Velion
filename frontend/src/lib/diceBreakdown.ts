/**
 * Build human-readable dice log lines: natural dice + modifier (+ optional multiplier) = total.
 * Used by GlobalDiceOverlay and DiceLog so VTT and character sheet stay consistent.
 */

export type AdvantageKeep = 'high' | 'low';

export interface DiceBreakdownInput {
  /** Face values from the physics engine, in roll order */
  faces: number[];
  modifier?: number;
  /** Applied after (diceSum + modifier), default 1 */
  postMultiplier?: number;
  /** When exactly two d20s were rolled (advantage / disadvantage) */
  advantageKeep?: AdvantageKeep;
}

export interface DiceBreakdown {
  /** Natural dice to store (both faces for adv/dis, or all faces otherwise) */
  results: number[];
  total: number;
  /** Single line: e.g. "max(17, 3) + 2 = 19" or "11 + 3 = 14" */
  formula: string;
}

export function buildDiceBreakdown(input: DiceBreakdownInput): DiceBreakdown {
  const faces = input.faces.slice();
  const mod = input.modifier ?? 0;
  const mult = input.postMultiplier ?? 1;

  let diceSum: number;
  let explain: string;
  let results: number[];

  if (input.advantageKeep && faces.length === 2) {
    const [a, b] = faces;
    diceSum = input.advantageKeep === 'high' ? Math.max(a, b) : Math.min(a, b);
    explain = input.advantageKeep === 'high' ? `max(${a}, ${b})` : `min(${a}, ${b})`;
    results = [a, b];
  } else {
    diceSum = faces.reduce((s, n) => s + n, 0);
    explain = faces.join(' + ');
    results = faces.slice();
  }

  const preMult = diceSum + mod;
  const total = Math.round(preMult * mult);

  let formula: string;
  if (mult !== 1) {
    if (mod !== 0) {
      formula = `(${explain} + ${mod}) × ${mult} = ${total}`;
    } else {
      formula = `(${explain}) × ${mult} = ${total}`;
    }
  } else if (mod !== 0) {
    formula = `${explain} + ${mod} = ${total}`;
  } else {
    formula = explain.length > 0 ? `${explain} = ${total}` : `${total}`;
  }

  return { results, total, formula };
}
