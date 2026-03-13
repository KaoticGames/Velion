CREATE TABLE IF NOT EXISTS "refresh_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "subscriptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"stripe_subscription_id" text NOT NULL,
	"stripe_price_id" text NOT NULL,
	"status" text NOT NULL,
	"current_period_end" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "subscriptions_user_id_unique" UNIQUE("user_id"),
	CONSTRAINT "subscriptions_stripe_subscription_id_unique" UNIQUE("stripe_subscription_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"password_hash" text NOT NULL,
	"display_name" text NOT NULL,
	"avatar_url" text,
	"subscription_tier" text DEFAULT 'free' NOT NULL,
	"stripe_customer_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "users_email_unique" UNIQUE("email"),
	CONSTRAINT "users_stripe_customer_id_unique" UNIQUE("stripe_customer_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "character_bracer_gems" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"character_id" uuid NOT NULL,
	"gem_slot_index" integer NOT NULL,
	"spell_gem_id" uuid NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "character_equipment" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"character_id" uuid NOT NULL,
	"slot" text NOT NULL,
	"item_type" text NOT NULL,
	"item_id" uuid NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "character_weapon_gems" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"character_id" uuid NOT NULL,
	"weapon_equipment_id" uuid NOT NULL,
	"gem_slot_index" integer NOT NULL,
	"spell_gem_id" uuid NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "characters" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"name" text NOT NULL,
	"level" integer DEFAULT 1 NOT NULL,
	"power" integer DEFAULT 10 NOT NULL,
	"agility" integer DEFAULT 10 NOT NULL,
	"focus" integer DEFAULT 10 NOT NULL,
	"presence" integer DEFAULT 10 NOT NULL,
	"chosen_attribute" text DEFAULT 'power' NOT NULL,
	"growth_pool_total" integer DEFAULT 0 NOT NULL,
	"base_rp" integer DEFAULT 0 NOT NULL,
	"max_hp" bigint DEFAULT 0 NOT NULL,
	"current_hp" bigint DEFAULT 0 NOT NULL,
	"backstory" text DEFAULT '' NOT NULL,
	"notes" text DEFAULT '' NOT NULL,
	"gold" integer DEFAULT 0 NOT NULL,
	"portrait_url" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "growth_pool_history" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"character_id" uuid NOT NULL,
	"level_gained" integer NOT NULL,
	"roll_result" integer NOT NULL,
	"rolled_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "campaign_characters" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"campaign_id" uuid NOT NULL,
	"character_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"joined_at" timestamp with time zone DEFAULT now() NOT NULL,
	"removed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "campaign_invites" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"campaign_id" uuid NOT NULL,
	"token" text NOT NULL,
	"max_uses" integer,
	"use_count" integer DEFAULT 0 NOT NULL,
	"expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "campaign_invites_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "campaigns" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"dm_user_id" uuid NOT NULL,
	"name" text NOT NULL,
	"world_tier_baseline" text DEFAULT 'local' NOT NULL,
	"settings" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "combat_encounters" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" uuid NOT NULL,
	"name" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"current_side" text DEFAULT 'player' NOT NULL,
	"round_number" integer DEFAULT 1 NOT NULL,
	"difficulty_setting" text DEFAULT 'standard' NOT NULL,
	"encounter_pool_total" integer DEFAULT 0 NOT NULL,
	"encounter_pool_remaining" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ended_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "combat_log_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"encounter_id" uuid NOT NULL,
	"round_number" integer NOT NULL,
	"sequence_number" integer NOT NULL,
	"event_type" text NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"is_dm_only" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "combat_participant_states" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"participant_id" uuid NOT NULL,
	"state_name" text NOT NULL,
	"duration_type" text NOT NULL,
	"expires_round" integer,
	"applied_at_round" integer NOT NULL,
	"applied_by_participant_id" uuid
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "combat_participants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"encounter_id" uuid NOT NULL,
	"participant_type" text NOT NULL,
	"character_id" uuid,
	"enemy_instance_id" uuid,
	"token_x" real DEFAULT 0 NOT NULL,
	"token_y" real DEFAULT 0 NOT NULL,
	"current_hp" bigint DEFAULT 0 NOT NULL,
	"max_hp_snapshot" bigint DEFAULT 0 NOT NULL,
	"current_rp" integer DEFAULT 0 NOT NULL,
	"banked_rp" integer DEFAULT 0 NOT NULL,
	"has_acted_this_round" boolean DEFAULT false NOT NULL,
	"has_attacked_last_turn" boolean DEFAULT false NOT NULL,
	"turn_order_index" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "enemy_instances" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"encounter_id" uuid NOT NULL,
	"enemy_id" uuid NOT NULL,
	"label" text NOT NULL,
	"current_hp" bigint DEFAULT 0 NOT NULL,
	"max_hp" bigint DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"campaign_id" uuid NOT NULL,
	"name" text NOT NULL,
	"status" text DEFAULT 'scheduled' NOT NULL,
	"active_map_id" uuid,
	"started_at" timestamp with time zone,
	"ended_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "armor_pieces" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"category" text NOT NULL,
	"slot" text NOT NULL,
	"rarity" text DEFAULT 'common' NOT NULL,
	"mitigation_percent" numeric(5, 2) DEFAULT '0' NOT NULL,
	"req_power" integer DEFAULT 0 NOT NULL,
	"gem_slots" integer DEFAULT 0 NOT NULL,
	"is_homebrew" boolean DEFAULT false NOT NULL,
	"campaign_id" uuid,
	"is_public" boolean DEFAULT true NOT NULL,
	"created_by" uuid
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "enemies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"classification" text DEFAULT 'standard' NOT NULL,
	"hp" bigint DEFAULT 100 NOT NULL,
	"resistance_modifier" integer DEFAULT 0 NOT NULL,
	"traits" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"enemy_weight" numeric(4, 2) DEFAULT '1.0' NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"is_homebrew" boolean DEFAULT false NOT NULL,
	"campaign_id" uuid,
	"is_public" boolean DEFAULT true NOT NULL,
	"created_by" uuid
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "enemy_attack_tiers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"enemy_id" uuid NOT NULL,
	"tier_name" text NOT NULL,
	"pressure_steps" integer NOT NULL,
	"damage_multiplier" integer NOT NULL,
	"max_pool_contribution" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "focus_bracers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"grade" text NOT NULL,
	"gem_slots" integer NOT NULL,
	"req_focus" integer DEFAULT 0 NOT NULL,
	"is_homebrew" boolean DEFAULT false NOT NULL,
	"campaign_id" uuid
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "spell_gems" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"element_type" text NOT NULL,
	"rarity" text DEFAULT 'common' NOT NULL,
	"num_dice" integer DEFAULT 1 NOT NULL,
	"die_type" integer DEFAULT 6 NOT NULL,
	"armor_resistance_percent" numeric(5, 2) DEFAULT '0' NOT NULL,
	"secondary_effect" text,
	"is_homebrew" boolean DEFAULT false NOT NULL,
	"campaign_id" uuid,
	"is_public" boolean DEFAULT true NOT NULL,
	"created_by" uuid
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "weapon_channels" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"weapon_id" uuid NOT NULL,
	"damage_type" text NOT NULL,
	"num_dice" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "weapons" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"category" text NOT NULL,
	"rarity" text DEFAULT 'common' NOT NULL,
	"base_die_type" integer DEFAULT 6 NOT NULL,
	"total_dice_budget" integer DEFAULT 1 NOT NULL,
	"req_power" integer DEFAULT 0 NOT NULL,
	"req_agility" integer DEFAULT 0 NOT NULL,
	"req_focus" integer DEFAULT 0 NOT NULL,
	"gem_slots" integer DEFAULT 0 NOT NULL,
	"is_homebrew" boolean DEFAULT false NOT NULL,
	"campaign_id" uuid,
	"is_public" boolean DEFAULT true NOT NULL,
	"created_by" uuid
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "browser_sources" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"campaign_id" uuid NOT NULL,
	"source_type" text NOT NULL,
	"access_token" text NOT NULL,
	"config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "browser_sources_access_token_unique" UNIQUE("access_token")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "faction_favor" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"faction_id" uuid NOT NULL,
	"character_id" uuid NOT NULL,
	"score" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "score_range" CHECK ("faction_favor"."score" >= -100 AND "faction_favor"."score" <= 100)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "factions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"campaign_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "journal_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"campaign_id" uuid NOT NULL,
	"title" text NOT NULL,
	"content" text DEFAULT '' NOT NULL,
	"is_dm_only" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "map_fog_cells" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"map_id" uuid NOT NULL,
	"cell_x" integer NOT NULL,
	"cell_y" integer NOT NULL,
	"is_revealed" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "maps" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"campaign_id" uuid NOT NULL,
	"name" text NOT NULL,
	"image_url" text NOT NULL,
	"grid_cell_size" integer DEFAULT 70 NOT NULL,
	"width_cells" integer DEFAULT 20 NOT NULL,
	"height_cells" integer DEFAULT 20 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "stripe_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"stripe_id" text NOT NULL,
	"event_type" text NOT NULL,
	"payload" jsonb NOT NULL,
	"processed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "stripe_events_stripe_id_unique" UNIQUE("stripe_id")
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "refresh_tokens" ADD CONSTRAINT "refresh_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "character_bracer_gems" ADD CONSTRAINT "character_bracer_gems_character_id_characters_id_fk" FOREIGN KEY ("character_id") REFERENCES "public"."characters"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "character_equipment" ADD CONSTRAINT "character_equipment_character_id_characters_id_fk" FOREIGN KEY ("character_id") REFERENCES "public"."characters"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "character_weapon_gems" ADD CONSTRAINT "character_weapon_gems_character_id_characters_id_fk" FOREIGN KEY ("character_id") REFERENCES "public"."characters"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "character_weapon_gems" ADD CONSTRAINT "character_weapon_gems_weapon_equipment_id_character_equipment_id_fk" FOREIGN KEY ("weapon_equipment_id") REFERENCES "public"."character_equipment"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "characters" ADD CONSTRAINT "characters_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "growth_pool_history" ADD CONSTRAINT "growth_pool_history_character_id_characters_id_fk" FOREIGN KEY ("character_id") REFERENCES "public"."characters"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "campaign_characters" ADD CONSTRAINT "campaign_characters_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "campaign_characters" ADD CONSTRAINT "campaign_characters_character_id_characters_id_fk" FOREIGN KEY ("character_id") REFERENCES "public"."characters"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "campaign_characters" ADD CONSTRAINT "campaign_characters_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "campaign_invites" ADD CONSTRAINT "campaign_invites_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_dm_user_id_users_id_fk" FOREIGN KEY ("dm_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "combat_encounters" ADD CONSTRAINT "combat_encounters_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "combat_log_entries" ADD CONSTRAINT "combat_log_entries_encounter_id_combat_encounters_id_fk" FOREIGN KEY ("encounter_id") REFERENCES "public"."combat_encounters"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "combat_participant_states" ADD CONSTRAINT "combat_participant_states_participant_id_combat_participants_id_fk" FOREIGN KEY ("participant_id") REFERENCES "public"."combat_participants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "combat_participants" ADD CONSTRAINT "combat_participants_encounter_id_combat_encounters_id_fk" FOREIGN KEY ("encounter_id") REFERENCES "public"."combat_encounters"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "combat_participants" ADD CONSTRAINT "combat_participants_character_id_characters_id_fk" FOREIGN KEY ("character_id") REFERENCES "public"."characters"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "enemy_instances" ADD CONSTRAINT "enemy_instances_encounter_id_combat_encounters_id_fk" FOREIGN KEY ("encounter_id") REFERENCES "public"."combat_encounters"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "sessions" ADD CONSTRAINT "sessions_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "armor_pieces" ADD CONSTRAINT "armor_pieces_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "enemies" ADD CONSTRAINT "enemies_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "enemy_attack_tiers" ADD CONSTRAINT "enemy_attack_tiers_enemy_id_enemies_id_fk" FOREIGN KEY ("enemy_id") REFERENCES "public"."enemies"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "spell_gems" ADD CONSTRAINT "spell_gems_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "weapon_channels" ADD CONSTRAINT "weapon_channels_weapon_id_weapons_id_fk" FOREIGN KEY ("weapon_id") REFERENCES "public"."weapons"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "weapons" ADD CONSTRAINT "weapons_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "browser_sources" ADD CONSTRAINT "browser_sources_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "browser_sources" ADD CONSTRAINT "browser_sources_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "faction_favor" ADD CONSTRAINT "faction_favor_faction_id_factions_id_fk" FOREIGN KEY ("faction_id") REFERENCES "public"."factions"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "faction_favor" ADD CONSTRAINT "faction_favor_character_id_characters_id_fk" FOREIGN KEY ("character_id") REFERENCES "public"."characters"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "factions" ADD CONSTRAINT "factions_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "journal_entries" ADD CONSTRAINT "journal_entries_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "map_fog_cells" ADD CONSTRAINT "map_fog_cells_map_id_maps_id_fk" FOREIGN KEY ("map_id") REFERENCES "public"."maps"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "maps" ADD CONSTRAINT "maps_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
