/**
 * Server-authoritative dice: crypto seed → headless Rapier → face read (+Y / d4 −Y).
 */

import { randomInt } from 'node:crypto';
import { CANONICAL_DICE_VIEWPORT_ASPECT } from './constants';
import { areDicePreloaded, preloadAllDice } from './diceLoader';
import { simulateDiceRoll } from './rapierDiceSim';
import type { DieType } from './types';

export type AdvantageKeep = 'high' | 'low';

export interface ServerDiceAuthorityInput {
  diceExpr: string;
  modifier?: number;
  postMultiplier?: number;
  advantageKeep?: AdvantageKeep;
}

type StandardDieType = DieType;

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

export interface ServerPhysicsRollResult {
  seed: number;
  die_types: DieType[];
  viewport_aspect: number;
  results: number[];
  total: number;
  formula: string;
  animation_spec: Array<{ sides: number; value: number }>;
  physics_notation: string;
}

let initPromise: Promise<void> | null = null;

export async function ensureServerDiceReady(): Promise<void> {
  if (!initPromise) {
    initPromise = preloadAllDice().catch((err) => {
      initPromise = null;
      throw err;
    });
  }
  await initPromise;
}

/** Headless Rapier roll — source of truth for session dice log and client replay. */
export async function rollDiceAuthoritative(
  input: ServerDiceAuthorityInput,
): Promise<ServerPhysicsRollResult> {
  await ensureServerDiceReady();
  if (!areDicePreloaded()) {
    throw new Error('[rollSessionDice] dice assets not loaded');
  }

  const dice = parseDiceFromExpr(input.diceExpr.trim());
  if (!dice.length) {
    throw new Error('[rollSessionDice] no dice in expression');
  }

  const seed = randomInt(0, 0x1_0000_0000);
  const viewport_aspect = CANONICAL_DICE_VIEWPORT_ASPECT;
  const animation_spec = await simulateDiceRoll(seed, dice, viewport_aspect);
  const rolledFaces = animation_spec.map((f) => f.value);

  const { results, total, formula } = buildBreakdown({
    faces: rolledFaces,
    modifier: input.modifier,
    postMultiplier: input.postMultiplier,
    advantageKeep: input.advantageKeep,
  });

  return {
    seed,
    die_types: dice,
    viewport_aspect,
    results,
    total,
    formula,
    animation_spec,
    physics_notation: summariseDice(dice),
  };
}
