ALTER TABLE "character_pets" DROP CONSTRAINT "character_pets_campaign_id_campaigns_id_fk";
--> statement-breakpoint
ALTER TABLE "character_pets" ALTER COLUMN "campaign_id" DROP NOT NULL;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "character_pets" ADD CONSTRAINT "character_pets_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
