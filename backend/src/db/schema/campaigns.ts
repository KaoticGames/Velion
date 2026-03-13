import { pgTable, uuid, text, integer, timestamp, jsonb } from 'drizzle-orm/pg-core';
import { users } from './users';
import { characters } from './characters';

export const campaigns = pgTable('campaigns', {
  id:                  uuid('id').primaryKey().defaultRandom(),
  dm_user_id:          uuid('dm_user_id').notNull().references(() => users.id),
  name:                text('name').notNull(),
  // local | veteran | heroic | mythic | godlike | cosmic
  world_tier_baseline: text('world_tier_baseline').notNull().default('local'),
  // House rules: { mitigation_cap_warning: bool, horde_pool_enabled: bool, ... }
  settings:            jsonb('settings').notNull().default({}),
  // Public-facing campaign description (visible to all members)
  summary:             text('summary').notNull().default(''),
  // DM-private notes — never sent to players
  dm_notes:            text('dm_notes').notNull().default(''),
  created_at:          timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  deleted_at:          timestamp('deleted_at', { withTimezone: true }),
});

export const campaignCharacters = pgTable('campaign_characters', {
  id:           uuid('id').primaryKey().defaultRandom(),
  campaign_id:  uuid('campaign_id').notNull().references(() => campaigns.id, { onDelete: 'cascade' }),
  character_id: uuid('character_id').notNull().references(() => characters.id, { onDelete: 'cascade' }),
  user_id:      uuid('user_id').notNull().references(() => users.id),
  joined_at:    timestamp('joined_at', { withTimezone: true }).notNull().defaultNow(),
  removed_at:   timestamp('removed_at', { withTimezone: true }),
});

export const campaignInvites = pgTable('campaign_invites', {
  id:          uuid('id').primaryKey().defaultRandom(),
  campaign_id: uuid('campaign_id').notNull().references(() => campaigns.id, { onDelete: 'cascade' }),
  token:       text('token').notNull().unique(),
  max_uses:    integer('max_uses'),         // null = unlimited
  use_count:   integer('use_count').notNull().default(0),
  expires_at:  timestamp('expires_at', { withTimezone: true }),
  created_at:  timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// ── Campaign Assets ──────────────────────────────────────────────────────
// General asset library: maps, tokens, reference images.
// asset_type: 'map' | 'token' | 'image'
export const campaignAssets = pgTable('campaign_assets', {
  id:          uuid('id').primaryKey().defaultRandom(),
  campaign_id: uuid('campaign_id').notNull().references(() => campaigns.id, { onDelete: 'cascade' }),
  name:        text('name').notNull(),
  asset_type:  text('asset_type').notNull().default('image'),
  url:         text('url').notNull(),
  r2_key:      text('r2_key').notNull(),
  size_bytes:  integer('size_bytes').notNull().default(0),
  created_at:  timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// ── Types ──────────────────────────────────────────────────────────────────
export type Campaign         = typeof campaigns.$inferSelect;
export type CampaignAsset    = typeof campaignAssets.$inferSelect;
export type NewCampaign      = typeof campaigns.$inferInsert;
export type CampaignCharacter= typeof campaignCharacters.$inferSelect;
export type CampaignInvite   = typeof campaignInvites.$inferSelect;