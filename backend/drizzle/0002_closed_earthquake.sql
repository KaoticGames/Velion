CREATE TABLE IF NOT EXISTS "character_inventory" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"character_id" uuid NOT NULL,
	"item_type" text NOT NULL,
	"library_item_id" uuid,
	"quantity" integer DEFAULT 1 NOT NULL,
	"notes" text DEFAULT '' NOT NULL,
	"equipped" boolean DEFAULT false NOT NULL,
	"equipped_slot" text,
	"added_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "general_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"category" text DEFAULT 'misc' NOT NULL,
	"weight" numeric(5, 2) DEFAULT '0' NOT NULL,
	"value_gold" integer DEFAULT 0 NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"effect" text DEFAULT '' NOT NULL,
	"stackable" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
ALTER TABLE "enemies" ADD COLUMN "power" integer DEFAULT 10 NOT NULL;--> statement-breakpoint
ALTER TABLE "enemies" ADD COLUMN "agility" integer DEFAULT 10 NOT NULL;--> statement-breakpoint
ALTER TABLE "enemies" ADD COLUMN "focus" integer DEFAULT 10 NOT NULL;--> statement-breakpoint
ALTER TABLE "enemies" ADD COLUMN "presence" integer DEFAULT 10 NOT NULL;--> statement-breakpoint
ALTER TABLE "enemies" ADD COLUMN "base_rp" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "enemies" ADD COLUMN "attacks" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "character_inventory" ADD CONSTRAINT "character_inventory_character_id_characters_id_fk" FOREIGN KEY ("character_id") REFERENCES "public"."characters"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
