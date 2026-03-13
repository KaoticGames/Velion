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

const router = Router();
router.use(requireAuth);

const param = (p: string | string[]): string => (Array.isArray(p) ? p[0] : p);

// ── Helpers ───────────────────────────────────────────────────────────────

/** Confirm the character belongs to the requesting user */
async function assertCharacterOwner(
  characterId: string,
  userId: string,
  res: Response,
): Promise<boolean> {
  const [c] = await db
    .select({ id: characters.id, user_id: characters.user_id })
    .from(characters)
    .where(eq(characters.id, characterId))
    .limit(1);

  if (!c || c.user_id !== userId) {
    res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Character not found.', status: 404 } });
    return false;
  }
  return true;
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