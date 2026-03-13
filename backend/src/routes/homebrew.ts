import { Router, Request, Response } from 'express';
import { eq, and, or }               from 'drizzle-orm';
import { db }                         from '../db';
import {
  weapons, weaponChannels,
  armorPieces,
  spellGems,
  focusBracers,
  enemies, enemyAttackTiers,
  pets, petAttacks,
  homebrewVersions,
  type NewWeapon, type NewArmorPiece, type NewSpellGem,
  type NewFocusBracer, type NewEnemy, type NewPet,
} from '../db/schema';
import { requireAuth, requirePaid } from '../middleware/auth';
import { calcBaseRP, calcMaxHP }    from '../lib/rules';

const router = Router();

// All homebrew writes require authentication + paid subscription
router.use(requireAuth);

// ── Helpers ───────────────────────────────────────────────────────────────

const param = (p: string | string[]): string => (Array.isArray(p) ? p[0] : p);

/** Safely serialize a row to JSON — converts BigInt to string */
const toSnapshot = (row: Record<string, unknown>): Record<string, unknown> =>
  JSON.parse(JSON.stringify(row, (_k, v) => (typeof v === 'bigint' ? v.toString() : v)));

/**
 * Snapshot the current state of a homebrew item before updating it.
 * Inserts a row into homebrew_versions and returns the next version number.
 */
const snapshotAndBump = async (
  itemType: string,
  itemId:   string,
  currentRow: Record<string, unknown>,
  savedBy:  string,
): Promise<number> => {
  const currentVersion = (currentRow.version as number) ?? 1;
  await db.insert(homebrewVersions).values({
    item_type: itemType,
    item_id:   itemId,
    version:   currentVersion,
    snapshot:  toSnapshot(currentRow),
    saved_by:  savedBy,
  });
  return currentVersion + 1;
};

/** Enforce ownership — 403 if the item doesn't belong to the requesting user */
const assertOwner = (createdBy: string | null | undefined, userId: string, res: Response): boolean => {
  if (createdBy !== userId) {
    res.status(403).json({ error: { code: 'FORBIDDEN', message: 'You do not own this item.', status: 403 } });
    return false;
  }
  return true;
};

// ═════════════════════════════════════════════════════════════════════════════
// DUPLICATE DETECTION
// POST /library/duplicate-check
// Body: { item_type, ...stats }  — returns array of similar items (names + ids)
// ═════════════════════════════════════════════════════════════════════════════
router.post('/duplicate-check', requirePaid, async (req: Request, res: Response): Promise<void> => {
  const { item_type } = req.body as { item_type: string };

  switch (item_type) {
    case 'weapon': {
      const { base_die_type, total_dice_budget, channels } = req.body as {
        base_die_type: number;
        total_dice_budget: number;
        channels: Array<{ damage_type: string; num_dice: number }>;
      };
      // Find weapons sharing the same dice profile
      const candidates = await db.select().from(weapons).where(
        and(eq(weapons.base_die_type, base_die_type), eq(weapons.total_dice_budget, total_dice_budget))
      );
      // Filter in JS: channels must match exactly (same damage_type + num_dice set)
      const incoming = new Map(channels.map((c) => [c.damage_type, c.num_dice]));
      const matches: Array<{ id: string; name: string }> = [];
      for (const w of candidates) {
        const wChannels = await db.select().from(weaponChannels).where(eq(weaponChannels.weapon_id, w.id));
        if (wChannels.length !== channels.length) continue;
        const allMatch = wChannels.every(
          (wc) => incoming.get(wc.damage_type) === wc.num_dice
        );
        if (allMatch) matches.push({ id: w.id, name: w.name });
      }
      res.json({ duplicates: matches });
      break;
    }

    case 'armor': {
      const { slot, mitigation_percent } = req.body as { slot: string; mitigation_percent: string };
      const candidates = await db.select().from(armorPieces).where(eq(armorPieces.slot, slot));
      // Match on slot + mitigation within ±0.5%
      const incoming = parseFloat(mitigation_percent);
      const matches = candidates
        .filter((a) => Math.abs(parseFloat(a.mitigation_percent) - incoming) <= 0.5)
        .map((a) => ({ id: a.id, name: a.name }));
      res.json({ duplicates: matches });
      break;
    }

    case 'spell_gem': {
      const { element_type, num_dice, die_type } = req.body as {
        element_type: string; num_dice: number; die_type: number;
      };
      const matches = await db.select({ id: spellGems.id, name: spellGems.name })
        .from(spellGems)
        .where(and(
          eq(spellGems.element_type, element_type),
          eq(spellGems.num_dice, num_dice),
          eq(spellGems.die_type, die_type),
        ));
      res.json({ duplicates: matches });
      break;
    }

    case 'focus_bracer': {
      const { grade, gem_slots } = req.body as { grade: string; gem_slots: number };
      const matches = await db.select({ id: focusBracers.id, name: focusBracers.name })
        .from(focusBracers)
        .where(and(eq(focusBracers.grade, grade), eq(focusBracers.gem_slots, gem_slots)));
      res.json({ duplicates: matches });
      break;
    }

    case 'enemy': {
      const { classification, hp } = req.body as { classification: string; hp: number };
      const candidates = await db.select().from(enemies).where(eq(enemies.classification, classification));
      // Match HP within ±10%
      const matches = candidates
        .filter((e) => {
          const diff = Math.abs(Number(e.hp) - hp) / Math.max(hp, 1);
          return diff <= 0.1;
        })
        .map((e) => ({ id: e.id, name: e.name }));
      res.json({ duplicates: matches });
      break;
    }

    case 'pet': {
      const { species, power, agility, focus, presence } = req.body as {
        species: string; power: number; agility: number; focus: number; presence: number;
      };
      const candidates = await db.select().from(pets).where(eq(pets.species, species));
      // Match if all 4 attributes are within ±2 of the incoming values
      const matches = candidates
        .filter((p) =>
          Math.abs(p.power - power) <= 2 &&
          Math.abs(p.agility - agility) <= 2 &&
          Math.abs(p.focus - focus) <= 2 &&
          Math.abs(p.presence - presence) <= 2
        )
        .map((p) => ({ id: p.id, name: p.name }));
      res.json({ duplicates: matches });
      break;
    }

    default:
      res.status(400).json({ error: { code: 'INVALID_ITEM_TYPE', message: `Unknown item_type: ${item_type}`, status: 400 } });
  }
});

// ═════════════════════════════════════════════════════════════════════════════
// VERSION HISTORY  (read — no requirePaid, just requireAuth)
// GET /library/weapons/:id/versions
// GET /library/armor/:id/versions
// GET /library/spell-gems/:id/versions
// GET /library/focus-bracers/:id/versions
// GET /library/enemies/:id/versions
// GET /library/pets/:id/versions
// ═════════════════════════════════════════════════════════════════════════════
const versionHandler = (itemType: string) =>
  async (req: Request, res: Response): Promise<void> => {
    const id = param(req.params.id);
    const history = await db
      .select()
      .from(homebrewVersions)
      .where(and(eq(homebrewVersions.item_type, itemType), eq(homebrewVersions.item_id, id)))
      .orderBy(homebrewVersions.version);
    res.json({ data: history });
  };

router.get('/weapons/:id/versions',      versionHandler('weapon'));
router.get('/armor/:id/versions',        versionHandler('armor'));
router.get('/spell-gems/:id/versions',   versionHandler('spell_gem'));
router.get('/focus-bracers/:id/versions',versionHandler('focus_bracer'));
router.get('/enemies/:id/versions',      versionHandler('enemy'));
router.get('/pets/:id/versions',         versionHandler('pet'));

// ═════════════════════════════════════════════════════════════════════════════
// WEAPONS
// ═════════════════════════════════════════════════════════════════════════════

// POST /library/weapons — create homebrew weapon
router.post('/weapons', requirePaid, async (req: Request, res: Response): Promise<void> => {
  const userId = req.user!.user_id;
  const {
    name, category, rarity = 'common',
    base_die_type = 6, total_dice_budget = 1,
    req_power = 0, req_agility = 0, req_focus = 0,
    gem_slots = 0, description = '',
    is_public = false,
    channels = [],
  } = req.body as NewWeapon & { channels: Array<{ damage_type: string; num_dice: number }> };

  const newWeapon: NewWeapon = {
    name, category, rarity, base_die_type, total_dice_budget,
    req_power, req_agility, req_focus, gem_slots, description,
    is_homebrew: true,
    is_public,
    created_by: userId,
    version: 1,
  };

  const [weapon] = await db.insert(weapons).values(newWeapon).returning();

  if (channels.length) {
    await db.insert(weaponChannels).values(
      channels.map((c) => ({ weapon_id: weapon.id, damage_type: c.damage_type, num_dice: c.num_dice }))
    );
  }

  const allChannels = await db.select().from(weaponChannels).where(eq(weaponChannels.weapon_id, weapon.id));
  res.status(201).json({ ...weapon, channels: allChannels });
});

// PATCH /library/weapons/:id — update homebrew weapon (snapshots previous version)
router.patch('/weapons/:id', requirePaid, async (req: Request, res: Response): Promise<void> => {
  const id     = param(req.params.id);
  const userId = req.user!.user_id;

  const [existing] = await db.select().from(weapons).where(eq(weapons.id, id)).limit(1);
  if (!existing) { res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Weapon not found.', status: 404 } }); return; }
  if (!assertOwner(existing.created_by, userId, res)) return;

  const { channels, ...updates } = req.body as Partial<NewWeapon> & {
    channels?: Array<{ damage_type: string; num_dice: number }>;
  };

  // Snapshot current state before mutating
  const currentChannels = await db.select().from(weaponChannels).where(eq(weaponChannels.weapon_id, id));
  const nextVersion = await snapshotAndBump('weapon', id, { ...existing, channels: currentChannels }, userId);

  await db.update(weapons).set({
    ...updates,
    is_homebrew: true,   // can never be cleared via PATCH
    version:     nextVersion,
    updated_at:  new Date(),
  }).where(eq(weapons.id, id));

  // Replace channels if provided
  if (channels !== undefined) {
    await db.delete(weaponChannels).where(eq(weaponChannels.weapon_id, id));
    if (channels.length) {
      await db.insert(weaponChannels).values(
        channels.map((c) => ({ weapon_id: id, damage_type: c.damage_type, num_dice: c.num_dice }))
      );
    }
  }

  const [updated] = await db.select().from(weapons).where(eq(weapons.id, id)).limit(1);
  const allChannels = await db.select().from(weaponChannels).where(eq(weaponChannels.weapon_id, id));
  res.json({ ...updated, channels: allChannels });
});

// DELETE /library/weapons/:id
router.delete('/weapons/:id', requirePaid, async (req: Request, res: Response): Promise<void> => {
  const id     = param(req.params.id);
  const userId = req.user!.user_id;

  const [existing] = await db.select().from(weapons).where(eq(weapons.id, id)).limit(1);
  if (!existing) { res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Weapon not found.', status: 404 } }); return; }
  if (!assertOwner(existing.created_by, userId, res)) return;

  // Cascade deletes channels via FK; also clean version history
  await db.delete(homebrewVersions).where(and(eq(homebrewVersions.item_type, 'weapon'), eq(homebrewVersions.item_id, id)));
  await db.delete(weapons).where(eq(weapons.id, id));
  res.json({ success: true });
});

// ═════════════════════════════════════════════════════════════════════════════
// ARMOR
// ═════════════════════════════════════════════════════════════════════════════

router.post('/armor', requirePaid, async (req: Request, res: Response): Promise<void> => {
  const userId = req.user!.user_id;
  const {
    name, category, slot, rarity = 'common',
    mitigation_percent = '0', req_power = 0,
    gem_slots = 0, description = '', is_public = false,
  } = req.body as NewArmorPiece;

  const [armor] = await db.insert(armorPieces).values({
    name, category, slot, rarity, mitigation_percent, req_power,
    gem_slots, description,
    is_homebrew: true, is_public,
    created_by: userId, version: 1,
  }).returning();

  res.status(201).json(armor);
});

router.patch('/armor/:id', requirePaid, async (req: Request, res: Response): Promise<void> => {
  const id     = param(req.params.id);
  const userId = req.user!.user_id;

  const [existing] = await db.select().from(armorPieces).where(eq(armorPieces.id, id)).limit(1);
  if (!existing) { res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Armor not found.', status: 404 } }); return; }
  if (!assertOwner(existing.created_by, userId, res)) return;

  const nextVersion = await snapshotAndBump('armor', id, existing as unknown as Record<string, unknown>, userId);

  const updates = req.body as Partial<NewArmorPiece>;
  await db.update(armorPieces).set({
    ...updates, is_homebrew: true, version: nextVersion, updated_at: new Date(),
  }).where(eq(armorPieces.id, id));

  const [updated] = await db.select().from(armorPieces).where(eq(armorPieces.id, id)).limit(1);
  res.json(updated);
});

router.delete('/armor/:id', requirePaid, async (req: Request, res: Response): Promise<void> => {
  const id     = param(req.params.id);
  const userId = req.user!.user_id;

  const [existing] = await db.select().from(armorPieces).where(eq(armorPieces.id, id)).limit(1);
  if (!existing) { res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Armor not found.', status: 404 } }); return; }
  if (!assertOwner(existing.created_by, userId, res)) return;

  await db.delete(homebrewVersions).where(and(eq(homebrewVersions.item_type, 'armor'), eq(homebrewVersions.item_id, id)));
  await db.delete(armorPieces).where(eq(armorPieces.id, id));
  res.json({ success: true });
});

// ═════════════════════════════════════════════════════════════════════════════
// SPELL GEMS
// ═════════════════════════════════════════════════════════════════════════════

router.post('/spell-gems', requirePaid, async (req: Request, res: Response): Promise<void> => {
  const userId = req.user!.user_id;
  const {
    name, element_type, rarity = 'common',
    num_dice = 1, die_type = 6,
    armor_resistance_percent = '0',
    secondary_effect, description = '', is_public = false,
  } = req.body as NewSpellGem;

  const [gem] = await db.insert(spellGems).values({
    name, element_type, rarity, num_dice, die_type,
    armor_resistance_percent, secondary_effect, description,
    is_homebrew: true, is_public,
    created_by: userId, version: 1,
  }).returning();

  res.status(201).json(gem);
});

router.patch('/spell-gems/:id', requirePaid, async (req: Request, res: Response): Promise<void> => {
  const id     = param(req.params.id);
  const userId = req.user!.user_id;

  const [existing] = await db.select().from(spellGems).where(eq(spellGems.id, id)).limit(1);
  if (!existing) { res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Spell gem not found.', status: 404 } }); return; }
  if (!assertOwner(existing.created_by, userId, res)) return;

  const nextVersion = await snapshotAndBump('spell_gem', id, existing as unknown as Record<string, unknown>, userId);

  await db.update(spellGems).set({
    ...req.body as Partial<NewSpellGem>,
    is_homebrew: true, version: nextVersion, updated_at: new Date(),
  }).where(eq(spellGems.id, id));

  const [updated] = await db.select().from(spellGems).where(eq(spellGems.id, id)).limit(1);
  res.json(updated);
});

router.delete('/spell-gems/:id', requirePaid, async (req: Request, res: Response): Promise<void> => {
  const id     = param(req.params.id);
  const userId = req.user!.user_id;

  const [existing] = await db.select().from(spellGems).where(eq(spellGems.id, id)).limit(1);
  if (!existing) { res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Spell gem not found.', status: 404 } }); return; }
  if (!assertOwner(existing.created_by, userId, res)) return;

  await db.delete(homebrewVersions).where(and(eq(homebrewVersions.item_type, 'spell_gem'), eq(homebrewVersions.item_id, id)));
  await db.delete(spellGems).where(eq(spellGems.id, id));
  res.json({ success: true });
});

// ═════════════════════════════════════════════════════════════════════════════
// FOCUS BRACERS
// ═════════════════════════════════════════════════════════════════════════════

router.post('/focus-bracers', requirePaid, async (req: Request, res: Response): Promise<void> => {
  const userId = req.user!.user_id;
  const {
    name, grade, gem_slots, req_focus = 0,
    description = '', is_public = false,
  } = req.body as NewFocusBracer;

  const [bracer] = await db.insert(focusBracers).values({
    name, grade, gem_slots, req_focus, description,
    is_homebrew: true, is_public,
    created_by: userId, version: 1,
  }).returning();

  res.status(201).json(bracer);
});

router.patch('/focus-bracers/:id', requirePaid, async (req: Request, res: Response): Promise<void> => {
  const id     = param(req.params.id);
  const userId = req.user!.user_id;

  const [existing] = await db.select().from(focusBracers).where(eq(focusBracers.id, id)).limit(1);
  if (!existing) { res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Focus bracer not found.', status: 404 } }); return; }
  if (!assertOwner(existing.created_by, userId, res)) return;

  const nextVersion = await snapshotAndBump('focus_bracer', id, existing as unknown as Record<string, unknown>, userId);

  await db.update(focusBracers).set({
    ...req.body as Partial<NewFocusBracer>,
    is_homebrew: true, version: nextVersion, updated_at: new Date(),
  }).where(eq(focusBracers.id, id));

  const [updated] = await db.select().from(focusBracers).where(eq(focusBracers.id, id)).limit(1);
  res.json(updated);
});

router.delete('/focus-bracers/:id', requirePaid, async (req: Request, res: Response): Promise<void> => {
  const id     = param(req.params.id);
  const userId = req.user!.user_id;

  const [existing] = await db.select().from(focusBracers).where(eq(focusBracers.id, id)).limit(1);
  if (!existing) { res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Focus bracer not found.', status: 404 } }); return; }
  if (!assertOwner(existing.created_by, userId, res)) return;

  await db.delete(homebrewVersions).where(and(eq(homebrewVersions.item_type, 'focus_bracer'), eq(homebrewVersions.item_id, id)));
  await db.delete(focusBracers).where(eq(focusBracers.id, id));
  res.json({ success: true });
});

// ═════════════════════════════════════════════════════════════════════════════
// ENEMIES
// ═════════════════════════════════════════════════════════════════════════════

router.post('/enemies', requirePaid, async (req: Request, res: Response): Promise<void> => {
  const userId = req.user!.user_id;
  const {
    name, classification = 'standard',
    hp = 100, resistance_modifier = 0,
    power = 10, agility = 10, focus = 10, presence = 10,
    traits = [], attacks = [], enemy_weight = '1.0',
    description = '', is_public = false,
    attack_tiers = [],
  } = req.body as NewEnemy & {
    attack_tiers: Array<{ tier_name: string; pressure_steps: number; damage_multiplier: number; max_pool_contribution?: number }>;
    attacks: Array<{ name: string; damage_dice: string; damage_type: string; description?: string }>;
  };

  const chosen_val = Math.max(power, agility, focus, presence);
  const base_rp = calcBaseRP(1, chosen_val, 0);

  const [enemy] = await db.insert(enemies).values({
    name, classification,
    hp: BigInt(hp as unknown as number),
    resistance_modifier,
    power, agility, focus, presence, base_rp,
    traits, attacks, enemy_weight, description,
    is_homebrew: true, is_public,
    created_by: userId, version: 1,
  }).returning();

  if (attack_tiers.length) {
    await db.insert(enemyAttackTiers).values(
      attack_tiers.map((t) => ({
        enemy_id:              enemy.id,
        tier_name:             t.tier_name,
        pressure_steps:        t.pressure_steps,
        damage_multiplier:     t.damage_multiplier,
        max_pool_contribution: t.max_pool_contribution ?? 0,
      }))
    );
  }

  const tiers = await db.select().from(enemyAttackTiers).where(eq(enemyAttackTiers.enemy_id, enemy.id));
  res.status(201).json({ ...enemy, attack_tiers: tiers });
});

router.patch('/enemies/:id', requirePaid, async (req: Request, res: Response): Promise<void> => {
  const id     = param(req.params.id);
  const userId = req.user!.user_id;

  const [existing] = await db.select().from(enemies).where(eq(enemies.id, id)).limit(1);
  if (!existing) { res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Enemy not found.', status: 404 } }); return; }
  if (!assertOwner(existing.created_by, userId, res)) return;

  const { attack_tiers, ...updates } = req.body as Partial<NewEnemy> & {
    attack_tiers?: Array<{ tier_name: string; pressure_steps: number; damage_multiplier: number; max_pool_contribution?: number }>;
  };

  const currentTiers = await db.select().from(enemyAttackTiers).where(eq(enemyAttackTiers.enemy_id, id));
  const nextVersion  = await snapshotAndBump('enemy', id, { ...existing, attack_tiers: currentTiers }, userId);

  // Recalculate base_rp if any attribute changed
  const newPower    = (updates.power    ?? existing.power)    as number;
  const newAgility  = (updates.agility  ?? existing.agility)  as number;
  const newFocus    = (updates.focus    ?? existing.focus)    as number;
  const newPresence = (updates.presence ?? existing.presence) as number;
  const chosen_val  = Math.max(newPower, newAgility, newFocus, newPresence);
  const base_rp     = calcBaseRP(1, chosen_val, 0);

  const hpUpdate = updates.hp !== undefined ? { hp: BigInt(updates.hp as unknown as number) } : {};
  await db.update(enemies).set({
    ...updates, ...hpUpdate, base_rp,
    is_homebrew: true, version: nextVersion, updated_at: new Date(),
  }).where(eq(enemies.id, id));

  if (attack_tiers !== undefined) {
    await db.delete(enemyAttackTiers).where(eq(enemyAttackTiers.enemy_id, id));
    if (attack_tiers.length) {
      await db.insert(enemyAttackTiers).values(
        attack_tiers.map((t) => ({
          enemy_id:              id,
          tier_name:             t.tier_name,
          pressure_steps:        t.pressure_steps,
          damage_multiplier:     t.damage_multiplier,
          max_pool_contribution: t.max_pool_contribution ?? 0,
        }))
      );
    }
  }

  const [updated] = await db.select().from(enemies).where(eq(enemies.id, id)).limit(1);
  const tiers = await db.select().from(enemyAttackTiers).where(eq(enemyAttackTiers.enemy_id, id));
  res.json({ ...updated, attack_tiers: tiers });
});

router.delete('/enemies/:id', requirePaid, async (req: Request, res: Response): Promise<void> => {
  const id     = param(req.params.id);
  const userId = req.user!.user_id;

  const [existing] = await db.select().from(enemies).where(eq(enemies.id, id)).limit(1);
  if (!existing) { res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Enemy not found.', status: 404 } }); return; }
  if (!assertOwner(existing.created_by, userId, res)) return;

  await db.delete(homebrewVersions).where(and(eq(homebrewVersions.item_type, 'enemy'), eq(homebrewVersions.item_id, id)));
  await db.delete(enemies).where(eq(enemies.id, id));  // attack_tiers cascade
  res.json({ success: true });
});

// ═════════════════════════════════════════════════════════════════════════════
// PETS
// ═════════════════════════════════════════════════════════════════════════════

router.post('/pets', requirePaid, async (req: Request, res: Response): Promise<void> => {
  const userId = req.user!.user_id;
  const {
    name, species, description = '',
    power = 10, agility = 10, focus = 10, presence = 10,
    movement = 30, is_public = false,
    attacks = [],
  } = req.body as NewPet & {
    attacks: Array<{
      name: string; damage_dice: string;
      damage_type: string; description?: string; order_index?: number;
    }>;
  };

  // Compute base_rp and max_hp using the same rules as characters (level 1)
  const chosen_val = Math.max(power, agility, focus, presence);
  const base_rp    = calcBaseRP(1, chosen_val, 0);
  const max_hp     = calcMaxHP(base_rp, 1);

  const [pet] = await db.insert(pets).values({
    name, species, description,
    power, agility, focus, presence, movement,
    base_rp, max_hp: BigInt(max_hp),
    is_homebrew: true, is_public,
    created_by: userId, version: 1,
  }).returning();

  if (attacks.length) {
    await db.insert(petAttacks).values(
      attacks.map((a, i) => ({
        pet_id:      pet.id,
        name:        a.name,
        damage_dice: a.damage_dice,
        damage_type: a.damage_type,
        description: a.description ?? '',
        order_index: a.order_index ?? i,
      }))
    );
  }

  const allAttacks = await db.select().from(petAttacks)
    .where(eq(petAttacks.pet_id, pet.id))
    .orderBy(petAttacks.order_index);
  res.status(201).json({ ...pet, attacks: allAttacks });
});

router.patch('/pets/:id', requirePaid, async (req: Request, res: Response): Promise<void> => {
  const id     = param(req.params.id);
  const userId = req.user!.user_id;

  const [existing] = await db.select().from(pets).where(eq(pets.id, id)).limit(1);
  if (!existing) { res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Pet not found.', status: 404 } }); return; }
  if (!assertOwner(existing.created_by, userId, res)) return;

  const { attacks, ...updates } = req.body as Partial<NewPet> & {
    attacks?: Array<{
      name: string; damage_dice: string;
      damage_type: string; description?: string; order_index?: number;
    }>;
  };

  const currentAttacks = await db.select().from(petAttacks).where(eq(petAttacks.pet_id, id));
  const nextVersion    = await snapshotAndBump('pet', id, { ...existing, attacks: currentAttacks }, userId);

  // Recompute HP/RP if any stat changed
  const newPower    = updates.power    ?? existing.power;
  const newAgility  = updates.agility  ?? existing.agility;
  const newFocus    = updates.focus    ?? existing.focus;
  const newPresence = updates.presence ?? existing.presence;
  const chosen_val  = Math.max(newPower, newAgility, newFocus, newPresence);
  const base_rp     = calcBaseRP(1, chosen_val, 0);
  const max_hp      = calcMaxHP(base_rp, 1);

  await db.update(pets).set({
    ...updates,
    base_rp, max_hp: BigInt(max_hp),
    is_homebrew: true, version: nextVersion, updated_at: new Date(),
  }).where(eq(pets.id, id));

  if (attacks !== undefined) {
    await db.delete(petAttacks).where(eq(petAttacks.pet_id, id));
    if (attacks.length) {
      await db.insert(petAttacks).values(
        attacks.map((a, i) => ({
          pet_id:      id,
          name:        a.name,
          damage_dice: a.damage_dice,
          damage_type: a.damage_type,
          description: a.description ?? '',
          order_index: a.order_index ?? i,
        }))
      );
    }
  }

  const [updated]  = await db.select().from(pets).where(eq(pets.id, id)).limit(1);
  const allAttacks = await db.select().from(petAttacks)
    .where(eq(petAttacks.pet_id, id))
    .orderBy(petAttacks.order_index);
  res.json({ ...updated, attacks: allAttacks });
});

router.delete('/pets/:id', requirePaid, async (req: Request, res: Response): Promise<void> => {
  const id     = param(req.params.id);
  const userId = req.user!.user_id;

  const [existing] = await db.select().from(pets).where(eq(pets.id, id)).limit(1);
  if (!existing) { res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Pet not found.', status: 404 } }); return; }
  if (!assertOwner(existing.created_by, userId, res)) return;

  await db.delete(homebrewVersions).where(and(eq(homebrewVersions.item_type, 'pet'), eq(homebrewVersions.item_id, id)));
  await db.delete(pets).where(eq(pets.id, id));   // pet_attacks cascade
  res.json({ success: true });
});

export default router;