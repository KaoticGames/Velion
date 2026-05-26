CREATE TABLE IF NOT EXISTS "special_abilities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"resolution_model" text DEFAULT 'narrative' NOT NULL,
	"num_dice" integer,
	"die_type" integer,
	"damage_type" text,
	"suggested_rp_note" text,
	"applies_states" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"secondary_effect_text" text,
	"is_homebrew" boolean DEFAULT false NOT NULL,
	"is_public" boolean DEFAULT false NOT NULL,
	"created_by" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "character_special_abilities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"character_id" uuid NOT NULL,
	"ability_id" uuid,
	"name" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"resolution_model" text DEFAULT 'narrative' NOT NULL,
	"num_dice" integer,
	"die_type" integer,
	"damage_type" text,
	"suggested_rp_note" text,
	"applies_states" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"secondary_effect_text" text,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "special_abilities" ADD CONSTRAINT "special_abilities_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "character_special_abilities" ADD CONSTRAINT "character_special_abilities_character_id_characters_id_fk" FOREIGN KEY ("character_id") REFERENCES "public"."characters"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "character_special_abilities" ADD CONSTRAINT "character_special_abilities_ability_id_special_abilities_id_fk" FOREIGN KEY ("ability_id") REFERENCES "public"."special_abilities"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
