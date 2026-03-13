CREATE TABLE IF NOT EXISTS "fog_sections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"map_id" uuid NOT NULL,
	"name" text DEFAULT 'Section' NOT NULL,
	"cells" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"is_hidden" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "maps" ADD COLUMN "feet_per_cell" integer DEFAULT 5 NOT NULL;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "fog_sections" ADD CONSTRAINT "fog_sections_map_id_maps_id_fk" FOREIGN KEY ("map_id") REFERENCES "public"."maps"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
