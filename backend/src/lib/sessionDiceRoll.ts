/**
 * Session socket: server-authoritative dice (Velion dice breakdown rules).
 */

import { randomInt } from 'node:crypto';

export type AdvantageKeep = 'high' | 'low';

export interface ServerDiceAuthorityInput {
  /** NdX dice expression only (e.g. `2d20`, `4d8`) */
  diceExpr: string;
  modifier?: number;
  postMultiplier?: number;
  advantageKeep?: AdvantageKeep;
}

type StandardDieType = 'd4' | 'd6' | 'd8' | 'd10' | 'd12' | 'd20' | 'd100';

function parseDiceFromExpr(expr: string): StandardDieType[] {
  const out: StandardDieType[] = [];
  const dicePortion = expr.split('=')[0] ?? expr;
  const rx = /(\d*)\s*[dD]\s*(4|6|8|10|12|20|100)/g;
  let match: RegExpExecArray | null;
  while ((match = rx.exec(dicePortion)) !== null) {
    const rawQty = match[1];
    const qty = rawQty === '' ? 1 : Number.parseInt(rawQty, 10);
    if (!Number.isFinite(qty) || qty < 1) continue;
    const die = (`d${match[2]}`) as StandardDieType;
    for (let i = 0; i < Math.max(0, Math.min(qty, 30)); i += 1) out.push(die);
  }
  return out;
}

function dieSides(die: StandardDieType): number {
  return die === 'd100' ? 100 : Number.parseInt(die.slice(1), 10);
}

/** Inclusive cryptographically secure integer in [1, sides]. */
export function secureDieRoll(sides: number): number {
  const s = Math.max(1, Math.floor(sides));
  return randomInt(1, s);
}

function summariseDice(dice: StandardDieType[]): string {
  const counts = new Map<StandardDieType, number>();
  dice.forEach((d) => counts.set(d, (counts.get(d) ?? 0) + 1));
  return [...counts.entries()].map(([die, qty]) => `${qty}${die}`).join(' + ');
}

function buildBreakdown(params: {
  faces: number[];
  modifier?: number;
  postMultiplier?: number;
  advantageKeep?: AdvantageKeep;
}): { results: number[]; total: number; formula: string } {
  const mod = params.modifier ?? 0;
  const mult = params.postMultiplier ?? 1;
  const faces = params.faces.slice();

  let diceSum: number;
  let explain: string;
  let results: number[];

  if (params.advantageKeep && faces.length === 2) {
    const [a, b] = faces;
    diceSum = params.advantageKeep === 'high' ? Math.max(a, b) : Math.min(a, b);
    explain = params.advantageKeep === 'high' ? `max(${a}, ${b})` : `min(${a}, ${b})`;
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

/** Roll dice from NdX notation; builds log formula, totals, and per-die faces for replay UI. */
export function rollDiceAuthoritative(input: ServerDiceAuthorityInput): {
  results: number[];
  total: number;
  formula: string;
  animation_spec: Array<{ sides: number; value: number }>;
  physics_notation: string;
} {
  const dice = parseDiceFromExpr(input.diceExpr.trim());
  if (!dice.length) {
    throw new Error('[sessionDiceRoll] no dice in expression');
  }

  const rolledFaces = dice.map((die) => secureDieRoll(dieSides(die)));
  const animation_spec = dice.map((die, i) => ({
    sides: dieSides(die),
    value: rolledFaces[i],
  }));

  const { results, total, formula } = buildBreakdown({
    faces: rolledFaces,
    modifier: input.modifier,
    postMultiplier: input.postMultiplier,
    advantageKeep: input.advantageKeep,
  });

  return {
    results,
    total,
    formula,
    animation_spec,
    physics_notation: summariseDice(dice),
  };
}
