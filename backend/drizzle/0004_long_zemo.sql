ALTER TABLE "sessions" ALTER COLUMN "name" SET DEFAULT '';--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "last_activity_at" timestamp with time zone DEFAULT now() NOT NULL;