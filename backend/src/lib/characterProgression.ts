import { eq, and, asc } from 'drizzle-orm';
import { db } from '../db';
import { characters, characterLevelProgression, growthPoolHistory } from '../db/schema';
import { calcBaseRP, calcMaxHP, validateAttributeDistribution } from './rules';

export type AttrKey = 'power' | 'agility' | 'focus' | 'presence';

export type CreationBaseline = {
  power: number;
  agility: number;
  focus: number;
  presence: number;
  growth_roll: number;
  chosen_attribute: AttrKey;
};

export type LevelProgressionStep = {
  to_level: number;
  power_gain: number;
  agility_gain: number;
  focus_gain: number;
  presence_gain: number;
  growth_roll: number;
  chosen_attribute: AttrKey;
};

export type ProgressionSnapshot = {
  baseline: CreationBaseline;
  steps: LevelProgressionStep[];
  level: number;
  complete: boolean;
};

const ATTR_KEYS: AttrKey[] = ['power', 'agility', 'focus', 'presence'];

export function parseCreationBaseline(raw: unknown): CreationBaseline | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  const chosen = o.chosen_attribute;
  if (
    typeof o.power !== 'number' ||
    typeof o.agility !== 'number' ||
    typeof o.focus !== 'number' ||
    typeof o.presence !== 'number' ||
    typeof o.growth_roll !== 'number' ||
    typeof chosen !== 'string' ||
    !ATTR_KEYS.includes(chosen as AttrKey)
  ) {
    return null;
  }
  const growth_roll = Math.floor(o.growth_roll);
  if (growth_roll < 1 || growth_roll > 6) return null;
  return {
    power: Math.floor(o.power),
    agility: Math.floor(o.agility),
    focus: Math.floor(o.focus),
    presence: Math.floor(o.presence),
    growth_roll,
    chosen_attribute: chosen as AttrKey,
  };
}

export function computeFromProgression(
  baseline: CreationBaseline,
  steps: LevelProgressionStep[],
): {
  power: number;
  agility: number;
  focus: number;
  presence: number;
  growth_pool_total: number;
  chosen_attribute: AttrKey;
  level: number;
} {
  const sorted = [...steps].sort((a, b) => a.to_level - b.to_level);
  let power = baseline.power;
  let agility = baseline.agility;
  let focus = baseline.focus;
  let presence = baseline.presence;
  let growth_pool_total = baseline.growth_roll;
  let chosen_attribute = baseline.chosen_attribute;
  let level = 1;

  for (const step of sorted) {
    power += step.power_gain;
    agility += step.agility_gain;
    focus += step.focus_gain;
    presence += step.presence_gain;
    growth_pool_total += step.growth_roll;
    chosen_attribute = step.chosen_attribute;
    level = step.to_level;
  }

  return { power, agility, focus, presence, growth_pool_total, chosen_attribute, level };
}

export async function loadProgressionSnapshot(characterId: string): Promise<ProgressionSnapshot | null> {
  const [c] = await db.select().from(characters).where(eq(characters.id, characterId)).limit(1);
  if (!c) return null;

  let baseline = parseCreationBaseline(c.creation_baseline);
  if (!baseline) {
    const [g1] = await db
      .select()
      .from(growthPoolHistory)
      .where(and(eq(growthPoolHistory.character_id, characterId), eq(growthPoolHistory.level_gained, 1)))
      .limit(1);
    baseline = {
      power: c.power,
      agility: c.agility,
      focus: c.focus,
      presence: c.presence,
      growth_roll: g1?.roll_result ?? Math.max(1, c.growth_pool_total),
      chosen_attribute: (c.chosen_attribute as AttrKey) ?? 'power',
    };
  }

  const rows = await db
    .select()
    .from(characterLevelProgression)
    .where(eq(characterLevelProgression.character_id, characterId))
    .orderBy(asc(characterLevelProgression.to_level));

  const steps: LevelProgressionStep[] = rows.map((r) => ({
    to_level: r.to_level,
    power_gain: r.power_gain,
    agility_gain: r.agility_gain,
    focus_gain: r.focus_gain,
    presence_gain: r.presence_gain,
    growth_roll: r.roll_result,
    chosen_attribute: r.chosen_attribute as AttrKey,
  }));

  const level = c.level;
  const complete = level <= 1 ? true : steps.length === level - 1;

  return { baseline, steps, level, complete };
}

export async function persistCreationBaseline(
  characterId: string,
  baseline: CreationBaseline,
): Promise<void> {
  await db
    .update(characters)
    .set({ creation_baseline: baseline as never, updated_at: new Date() })
    .where(eq(characters.id, characterId));

  const existing = await db
    .select()
    .from(growthPoolHistory)
    .where(and(eq(growthPoolHistory.character_id, characterId), eq(growthPoolHistory.level_gained, 1)))
    .limit(1);

  if (existing.length) {
    await db
      .update(growthPoolHistory)
      .set({ roll_result: baseline.growth_roll })
      .where(eq(growthPoolHistory.id, existing[0]!.id));
  } else {
    await db.insert(growthPoolHistory).values({
      character_id: characterId,
      level_gained: 1,
      roll_result: baseline.growth_roll,
    });
  }
}

export async function applyProgressionToCharacter(characterId: string): Promise<void> {
  const snap = await loadProgressionSnapshot(characterId);
  if (!snap) return;

  const stats = computeFromProgression(snap.baseline, snap.steps);
  const base_rp = calcBaseRP(stats.level, stats[stats.chosen_attribute], stats.growth_pool_total);
  const max_hp = calcMaxHP(base_rp, stats.level);

  const [c] = await db.select().from(characters).where(eq(characters.id, characterId)).limit(1);
  const prevCur = Number(c?.current_rp ?? base_rp);
  const clampedRp = Math.min(Math.max(0, prevCur), base_rp);

  await db
    .update(characters)
    .set({
      level: stats.level,
      power: stats.power,
      agility: stats.agility,
      focus: stats.focus,
      presence: stats.presence,
      chosen_attribute: stats.chosen_attribute,
      growth_pool_total: stats.growth_pool_total,
      base_rp,
      max_hp: BigInt(max_hp),
      current_rp: clampedRp,
      updated_at: new Date(),
    })
    .where(eq(characters.id, characterId));
}

/** After level-up: full RP and HP to new maximums (matches +1 LEVEL UP sheet behavior). */
export async function refillLevelUpPools(characterId: string): Promise<void> {
  const [c] = await db.select().from(characters).where(eq(characters.id, characterId)).limit(1);
  if (!c) return;

  const chosenVal = c[c.chosen_attribute as AttrKey] ?? 10;
  const base_rp = calcBaseRP(c.level, chosenVal, c.growth_pool_total);
  const max_hp = calcMaxHP(base_rp, c.level);

  await db
    .update(characters)
    .set({
      base_rp,
      max_hp: BigInt(max_hp),
      current_rp: base_rp,
      current_hp: BigInt(max_hp),
      rp_banked: 0,
      rp_banking: false,
      updated_at: new Date(),
    })
    .where(eq(characters.id, characterId));
}

export async function recordLevelUpStep(
  characterId: string,
  step: Omit<LevelProgressionStep, 'to_level'> & { to_level: number },
): Promise<{ valid: boolean; reason?: string }> {
  const validation = validateAttributeDistribution({
    power: step.power_gain,
    agility: step.agility_gain,
    focus: step.focus_gain,
    presence: step.presence_gain,
  });
  if (!validation.valid) return validation;

  const growth_roll = Math.floor(step.growth_roll);
  if (growth_roll < 1 || growth_roll > 6) {
    return { valid: false, reason: 'Growth roll must be between 1 and 6.' };
  }

  const snap = await loadProgressionSnapshot(characterId);
  if (!snap) return { valid: false, reason: 'Character not found.' };

  const expectedLevel = snap.level + 1;
  if (step.to_level !== expectedLevel) {
    return { valid: false, reason: `Next level must be ${expectedLevel}.` };
  }

  await db
    .insert(characterLevelProgression)
    .values({
      character_id: characterId,
      to_level: step.to_level,
      power_gain: step.power_gain,
      agility_gain: step.agility_gain,
      focus_gain: step.focus_gain,
      presence_gain: step.presence_gain,
      roll_result: growth_roll,
      chosen_attribute: step.chosen_attribute,
    })
    .onConflictDoUpdate({
      target: [characterLevelProgression.character_id, characterLevelProgression.to_level],
      set: {
        power_gain: step.power_gain,
        agility_gain: step.agility_gain,
        focus_gain: step.focus_gain,
        presence_gain: step.presence_gain,
        roll_result: growth_roll,
        chosen_attribute: step.chosen_attribute,
      },
    });

  await db.insert(growthPoolHistory).values({
    character_id: characterId,
    level_gained: step.to_level,
    roll_result: growth_roll,
  });

  await applyProgressionToCharacter(characterId);
  await refillLevelUpPools(characterId);

  return { valid: true };
}

export async function removeLevelStep(characterId: string): Promise<{ valid: boolean; reason?: string }> {
  const snap = await loadProgressionSnapshot(characterId);
  if (!snap) return { valid: false, reason: 'Character not found.' };
  if (snap.level <= 1) return { valid: false, reason: 'Already at level 1.' };

  const toRemove = snap.level;
  await db
    .delete(characterLevelProgression)
    .where(
      and(
        eq(characterLevelProgression.character_id, characterId),
        eq(characterLevelProgression.to_level, toRemove),
      ),
    );

  await db
    .delete(growthPoolHistory)
    .where(
      and(
        eq(growthPoolHistory.character_id, characterId),
        eq(growthPoolHistory.level_gained, toRemove),
      ),
    );

  await applyProgressionToCharacter(characterId);
  return { valid: true };
}

export async function upsertProgressionStep(
  characterId: string,
  step: LevelProgressionStep,
): Promise<{ valid: boolean; reason?: string }> {
  if (step.to_level < 2) {
    return { valid: false, reason: 'Level-up steps start at level 2.' };
  }

  const validation = validateAttributeDistribution({
    power: step.power_gain,
    agility: step.agility_gain,
    focus: step.focus_gain,
    presence: step.presence_gain,
  });
  if (!validation.valid) return validation;

  const growth_roll = Math.floor(step.growth_roll);
  if (growth_roll < 1 || growth_roll > 6) {
    return { valid: false, reason: 'Growth roll must be between 1 and 6.' };
  }

  await db
    .insert(characterLevelProgression)
    .values({
      character_id: characterId,
      to_level: step.to_level,
      power_gain: step.power_gain,
      agility_gain: step.agility_gain,
      focus_gain: step.focus_gain,
      presence_gain: step.presence_gain,
      roll_result: growth_roll,
      chosen_attribute: step.chosen_attribute,
    })
    .onConflictDoUpdate({
      target: [characterLevelProgression.character_id, characterLevelProgression.to_level],
      set: {
        power_gain: step.power_gain,
        agility_gain: step.agility_gain,
        focus_gain: step.focus_gain,
        presence_gain: step.presence_gain,
        roll_result: growth_roll,
        chosen_attribute: step.chosen_attribute,
      },
    });

  const [hist] = await db
    .select()
    .from(growthPoolHistory)
    .where(
      and(
        eq(growthPoolHistory.character_id, characterId),
        eq(growthPoolHistory.level_gained, step.to_level),
      ),
    )
    .limit(1);

  if (hist) {
    await db
      .update(growthPoolHistory)
      .set({ roll_result: growth_roll })
      .where(eq(growthPoolHistory.id, hist.id));
  } else {
    await db.insert(growthPoolHistory).values({
      character_id: characterId,
      level_gained: step.to_level,
      roll_result: growth_roll,
    });
  }

  const snap = await loadProgressionSnapshot(characterId);
  if (snap && step.to_level > snap.level) {
    await db
      .update(characters)
      .set({ level: step.to_level, updated_at: new Date() })
      .where(eq(characters.id, characterId));
  }

  await applyProgressionToCharacter(characterId);
  return { valid: true };
}

/** Split consolidated attribute gains into per-level steps (max +1 per attr per level, 2 per level). */
export function splitAttributeGainsIntoSteps(
  levelCount: number,
  totals: Record<AttrKey, number>,
): { valid: boolean; reason?: string; steps?: Array<Record<AttrKey, number>> } {
  if (levelCount < 1) {
    return { valid: false, reason: 'No levels to apply.' };
  }

  const sum = ATTR_KEYS.reduce((s, k) => s + (totals[k] ?? 0), 0);
  if (sum !== levelCount * 2) {
    return {
      valid: false,
      reason: `Attribute points must total ${levelCount * 2} (${levelCount} levels × 2).`,
    };
  }

  for (const key of ATTR_KEYS) {
    const v = totals[key] ?? 0;
    if (v < 0 || v > levelCount) {
      return {
        valid: false,
        reason: `Maximum +1 ${key} per level (${levelCount} levels → max +${levelCount} ${key}).`,
      };
    }
  }

  const remaining = { ...totals };
  const steps: Array<Record<AttrKey, number>> = [];

  for (let i = 0; i < levelCount; i++) {
    const step: Record<AttrKey, number> = { power: 0, agility: 0, focus: 0, presence: 0 };
    const available = ATTR_KEYS.filter((k) => (remaining[k] ?? 0) > 0);
    if (available.length < 2) {
      return {
        valid: false,
        reason: 'Could not split attribute gains — need at least two attributes with remaining points.',
      };
    }

    available.sort((a, b) => (remaining[b] ?? 0) - (remaining[a] ?? 0));
    const first = available[0]!;
    const second = available.find((k) => k !== first) ?? available[1]!;
    step[first] = 1;
    step[second] = 1;
    remaining[first]! -= 1;
    remaining[second]! -= 1;
    steps.push(step);
  }

  return { valid: true, steps };
}

/** Sum attribute gains for progression steps in a level range (inclusive). */
export function sumGainsInLevelRange(
  steps: LevelProgressionStep[],
  fromLevel: number,
  toLevel: number,
): Record<AttrKey, number> {
  const out: Record<AttrKey, number> = { power: 0, agility: 0, focus: 0, presence: 0 };
  for (const step of steps) {
    if (step.to_level < fromLevel || step.to_level > toLevel) continue;
    out.power += step.power_gain;
    out.agility += step.agility_gain;
    out.focus += step.focus_gain;
    out.presence += step.presence_gain;
  }
  return out;
}

export async function applyBulkLevelDown(
  characterId: string,
  payload: {
    target_level: number;
    power: number;
    agility: number;
    focus: number;
    presence: number;
  },
): Promise<{ valid: boolean; reason?: string }> {
  const snap = await loadProgressionSnapshot(characterId);
  if (!snap) return { valid: false, reason: 'Character not found.' };

  const target = Math.floor(payload.target_level);
  if (target >= snap.level) {
    return { valid: false, reason: `Target level must be below current level (${snap.level}).` };
  }
  if (target < 1) return { valid: false, reason: 'Minimum level is 1.' };

  const levelCount = snap.level - target;
  const fromLevel = target + 1;
  const removals: Record<AttrKey, number> = {
    power: Math.floor(payload.power),
    agility: Math.floor(payload.agility),
    focus: Math.floor(payload.focus),
    presence: Math.floor(payload.presence),
  };

  const removalSum = ATTR_KEYS.reduce((s, k) => s + removals[k], 0);
  if (removalSum !== levelCount * 2) {
    return {
      valid: false,
      reason: `Remove exactly ${levelCount * 2} attribute points (${levelCount} levels × 2).`,
    };
  }

  for (const key of ATTR_KEYS) {
    if (removals[key] < 0 || removals[key] > levelCount) {
      return {
        valid: false,
        reason: `Maximum −1 ${key} per level removed (${levelCount} levels → max −${levelCount} ${key}).`,
      };
    }
  }

  const recorded = sumGainsInLevelRange(snap.steps, fromLevel, snap.level);
  const levelsInRange: number[] = [];
  for (let lv = fromLevel; lv <= snap.level; lv++) levelsInRange.push(lv);
  const have = new Set(snap.steps.map((s) => s.to_level));
  const missing = levelsInRange.filter((lv) => !have.has(lv));
  if (missing.length) {
    return {
      valid: false,
      reason: `Missing progression for level(s) ${missing.join(', ')} — record them before lowering level.`,
    };
  }

  const recordedSum = ATTR_KEYS.reduce((s, k) => s + recorded[k], 0);
  if (recordedSum !== removalSum) {
    return {
      valid: false,
      reason: `Recorded attribute gains across these levels total ${recordedSum}, which must match your removal total.`,
    };
  }

  for (const key of ATTR_KEYS) {
    if (removals[key] > recorded[key]) {
      return {
        valid: false,
        reason: `Cannot remove more ${key} than was gained (+${recorded[key]} across these levels).`,
      };
    }
  }

  for (let lv = fromLevel; lv <= snap.level; lv++) {
    await db
      .delete(characterLevelProgression)
      .where(
        and(
          eq(characterLevelProgression.character_id, characterId),
          eq(characterLevelProgression.to_level, lv),
        ),
      );
    await db
      .delete(growthPoolHistory)
      .where(
        and(
          eq(growthPoolHistory.character_id, characterId),
          eq(growthPoolHistory.level_gained, lv),
        ),
      );
  }

  await applyProgressionToCharacter(characterId);
  return { valid: true };
}

export async function applyBulkLevelUp(
  characterId: string,
  payload: {
    target_level: number;
    power: number;
    agility: number;
    focus: number;
    presence: number;
    growth_rolls: number[];
    chosen_attribute: AttrKey;
  },
): Promise<{ valid: boolean; reason?: string }> {
  const snap = await loadProgressionSnapshot(characterId);
  if (!snap) return { valid: false, reason: 'Character not found.' };

  const target = Math.floor(payload.target_level);
  if (target <= snap.level) {
    return { valid: false, reason: `Target level must be above current level (${snap.level}).` };
  }
  if (target > 100) return { valid: false, reason: 'Maximum level is 100.' };

  const levelCount = target - snap.level;
  const totals: Record<AttrKey, number> = {
    power: Math.floor(payload.power),
    agility: Math.floor(payload.agility),
    focus: Math.floor(payload.focus),
    presence: Math.floor(payload.presence),
  };

  const split = splitAttributeGainsIntoSteps(levelCount, totals);
  if (!split.valid || !split.steps) return { valid: false, reason: split.reason };

  if (!Array.isArray(payload.growth_rolls) || payload.growth_rolls.length !== levelCount) {
    return {
      valid: false,
      reason: `Provide exactly ${levelCount} growth pool d6 roll(s).`,
    };
  }

  const growth_rolls = payload.growth_rolls.map((r) => Math.floor(r));
  for (const r of growth_rolls) {
    if (r < 1 || r > 6) {
      return { valid: false, reason: 'Each growth roll must be between 1 and 6.' };
    }
  }

  const chosen = payload.chosen_attribute;
  if (!ATTR_KEYS.includes(chosen)) {
    return { valid: false, reason: 'Invalid chosen attribute.' };
  }

  for (let lv = snap.level + 1; lv <= target; lv++) {
    await db
      .delete(characterLevelProgression)
      .where(
        and(
          eq(characterLevelProgression.character_id, characterId),
          eq(characterLevelProgression.to_level, lv),
        ),
      );
    await db
      .delete(growthPoolHistory)
      .where(
        and(
          eq(growthPoolHistory.character_id, characterId),
          eq(growthPoolHistory.level_gained, lv),
        ),
      );
  }

  for (let i = 0; i < levelCount; i++) {
    const to_level = snap.level + 1 + i;
    const gains = split.steps[i]!;
    const result = await recordLevelUpStep(characterId, {
      to_level,
      power_gain: gains.power,
      agility_gain: gains.agility,
      focus_gain: gains.focus,
      presence_gain: gains.presence,
      growth_roll: growth_rolls[i]!,
      chosen_attribute: chosen,
    });
    if (!result.valid) return result;
  }

  return { valid: true };
}
