import { pgTable, uuid, text, timestamp, unique } from 'drizzle-orm/pg-core';
import { users } from './users';

export const oauthAccounts = pgTable('oauth_accounts', {
  id:               uuid('id').primaryKey().defaultRandom(),
  user_id:          uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  provider:         text('provider').notNull(),
  provider_user_id: text('provider_user_id').notNull(),
  created_at:       timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  providerUserUnique: unique('oauth_provider_user_unique').on(table.provider, table.provider_user_id),
}));

export type OauthAccount = typeof oauthAccounts.$inferSelect;
