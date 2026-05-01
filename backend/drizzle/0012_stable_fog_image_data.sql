DO $$
DECLARE
  col_type text;
BEGIN
  SELECT data_type
    INTO col_type
  FROM information_schema.columns
  WHERE table_schema = 'public'
    AND table_name = 'fog_sections'
    AND column_name = 'image_data';

  IF col_type IN ('json', 'jsonb') THEN
    EXECUTE $sql$
      ALTER TABLE "fog_sections"
      ALTER COLUMN "image_data" TYPE text
      USING trim(both '"' from "image_data"::text)
    $sql$;
  END IF;
END $$;
