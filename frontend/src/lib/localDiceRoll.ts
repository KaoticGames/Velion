/**
 * localDiceRoll.ts — Local dice rolling using seeded deterministic physics.
 *
 * The seed is the source of truth. `simulateDiceRoll` runs the same headless
 * Rapier simulation the visual overlay uses (same timestep, same scene), so
 * logged values match the thrown dice without any forced face.
 *
 * The seed is included in the return value so callers can broadcast it for
 * cross-tab synchronisation. Any tab that receives the same seed and runs
 * the same simulation sees the same animation and the same result.
 */

import { buildDiceBreakdown, type AdvantageKeep } from '@/lib/diceBreakdown';
import { parseDiceFromFormula, summariseDiceNotation, type StandardDieType } from '@/lib/diceFormula';
import { getDiceViewportAspect } from '@/dice/diceSpawn';
import { simulateDiceRoll } from '@/dice/rapierDiceSim';
import { areDicePreloaded } from '@/dice/diceLoader';
import { sidesToDieType, type DiceAnimationFace, type DieType } from '@/dice/types';

function generateSeed(): number {
  const buf = new Uint32Array(1);
  crypto.getRandomValues(buf);
  return buf[0]!;
}

/** Cryptographically random fallback for when face maps are not yet loaded. */
function secureDieRoll(sides: number): number {
  const s = Math.max(1, Math.floor(sides));
  const buf = new Uint32Array(1);
  const limit = Math.floor(0x1_0000_0000 / s) * s;
  let x: number;
  do {
    crypto.getRandomValues(buf);
    x = buf[0]!;
  } while (x >= limit);
  return (x % s) + 1;
}

function dieSides(die: StandardDieType): number {
  return die === 'd100' ? 100 : Number.parseInt(die.slice(1), 10);
}

export async function rollDiceLocal(input: {
  diceExpr: string;
  modifier?: number;
  postMultiplier?: number;
  advantageKeep?: AdvantageKeep;
  /** If set, must match the visual Rapier arena (e.g. broadcast sender's aspect). */
  viewportAspect?: number;
}): Promise<{
  seed: number;
  results: number[];
  total: number;
  formula: string;
  animation_spec: DiceAnimationFace[];
  physics_notation: string;
}> {
  const dice = parseDiceFromFormula(input.diceExpr.trim());
  if (!dice.length) throw new Error('[localDiceRoll] no dice in expression');

  const seed = generateSeed();
  const dieTypes: DieType[] = dice.map((d) => sidesToDieType(dieSides(d)) ?? 'd20');

  const aspect = input.viewportAspect ?? getDiceViewportAspect();

  let animation_spec: DiceAnimationFace[];

  if (areDicePreloaded()) {
    animation_spec = await simulateDiceRoll(seed, dieTypes, aspect);
  } else {
    // Face maps not loaded yet (rare). Fall back to crypto RNG.
    animation_spec = dice.map((d) => ({
      sides: dieSides(d),
      value: secureDieRoll(dieSides(d)),
    }));
  }

  const rolledFaces = animation_spec.map((f) => f.value);

  const { results, total, formula } = buildDiceBreakdown({
    faces: rolledFaces,
    modifier: input.modifier,
    postMultiplier: input.postMultiplier,
    advantageKeep: input.advantageKeep,
  });

  return {
    seed,
    results,
    total,
    formula,
    animation_spec,
    physics_notation: summariseDiceNotation(dice),
  };
}