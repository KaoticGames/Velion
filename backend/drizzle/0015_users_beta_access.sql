ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "beta_access" boolean;
UPDATE "users" SET "beta_access" = true WHERE "beta_access" IS NULL;
ALTER TABLE "users" ALTER COLUMN "beta_access" SET NOT NULL;
ALTER TABLE "users" ALTER COLUMN "beta_access" SET DEFAULT true;
