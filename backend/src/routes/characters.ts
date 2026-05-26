import { Router, Request, Response } from 'express';
import { eq, and, isNull }           from 'drizzle-orm';
import { db }                        from '../db';
import {
  characters, characterEquipment, characterBracerGems, growthPoolHistory,
  characterPets, pets, petAttacks,
  specialAbilities, characterSpecialAbilities,
  type NewCharacter,
} from '../db/schema';
import {
  rowFromPayload, rowFromTemplate, validateAbilityPayload,
  type SpecialAbilityPayload,
} from '../lib/specialAbilities';
import { requireAuth }               from '../middleware/auth';
import { calcBaseRP, calcMaxHP } from '../lib/rules';
import { getCharacterAccess, canManageCharacter } from '../lib/campaignCharacterAuth';
import {
  applyBulkLevelUp,
  applyBulkLevelDown,
  loadProgressionSnapshot,
  persistCreationBaseline,
  recordLevelUpStep,
  removeLevelStep,
  upsertProgressionStep,
  type AttrKey as ProgAttrKey,
  type CreationBaseline,
} from '../lib/characterProgression';

const router = Router();
router.use(requireAuth);

// ── Types ─────────────────────────────────────────────────────────────────
type AttrKey = 'power' | 'agility' | 'focus' | 'presence';

// ── Helpers ───────────────────────────────────────────────────────────────

/** Recompute and cache base_rp / max_hp after any stat-affecting change */
const recalcAndSave = async (characterId: string): Promise<void> => {
  const [c] = await db
    .select()
    .from(characters)
    .where(eq(characters.id, characterId))
    .limit(1);

  const attrMap: Record<AttrKey, number> = {
    power: c.power, agility: c.agility, focus: c.focus, presence: c.presence,
  };
  const chosenVal  = attrMap[(c.chosen_attribute as AttrKey)] ?? 10;
  const base_rp    = calcBaseRP(c.level, chosenVal, c.growth_pool_total);
  const max_hp_num = calcMaxHP(base_rp, c.level);
  const prevCur    = Number(c.current_rp ?? c.base_rp);
  const clampedRp  = Math.min(Math.max(0, prevCur), base_rp);

  await db
    .update(characters)
    .set({ base_rp, max_hp: BigInt(max_hp_num), current_rp: clampedRp, updated_at: new Date() })
    .where(eq(characters.id, characterId));
};

const rollD6 = (): number => Math.floor(Math.random() * 6) + 1;

/** Cast req.params value to a plain string (Express can type params as string | string[]) */
const param = (p: string | string[]): string => (Array.isArray(p) ? p[0] : p);

const NOT_FOUND = { error: { code: 'NOT_FOUND', message: 'Character not found.', status: 404 } };

/** Owner or DM of a campaign that includes this character. */
async function assertManageAccess(
  res: Response,
  character: { id: string } | null | undefined,
  userId: string,
): Promise<boolean> {
  if (!character) {
    res.status(404).json(NOT_FOUND);
    return false;
  }
  const { access } = await getCharacterAccess(character.id, userId);
  if (!canManageCharacter(access)) {
    res.status(404).json(NOT_FOUND);
    return false;
  }
  return true;
}

// ── GET /characters ───────────────────────────────────────────────────────
router.get('/', async (req: Request, res: Response): Promise<void> => {
  const userId = req.user!.user_id;
  const list = await db
    .select()
    .from(characters)
    .where(and(eq(characters.user_id, userId), isNull(characters.deleted_at)));
  res.json({ data: list, meta: { total: list.length } });
});

// ── POST /characters ──────────────────────────────────────────────────────
router.post('/', async (req: Request, res: Response): Promise<void> => {
  const userId = req.user!.user_id;
  const tier   = req.user!.subscription_tier;

  if (tier === 'free') {
    const existing = await db
      .select()
      .from(characters)
      .where(and(eq(characters.user_id, userId), isNull(characters.deleted_at)));
    if (existing.length >= 3) {
      res.status(422).json({
        error: { code: 'CHARACTER_LIMIT_EXCEEDED', message: 'Free users may only create 3 characters.', status: 422 },
      });
      return;
    }
  }

  const {
    name,
    power    = 10,
    agility  = 10,
    focus    = 10,
    presence = 10,
    chosen_attribute = 'power',
    backstory = '',
    notes     = '',
    gold      = 0,
    growth_pool: clientGrowthPool,
    special_abilities: clientAbilities,
  } = req.body as {
    name?: string;
    power?: number; agility?: number; focus?: number; presence?: number;
    chosen_attribute?: AttrKey;
    backstory?: string; notes?: string; gold?: number;
    growth_pool?: number;
    special_abilities?: SpecialAbilityPayload[];
  };

  const attrKey: AttrKey       = (chosen_attribute as AttrKey) ?? 'power';
  const attrValues             = { power, agility, focus, presence };
  const growth_roll            = clientGrowthPool ?? rollD6();
  const growth_pool_total      = growth_roll;
  const base_rp                = calcBaseRP(1, attrValues[attrKey] ?? 10, growth_pool_total);
  const max_hp_num             = calcMaxHP(base_rp, 1);

  const newCharacter: NewCharacter = {
    user_id:           userId,
    name:              name || 'Unnamed Hero',
    power,
    agility,
    focus,
    presence,
    chosen_attribute:  attrKey,
    growth_pool_total,
    base_rp,
    current_rp:        base_rp,
    rp_banked:         0,
    rp_banking:        false,
    max_hp:            BigInt(max_hp_num),
    current_hp:        BigInt(max_hp_num),
    backstory,
    notes,
    gold,
  };

  const [character] = await db.insert(characters).values(newCharacter).returning();

  const baseline: CreationBaseline = {
    power,
    agility,
    focus,
    presence,
    growth_roll,
    chosen_attribute: attrKey,
  };

  await db
    .update(characters)
    .set({ creation_baseline: baseline as never })
    .where(eq(characters.id, character.id));

  await db.insert(growthPoolHistory).values({
    character_id: character.id,
    level_gained: 1,
    roll_result:  growth_roll,
  });

  const abilities = Array.isArray(clientAbilities) ? clientAbilities : [];
  if (abilities.length > 0) {
    const rows: Array<ReturnType<typeof rowFromPayload> & { sort_order: number }> = [];
    for (let idx = 0; idx < abilities.length; idx++) {
      const payload = abilities[idx];
      const err = validateAbilityPayload(payload);
      if (err) {
        res.status(422).json({ error: { code: 'VALIDATION_ERROR', message: err, status: 422 } });
        return;
      }
      if (payload.ability_id) {
        const [tpl] = await db.select().from(specialAbilities)
          .where(eq(specialAbilities.id, payload.ability_id)).limit(1);
        if (!tpl) {
          res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Special ability template not found.', status: 404 } });
          return;
        }
        if (tpl.is_homebrew && !tpl.is_public && tpl.created_by !== userId) {
          res.status(403).json({ error: { code: 'FORBIDDEN', message: 'You cannot attach this ability.', status: 403 } });
          return;
        }
        rows.push({ ...rowFromTemplate(tpl), sort_order: idx });
      } else {
        if (tier === 'free') {
          res.status(403).json({
            error: {
              code: 'UPGRADE_REQUIRED',
              message: 'Free accounts can only attach public library abilities during creation.',
              status: 403,
            },
          });
          return;
        }
        rows.push({ ...rowFromPayload(payload), sort_order: idx });
      }
    }
    await db.insert(characterSpecialAbilities).values(
      rows.map((r) => ({ character_id: character.id, ...r })),
    );
  }

  const special_abilities = await db.select().from(characterSpecialAbilities)
    .where(eq(characterSpecialAbilities.character_id, character.id));

  res.status(201).json({ ...character, special_abilities });
});

// ── GET /characters/:id ───────────────────────────────────────────────────
router.get('/:id', async (req: Request, res: Response): Promise<void> => {
  const id = param(req.params.id);

  const [character] = await db
    .select()
    .from(characters)
    .where(and(eq(characters.id, id), isNull(characters.deleted_at)))
    .limit(1);

  if (!(await assertManageAccess(res, character, req.user!.user_id))) return;

  const equipment   = await db.select().from(characterEquipment).where(eq(characterEquipment.character_id, id));
  const bracerGems  = await db.select().from(characterBracerGems).where(eq(characterBracerGems.character_id, id));
  const poolHistory = await db.select().from(growthPoolHistory).where(eq(growthPoolHistory.character_id, id));
  const special_abilities = await db.select().from(characterSpecialAbilities)
    .where(eq(characterSpecialAbilities.character_id, id));

  res.json({ ...character, equipment, bracer_gems: bracerGems, growth_pool_history: poolHistory, special_abilities });
});

// ── PATCH /characters/:id ─────────────────────────────────────────────────
router.patch('/:id', async (req: Request, res: Response): Promise<void> => {
  const id = param(req.params.id);

  const [existing] = await db
    .select()
    .from(characters)
    .where(and(eq(characters.id, id), isNull(characters.deleted_at)))
    .limit(1);

  if (!(await assertManageAccess(res, existing, req.user!.user_id))) return;

  // Build a strongly-typed partial update — only allow safe fields
  const body = req.body as Partial<{
    name: string; backstory: string; notes: string; gold: number;
    current_hp: bigint; chosen_attribute: AttrKey; portrait_url: string;
    current_rp: number; rp_banked: number; rp_banking: boolean;
    sheet_armor_overrides: unknown;
  }>;

  const updates: Partial<NewCharacter> = { updated_at: new Date() };
  if (body.name             !== undefined) updates.name             = body.name;
  if (body.backstory        !== undefined) updates.backstory        = body.backstory;
  if (body.notes            !== undefined) updates.notes            = body.notes;
  if (body.gold             !== undefined) updates.gold             = body.gold;
  if (body.current_hp       !== undefined) updates.current_hp       = BigInt(body.current_hp as unknown as number);
  if (body.chosen_attribute !== undefined) updates.chosen_attribute = body.chosen_attribute;
  if (body.portrait_url     !== undefined) updates.portrait_url     = body.portrait_url;
  if (body.current_rp !== undefined) {
    const v = Math.floor(Number(body.current_rp));
    if (!Number.isFinite(v) || v < 0) {
      res.status(422).json({ error: { code: 'VALIDATION_ERROR', message: 'current_rp must be a non-negative integer.', status: 422 } });
      return;
    }
    updates.current_rp = v;
  }
  if (body.rp_banked !== undefined) {
    const v = Math.floor(Number(body.rp_banked));
    if (!Number.isFinite(v) || v < 0) {
      res.status(422).json({ error: { code: 'VALIDATION_ERROR', message: 'rp_banked must be a non-negative integer.', status: 422 } });
      return;
    }
    updates.rp_banked = v;
  }
  if (body.rp_banking !== undefined) updates.rp_banking = Boolean(body.rp_banking);

  if (body.sheet_armor_overrides !== undefined) {
    const raw = body.sheet_armor_overrides;
    if (raw !== null && (typeof raw !== 'object' || Array.isArray(raw))) {
      res.status(422).json({
        error: { code: 'VALIDATION_ERROR', message: 'sheet_armor_overrides must be a JSON object.', status: 422 },
      });
      return;
    }
    const sheetSlots = new Set([
      'Helmet', 'Chestplate', 'Leggings', 'Gauntlets', 'Boots', 'Shirt', 'Pants',
    ]);
    const out: Record<string, Record<string, unknown>> = {};
    if (raw !== null) {
      for (const slot of sheetSlots) {
        const v = (raw as Record<string, unknown>)[slot];
        if (!v || typeof v !== 'object' || Array.isArray(v)) continue;
        const vo = v as Record<string, unknown>;
        const entry: Record<string, unknown> = {};
        if ('library_item_id' in vo && (vo.library_item_id === null || typeof vo.library_item_id === 'string')) {
          entry.library_item_id = vo.library_item_id;
        }
        if (typeof vo.mitigation === 'number' && Number.isFinite(vo.mitigation)) {
          entry.mitigation = Math.max(0, Math.min(100, vo.mitigation));
        }
        if (vo.resistances && typeof vo.resistances === 'object' && !Array.isArray(vo.resistances)) {
          const r: Record<string, number> = {};
          for (const [k, val] of Object.entries(vo.resistances as Record<string, unknown>)) {
            if (typeof val === 'number' && Number.isFinite(val)) {
              r[k] = Math.max(0, Math.min(200, val));
            }
          }
          entry.resistances = r;
        }
        if (Object.keys(entry).length > 0) out[slot] = entry;
      }
    }
    const json = JSON.stringify(out);
    if (json.length > 80_000) {
      res.status(422).json({
        error: { code: 'VALIDATION_ERROR', message: 'sheet_armor_overrides payload is too large.', status: 422 },
      });
      return;
    }
    updates.sheet_armor_overrides = out as never;
  }

  await db.update(characters).set(updates).where(eq(characters.id, id));

  if (body.chosen_attribute !== undefined) {
    await recalcAndSave(id);
  }

  const [updated] = await db.select().from(characters).where(eq(characters.id, id)).limit(1);
  res.json(updated);
});

// ── GET /characters/:id/progression ─────────────────────────────────────
router.get('/:id/progression', async (req: Request, res: Response): Promise<void> => {
  const id = param(req.params.id);
  const [character] = await db
    .select()
    .from(characters)
    .where(and(eq(characters.id, id), isNull(characters.deleted_at)))
    .limit(1);

  if (!(await assertManageAccess(res, character, req.user!.user_id))) return;

  const snap = await loadProgressionSnapshot(id);
  res.json(snap);
});

// ── PUT /characters/:id/creation-baseline ─────────────────────────────────
router.put('/:id/creation-baseline', async (req: Request, res: Response): Promise<void> => {
  const id = param(req.params.id);
  const [character] = await db
    .select()
    .from(characters)
    .where(and(eq(characters.id, id), isNull(characters.deleted_at)))
    .limit(1);

  if (!(await assertManageAccess(res, character, req.user!.user_id))) return;

  const body = req.body as CreationBaseline;
  if (
    typeof body.power !== 'number' ||
    typeof body.agility !== 'number' ||
    typeof body.focus !== 'number' ||
    typeof body.presence !== 'number' ||
    typeof body.growth_roll !== 'number' ||
    typeof body.chosen_attribute !== 'string'
  ) {
    res.status(422).json({ error: { code: 'VALIDATION_ERROR', message: 'Invalid creation baseline.', status: 422 } });
    return;
  }

  const growth_roll = Math.floor(body.growth_roll);
  if (growth_roll < 1 || growth_roll > 6) {
    res.status(422).json({ error: { code: 'VALIDATION_ERROR', message: 'growth_roll must be 1–6.', status: 422 } });
    return;
  }

  const baseline: CreationBaseline = {
    power: Math.floor(body.power),
    agility: Math.floor(body.agility),
    focus: Math.floor(body.focus),
    presence: Math.floor(body.presence),
    growth_roll,
    chosen_attribute: body.chosen_attribute as ProgAttrKey,
  };

  await persistCreationBaseline(id, baseline);
  await db.update(characters).set({ updated_at: new Date() }).where(eq(characters.id, id));
  const result = await loadProgressionSnapshot(id);
  res.json(result);
});

// ── PUT /characters/:id/progression/step/:toLevel ───────────────────────
router.put('/:id/progression/step/:toLevel', async (req: Request, res: Response): Promise<void> => {
  const id = param(req.params.id);
  const toLevel = Math.floor(Number(param(req.params.toLevel)));

  const [character] = await db
    .select()
    .from(characters)
    .where(and(eq(characters.id, id), isNull(characters.deleted_at)))
    .limit(1);

  if (!(await assertManageAccess(res, character, req.user!.user_id))) return;

  const body = req.body as {
    power_gain?: number;
    agility_gain?: number;
    focus_gain?: number;
    presence_gain?: number;
    growth_roll?: number;
    chosen_attribute?: ProgAttrKey;
  };

  const result = await upsertProgressionStep(id, {
    to_level: toLevel,
    power_gain: Math.floor(body.power_gain ?? 0),
    agility_gain: Math.floor(body.agility_gain ?? 0),
    focus_gain: Math.floor(body.focus_gain ?? 0),
    presence_gain: Math.floor(body.presence_gain ?? 0),
    growth_roll: Math.floor(body.growth_roll ?? 0),
    chosen_attribute: (body.chosen_attribute ?? character.chosen_attribute) as ProgAttrKey,
  });

  if (!result.valid) {
    res.status(422).json({ error: { code: 'VALIDATION_ERROR', message: result.reason, status: 422 } });
    return;
  }

  const snap = await loadProgressionSnapshot(id);
  res.json(snap);
});

// ── POST /characters/:id/progression/bulk-up ─────────────────────────────
router.post('/:id/progression/bulk-up', async (req: Request, res: Response): Promise<void> => {
  const id = param(req.params.id);

  const [character] = await db
    .select()
    .from(characters)
    .where(and(eq(characters.id, id), isNull(characters.deleted_at)))
    .limit(1);

  if (!(await assertManageAccess(res, character, req.user!.user_id))) return;

  const body = req.body as {
    target_level?: number;
    power?: number;
    agility?: number;
    focus?: number;
    presence?: number;
    growth_rolls?: number[];
    chosen_attribute?: ProgAttrKey;
  };

  const result = await applyBulkLevelUp(id, {
    target_level: Math.floor(Number(body.target_level)),
    power: Math.floor(body.power ?? 0),
    agility: Math.floor(body.agility ?? 0),
    focus: Math.floor(body.focus ?? 0),
    presence: Math.floor(body.presence ?? 0),
    growth_rolls: body.growth_rolls ?? [],
    chosen_attribute: (body.chosen_attribute ?? character.chosen_attribute) as ProgAttrKey,
  });

  if (!result.valid) {
    res.status(422).json({ error: { code: 'VALIDATION_ERROR', message: result.reason, status: 422 } });
    return;
  }

  const snap = await loadProgressionSnapshot(id);
  const [updated] = await db.select().from(characters).where(eq(characters.id, id)).limit(1);
  res.json({ character: updated, progression: snap });
});

// ── POST /characters/:id/progression/bulk-down ───────────────────────────
router.post('/:id/progression/bulk-down', async (req: Request, res: Response): Promise<void> => {
  const id = param(req.params.id);

  const [character] = await db
    .select()
    .from(characters)
    .where(and(eq(characters.id, id), isNull(characters.deleted_at)))
    .limit(1);

  if (!(await assertManageAccess(res, character, req.user!.user_id))) return;

  const body = req.body as {
    target_level?: number;
    power?: number;
    agility?: number;
    focus?: number;
    presence?: number;
  };

  const result = await applyBulkLevelDown(id, {
    target_level: Math.floor(Number(body.target_level)),
    power: Math.floor(body.power ?? 0),
    agility: Math.floor(body.agility ?? 0),
    focus: Math.floor(body.focus ?? 0),
    presence: Math.floor(body.presence ?? 0),
  });

  if (!result.valid) {
    res.status(422).json({ error: { code: 'VALIDATION_ERROR', message: result.reason, status: 422 } });
    return;
  }

  const snap = await loadProgressionSnapshot(id);
  const [updated] = await db.select().from(characters).where(eq(characters.id, id)).limit(1);
  res.json({ character: updated, progression: snap });
});

// ── POST /characters/:id/level-up ─────────────────────────────────────────
router.post('/:id/level-up', async (req: Request, res: Response): Promise<void> => {
  const id = param(req.params.id);

  const [character] = await db
    .select()
    .from(characters)
    .where(and(eq(characters.id, id), isNull(characters.deleted_at)))
    .limit(1);

  if (!(await assertManageAccess(res, character, req.user!.user_id))) return;

  const { attribute_points, chosen_attribute, growth_roll: clientGrowthRoll } = req.body as {
    attribute_points: Partial<Record<AttrKey, number>>;
    chosen_attribute?: AttrKey;
    growth_roll?: number;
  };

  const growth_roll = Math.floor(Number(clientGrowthRoll));
  if (!Number.isFinite(growth_roll) || growth_roll < 1 || growth_roll > 6) {
    res.status(422).json({
      error: {
        code: 'INVALID_GROWTH_ROLL',
        message: 'Level-up requires a growth pool roll (1d6 result between 1 and 6).',
        status: 422,
      },
    });
    return;
  }

  const newLevel = character.level + 1;
  const stepResult = await recordLevelUpStep(id, {
    to_level: newLevel,
    power_gain: attribute_points?.power ?? 0,
    agility_gain: attribute_points?.agility ?? 0,
    focus_gain: attribute_points?.focus ?? 0,
    presence_gain: attribute_points?.presence ?? 0,
    growth_roll,
    chosen_attribute: (chosen_attribute ?? character.chosen_attribute) as ProgAttrKey,
  });

  if (!stepResult.valid) {
    res.status(422).json({ error: { code: 'VALIDATION_ERROR', message: stepResult.reason, status: 422 } });
    return;
  }

  const [updated] = await db.select().from(characters).where(eq(characters.id, id)).limit(1);
  res.json({ ...updated, growth_roll_this_level: growth_roll });
});

// ── POST /characters/:id/level-down ───────────────────────────────────────
router.post('/:id/level-down', async (req: Request, res: Response): Promise<void> => {
  const id = param(req.params.id);

  const [character] = await db
    .select()
    .from(characters)
    .where(and(eq(characters.id, id), isNull(characters.deleted_at)))
    .limit(1);

  if (!(await assertManageAccess(res, character, req.user!.user_id))) return;

  const result = await removeLevelStep(id);
  if (!result.valid) {
    res.status(422).json({ error: { code: 'VALIDATION_ERROR', message: result.reason, status: 422 } });
    return;
  }

  const snap = await loadProgressionSnapshot(id);
  const [updated] = await db.select().from(characters).where(eq(characters.id, id)).limit(1);
  res.json({ character: updated, progression: snap });
});

// ── DELETE /characters/:id ────────────────────────────────────────────────
router.delete('/:id', async (req: Request, res: Response): Promise<void> => {
  const id = param(req.params.id);

  const [character] = await db
    .select()
    .from(characters)
    .where(and(eq(characters.id, id), isNull(characters.deleted_at)))
    .limit(1);

  if (!character || character.user_id !== req.user!.user_id) {
    res.status(404).json(NOT_FOUND);
    return;
  }

  await db.update(characters).set({ deleted_at: new Date() }).where(eq(characters.id, id));
  res.json({ success: true });
});

// ── PUT /characters/:id/equipment/:slot ───────────────────────────────────
router.put('/:id/equipment/:slot', async (req: Request, res: Response): Promise<void> => {
  const id   = param(req.params.id);
  const slot = param(req.params.slot);
  const { item_type, item_id } = req.body as { item_type: string; item_id: string };

  const [character] = await db
    .select()
    .from(characters)
    .where(and(eq(characters.id, id), isNull(characters.deleted_at)))
    .limit(1);

  if (!(await assertManageAccess(res, character, req.user!.user_id))) return;

  await db
    .delete(characterEquipment)
    .where(and(eq(characterEquipment.character_id, id), eq(characterEquipment.slot, slot)));

  const [equipped] = await db
    .insert(characterEquipment)
    .values({ character_id: id, slot, item_type, item_id })
    .returning();

  res.json(equipped);
});

// ── DELETE /characters/:id/equipment/:slot ────────────────────────────────
router.delete('/:id/equipment/:slot', async (req: Request, res: Response): Promise<void> => {
  const id   = param(req.params.id);
  const slot = param(req.params.slot);

  await db
    .delete(characterEquipment)
    .where(and(eq(characterEquipment.character_id, id), eq(characterEquipment.slot, slot)));

  res.json({ success: true });
});

// ── PUT /characters/:id/bracer-gems ───────────────────────────────────────
router.put('/:id/bracer-gems', async (req: Request, res: Response): Promise<void> => {
  const id   = param(req.params.id);
  const gems = req.body.gems as Array<{ slot_index: number; spell_gem_id: string }>;

  await db.delete(characterBracerGems).where(eq(characterBracerGems.character_id, id));

  if (gems?.length) {
    await db.insert(characterBracerGems).values(
      gems.map((g) => ({
        character_id:   id,
        gem_slot_index: g.slot_index,
        spell_gem_id:   g.spell_gem_id,
      }))
    );
  }

  const updated = await db
    .select()
    .from(characterBracerGems)
    .where(eq(characterBracerGems.character_id, id));

  res.json(updated);
});

// ── GET /:id/special-abilities ─────────────────────────────────────────────
router.get('/:id/special-abilities', async (req: Request, res: Response): Promise<void> => {
  const id = param(req.params.id);
  const [character] = await db
    .select()
    .from(characters)
    .where(and(eq(characters.id, id), isNull(characters.deleted_at)))
    .limit(1);
  if (!(await assertManageAccess(res, character, req.user!.user_id))) return;
  const list = await db.select().from(characterSpecialAbilities)
    .where(eq(characterSpecialAbilities.character_id, id));
  res.json({ data: list });
});

// ── POST /:id/special-abilities ───────────────────────────────────────────
router.post('/:id/special-abilities', async (req: Request, res: Response): Promise<void> => {
  const id = param(req.params.id);
  const userId = req.user!.user_id;
  const tier = req.user!.subscription_tier;

  const [character] = await db
    .select()
    .from(characters)
    .where(and(eq(characters.id, id), isNull(characters.deleted_at)))
    .limit(1);
  if (!(await assertManageAccess(res, character, userId))) return;

  const payload = req.body as SpecialAbilityPayload & { create_library?: boolean };
  const err = validateAbilityPayload(payload);
  if (err) {
    res.status(422).json({ error: { code: 'VALIDATION_ERROR', message: err, status: 422 } });
    return;
  }

  let abilityId: string | null = payload.ability_id ?? null;
  let rowData = rowFromPayload(payload, abilityId);

  if (abilityId) {
    const [tpl] = await db.select().from(specialAbilities).where(eq(specialAbilities.id, abilityId)).limit(1);
    if (!tpl) {
      res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Ability template not found.', status: 404 } });
      return;
    }
    if (tpl.is_homebrew && !tpl.is_public && tpl.created_by !== userId) {
      res.status(403).json({ error: { code: 'FORBIDDEN', message: 'You cannot attach this ability.', status: 403 } });
      return;
    }
    rowData = rowFromTemplate(tpl);
  } else if (tier === 'free') {
    res.status(403).json({
      error: {
        code: 'UPGRADE_REQUIRED',
        message: 'Free accounts can attach public library abilities only. Ask your DM to publish a custom ability.',
        status: 403,
      },
    });
    return;
  } else if (payload.create_library) {
    const [lib] = await db.insert(specialAbilities).values({
      name: rowData.name,
      description: rowData.description,
      resolution_model: rowData.resolution_model,
      num_dice: rowData.num_dice,
      die_type: rowData.die_type,
      damage_type: rowData.damage_type,
      suggested_rp_note: rowData.suggested_rp_note,
      applies_states: rowData.applies_states as never,
      secondary_effect_text: rowData.secondary_effect_text,
      is_homebrew: true,
      is_public: Boolean((payload as { is_public?: boolean }).is_public),
      created_by: userId,
      version: 1,
    }).returning();
    abilityId = lib.id;
    rowData = { ...rowData, ability_id: abilityId };
  }

  const existing = await db.select().from(characterSpecialAbilities)
    .where(eq(characterSpecialAbilities.character_id, id));
  const [inserted] = await db.insert(characterSpecialAbilities).values({
    character_id: id,
    ...rowData,
    sort_order: existing.length,
  }).returning();

  res.status(201).json(inserted);
});

// ── DELETE /:id/special-abilities/:abilityRowId ───────────────────────────
router.delete('/:id/special-abilities/:abilityRowId', async (req: Request, res: Response): Promise<void> => {
  const id = param(req.params.id);
  const abilityRowId = param(req.params.abilityRowId);
  const userId = req.user!.user_id;

  const [character] = await db
    .select()
    .from(characters)
    .where(and(eq(characters.id, id), isNull(characters.deleted_at)))
    .limit(1);
  if (!(await assertManageAccess(res, character, userId))) return;

  await db.delete(characterSpecialAbilities).where(
    and(
      eq(characterSpecialAbilities.id, abilityRowId),
      eq(characterSpecialAbilities.character_id, id),
    ),
  );
  res.json({ success: true });
});

// ── GET /:id/pets ─────────────────────────────────────────────────────────
router.get('/:id/pets', async (req: Request, res: Response): Promise<void> => {
  const id = req.params.id as string;
  const bonds = await db.select().from(characterPets).where(eq(characterPets.character_id, id));
  const result = await Promise.all(bonds.map(async bond => {
    const [pet] = await db.select().from(pets).where(eq(pets.id, bond.pet_id)).limit(1);
    const attacks = pet
      ? await db.select().from(petAttacks).where(eq(petAttacks.pet_id, pet.id)).orderBy(petAttacks.order_index)
      : [];
    return { ...bond, pet: pet ? { ...pet, attacks } : null };
  }));
  res.json({ data: result });
});

// ── POST /:id/pets ────────────────────────────────────────────────────────
router.post('/:id/pets', async (req: Request, res: Response): Promise<void> => {
  const id = req.params.id as string;
  const { pet_id, nickname } = req.body;
  if (!pet_id) { res.status(400).json({ error: 'pet_id required' }); return; }
  const [pet] = await db.select().from(pets).where(eq(pets.id, pet_id as string)).limit(1);
  if (!pet) { res.status(404).json({ error: 'Pet not found' }); return; }
  const [bond] = await db.insert(characterPets).values({
    character_id: id,
    pet_id: pet_id as string,
    nickname: nickname || null,
    current_hp: BigInt(pet.max_hp || 0),
  }).returning();
  const attacks = await db.select().from(petAttacks).where(eq(petAttacks.pet_id, pet.id)).orderBy(petAttacks.order_index);
  res.json({ ...bond, pet: { ...pet, attacks } });
});

// ── PATCH /:id/pets/:bondId ───────────────────────────────────────────────
router.patch('/:id/pets/:bondId', async (req: Request, res: Response): Promise<void> => {
  const id     = req.params.id     as string;
  const bondId = req.params.bondId as string;
  const { nickname, current_hp, notes } = req.body;
  const updates: Record<string, unknown> = {};
  if (nickname   !== undefined) updates.nickname   = nickname;
  if (notes      !== undefined) updates.notes      = notes;
  if (current_hp !== undefined) updates.current_hp = BigInt(current_hp);
  const [bond] = await db.update(characterPets).set(updates)
    .where(and(eq(characterPets.id, bondId), eq(characterPets.character_id, id)))
    .returning();
  res.json(bond);
});

// ── DELETE /:id/pets/:bondId ──────────────────────────────────────────────
router.delete('/:id/pets/:bondId', async (req: Request, res: Response): Promise<void> => {
  const id     = req.params.id     as string;
  const bondId = req.params.bondId as string;
  await db.delete(characterPets)
    .where(and(eq(characterPets.id, bondId), eq(characterPets.character_id, id)));
  res.json({ success: true });
});

export default router;