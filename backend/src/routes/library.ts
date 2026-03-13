import { Router, Request, Response } from 'express';
import { eq, ilike, and, or }        from 'drizzle-orm';
import { db }                         from '../db';
import {
  weapons, weaponChannels, armorPieces, spellGems,
  focusBracers, enemies, enemyAttackTiers, pets, petAttacks,
} from '../db/schema';
import { requireAuth } from '../middleware/auth';

const router = Router();
router.use(requireAuth);

const param = (p: string | string[]): string => (Array.isArray(p) ? p[0] : p);

// Visible = official content OR public homebrew
const visible = <T extends { is_homebrew: boolean; is_public: boolean }>(
  table: { is_homebrew: any; is_public: any }
) => or(eq(table.is_homebrew, false), eq(table.is_public, true))!;

// ── GET /library/weapons ──────────────────────────────────────────────────
router.get('/weapons', async (req: Request, res: Response): Promise<void> => {
  const { name, rarity, category } = req.query as Record<string, string>;
  const conditions = [visible(weapons)];
  if (name)     conditions.push(ilike(weapons.name, `%${name}%`));
  if (rarity)   conditions.push(eq(weapons.rarity, rarity));
  if (category) conditions.push(eq(weapons.category, category));

  const list = await db.select().from(weapons).where(and(...conditions));
  const withChannels = await Promise.all(list.map(async (w) => ({
    ...w,
    channels: await db.select().from(weaponChannels).where(eq(weaponChannels.weapon_id, w.id)),
  })));
  res.json({ data: withChannels });
});

// ── GET /library/weapons/mine ─────────────────────────────────────────────
router.get('/weapons/mine', async (req: Request, res: Response): Promise<void> => {
  const userId = req.user!.user_id;
  const list = await db.select().from(weapons)
    .where(and(eq(weapons.is_homebrew, true), eq(weapons.created_by as any, userId)));
  const withChannels = await Promise.all(list.map(async (w) => ({
    ...w,
    channels: await db.select().from(weaponChannels).where(eq(weaponChannels.weapon_id, w.id)),
  })));
  res.json({ data: withChannels });
});

// ── GET /library/weapons/:id ──────────────────────────────────────────────
router.get('/weapons/:id', async (req: Request, res: Response): Promise<void> => {
  const id = param(req.params.id);
  const [weapon] = await db.select().from(weapons).where(eq(weapons.id, id)).limit(1);
  if (!weapon) { res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Weapon not found.', status: 404 } }); return; }
  const channels = await db.select().from(weaponChannels).where(eq(weaponChannels.weapon_id, weapon.id));
  res.json({ ...weapon, channels });
});

// ── GET /library/armor ────────────────────────────────────────────────────
router.get('/armor', async (req: Request, res: Response): Promise<void> => {
  const { slot, category, rarity } = req.query as Record<string, string>;
  const conditions = [visible(armorPieces)];
  if (slot)     conditions.push(eq(armorPieces.slot, slot));
  if (category) conditions.push(eq(armorPieces.category, category));
  if (rarity)   conditions.push(eq(armorPieces.rarity, rarity));
  const list = await db.select().from(armorPieces).where(and(...conditions));
  res.json({ data: list });
});

// ── GET /library/armor/mine ───────────────────────────────────────────────
router.get('/armor/mine', async (req: Request, res: Response): Promise<void> => {
  const userId = req.user!.user_id;
  const list = await db.select().from(armorPieces)
    .where(and(eq(armorPieces.is_homebrew, true), eq(armorPieces.created_by as any, userId)));
  res.json({ data: list });
});

// ── GET /library/armor/:id ────────────────────────────────────────────────
router.get('/armor/:id', async (req: Request, res: Response): Promise<void> => {
  const id = param(req.params.id);
  const [piece] = await db.select().from(armorPieces).where(eq(armorPieces.id, id)).limit(1);
  if (!piece) { res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Armor piece not found.', status: 404 } }); return; }
  res.json(piece);
});

// ── GET /library/spell-gems ───────────────────────────────────────────────
router.get('/spell-gems', async (req: Request, res: Response): Promise<void> => {
  const { element, rarity } = req.query as Record<string, string>;
  const conditions = [visible(spellGems)];
  if (element) conditions.push(eq(spellGems.element_type, element));
  if (rarity)  conditions.push(eq(spellGems.rarity, rarity));
  const list = await db.select().from(spellGems).where(and(...conditions));
  res.json({ data: list });
});

// ── GET /library/spell-gems/mine ──────────────────────────────────────────
router.get('/spell-gems/mine', async (req: Request, res: Response): Promise<void> => {
  const userId = req.user!.user_id;
  const list = await db.select().from(spellGems)
    .where(and(eq(spellGems.is_homebrew, true), eq(spellGems.created_by as any, userId)));
  res.json({ data: list });
});

// ── GET /library/spell-gems/:id ───────────────────────────────────────────
router.get('/spell-gems/:id', async (req: Request, res: Response): Promise<void> => {
  const id = param(req.params.id);
  const [gem] = await db.select().from(spellGems).where(eq(spellGems.id, id)).limit(1);
  if (!gem) { res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Spell gem not found.', status: 404 } }); return; }
  res.json(gem);
});

// ── GET /library/focus-bracers ────────────────────────────────────────────
router.get('/focus-bracers', async (req: Request, res: Response): Promise<void> => {
  const { grade } = req.query as Record<string, string>;
  const conditions = [visible(focusBracers)];
  if (grade) conditions.push(eq(focusBracers.grade, grade));
  const list = await db.select().from(focusBracers).where(and(...conditions));
  res.json({ data: list });
});

// ── GET /library/focus-bracers/mine ──────────────────────────────────────
router.get('/focus-bracers/mine', async (req: Request, res: Response): Promise<void> => {
  const userId = req.user!.user_id;
  const list = await db.select().from(focusBracers)
    .where(and(eq(focusBracers.is_homebrew, true), eq(focusBracers.created_by as any, userId)));
  res.json({ data: list });
});

// ── GET /library/focus-bracers/:id ────────────────────────────────────────
router.get('/focus-bracers/:id', async (req: Request, res: Response): Promise<void> => {
  const id = param(req.params.id);
  const [bracer] = await db.select().from(focusBracers).where(eq(focusBracers.id, id)).limit(1);
  if (!bracer) { res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Focus bracer not found.', status: 404 } }); return; }
  res.json(bracer);
});

// ── GET /library/enemies ──────────────────────────────────────────────────
router.get('/enemies', async (req: Request, res: Response): Promise<void> => {
  const { name, classification } = req.query as Record<string, string>;
  const conditions = [visible(enemies)];
  if (name)           conditions.push(ilike(enemies.name, `%${name}%`));
  if (classification) conditions.push(eq(enemies.classification, classification));
  const list = await db.select().from(enemies).where(and(...conditions));
  const withTiers = await Promise.all(list.map(async (e) => ({
    ...e,
    attack_tiers: await db.select().from(enemyAttackTiers).where(eq(enemyAttackTiers.enemy_id, e.id)),
  })));
  res.json({ data: withTiers });
});

// ── GET /library/enemies/mine ─────────────────────────────────────────────
router.get('/enemies/mine', async (req: Request, res: Response): Promise<void> => {
  const userId = req.user!.user_id;
  const list = await db.select().from(enemies)
    .where(and(eq(enemies.is_homebrew, true), eq(enemies.created_by as any, userId)));
  const withTiers = await Promise.all(list.map(async (e) => ({
    ...e,
    attack_tiers: await db.select().from(enemyAttackTiers).where(eq(enemyAttackTiers.enemy_id, e.id)),
  })));
  res.json({ data: withTiers });
});

// ── GET /library/enemies/:id (keep existing if present) ──────────────────
router.get('/enemies/:id', async (req: Request, res: Response): Promise<void> => {
  const id = param(req.params.id);
  const [enemy] = await db.select().from(enemies).where(eq(enemies.id, id)).limit(1);
  if (!enemy) { res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Enemy not found.', status: 404 } }); return; }
  const attack_tiers = await db.select().from(enemyAttackTiers).where(eq(enemyAttackTiers.enemy_id, enemy.id));
  res.json({ ...enemy, attack_tiers });
});

// ── GET /library/pets ─────────────────────────────────────────────────────
router.get('/pets', async (req: Request, res: Response): Promise<void> => {
  const { name, species } = req.query as Record<string, string>;
  const conditions = [visible(pets)];
  if (name)    conditions.push(ilike(pets.name, `%${name}%`));
  if (species) conditions.push(ilike(pets.species, `%${species}%`));
  const list = await db.select().from(pets).where(and(...conditions));
  const withAttacks = await Promise.all(list.map(async (p) => ({
    ...p,
    attacks: await db.select().from(petAttacks)
      .where(eq(petAttacks.pet_id, p.id))
      .orderBy(petAttacks.order_index),
  })));
  res.json({ data: withAttacks });
});

// ── GET /library/pets/mine ────────────────────────────────────────────────
router.get('/pets/mine', async (req: Request, res: Response): Promise<void> => {
  const userId = req.user!.user_id;
  const list = await db.select().from(pets)
    .where(and(eq(pets.is_homebrew, true), eq(pets.created_by as any, userId)));
  const withAttacks = await Promise.all(list.map(async (p) => ({
    ...p,
    attacks: await db.select().from(petAttacks)
      .where(eq(petAttacks.pet_id, p.id))
      .orderBy(petAttacks.order_index),
  })));
  res.json({ data: withAttacks });
});

// ── GET /library/pets/:id ─────────────────────────────────────────────────
router.get('/pets/:id', async (req: Request, res: Response): Promise<void> => {
  const id = param(req.params.id);
  const [pet] = await db.select().from(pets).where(eq(pets.id, id)).limit(1);
  if (!pet) { res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Pet not found.', status: 404 } }); return; }
  const attacks = await db.select().from(petAttacks)
    .where(eq(petAttacks.pet_id, pet.id))
    .orderBy(petAttacks.order_index);
  res.json({ ...pet, attacks });
});

export default router;