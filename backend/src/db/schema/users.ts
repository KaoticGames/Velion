import { pgTable, uuid, text, timestamp, boolean, unique } from 'drizzle-orm/pg-core';

export const users = pgTable('users', {
  id:                uuid('id').primaryKey().defaultRandom(),
  email:             text('email').notNull().unique(),
  /** Null for OAuth-only accounts (e.g. Google). */
  password_hash:     text('password_hash'),
  display_name:      text('display_name').notNull(),
  avatar_url:        text('avatar_url'),
  /** Public profile / directory (optional). */
  bio:               text('bio'),
  /** Single social handle (e.g. @name or URL fragment), optional. */
  social_handle:     text('social_handle'),
  subscription_tier: text('subscription_tier').notNull().default('free'),
  /** When BETA_GATE_ENABLED, must be true to log in / refresh (set manually or true on successful gated register). */
  beta_access:       boolean('beta_access').notNull().default(true),
  stripe_customer_id:text('stripe_customer_id').unique(),
  created_at:        timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  deleted_at:        timestamp('deleted_at', { withTimezone: true }),
});

export const refreshTokens = pgTable('refresh_tokens', {
  id:         uuid('id').primaryKey().defaultRandom(),
  user_id:    uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  expires_at: timestamp('expires_at', { withTimezone: true }).notNull(),
  revoked_at: timestamp('revoked_at', { withTimezone: true }),
  created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const subscriptions = pgTable('subscriptions', {
  id:                     uuid('id').primaryKey().defaultRandom(),
  user_id:                uuid('user_id').notNull().unique().references(() => users.id, { onDelete: 'cascade' }),
  stripe_subscription_id: text('stripe_subscription_id').notNull().unique(),
  stripe_price_id:        text('stripe_price_id').notNull(),
  status:                 text('status').notNull(),   // active | past_due | canceled | trialing
  current_period_end:     timestamp('current_period_end', { withTimezone: true }).notNull(),
  updated_at:             timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

// ── Types ──────────────────────────────────────────────────────────────────
export type User         = typeof users.$inferSelect;
export type NewUser      = typeof users.$inferInsert;
export type RefreshToken = typeof refreshTokens.$inferSelect;
export type Subscription = typeof subscriptions.$inferSelect;

// ── Early Access Signups ───────────────────────────────────────────────────
export const earlyAccessSignups = pgTable('early_access_signups', {
  id:           uuid('id').primaryKey().defaultRandom(),
  email:        text('email').notNull(),
  name:         text('name'),
  source:       text('source').notNull().default('landing'),
  beta_granted: boolean('beta_granted').notNull().default(false),
  granted_at:   timestamp('granted_at', { withTimezone: true }),
  created_at:   timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  emailUnique: unique('early_access_email_unique').on(table.email),
}));