ALTER TABLE "road_status_updates" DROP CONSTRAINT "road_status_updates_road_impact_id_road_impacts_id_fk";
--> statement-breakpoint
ALTER TABLE "road_status_updates" ADD CONSTRAINT "road_status_updates_road_impact_id_road_impacts_id_fk" FOREIGN KEY ("road_impact_id") REFERENCES "public"."road_impacts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_extractions" ADD CONSTRAINT "ai_extractions_status_check" CHECK (status IN ('pending', 'processing', 'completed', 'failed'));--> statement-breakpoint
ALTER TABLE "cleanup_evidence" ADD CONSTRAINT "cleanup_evidence_stage_check" CHECK (stage IN ('before', 'after'));--> statement-breakpoint
ALTER TABLE "cleanup_tasks" ADD CONSTRAINT "cleanup_tasks_status_check" CHECK (status IN ('todo', 'in_progress', 'submitted', 'verified', 'reopened'));--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_status_check" CHECK (status IN ('draft', 'review', 'published', 'active', 'completed', 'cancelled', 'archived'));--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_role_check" CHECK (role IN ('organizer', 'officer'));--> statement-breakpoint
ALTER TABLE "road_impacts" ADD CONSTRAINT "road_impacts_type_check" CHECK (impact_type IN ('closure', 'intermittent', 'narrowing', 'procession'));--> statement-breakpoint
ALTER TABLE "road_status_updates" ADD CONSTRAINT "road_status_updates_status_check" CHECK (status IN ('open', 'intermittent', 'closed', 'unknown'));--> statement-breakpoint
ALTER TABLE "waste_records" ADD CONSTRAINT "waste_records_category_check" CHECK (category IN ('organic', 'recyclable', 'residual'));--> statement-breakpoint
ALTER TABLE "waste_records" ADD CONSTRAINT "waste_records_method_check" CHECK (measurement_method IN ('weighed', 'estimated'));