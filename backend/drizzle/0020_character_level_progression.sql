ALTER TABLE "characters" ADD COLUMN IF NOT EXISTS "creation_baseline" jsonb;

CREATE TABLE IF NOT EXISTS "character_level_progression" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "character_id" uuid NOT NULL REFERENCES "public"."characters"("id") ON DELETE cascade,
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
