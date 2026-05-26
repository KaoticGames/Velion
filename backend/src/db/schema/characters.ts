import { pgTable, uuid, text, integer, bigint, timestamp, boolean, jsonb, unique } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { users } from './users';

export const characters = pgTable('characters', {
  id:                uuid('id').primaryKey().defaultRandom(),
  user_id:           uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  name:              text('name').notNull(),
  level:             integer('level').notNull().default(1),

  // Core attributes
  power:             integer('power').notNull().default(10),
  agility:           integer('agility').notNull().default(10),
  focus:             integer('focus').notNull().default(10),
  presence:          integer('presence').notNull().default(10),

  chosen_attribute:  text('chosen_attribute').notNull().default('power'),

  // Growth Pool
  growth_pool_total: integer('growth_pool_total').notNull().default(0),

  // Computed + cached (recalculated on attribute/level change)
  base_rp:           integer('base_rp').notNull().default(0),
  /** Spendable RP this turn — synced with VTT + character sheet (authoritative in DB). */
  current_rp:        integer('current_rp').notNull().default(0),
  /** RP banked for the next turn (sheet / VTT bank flow). */
  rp_banked:         integer('rp_banked').notNull().default(0),
  /** Whether the player has committed banking for end-of-turn. */
  rp_banking:        boolean('rp_banking').notNull().default(false),
  // bigint: at level 50+ max_hp exceeds int4 ceiling
  max_hp:            bigint('max_hp', { mode: 'bigint' }).notNull().default(sql`0`),
  current_hp:        bigint('current_hp', { mode: 'bigint' }).notNull().default(sql`0`),

  backstory:         text('backstory').notNull().default(''),
  notes:             text('notes').notNull().default(''),
  gold:              integer('gold').notNull().default(0),
  portrait_url:      text('portrait_url'),

  /** Per-slot armor tweaks from the sheet (resistances, mitigation) keyed by sheet slot e.g. Helmet. */
  sheet_armor_overrides: jsonb('sheet_armor_overrides').notNull().default(sql`'{}'::jsonb`),

  /** Level-1 origin: rolled attributes, initial growth d6, chosen attribute (see character_level_progression for 2+). */
  creation_baseline: jsonb('creation_baseline'),

  created_at:        timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updated_at:        timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  deleted_at:        timestamp('deleted_at', { withTimezone: true }),
});

export const growthPoolHistory = pgTable('growth_pool_history', {
  id:           uuid('id').primaryKey().defaultRandom(),
  character_id: uuid('character_id').notNull().references(() => characters.id, { onDelete: 'cascade' }),
  level_gained: integer('level_gained').notNull(),
  roll_result:  integer('roll_result').notNull(),   // 1–6
  rolled_at:    timestamp('rolled_at', { withTimezone: true }).notNull().defaultNow(),
});

/** Per level-up (levels 2+): +2 attribute points (max +1 each) and one growth d6. */
export const characterLevelProgression = pgTable(
  'character_level_progression',
  {
    id:               uuid('id').primaryKey().defaultRandom(),
    character_id:     uuid('character_id').notNull().references(() => characters.id, { onDelete: 'cascade' }),
    to_level:         integer('to_level').notNull(),
    power_gain:       integer('power_gain').notNull().default(0),
    agility_gain:     integer('agility_gain').notNull().default(0),
    focus_gain:       integer('focus_gain').notNull().default(0),
    presence_gain:    integer('presence_gain').notNull().default(0),
    roll_result:      integer('roll_result').notNull(),
    chosen_attribute: text('chosen_attribute').notNull(),
    recorded_at:      timestamp('recorded_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    charLevelUnique: unique().on(t.character_id, t.to_level),
  }),
);

export const characterEquipment = pgTable('character_equipment', {
  id:           uuid('id').primaryKey().defaultRandom(),
  character_id: uuid('character_id').notNull().references(() => characters.id, { onDelete: 'cascade' }),
  // slot: main_hand | off_hand | helmet | chestplate | leggings | gauntlets | boots | shirt | pants | bracer
  slot:         text('slot').notNull(),
  // item_type: weapon | armor | focus_bracer
  item_type:    text('item_type').notNull(),
  item_id:      uuid('item_id').notNull(),
});

export const characterWeaponGems = pgTable('character_weapon_gems', {
  id:                   uuid('id').primaryKey().defaultRandom(),
  character_id:         uuid('character_id').notNull().references(() => characters.id, { onDelete: 'cascade' }),
  weapon_equipment_id:  uuid('weapon_equipment_id').notNull().references(() => characterEquipment.id, { onDelete: 'cascade' }),
  gem_slot_index:       integer('gem_slot_index').notNull(),
  spell_gem_id:         uuid('spell_gem_id').notNull(),
});

export const characterBracerGems = pgTable('character_bracer_gems', {
  id:             uuid('id').primaryKey().defaultRandom(),
  character_id:   uuid('character_id').notNull().references(() => characters.id, { onDelete: 'cascade' }),
  gem_slot_index: integer('gem_slot_index').notNull(),
  spell_gem_id:   uuid('spell_gem_id').notNull(),
});

// ── Types ──────────────────────────────────────────────────────────────────
export type Character          = typeof characters.$inferSelect;
export type NewCharacter        = typeof characters.$inferInsert;
export type GrowthPoolEntry     = typeof growthPoolHistory.$inferSelect;
export type CharacterEquipment  = typeof characterEquipment.$inferSelect;