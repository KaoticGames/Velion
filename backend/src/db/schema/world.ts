import { pgTable, uuid, text, integer, boolean, timestamp, jsonb, check, unique } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { users } from './users';
import { campaigns } from './campaigns';
import { characters } from './characters';

// ── Maps ──────────────────────────────────────────────────────────────────
export const maps = pgTable('maps', {
  id:             uuid('id').primaryKey().defaultRandom(),
  campaign_id:    uuid('campaign_id').notNull().references(() => campaigns.id, { onDelete: 'cascade' }),
  name:           text('name').notNull(),
  image_url:      text('image_url').notNull(),
  grid_cell_size: integer('grid_cell_size').notNull().default(70),
  width_cells:    integer('width_cells').notNull().default(20),
  height_cells:   integer('height_cells').notNull().default(20),
  // How many feet each grid square represents — used by ruler + all AoE tools
  feet_per_cell:  integer('feet_per_cell').notNull().default(5),
  created_at:     timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const mapFogCells = pgTable('map_fog_cells', {
  id:          uuid('id').primaryKey().defaultRandom(),
  map_id:      uuid('map_id').notNull().references(() => maps.id, { onDelete: 'cascade' }),
  cell_x:      integer('cell_x').notNull(),
  cell_y:      integer('cell_y').notNull(),
  is_revealed: boolean('is_revealed').notNull().default(false),
}, (table) => ({
  // Unique constraint required for ON CONFLICT upsert in fog-of-war updates
  cellUnique: unique('map_fog_cells_map_cell_unique').on(table.map_id, table.cell_x, table.cell_y),
}));

// ── Fog Sections ─────────────────────────────────────────────────────────
// Named regions of fog that can be toggled on/off as a unit by the DM.
// cells stores [{x,y}] grid coordinates belonging to the section.
export const fogSections = pgTable('fog_sections', {
  id:         uuid('id').primaryKey().defaultRandom(),
  map_id:     uuid('map_id').notNull().references(() => maps.id, { onDelete: 'cascade' }),
  name:       text('name').notNull().default('Section'),
  cells:      jsonb('cells').notNull().default([]),  // Array<{x:number,y:number}>
  is_hidden:  boolean('is_hidden').notNull().default(false),
  created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// ── Factions ──────────────────────────────────────────────────────────────
export const factions = pgTable('factions', {
  id:          uuid('id').primaryKey().defaultRandom(),
  campaign_id: uuid('campaign_id').notNull().references(() => campaigns.id, { onDelete: 'cascade' }),
  name:        text('name').notNull(),
  description: text('description'),
});

export const factionFavor = pgTable('faction_favor', {
  id:           uuid('id').primaryKey().defaultRandom(),
  faction_id:   uuid('faction_id').notNull().references(() => factions.id, { onDelete: 'cascade' }),
  character_id: uuid('character_id').notNull().references(() => characters.id, { onDelete: 'cascade' }),
  // -100 to +100 enforced by DB check constraint
  score:        integer('score').notNull().default(0),
},
(table) => ({
  scoreCheck: check('score_range', sql`${table.score} >= -100 AND ${table.score} <= 100`),
}));

// ── Journal ───────────────────────────────────────────────────────────────
export const journalEntries = pgTable('journal_entries', {
  id:          uuid('id').primaryKey().defaultRandom(),
  campaign_id: uuid('campaign_id').notNull().references(() => campaigns.id, { onDelete: 'cascade' }),
  title:       text('title').notNull(),
  content:     text('content').notNull().default(''),
  is_dm_only:  boolean('is_dm_only').notNull().default(false),
  created_at:  timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updated_at:  timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

// ── Browser Sources ───────────────────────────────────────────────────────
export const browserSources = pgTable('browser_sources', {
  id:           uuid('id').primaryKey().defaultRandom(),
  user_id:      uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  campaign_id:  uuid('campaign_id').notNull().references(() => campaigns.id, { onDelete: 'cascade' }),
  // dice_tray | map | character_sheet | cycling_sheets | combat_log | turn_order
  source_type:  text('source_type').notNull(),
  access_token: text('access_token').notNull().unique(),
  // { character_id?, cycle_interval_ms?, ... }
  config:       jsonb('config').notNull().default({}),
  created_at:   timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// ── Stripe audit log ──────────────────────────────────────────────────────
export const stripeEvents = pgTable('stripe_events', {
  id:          uuid('id').primaryKey().defaultRandom(),
  stripe_id:   text('stripe_id').notNull().unique(),
  event_type:  text('event_type').notNull(),
  payload:     jsonb('payload').notNull(),
  processed_at:timestamp('processed_at', { withTimezone: true }).notNull().defaultNow(),
});

// ── Types ──────────────────────────────────────────────────────────────────
export type GameMap       = typeof maps.$inferSelect;
export type FogSection    = typeof fogSections.$inferSelect;
export type Faction       = typeof factions.$inferSelect;
export type FactionFavor  = typeof factionFavor.$inferSelect;
export type BrowserSource = typeof browserSources.$inferSelect;