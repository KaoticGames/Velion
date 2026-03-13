/**
 * rules.ts — Velion Mythera Rules Engine
 *
 * Pure functions implementing every formula from the SRD.
 * No database calls, no side effects. Fully unit-testable.
 * This is the server-authoritative source of truth for all combat math.
 */

// ── Attribute System ──────────────────────────────────────────────────────

/** floor((Attribute − 10) ÷ 2) */
export const calcModifier = (attribute: number): number =>
  Math.floor((attribute - 10) / 2);

// ── Resource Points ───────────────────────────────────────────────────────

/** Base RP = Level + Chosen Attribute Modifier + Growth Pool */
export const calcBaseRP = (
  level:          number,
  chosenAttrValue: number,
  growthPool:     number,
): number => level + calcModifier(chosenAttrValue) + growthPool;

/** Max RP a character may hold at any point = 2 × Base RP */
export const calcMaxRP = (baseRP: number): number => baseRP * 2;

// ── Hit Points ────────────────────────────────────────────────────────────

/** Max HP = Base RP × (Level + 10)² */
export const calcMaxHP = (baseRP: number, level: number): bigint => {
  const squared = (level + 10) ** 2;
  return BigInt(baseRP) * BigInt(squared);
};

// ── Pressure Steps ────────────────────────────────────────────────────────

/**
 * Convert committed RP to Pressure/Defensive Steps.
 * RP as a percentage of available RP → 0–5 steps.
 * Maximum is always 5 regardless of RP pool size.
 */
export const calcPressureSteps = (rpCommitted: number, availableRP: number): number => {
  if (!availableRP || rpCommitted <= 0) return 0;
  const p = rpCommitted / availableRP;
  if (p <= 0.20) return 1;
  if (p <= 0.40) return 2;
  if (p <= 0.60) return 3;
  if (p <= 0.80) return 4;
  return 5;
};

/** Net Steps = Pressure − Defense (min 0, max 5) */
export const calcNetSteps = (pressureSteps: number, defensiveSteps: number): number =>
  Math.max(0, Math.min(5, pressureSteps - defensiveSteps));

/** Save Target = 10 + (2 × Net Steps) → range 10–20 */
export const calcSaveTarget = (netSteps: number): number =>
  10 + (2 * netSteps);

// ── Damage Resolution ─────────────────────────────────────────────────────

/** Physical damage after armor mitigation */
export const applyArmorMitigation = (
  incomingPhysical: number,
  mitigationPct:    number,
): number => Math.round(incomingPhysical * (1 - mitigationPct / 100));

/** Elemental damage after resistance */
export const applyElementalResistance = (
  incomingElemental: number,
  resistancePct:     number,
): number => {
  if (resistancePct >= 100) return 0;   // absorbed (healing handled separately)
  return Math.round(incomingElemental * (1 - resistancePct / 100));
};

/**
 * When resistance > 100%, excess converts to healing.
 * Healing = Incoming × (Resistance% − 100%)
 */
export const calcAbsorptionHealing = (
  incomingElemental: number,
  resistancePct:     number,
): number => {
  if (resistancePct <= 100) return 0;
  return Math.round(incomingElemental * (resistancePct - 100) / 100);
};

/** Damage per channel = Weapon/Gem Dice Roll × Staked RP */
export const calcChannelDamage = (diceRoll: number, stakedRP: number): number =>
  diceRoll * stakedRP;

// ── Overextension ─────────────────────────────────────────────────────────

/**
 * DC = 10 + (10 × OE_Amount ÷ Available_RP) clamped to 10–20
 * OE_Amount = desired_total_rp − available_rp
 */
export const calcOverextensionDC = (
  overextendedAmount: number,
  availableRP:        number,
): number => {
  if (!availableRP) return 20;
  return Math.min(20, Math.round(10 + (10 * overextendedAmount / availableRP)));
};

/**
 * Hard limit: total desired RP may not exceed 2× available RP.
 * Therefore OE_Amount (= T − A) ≤ A, so T ≤ 2A.
 */
export const validateOverextensionAmount = (
  desiredRP:   number,
  availableRP: number,
): boolean => desiredRP <= availableRP * 2;

// ── Encounter Pool ────────────────────────────────────────────────────────

const POOL_FACTORS: Record<string, number> = {
  easy:    0.25,
  standard: 0.50,
  hard:    0.75,
  deadly:  1.00,
  horde:   1.25,
};

/**
 * Pool Size = Avg Party Base RP × Party Size × Enemy Weight × Pool Factor
 */
export const calcEncounterPool = (
  avgPartyBaseRP:  number,
  partySize:       number,
  enemyWeight:     number,
  difficultySetting: string,
): number => {
  const factor = POOL_FACTORS[difficultySetting] ?? 0.50;
  return Math.round(avgPartyBaseRP * partySize * enemyWeight * factor);
};

// ── Rest & Recovery ───────────────────────────────────────────────────────

/** Short Rest: restores 25% of Max HP */
export const calcShortRestHP = (maxHP: bigint): bigint =>
  BigInt(Math.floor(Number(maxHP) * 0.25));

// ── State Effects on RP ───────────────────────────────────────────────────

/**
 * Apply active state modifiers to Base RP.
 * Returns the effective Base RP after state penalties.
 */
export const calcEffectiveBaseRP = (
  baseRP:       number,
  activeStates: Set<string>,
): number => {
  let rp = baseRP;

  // Overextended: Base RP −50%
  if (activeStates.has('Overextended')) {
    rp = Math.floor(rp * 0.5);
  }
  // Exhausted: Base RP −25%
  else if (activeStates.has('Exhausted')) {
    rp = Math.floor(rp * 0.75);
  }

  return Math.max(0, rp);
};

/**
 * States that block banking entirely.
 */
export const BANKING_BLOCKED_STATES = new Set([
  'Restrained', 'Exhausted', 'Overextended', 'Enraged', 'Stunned', 'Asleep',
]);

export const isBankingBlocked = (activeStates: Set<string>): boolean =>
  [...activeStates].some((s) => BANKING_BLOCKED_STATES.has(s));

// ── Leveling ──────────────────────────────────────────────────────────────

/** Validate +2 attribute point distribution with max +1 per attribute */
export const validateAttributeDistribution = (
  distribution: Record<string, number>,
): { valid: boolean; reason?: string } => {
  const total = Object.values(distribution).reduce((s, v) => s + v, 0);
  if (total !== 2) return { valid: false, reason: 'Must distribute exactly 2 attribute points.' };

  for (const [attr, val] of Object.entries(distribution)) {
    if (val < 0 || val > 1) {
      return { valid: false, reason: `Maximum +1 per attribute per level (${attr} received ${val}).` };
    }
  }

  return { valid: true };
};

// ── Faction Favor ─────────────────────────────────────────────────────────

/** Clamp favor score to -100 → +100 */
export const clampFavor = (score: number): number =>
  Math.max(-100, Math.min(100, score));

export const getFavorStatus = (score: number): string => {
  if (score >= 75)  return 'Champion';
  if (score >= 50)  return 'Allied';
  if (score >= 25)  return 'Trusted';
  if (score >= 1)   return 'Recognized';
  if (score === 0)  return 'Neutral';
  if (score >= -49) return 'Unfriendly';
  return 'Hostile';
};
