ALTER TABLE "characters" ADD COLUMN IF NOT EXISTS "sheet_armor_overrides" jsonb DEFAULT '{}'::jsonb NOT NULL;
