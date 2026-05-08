/**
 * Parses NdX portions from a roll expression (modifiers may appear but are ignored here).
 */

export type StandardDieType = 'd4' | 'd6' | 'd8' | 'd10' | 'd12' | 'd20' | 'd100';

export function parseDiceFromFormula(formula?: string): StandardDieType[] {
  if (!formula) return [];
  const out: StandardDieType[] = [];
  const dicePortion = formula.split('=')[0] ?? formula;
  const rx = /(\d*)\s*[dD]\s*(4|6|8|10|12|20|100)/g;
  let match: RegExpExecArray | null;
  while ((match = rx.exec(dicePortion)) !== null) {
    const rawQty = match[1];
    const qty = rawQty === '' ? 1 : Number.parseInt(rawQty, 10);
    if (!Number.isFinite(qty) || qty < 1) continue;
    const die = `d${match[2]}` as StandardDieType;
    for (let i = 0; i < Math.max(0, Math.min(qty, 30)); i += 1) out.push(die);
  }
  return out;
}

export function summariseDiceNotation(dice: StandardDieType[]): string {
  const counts = new Map<StandardDieType, number>();
  dice.forEach((die) => counts.set(die, (counts.get(die) ?? 0) + 1));
  return [...counts.entries()].map(([die, qty]) => `${qty}${die}`).join(' + ');
}
