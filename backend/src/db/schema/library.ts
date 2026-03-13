import {
  pgTable, uuid, text, integer, boolean, numeric, jsonb, bigint, timestamp,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { users }      from './users';
import { characters } from './characters';
import { campaigns }  from './campaigns';

// ── Shared homebrew columns (applied consistently to every library table) ──
// is_homebrew : true for any user-created content
// is_public   : homebrew the creator has chosen to share with everyone
// created_by  : null for official Velion Mythera content
// version     : increments when a DM edits homebrew in-place; history in homebrew_versions

// ─────────────────────────────────────────────────────────────────────────────
// WEAPONS
// ─────────────────────────────────────────────────────────────────────────────
export const weapons = pgTable('weapons', {
  id:                uuid('id').primaryKey().defaultRandom(),
  name:              text('name').notNull(),
  // short_sword | great_axe | staff | bow | etc.
  category:          text('category').notNull(),
  // common | uncommon | rare | epic | legendary | mythic
  rarity:            text('rarity').notNull().default('common'),
  base_die_type:     integer('base_die_type').notNull().default(6),
  total_dice_budget: integer('total_dice_budget').notNull().default(1),
  req_power:         integer('req_power').notNull().default(0),
  req_agility:       integer('req_agility').notNull().default(0),
  req_focus:         integer('req_focus').notNull().default(0),
  gem_slots:         integer('gem_slots').notNull().default(0),
  description:       text('description').notNull().default(''),
  // Homebrew fields
  is_homebrew:       boolean('is_homebrew').notNull().default(false),
  is_public:         boolean('is_public').notNull().default(false),
  created_by:        uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
  version:           integer('version').notNull().default(1),
  created_at:        timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updated_at:        timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

// Damage channels for a weapon (slashing, fire, etc.)
export const weaponChannels = pgTable('weapon_channels', {
  id:          uuid('id').primaryKey().defaultRandom(),
  weapon_id:   uuid('weapon_id').notNull().references(() => weapons.id, { onDelete: 'cascade' }),
  // slashing | piercing | bludgeoning | fire | ice | lightning | poison | shadow | radiant | arcane
  damage_type: text('damage_type').notNull(),
  num_dice:    integer('num_dice').notNull(),
});

// ─────────────────────────────────────────────────────────────────────────────
// ARMOR
// ─────────────────────────────────────────────────────────────────────────────
export const armorPieces = pgTable('armor_pieces', {
  id:                 uuid('id').primaryKey().defaultRandom(),
  name:               text('name').notNull(),
  // light | medium | heavy
  category:           text('category').notNull(),
  // helmet | chestplate | leggings | gauntlets | boots | shirt | pants
  slot:               text('slot').notNull(),
  rarity:             text('rarity').notNull().default('common'),
  mitigation_percent: numeric('mitigation_percent', { precision: 5, scale: 2 }).notNull().default('0'),
  req_power:          integer('req_power').notNull().default(0),
  gem_slots:          integer('gem_slots').notNull().default(0),
  description:        text('description').notNull().default(''),
  // Homebrew fields
  is_homebrew:        boolean('is_homebrew').notNull().default(false),
  is_public:          boolean('is_public').notNull().default(false),
  created_by:         uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
  version:            integer('version').notNull().default(1),
  created_at:         timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updated_at:         timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

// ─────────────────────────────────────────────────────────────────────────────
// SPELL GEMS
// ─────────────────────────────────────────────────────────────────────────────
export const spellGems = pgTable('spell_gems', {
  id:                       uuid('id').primaryKey().defaultRandom(),
  name:                     text('name').notNull(),
  // fire | ice | lightning | earth | wind | light | shadow | arcane | nature | poison
  element_type:             text('element_type').notNull(),
  rarity:                   text('rarity').notNull().default('common'),
  num_dice:                 integer('num_dice').notNull().default(1),
  die_type:                 integer('die_type').notNull().default(6),
  armor_resistance_percent: numeric('armor_resistance_percent', { precision: 5, scale: 2 }).notNull().default('0'),
  secondary_effect:         text('secondary_effect'),
  description:              text('description').notNull().default(''),
  // Homebrew fields
  is_homebrew:              boolean('is_homebrew').notNull().default(false),
  is_public:                boolean('is_public').notNull().default(false),
  created_by:               uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
  version:                  integer('version').notNull().default(1),
  created_at:               timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updated_at:               timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

// ─────────────────────────────────────────────────────────────────────────────
// FOCUS BRACERS
// ─────────────────────────────────────────────────────────────────────────────
export const focusBracers = pgTable('focus_bracers', {
  id:          uuid('id').primaryKey().defaultRandom(),
  name:        text('name').notNull(),
  // initiate | adept | exemplar | ascendant
  grade:       text('grade').notNull(),
  gem_slots:   integer('gem_slots').notNull(),   // 2 | 4 | 6 | 8
  req_focus:   integer('req_focus').notNull().default(0),
  description: text('description').notNull().default(''),
  // Homebrew fields
  is_homebrew: boolean('is_homebrew').notNull().default(false),
  is_public:   boolean('is_public').notNull().default(false),
  created_by:  uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
  version:     integer('version').notNull().default(1),
  created_at:  timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updated_at:  timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

// ─────────────────────────────────────────────────────────────────────────────
// ENEMIES
// ─────────────────────────────────────────────────────────────────────────────
export const enemies = pgTable('enemies', {
  id:                  uuid('id').primaryKey().defaultRandom(),
  name:                text('name').notNull(),
  // minion | standard | elite | boss
  classification:      text('classification').notNull().default('standard'),
  hp:                  bigint('hp', { mode: 'bigint' }).notNull().default(sql`100`),
  resistance_modifier: integer('resistance_modifier').notNull().default(0),
  // Core attributes — used to derive base_rp for encounter design reference
  power:               integer('power').notNull().default(10),
  agility:             integer('agility').notNull().default(10),
  focus:               integer('focus').notNull().default(10),
  presence:            integer('presence').notNull().default(10),
  // Cached base RP derived from attributes (same formula as characters/pets at level 1)
  base_rp:             integer('base_rp').notNull().default(0),
  // [{ name, description, mechanic_override }]
  traits:              jsonb('traits').notNull().default(sql`'[]'::jsonb`),
  // Named attacks: [{ name, damage_dice, damage_type, description }]
  attacks:             jsonb('attacks').notNull().default(sql`'[]'::jsonb`),
  // Used in Encounter Pool formula — standard = 1.0
  enemy_weight:        numeric('enemy_weight', { precision: 4, scale: 2 }).notNull().default('1.0'),
  description:         text('description').notNull().default(''),
  // Homebrew fields
  is_homebrew:         boolean('is_homebrew').notNull().default(false),
  is_public:           boolean('is_public').notNull().default(false),
  created_by:          uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
  version:             integer('version').notNull().default(1),
  created_at:          timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updated_at:          timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const enemyAttackTiers = pgTable('enemy_attack_tiers', {
  id:                    uuid('id').primaryKey().defaultRandom(),
  enemy_id:              uuid('enemy_id').notNull().references(() => enemies.id, { onDelete: 'cascade' }),
  // partial | standard | full
  tier_name:             text('tier_name').notNull(),
  pressure_steps:        integer('pressure_steps').notNull(),
  damage_multiplier:     integer('damage_multiplier').notNull(),
  max_pool_contribution: integer('max_pool_contribution').notNull().default(0),
});

// ─────────────────────────────────────────────────────────────────────────────
// PETS / COMPANIONS
// ─────────────────────────────────────────────────────────────────────────────
export const pets = pgTable('pets', {
  id:           uuid('id').primaryKey().defaultRandom(),
  name:         text('name').notNull(),
  species:      text('species').notNull(),           // e.g. "Dragon", "Swallow", "Wolf"
  description:  text('description').notNull().default(''),
  // Core stats
  power:        integer('power').notNull().default(10),
  agility:      integer('agility').notNull().default(10),
  focus:        integer('focus').notNull().default(10),
  presence:     integer('presence').notNull().default(10),
  // Movement in feet per turn
  movement:     integer('movement').notNull().default(30),
  // Cached computed stats (same formulas as characters)
  base_rp:      integer('base_rp').notNull().default(0),
  max_hp:       bigint('max_hp', { mode: 'bigint' }).notNull().default(sql`0`),
  // Homebrew fields
  is_homebrew:  boolean('is_homebrew').notNull().default(false),
  is_public:    boolean('is_public').notNull().default(false),
  created_by:   uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
  version:      integer('version').notNull().default(1),
  created_at:   timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updated_at:   timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

// Each pet can have any number of attacks — a swallow may have none, a dragon many
export const petAttacks = pgTable('pet_attacks', {
  id:          uuid('id').primaryKey().defaultRandom(),
  pet_id:      uuid('pet_id').notNull().references(() => pets.id, { onDelete: 'cascade' }),
  name:        text('name').notNull(),              // "Bite", "Claw", "Fire Breath"
  damage_dice: text('damage_dice').notNull(),        // e.g. "2d6", "4d8"
  // slashing | piercing | bludgeoning | fire | ice | lightning | etc.
  damage_type: text('damage_type').notNull(),
  description: text('description').notNull().default(''),
  // Controls display order on the stat block
  order_index: integer('order_index').notNull().default(0),
});

// Junction: a character bonds with a pet within a specific campaign
// The pet_id always points to the live version of the pet template.
// current_hp is instance-specific (the pet's actual HP in-session).
export const characterPets = pgTable('character_pets', {
  id:          uuid('id').primaryKey().defaultRandom(),
  character_id: uuid('character_id').notNull().references(() => characters.id, { onDelete: 'cascade' }),
  campaign_id:  uuid('campaign_id').references(() => campaigns.id, { onDelete: 'set null' }),  // nullable — pet can exist outside a campaign
  pet_id:       uuid('pet_id').notNull().references(() => pets.id, { onDelete: 'restrict' }),
  // Optional player-given name (e.g. they name their wolf "Shadow")
  nickname:     text('nickname'),
  current_hp:   bigint('current_hp', { mode: 'bigint' }).notNull().default(sql`0`),
  notes:        text('notes').notNull().default(''),
  bonded_at:    timestamp('bonded_at', { withTimezone: true }).notNull().defaultNow(),
});

// ─────────────────────────────────────────────────────────────────────────────
// HOMEBREW VERSION HISTORY
// ─────────────────────────────────────────────────────────────────────────────
// When a DM saves a new version of any homebrew item, the previous state is
// snapshotted here. The live row in its table always reflects the current version.
// item_type: 'weapon' | 'armor' | 'spell_gem' | 'focus_bracer' | 'enemy' | 'pet'
export const homebrewVersions = pgTable('homebrew_versions', {
  id:           uuid('id').primaryKey().defaultRandom(),
  item_type:    text('item_type').notNull(),
  item_id:      uuid('item_id').notNull(),       // FK to the relevant table (no enforced FK, cross-table)
  version:      integer('version').notNull(),     // which version this snapshot represents
  snapshot:     jsonb('snapshot').notNull(),       // full row at time of snapshot
  saved_by:     uuid('saved_by').references(() => users.id, { onDelete: 'set null' }),
  saved_at:     timestamp('saved_at', { withTimezone: true }).notNull().defaultNow(),
});

// ─────────────────────────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────────────────────────
export type Weapon            = typeof weapons.$inferSelect;
export type NewWeapon         = typeof weapons.$inferInsert;
export type WeaponChannel     = typeof weaponChannels.$inferSelect;
export type ArmorPiece        = typeof armorPieces.$inferSelect;
export type NewArmorPiece     = typeof armorPieces.$inferInsert;
export type SpellGem          = typeof spellGems.$inferSelect;
export type NewSpellGem       = typeof spellGems.$inferInsert;
export type FocusBracer       = typeof focusBracers.$inferSelect;
export type NewFocusBracer    = typeof focusBracers.$inferInsert;
export type Enemy             = typeof enemies.$inferSelect;
export type NewEnemy          = typeof enemies.$inferInsert;
export type EnemyAttackTier   = typeof enemyAttackTiers.$inferSelect;
export type Pet               = typeof pets.$inferSelect;
export type NewPet            = typeof pets.$inferInsert;
export type PetAttack         = typeof petAttacks.$inferSelect;
export type CharacterPet      = typeof characterPets.$inferSelect;
export type HomebrewVersion   = typeof homebrewVersions.$inferSelect;