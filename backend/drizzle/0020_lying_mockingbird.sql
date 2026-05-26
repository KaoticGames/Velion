CREATE TABLE IF NOT EXISTS "character_level_progression" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"character_id" uuid NOT NULL,
	"to_level" integer NOT NULL,
	"power_gain" integer DEFAULT 0 NOT NULL,
	"agility_gain" integer DEFAULT 0 NOT NULL,
	"focus_gain" integer DEFAULT 0 NOT NULL,
	"presence_gain" integer DEFAULT 0 NOT NULL,
	"roll_result" integer NOT NULL,
	"chosen_attribute" text NOT NULL,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "character_level_progression_character_id_to_level_unique" UNIQUE("character_id","to_level")
);
--> statement-breakpoint
ALTER TABLE "characters" ADD COLUMN "creation_baseline" jsonb;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "character_level_progression" ADD CONSTRAINT "character_level_progression_character_id_characters_id_fk" FOREIGN KEY ("character_id") REFERENCES "public"."characters"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
