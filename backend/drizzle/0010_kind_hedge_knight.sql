CREATE TABLE IF NOT EXISTS "session_map_fog" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" uuid NOT NULL,
	"map_id" uuid NOT NULL,
	"image_data" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "session_map_fog_unique" UNIQUE("session_id","map_id")
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "session_map_fog" ADD CONSTRAINT "session_map_fog_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "session_map_fog" ADD CONSTRAINT "session_map_fog_map_id_maps_id_fk" FOREIGN KEY ("map_id") REFERENCES "public"."maps"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
