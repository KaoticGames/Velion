/**
 * Per-die face data for syncing 3D/CSS dice visuals with physics results.
 * Built from dice-box `onRollComplete` raw die objects (value + sides).
 */

export type DiceAnimationFace = { sides: number; value: number };

/** Same ordering as GlobalDiceOverlay `onRollComplete` mapping. */
export function buildAnimationSpecFromPhysicsResults(
  rawResults: Array<{ value: number; sides: number }>,
  d100Count: number,
): DiceAnimationFace[] {
  const valid = rawResults.filter((r) => r.value > 0);
  const d10 = valid.filter((r) => r.sides === 10);
  const d100 = valid.filter((r) => r.sides === 100);
  const others = valid.filter((r) => r.sides !== 10 && r.sides !== 100);

  const spec: DiceAnimationFace[] = [];
  for (let i = 0; i < d100Count; i += 1) {
    const pct = d100.shift();
    const units = d10.shift();
    if (!pct || !units) continue;
    const tens = pct.value;
    const unit = units.value;
    // Two physics dice per d100 (percentile + ones) — matches dice-box toss + network replay counts.
    spec.push({ sides: 100, value: tens });
    spec.push({ sides: 10, value: unit });
  }
  d10.forEach((die) => spec.push({ sides: 10, value: die.value }));
  others.forEach((die) => spec.push({ sides: die.sides, value: die.value }));
  return spec;
}

/** Build dice-box notation (`2d20 + 1d6` style) from expanded animation_spec (d100 uses 1d100 chunks). */
export function physicsNotationFromAnimationSpec(spec: DiceAnimationFace[]): string {
  const chunks: string[] = [];
  for (let i = 0; i < spec.length; ) {
    const a = spec[i];
    if (a.sides === 100) {
      const b = spec[i + 1];
      if (b?.sides === 10) {
        chunks.push('1d100');
        i += 2;
        continue;
      }
    }
    chunks.push(`1d${a.sides}`);
    i += 1;
  }
  return chunks.join(' + ');
}

/** Collapse `1d20 + 1d20` into `2d20` where possible for cleaner notation (optional). */
export function compactPhysicsNotationLoose(spec: DiceAnimationFace[]): string {
  const mult = new Map<number, number>();
  for (let i = 0; i < spec.length; ) {
    const a = spec[i];
    if (a.sides === 100) {
      const b = spec[i + 1];
      if (b?.sides === 10) {
        mult.set(100, (mult.get(100) ?? 0) + 1);
        i += 2;
        continue;
      }
    }
    mult.set(a.sides, (mult.get(a.sides) ?? 0) + 1);
    i += 1;
  }
  const parts: string[] = [];
  [...mult.entries()]
    .sort(([a], [b]) => a - b)
    .forEach(([sides, qty]) => {
      parts.push(`${qty}d${sides}`);
    });
  return parts.join(' + ');
}

/** dice-box `roll()` item: quantity + sides (d100 expanded to +d100/+d10 like `GlobalDiceOverlay`). */
export type DiceBoxRollPart = { qty: number; sides: number };

/**
 * Parse compact notation (`2d20 + 1d6 + 1d100`) into dice-box `roll()` argument.
 * Matches `startPhysicalRoll` d100 handling: each `d100` adds one d100 and one d10 to the toss.
 */
export function physicsNotationToDiceBoxRoll(notation: string): { rollArg: DiceBoxRollPart[]; d100Count: number } {
  const chunks = notation
    .split(/\s*\+\s*/)
    .map((s) => s.trim())
    .filter(Boolean);
  let d100Count = 0;
  const mult = new Map<number, number>();
  for (const chunk of chunks) {
    let qty = 1;
    let sides: number | null = null;
    const nd = chunk.match(/^(\d+)\s*d\s*(\d+)$/i);
    const dOnly = chunk.match(/^d\s*(\d+)$/i);
    if (nd) {
      qty = Number.parseInt(nd[1], 10);
      sides = Number.parseInt(nd[2], 10);
    } else if (dOnly) {
      sides = Number.parseInt(dOnly[1], 10);
    }
    if (sides == null || !Number.isFinite(sides) || qty < 1) continue;
    if (sides === 100) d100Count += qty;
    else mult.set(sides, (mult.get(sides) ?? 0) + qty);
  }
  if (d100Count > 0) {
    mult.set(100, (mult.get(100) ?? 0) + d100Count);
    mult.set(10, (mult.get(10) ?? 0) + d100Count);
  }
  const rollArg = [...mult.entries()]
    .map(([sides, q]) => ({ qty: q, sides }))
    .filter((p) => p.qty > 0);
  return { rollArg, d100Count };
}
