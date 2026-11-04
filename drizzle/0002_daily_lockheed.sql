ALTER TABLE "documents" ADD COLUMN IF NOT EXISTS "ai_consent_by" text;--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN IF NOT EXISTS "ai_consent_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN IF NOT EXISTS "procession_description" text;--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN IF NOT EXISTS "traffic_impact_description" text;--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN IF NOT EXISTS "organizer_name" text;--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN IF NOT EXISTS "cleanup_location_notes" text;--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN IF NOT EXISTS "contact_information" text;
