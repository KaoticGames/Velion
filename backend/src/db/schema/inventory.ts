import {
  pgTable, uuid, text, integer, boolean, numeric, timestamp,
} from 'drizzle-orm/pg-core';
import { characters } from './characters';

// ─────────────────────────────────────────────────────────────────────────────
// GENERAL ITEMS
// Mundane equipment, consumables, and adventure gear. Not part of the combat
// library (weapons/armor/gems) — things like potions, rope, rations, tools.
// ─────────────────────────────────────────────────────────────────────────────

export const generalItems = pgTable('general_items', {
  id:          uuid('id').primaryKey().defaultRandom(),
  name:        text('name').notNull(),
  // category: consumable | tool | light | container | misc
  category:    text('category').notNull().default('misc'),
  weight:      numeric('weight', { precision: 5, scale: 2 }).notNull().default('0'),
  value_gold:  integer('value_gold').notNull().default(0),
  description: text('description').notNull().default(''),
  // consumable items have an effect string (e.g. "Restores 500 HP")
  effect:      text('effect').notNull().default(''),
  // Can this stack in inventory?
  stackable:   boolean('stackable').notNull().default(true),
});

// ─────────────────────────────────────────────────────────────────────────────
// CHARACTER INVENTORY
// One row per owned item per character. Source of truth for what a player has.
// item_type: weapon | armor | spell_gem | general
// library_item_id: references the relevant library table row (null for custom/manual)
//
// Equipping:
//   equipped = true means this item is currently in use
//   equipped_slot: the gear slot it occupies (mirrors character_equipment slots)
//   character_equipment continues to exist for fast slot-keyed lookups, but is
//   kept in sync by the inventory routes — do not write to it directly.
// ─────────────────────────────────────────────────────────────────────────────

export const characterInventory = pgTable('character_inventory', {
  id:              uuid('id').primaryKey().defaultRandom(),
  character_id:    uuid('character_id').notNull().references(() => characters.id, { onDelete: 'cascade' }),

  // item_type: weapon | armor | spell_gem | general
  item_type:       text('item_type').notNull(),

  // Points to the relevant library table (weapons, armor_pieces, spell_gems, general_items)
  // null for manually-entered items with no library reference
  library_item_id: uuid('library_item_id'),

  // For general items (and stackable library items) — defaults to 1
  quantity:        integer('quantity').notNull().default(1),

  // Optional player-written note on this specific item (e.g. "from the cursed dungeon")
  notes:           text('notes').notNull().default(''),

  // Equipped state
  equipped:        boolean('equipped').notNull().default(false),
  // e.g. main_hand | off_hand | helmet | chestplate | leggings | gauntlets | boots | shirt | pants | bracer
  // null when not equipped
  equipped_slot:   text('equipped_slot'),

  added_at:        timestamp('added_at', { withTimezone: true }).notNull().defaultNow(),
});

// ── Types ──────────────────────────────────────────────────────────────────
export type GeneralItem         = typeof generalItems.$inferSelect;
export type NewGeneralItem      = typeof generalItems.$inferInsert;
export type CharacterInventory  = typeof characterInventory.$inferSelect;
export type NewInventoryItem    = typeof characterInventory.$inferInsert;