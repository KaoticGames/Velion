DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'map_tokens'
      AND column_name = 'scale'
  ) THEN
    ALTER TABLE "map_tokens"
      ADD COLUMN "scale" real NOT NULL DEFAULT 1;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'map_tokens'
      AND column_name = 'is_hidden'
  ) THEN
    ALTER TABLE "map_tokens"
      ADD COLUMN "is_hidden" boolean NOT NULL DEFAULT false;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'map_tokens'
      AND column_name = 'group_id'
  ) THEN
    ALTER TABLE "map_tokens"
      ADD COLUMN "group_id" uuid;
  END IF;
END $$;
