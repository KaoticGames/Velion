CREATE TABLE IF NOT EXISTS "character_pets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"character_id" uuid NOT NULL,
	"campaign_id" uuid NOT NULL,
	"pet_id" uuid NOT NULL,
	"nickname" text,
	"current_hp" bigint DEFAULT 0 NOT NULL,
	"notes" text DEFAULT '' NOT NULL,
	"bonded_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "homebrew_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"item_type" text NOT NULL,
	"item_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"snapshot" jsonb NOT NULL,
	"saved_by" uuid,
	"saved_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "pet_attacks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"pet_id" uuid NOT NULL,
	"name" text NOT NULL,
	"damage_dice" text NOT NULL,
	"damage_type" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"order_index" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "pets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"species" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"power" integer DEFAULT 10 NOT NULL,
	"agility" integer DEFAULT 10 NOT NULL,
	"focus" integer DEFAULT 10 NOT NULL,
	"presence" integer DEFAULT 10 NOT NULL,
	"movement" integer DEFAULT 30 NOT NULL,
	"base_rp" integer DEFAULT 0 NOT NULL,
	"max_hp" bigint DEFAULT 0 NOT NULL,
	"is_homebrew" boolean DEFAULT false NOT NULL,
	"is_public" boolean DEFAULT false NOT NULL,
	"created_by" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "armor_pieces" DROP CONSTRAINT "armor_pieces_created_by_users_id_fk";
--> statement-breakpoint
ALTER TABLE "enemies" DROP CONSTRAINT "enemies_created_by_users_id_fk";
--> statement-breakpoint
ALTER TABLE "spell_gems" DROP CONSTRAINT "spell_gems_created_by_users_id_fk";
--> statement-breakpoint
ALTER TABLE "weapons" DROP CONSTRAINT "weapons_created_by_users_id_fk";
--> statement-breakpoint
ALTER TABLE "armor_pieces" ALTER COLUMN "is_public" SET DEFAULT false;--> statement-breakpoint
ALTER TABLE "enemies" ALTER COLUMN "is_public" SET DEFAULT false;--> statement-breakpoint
ALTER TABLE "spell_gems" ALTER COLUMN "is_public" SET DEFAULT false;--> statement-breakpoint
ALTER TABLE "weapons" ALTER COLUMN "is_public" SET DEFAULT false;--> statement-breakpoint
ALTER TABLE "armor_pieces" ADD COLUMN "description" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "armor_pieces" ADD COLUMN "version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "armor_pieces" ADD COLUMN "created_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "armor_pieces" ADD COLUMN "updated_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "enemies" ADD COLUMN "version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "enemies" ADD COLUMN "created_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "enemies" ADD COLUMN "updated_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "focus_bracers" ADD COLUMN "description" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "focus_bracers" ADD COLUMN "is_public" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "focus_bracers" ADD COLUMN "created_by" uuid;--> statement-breakpoint
ALTER TABLE "focus_bracers" ADD COLUMN "version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "focus_bracers" ADD COLUMN "created_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "focus_bracers" ADD COLUMN "updated_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "spell_gems" ADD COLUMN "description" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "spell_gems" ADD COLUMN "version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "spell_gems" ADD COLUMN "created_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "spell_gems" ADD COLUMN "updated_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "weapons" ADD COLUMN "description" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "weapons" ADD COLUMN "version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "weapons" ADD COLUMN "created_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "weapons" ADD COLUMN "updated_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "character_pets" ADD CONSTRAINT "character_pets_character_id_characters_id_fk" FOREIGN KEY ("character_id") REFERENCES "public"."characters"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "character_pets" ADD CONSTRAINT "character_pets_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "character_pets" ADD CONSTRAINT "character_pets_pet_id_pets_id_fk" FOREIGN KEY ("pet_id") REFERENCES "public"."pets"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "homebrew_versions" ADD CONSTRAINT "homebrew_versions_saved_by_users_id_fk" FOREIGN KEY ("saved_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "pet_attacks" ADD CONSTRAINT "pet_attacks_pet_id_pets_id_fk" FOREIGN KEY ("pet_id") REFERENCES "public"."pets"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "pets" ADD CONSTRAINT "pets_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "armor_pieces" ADD CONSTRAINT "armor_pieces_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "enemies" ADD CONSTRAINT "enemies_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "focus_bracers" ADD CONSTRAINT "focus_bracers_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "spell_gems" ADD CONSTRAINT "spell_gems_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "weapons" ADD CONSTRAINT "weapons_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
ALTER TABLE "armor_pieces" DROP COLUMN IF EXISTS "campaign_id";--> statement-breakpoint
ALTER TABLE "enemies" DROP COLUMN IF EXISTS "campaign_id";--> statement-breakpoint
ALTER TABLE "focus_bracers" DROP COLUMN IF EXISTS "campaign_id";--> statement-breakpoint
ALTER TABLE "spell_gems" DROP COLUMN IF EXISTS "campaign_id";--> statement-breakpoint
ALTER TABLE "weapons" DROP COLUMN IF EXISTS "campaign_id";