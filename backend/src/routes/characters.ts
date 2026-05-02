import { Router, Request, Response } from 'express';
import { eq, and, isNull }           from 'drizzle-orm';
import { db }                        from '../db';
import {
  characters, characterEquipment, characterBracerGems, growthPoolHistory,
  characterPets, pets, petAttacks,
  type NewCharacter,
} from '../db/schema';
import { requireAuth }               from '../middleware/auth';
import { calcBaseRP, calcMaxHP, validateAttributeDistribution } from '../lib/rules';

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
  } = req.body as {
    name?: string;
    power?: number; agility?: number; focus?: number; presence?: number;
    chosen_attribute?: AttrKey;
    backstory?: string; notes?: string; gold?: number;
    growth_pool?: number;
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

  await db.insert(growthPoolHistory).values({
    character_id: character.id,
    level_gained: 1,
    roll_result:  growth_roll,
  });

  res.status(201).json(character);
});

// ── GET /characters/:id ───────────────────────────────────────────────────
router.get('/:id', async (req: Request, res: Response): Promise<void> => {
  const id = param(req.params.id);

  const [character] = await db
    .select()
    .from(characters)
    .where(and(eq(characters.id, id), isNull(characters.deleted_at)))
    .limit(1);

  if (!character || character.user_id !== req.user!.user_id) {
    res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Character not found.', status: 404 } });
    return;
  }

  const equipment   = await db.select().from(characterEquipment).where(eq(characterEquipment.character_id, id));
  const bracerGems  = await db.select().from(characterBracerGems).where(eq(characterBracerGems.character_id, id));
  const poolHistory = await db.select().from(growthPoolHistory).where(eq(growthPoolHistory.character_id, id));

  res.json({ ...character, equipment, bracer_gems: bracerGems, growth_pool_history: poolHistory });
});

// ── PATCH /characters/:id ─────────────────────────────────────────────────
router.patch('/:id', async (req: Request, res: Response): Promise<void> => {
  const id = param(req.params.id);

  const [existing] = await db
    .select()
    .from(characters)
    .where(and(eq(characters.id, id), isNull(characters.deleted_at)))
    .limit(1);

  if (!existing || existing.user_id !== req.user!.user_id) {
    res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Character not found.', status: 404 } });
    return;
  }

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

// ── POST /characters/:id/level-up ─────────────────────────────────────────
router.post('/:id/level-up', async (req: Request, res: Response): Promise<void> => {
  const id = param(req.params.id);

  const [character] = await db
    .select()
    .from(characters)
    .where(and(eq(characters.id, id), isNull(characters.deleted_at)))
    .limit(1);

  if (!character || character.user_id !== req.user!.user_id) {
    res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Character not found.', status: 404 } });
    return;
  }

  const { attribute_points, chosen_attribute } = req.body as {
    attribute_points: Partial<Record<AttrKey, number>>;
    chosen_attribute?: AttrKey;
  };

  const validation = validateAttributeDistribution(attribute_points ?? {});
  if (!validation.valid) {
    res.status(422).json({
      error: { code: 'INVALID_ATTRIBUTE_DISTRIBUTION', message: validation.reason, status: 422 },
    });
    return;
  }

  // Server is authoritative for the level-up growth roll
  const growth_roll     = rollD6();
  const new_level       = character.level + 1;
  const new_growth_pool = character.growth_pool_total + growth_roll;
  const new_power       = character.power    + (attribute_points?.power    ?? 0);
  const new_agility     = character.agility  + (attribute_points?.agility  ?? 0);
  const new_focus       = character.focus    + (attribute_points?.focus    ?? 0);
  const new_presence    = character.presence + (attribute_points?.presence ?? 0);
  const new_chosen      = (chosen_attribute ?? character.chosen_attribute) as AttrKey;

  const newAttrMap: Record<AttrKey, number> = {
    power: new_power, agility: new_agility, focus: new_focus, presence: new_presence,
  };
  const new_base_rp   = calcBaseRP(new_level, newAttrMap[new_chosen] ?? 10, new_growth_pool);
  const new_max_hp    = calcMaxHP(new_base_rp, new_level);

  await db.update(characters).set({
    level:             new_level,
    power:             new_power,
    agility:           new_agility,
    focus:             new_focus,
    presence:          new_presence,
    chosen_attribute:  new_chosen,
    growth_pool_total: new_growth_pool,
    base_rp:           new_base_rp,
    current_rp:        new_base_rp,
    rp_banked:         0,
    rp_banking:        false,
    max_hp:            BigInt(new_max_hp),
    updated_at:        new Date(),
  }).where(eq(characters.id, id));

  await db.insert(growthPoolHistory).values({
    character_id: character.id,
    level_gained: new_level,
    roll_result:  growth_roll,
  });

  const [updated] = await db.select().from(characters).where(eq(characters.id, id)).limit(1);
  res.json({ ...updated, growth_roll_this_level: growth_roll });
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
    res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Character not found.', status: 404 } });
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

  if (!character || character.user_id !== req.user!.user_id) {
    res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Character not found.', status: 404 } });
    return;
  }

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