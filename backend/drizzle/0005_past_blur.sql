CREATE TABLE IF NOT EXISTS "campaign_assets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"campaign_id" uuid NOT NULL,
	"name" text NOT NULL,
	"asset_type" text DEFAULT 'image' NOT NULL,
	"url" text NOT NULL,
	"r2_key" text NOT NULL,
	"size_bytes" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "campaigns" ADD COLUMN "summary" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "campaigns" ADD COLUMN "dm_notes" text DEFAULT '' NOT NULL;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "campaign_assets" ADD CONSTRAINT "campaign_assets_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
