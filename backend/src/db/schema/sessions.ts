import { pgTable, uuid, text, integer, bigint, boolean, timestamp, jsonb, real } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { campaigns } from './campaigns';
import { characters } from './characters';

export const sessions = pgTable('sessions', {
  id:               uuid('id').primaryKey().defaultRandom(),
  campaign_id:      uuid('campaign_id').notNull().references(() => campaigns.id, { onDelete: 'cascade' }),
  // Auto-generated label — no user-defined names
  name:             text('name').notNull().default(''),
  // scheduled | active | paused | ended
  status:           text('status').notNull().default('scheduled'),
  active_map_id:    uuid('active_map_id'),
  started_at:       timestamp('started_at', { withTimezone: true }),
  ended_at:         timestamp('ended_at', { withTimezone: true }),
  // Updated on every heartbeat — session auto-ends after 30 min inactivity
  last_activity_at: timestamp('last_activity_at', { withTimezone: true }).notNull().defaultNow(),
  // DM presses "Start Session" — players exit waiting screen and see the map
  is_started:       boolean('is_started').notNull().default(false),
});

export const combatEncounters = pgTable('combat_encounters', {
  id:                      uuid('id').primaryKey().defaultRandom(),
  session_id:              uuid('session_id').notNull().references(() => sessions.id, { onDelete: 'cascade' }),
  name:                    text('name').notNull(),
  // pending | active | ended
  status:                  text('status').notNull().default('pending'),
  // player | enemy
  current_side:            text('current_side').notNull().default('player'),
  round_number:            integer('round_number').notNull().default(1),
  // easy | standard | hard | deadly | horde
  difficulty_setting:      text('difficulty_setting').notNull().default('standard'),
  encounter_pool_total:    integer('encounter_pool_total').notNull().default(0),
  encounter_pool_remaining:integer('encounter_pool_remaining').notNull().default(0),
  created_at:              timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  ended_at:                timestamp('ended_at', { withTimezone: true }),
});

export const combatParticipants = pgTable('combat_participants', {
  id:                  uuid('id').primaryKey().defaultRandom(),
  encounter_id:        uuid('encounter_id').notNull().references(() => combatEncounters.id, { onDelete: 'cascade' }),
  // character | enemy_instance
  participant_type:    text('participant_type').notNull(),
  character_id:        uuid('character_id').references(() => characters.id),
  enemy_instance_id:   uuid('enemy_instance_id'),
  token_x:             real('token_x').notNull().default(0),
  token_y:             real('token_y').notNull().default(0),
  current_hp:          bigint('current_hp', { mode: 'bigint' }).notNull().default(sql`0`),
  max_hp_snapshot:     bigint('max_hp_snapshot', { mode: 'bigint' }).notNull().default(sql`0`),
  current_rp:          integer('current_rp').notNull().default(0),
  banked_rp:           integer('banked_rp').notNull().default(0),
  has_acted_this_round:boolean('has_acted_this_round').notNull().default(false),
  has_attacked_last_turn: boolean('has_attacked_last_turn').notNull().default(false),
  turn_order_index:    integer('turn_order_index').notNull().default(0),
});

export const combatParticipantStates = pgTable('combat_participant_states', {
  id:                      uuid('id').primaryKey().defaultRandom(),
  participant_id:          uuid('participant_id').notNull().references(() => combatParticipants.id, { onDelete: 'cascade' }),
  // All 16 states from Compendium Chapter 11
  state_name:              text('state_name').notNull(),
  // end_of_next_turn | until_save | rounds | healing_threshold | long_rest | narrative
  duration_type:           text('duration_type').notNull(),
  expires_round:           integer('expires_round'),
  applied_at_round:        integer('applied_at_round').notNull(),
  applied_by_participant_id: uuid('applied_by_participant_id'),
});

export const combatLogEntries = pgTable('combat_log_entries', {
  id:              uuid('id').primaryKey().defaultRandom(),
  encounter_id:    uuid('encounter_id').notNull().references(() => combatEncounters.id, { onDelete: 'cascade' }),
  round_number:    integer('round_number').notNull(),
  // Monotonically increasing within a round — preserves event order
  sequence_number: integer('sequence_number').notNull(),
  // turn_start | action_declare | pressure_resolve | save_result | critical |
  // damage | state_apply | state_remove | hp_update | overextension |
  // pool_draw | turn_end | round_end | encounter_end
  event_type:      text('event_type').notNull(),
  // Full event data: attacker, defender, dice results, damage channels, steps
  payload:         jsonb('payload').notNull().default({}),
  is_dm_only:      boolean('is_dm_only').notNull().default(false),
  created_at:      timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const enemyInstances = pgTable('enemy_instances', {
  id:           uuid('id').primaryKey().defaultRandom(),
  encounter_id: uuid('encounter_id').notNull().references(() => combatEncounters.id, { onDelete: 'cascade' }),
  enemy_id:     uuid('enemy_id').notNull(),
  label:        text('label').notNull(),   // 'Guard A', 'Guard B'
  current_hp:   bigint('current_hp', { mode: 'bigint' }).notNull().default(sql`0`),
  max_hp:       bigint('max_hp', { mode: 'bigint' }).notNull().default(sql`0`),
});

// ── Map Tokens ───────────────────────────────────────────────────────────
// Anything placed on a map during a session: characters and enemy instances.
// Position is grid-cell based (integer x/y).
export const mapTokens = pgTable('map_tokens', {
  id:              uuid('id').primaryKey().defaultRandom(),
  session_id:      uuid('session_id').notNull().references(() => sessions.id, { onDelete: 'cascade' }),
  map_id:          uuid('map_id').notNull(),
  // 'character' | 'enemy'
  entity_type:     text('entity_type').notNull(),
  // character_id or enemy_instance_id depending on entity_type
  entity_id:       uuid('entity_id').notNull(),
  // Grid cell position
  cell_x:          integer('cell_x').notNull().default(0),
  cell_y:          integer('cell_y').notNull().default(0),
  // Display label override (e.g. "Guard A")
  label:           text('label'),
  // URL to token artwork — falls back to portrait/default
  token_url:       text('token_url'),
  // Visual token scale multiplier (1.0 = default medium)
  scale:           real('scale').notNull().default(1),
  // DM-only visibility toggle (hidden from players when true)
  is_hidden:       boolean('is_hidden').notNull().default(false),
  // Tokens sharing group_id move together
  group_id:        uuid('group_id'),
  created_at:      timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// ── Enemy Instances ───────────────────────────────────────────────────────
// One row per enemy token placed on a map. Tracks live HP for that instance.
export const sessionEnemyInstances = pgTable('session_enemy_instances', {
  id:          uuid('id').primaryKey().defaultRandom(),
  session_id:  uuid('session_id').notNull().references(() => sessions.id, { onDelete: 'cascade' }),
  enemy_id:    uuid('enemy_id').notNull(),
  // Human label: "Goblin A", "Goblin B" — DM sets this when placing
  label:       text('label').notNull(),
  current_hp:  bigint('current_hp', { mode: 'bigint' }).notNull().default(sql`0`),
  max_hp:      bigint('max_hp', { mode: 'bigint' }).notNull().default(sql`0`),
  is_defeated: boolean('is_defeated').notNull().default(false),
  created_at:  timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// ── Canvas Shapes ─────────────────────────────────────────────────────────
// Persistent synced shapes/markers on the map canvas.
// Rulers are local-only and never stored.
export const canvasShapes = pgTable('canvas_shapes', {
  id:         uuid('id').primaryKey().defaultRandom(),
  session_id: uuid('session_id').notNull().references(() => sessions.id, { onDelete: 'cascade' }),
  map_id:     uuid('map_id').notNull(),
  // 'marker' | 'circle' | 'rect' | 'line' | 'cone'
  shape_type: text('shape_type').notNull(),
  // Color hex string
  color:      text('color').notNull().default('#ff0000'),
  // All shape geometry and label stored as flexible JSON
  data:       jsonb('data').notNull().default({}),
  created_by: uuid('created_by').notNull(),
  created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// ── Dice Log ──────────────────────────────────────────────────────────────
// Persisted roll history for the session.
// Visibility: 'public' | 'private' | 'dm'
// source_label: null = user's own name, otherwise "Goblin Chieftain — Shortbow"
export const diceLogEntries = pgTable('dice_log_entries', {
  id:           uuid('id').primaryKey().defaultRandom(),
  session_id:   uuid('session_id').notNull().references(() => sessions.id, { onDelete: 'cascade' }),
  roller_id:    uuid('roller_id').notNull(),
  // null = user rolled themselves, set for stat block rolls
  source_label: text('source_label'),
  formula:      text('formula').notNull(),
  results:      jsonb('results').notNull().default(sql`'[]'::jsonb`),
  total:        integer('total').notNull().default(0),
  label:        text('label').notNull().default(''),
  // 'public' | 'private' | 'dm'
  visibility:   text('visibility').notNull().default('public'),
  created_at:   timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// ── Types ──────────────────────────────────────────────────────────────────
export type Session               = typeof sessions.$inferSelect;
export type MapToken              = typeof mapTokens.$inferSelect;
export type SessionEnemyInstance  = typeof sessionEnemyInstances.$inferSelect;
export type CanvasShape           = typeof canvasShapes.$inferSelect;
export type DiceLogEntry          = typeof diceLogEntries.$inferSelect;
// Legacy combat tables kept to avoid DROP TABLE migrations
export type CombatEncounter       = typeof combatEncounters.$inferSelect;
export type CombatParticipant     = typeof combatParticipants.$inferSelect;
export type CombatParticipantState= typeof combatParticipantStates.$inferSelect;
export type CombatLogEntry        = typeof combatLogEntries.$inferSelect;
export type EnemyInstance         = typeof enemyInstances.$inferSelect;