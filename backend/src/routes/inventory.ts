/**
 * backend/src/routes/inventory.ts
 *
 * Routes:
 *   GET    /inventory/general-items              — browse all general items
 *   GET    /inventory/:characterId               — get full bag (resolved item details)
 *   POST   /inventory/:characterId               — add item from library or general items
 *   PATCH  /inventory/:characterId/:itemId       — equip/unequip, change qty, add note
 *   DELETE /inventory/:characterId/:itemId       — remove from bag
 */

import { Router, Request, Response } from 'express';
import { eq, and, ilike }            from 'drizzle-orm';
import { db }                        from '../db';
import {
  characterInventory, generalItems,
  type NewInventoryItem,
} from '../db/schema';
import {
  characters, characterEquipment,
  weapons, armorPieces, spellGems, focusBracers,
} from '../db/schema';
import { requireAuth }               from '../middleware/auth';
import { getCharacterAccess, canManageCharacter } from '../lib/campaignCharacterAuth';

const router = Router();
router.use(requireAuth);

const param = (p: string | string[]): string => (Array.isArray(p) ? p[0] : p);

// ── Helpers ───────────────────────────────────────────────────────────────

/** Owner or campaign DM may manage inventory. */
async function assertCharacterOwner(
  characterId: string,
  userId: string,
  res: Response,
): Promise<boolean> {
  const { access, character } = await getCharacterAccess(characterId, userId);
  if (!character || !canManageCharacter(access)) {
    res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Character not found.', status: 404 } });
    return false;
  }
  return true;
}

type StatBlock = { power: number; agility: number; focus: number; presence: number };

async function loadCharacterCombatStats(characterId: string): Promise<StatBlock | null> {
  const [c] = await db
    .select({
      power:    characters.power,
      agility:  characters.agility,
      focus:    characters.focus,
      presence: characters.presence,
    })
    .from(characters)
    .where(eq(characters.id, characterId))
    .limit(1);
  if (!c) return null;
  return {
    power:    Number(c.power) || 0,
    agility:  Number(c.agility) || 0,
    focus:    Number(c.focus) || 0,
    presence: Number(c.presence) || 0,
  };
}

/** Returns a user-facing message if requirements are not met; otherwise null. */
function statRequirementMessage(stats: StatBlock, itemType: string, lib: Record<string, unknown>): string | null {
  if (itemType === 'weapon') {
    const rp = Number(lib.req_power) || 0;
    const ra = Number(lib.req_agility) || 0;
    const rf = Number(lib.req_focus) || 0;
    if (stats.power < rp || stats.agility < ra || stats.focus < rf) {
      return `This weapon requires Power ${rp}, Agility ${ra}, and Focus ${rf}. Your stats are Power ${stats.power}, Agility ${stats.agility}, Focus ${stats.focus}.`;
    }
  }
  if (itemType === 'armor') {
    const rp = Number(lib.req_power) || 0;
    if (stats.power < rp) {
      return `This armor requires Power ${rp}. Your Power is ${stats.power}.`;
    }
  }
  if (itemType === 'focus_bracer') {
    const rf = Number(lib.req_focus) || 0;
    if (stats.focus < rf) {
      return `This focus bracer requires Focus ${rf}. Your Focus is ${stats.focus}.`;
    }
  }
  return null;
}

/** Resolve item details from the relevant library table */
async function resolveItem(item_type: string, library_item_id: string | null) {
  if (!library_item_id) return null;
  if (item_type === 'weapon')       { const [r] = await db.select().from(weapons).where(eq(weapons.id, library_item_id)).limit(1);           return r ?? null; }
  if (item_type === 'armor')        { const [r] = await db.select().from(armorPieces).where(eq(armorPieces.id, library_item_id)).limit(1);     return r ?? null; }
  if (item_type === 'spell_gem')    { const [r] = await db.select().from(spellGems).where(eq(spellGems.id, library_item_id)).limit(1);         return r ?? null; }
  if (item_type === 'general')      { const [r] = await db.select().from(generalItems).where(eq(generalItems.id, library_item_id)).limit(1);   return r ?? null; }
  if (item_type === 'focus_bracer') { const [r] = await db.select().from(focusBracers).where(eq(focusBracers.id, library_item_id)).limit(1);   return r ?? null; }
  return null;
}

/** Keep character_equipment in sync when an inventory item is equipped/unequipped */
async function syncEquipmentSlot(
  characterId: string,
  slot: string | null,
  item_type: string,
  library_item_id: string | null,
  equip: boolean,
) {
  if (!slot || (item_type !== 'weapon' && item_type !== 'armor' && item_type !== 'focus_bracer')) return;

  if (!equip) {
    await db.delete(characterEquipment).where(
      and(eq(characterEquipment.character_id, characterId), eq(characterEquipment.slot, slot))
    );
    return;
  }

  if (!library_item_id) return;

  // Upsert — delete existing in slot then insert
  await db.delete(characterEquipment).where(
    and(eq(characterEquipment.character_id, characterId), eq(characterEquipment.slot, slot))
  );
  await db.insert(characterEquipment).values({
    character_id: characterId,
    slot,
    item_type,
    item_id: library_item_id,
  });
}

// ── GET /inventory/general-items ──────────────────────────────────────────
router.get('/general-items', async (req: Request, res: Response): Promise<void> => {
  const { search, category } = req.query as { search?: string; category?: string };

  let query = db.select().from(generalItems).$dynamic();

  if (search) {
    query = query.where(ilike(generalItems.name, `%${search}%`));
  }
  if (category) {
    query = query.where(eq(generalItems.category, category));
  }

  const items = await query.orderBy(generalItems.category, generalItems.name);
  res.json({ data: items });
});

// ── GET /inventory/:characterId ───────────────────────────────────────────
router.get('/:characterId', async (req: Request, res: Response): Promise<void> => {
  const characterId = param(req.params.characterId);
  if (!await assertCharacterOwner(characterId, req.user!.user_id, res)) return;

  const rows = await db
    .select()
    .from(characterInventory)
    .where(eq(characterInventory.character_id, characterId))
    .orderBy(characterInventory.added_at);

  // Resolve item details for each row
  const resolved = await Promise.all(
    rows.map(async (row) => ({
      ...row,
      item_details: await resolveItem(row.item_type, row.library_item_id),
    }))
  );

  res.json({ data: resolved });
});

// ── POST /inventory/:characterId ─────────────────────────────────────────
// Body: { item_type, library_item_id, quantity?, notes? }
router.post('/:characterId', async (req: Request, res: Response): Promise<void> => {
  const characterId = param(req.params.characterId);
  if (!await assertCharacterOwner(characterId, req.user!.user_id, res)) return;

  const { item_type, library_item_id, quantity = 1, notes = '' } =
    req.body as { item_type: string; library_item_id: string; quantity?: number; notes?: string };

  if (!item_type || !library_item_id) {
    res.status(400).json({ error: { code: 'BAD_REQUEST', message: 'item_type and library_item_id are required.', status: 400 } });
    return;
  }

  // For stackable general items already in inventory, increment quantity instead of adding a new row
  if (item_type === 'general') {
    const [genItem] = await db.select().from(generalItems).where(eq(generalItems.id, library_item_id)).limit(1);
    if (genItem?.stackable) {
      const [existing] = await db
        .select()
        .from(characterInventory)
        .where(and(
          eq(characterInventory.character_id, characterId),
          eq(characterInventory.item_type, 'general'),
          eq(characterInventory.library_item_id, library_item_id),
        ))
        .limit(1);

      if (existing) {
        const [updated] = await db
          .update(characterInventory)
          .set({ quantity: existing.quantity + quantity })
          .where(eq(characterInventory.id, existing.id))
          .returning();

        const item_details = await resolveItem(item_type, library_item_id);
        res.status(200).json({ ...updated, item_details });
        return;
      }
    }
  }

  if (item_type === 'weapon' || item_type === 'armor' || item_type === 'focus_bracer') {
    const details = await resolveItem(item_type, library_item_id);
    if (!details) {
      res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Library item not found.', status: 404 } });
      return;
    }
    const stats = await loadCharacterCombatStats(characterId);
    if (!stats) {
      res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Character not found.', status: 404 } });
      return;
    }
    const msg = statRequirementMessage(stats, item_type, details as Record<string, unknown>);
    if (msg) {
      res.status(422).json({ error: { code: 'REQUIREMENTS_NOT_MET', message: msg, status: 422 } });
      return;
    }
  }

  const [row] = await db
    .insert(characterInventory)
    .values({ character_id: characterId, item_type, library_item_id, quantity, notes } as NewInventoryItem)
    .returning();

  const item_details = await resolveItem(item_type, library_item_id);
  res.status(201).json({ ...row, item_details });
});

// ── PATCH /inventory/:characterId/:itemId ────────────────────────────────
// Body: { equipped?, equipped_slot?, quantity?, notes? }
router.patch('/:characterId/:itemId', async (req: Request, res: Response): Promise<void> => {
  const characterId = param(req.params.characterId);
  const itemId      = param(req.params.itemId);
  if (!await assertCharacterOwner(characterId, req.user!.user_id, res)) return;

  const [existing] = await db
    .select()
    .from(characterInventory)
    .where(and(eq(characterInventory.id, itemId), eq(characterInventory.character_id, characterId)))
    .limit(1);

  if (!existing) {
    res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Inventory item not found.', status: 404 } });
    return;
  }

  const { equipped, equipped_slot, quantity, notes } =
    req.body as { equipped?: boolean; equipped_slot?: string | null; quantity?: number; notes?: string };

  if (equipped === true && equipped_slot) {
    const libDetails = await resolveItem(existing.item_type, existing.library_item_id);
    if (!libDetails) {
      res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Library item not found for this inventory row.', status: 404 } });
      return;
    }
    const stats = await loadCharacterCombatStats(characterId);
    if (!stats) {
      res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Character not found.', status: 404 } });
      return;
    }
    const reqMsg = statRequirementMessage(stats, existing.item_type, libDetails as Record<string, unknown>);
    if (reqMsg) {
      res.status(422).json({ error: { code: 'REQUIREMENTS_NOT_MET', message: reqMsg, status: 422 } });
      return;
    }
  }

  // If equipping, unequip any other item currently in the same slot
  if (equipped === true && equipped_slot) {
    const conflicts = await db
      .select()
      .from(characterInventory)
      .where(and(
        eq(characterInventory.character_id, characterId),
        eq(characterInventory.equipped, true),
        eq(characterInventory.equipped_slot, equipped_slot),
      ));

    for (const conflict of conflicts) {
      if (conflict.id !== itemId) {
        await db.update(characterInventory)
          .set({ equipped: false, equipped_slot: null })
          .where(eq(characterInventory.id, conflict.id));
        await syncEquipmentSlot(characterId, equipped_slot, conflict.item_type, conflict.library_item_id, false);
      }
    }
  }

  const updates: Partial<typeof characterInventory.$inferInsert> = {};
  if (equipped  !== undefined) updates.equipped      = equipped;
  if (equipped_slot !== undefined) updates.equipped_slot = equipped_slot ?? null;
  if (quantity  !== undefined) updates.quantity       = quantity;
  if (notes     !== undefined) updates.notes          = notes;

  const [updated] = await db
    .update(characterInventory)
    .set(updates)
    .where(eq(characterInventory.id, itemId))
    .returning();

  // Sync character_equipment
  const finalSlot = updated.equipped_slot;
  await syncEquipmentSlot(
    characterId, finalSlot, updated.item_type, updated.library_item_id,
    updated.equipped,
  );

  const item_details = await resolveItem(updated.item_type, updated.library_item_id);
  res.json({ ...updated, item_details });
});

// ── DELETE /inventory/:characterId/:itemId ────────────────────────────────
router.delete('/:characterId/:itemId', async (req: Request, res: Response): Promise<void> => {
  const characterId = param(req.params.characterId);
  const itemId      = param(req.params.itemId);
  if (!await assertCharacterOwner(characterId, req.user!.user_id, res)) return;

  const [existing] = await db
    .select()
    .from(characterInventory)
    .where(and(eq(characterInventory.id, itemId), eq(characterInventory.character_id, characterId)))
    .limit(1);

  if (!existing) {
    res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Inventory item not found.', status: 404 } });
    return;
  }

  // Unequip from gear slot if equipped
  if (existing.equipped && existing.equipped_slot) {
    await syncEquipmentSlot(characterId, existing.equipped_slot, existing.item_type, existing.library_item_id, false);
  }

  await db.delete(characterInventory).where(eq(characterInventory.id, itemId));
  res.json({ success: true });
});

export default router;