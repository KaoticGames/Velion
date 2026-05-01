-- Session RP fields: single source of truth for character sheet + VTT
ALTER TABLE "characters" ADD COLUMN IF NOT EXISTS "current_rp" integer;
ALTER TABLE "characters" ADD COLUMN IF NOT EXISTS "rp_banked" integer;
ALTER TABLE "characters" ADD COLUMN IF NOT EXISTS "rp_banking" boolean;

UPDATE "characters"
SET
  "current_rp" = COALESCE("current_rp", "base_rp"),
  "rp_banked" = COALESCE("rp_banked", 0),
  "rp_banking" = COALESCE("rp_banking", false)
WHERE "current_rp" IS NULL OR "rp_banked" IS NULL OR "rp_banking" IS NULL;

ALTER TABLE "characters" ALTER COLUMN "current_rp" SET NOT NULL;
ALTER TABLE "characters" ALTER COLUMN "rp_banked" SET NOT NULL;
ALTER TABLE "characters" ALTER COLUMN "rp_banking" SET NOT NULL;
ALTER TABLE "characters" ALTER COLUMN "current_rp" SET DEFAULT 0;
ALTER TABLE "characters" ALTER COLUMN "rp_banked" SET DEFAULT 0;
ALTER TABLE "characters" ALTER COLUMN "rp_banking" SET DEFAULT false;
