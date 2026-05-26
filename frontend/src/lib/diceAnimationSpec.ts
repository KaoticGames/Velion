/**
 * Per-die face data for syncing Three.js dice visuals with server-authoritative results.
 */

export type DiceAnimationFace = { sides: number; value: number };

/** Build compact physics notation (`2d20 + 1d6`) from animation_spec. */
export function physicsNotationFromAnimationSpec(spec: DiceAnimationFace[]): string {
  const chunks: string[] = [];
  for (let i = 0; i < spec.length; ) {
    const a = spec[i];
    if (!a) break;
    chunks.push(`1d${a.sides}`);
    i += 1;
  }
  return chunks.join(' + ');
}

/** Collapse `1d20 + 1d20` into `2d20` where possible. */
export function compactPhysicsNotationLoose(spec: DiceAnimationFace[]): string {
  const mult = new Map<number, number>();
  for (const face of spec) {
    mult.set(face.sides, (mult.get(face.sides) ?? 0) + 1);
  }
  const parts: string[] = [];
  [...mult.entries()]
    .sort(([a], [b]) => a - b)
    .forEach(([sides, qty]) => {
      parts.push(`${qty}d${sides}`);
    });
  return parts.join(' + ');
}
