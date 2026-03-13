CREATE TABLE IF NOT EXISTS "early_access_signups" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"name" text,
	"source" text DEFAULT 'landing' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "early_access_email_unique" UNIQUE("email")
);
