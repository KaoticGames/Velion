DROP TABLE "map_fog_cells" CASCADE;--> statement-breakpoint
DROP TABLE "session_map_fog" CASCADE;--> statement-breakpoint
ALTER TABLE "fog_sections" RENAME COLUMN "cells" TO "image_data";