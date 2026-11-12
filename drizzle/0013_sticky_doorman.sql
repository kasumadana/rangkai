CREATE TABLE "reviewer_territory_assignments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"territory_version_id" uuid NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"assigned_by" text NOT NULL,
	"assigned_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_by" text,
	"revoked_at" timestamp with time zone,
	CONSTRAINT "reviewer_territory_assignments_user_version_unique" UNIQUE("user_id","territory_version_id"),
	CONSTRAINT "reviewer_territory_assignments_status_check" CHECK (status IN ('active', 'revoked'))
);
--> statement-breakpoint
CREATE TABLE "road_review_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"road_impact_id" uuid NOT NULL,
	"event_id" uuid NOT NULL,
	"road_segment_id" uuid NOT NULL,
	"territory_version_id" uuid NOT NULL,
	"road_geometry" geometry(LineString, 4326) NOT NULL,
	"geometry_wkb" text NOT NULL,
	"territory_content_hash" text NOT NULL,
	"event_starts_at" timestamp with time zone,
	"event_ends_at" timestamp with time zone,
	"planned_from" timestamp with time zone NOT NULL,
	"planned_to" timestamp with time zone NOT NULL,
	"impact_type" text NOT NULL,
	"is_simulation" boolean NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"submitted_by" text NOT NULL,
	"submitted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"reviewed_by" text,
	"reviewed_at" timestamp with time zone,
	"reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "road_review_requests_status_check" CHECK (status IN ('pending', 'approved', 'rejected', 'superseded')),
	CONSTRAINT "road_review_requests_decision_check" CHECK (status NOT IN ('approved', 'rejected') OR (reviewed_by IS NOT NULL AND reviewed_at IS NOT NULL AND reason IS NOT NULL)),
	CONSTRAINT "road_review_requests_pending_check" CHECK (status <> 'pending' OR (reviewed_by IS NULL AND reviewed_at IS NULL AND reason IS NULL)),
	CONSTRAINT "road_review_requests_time_check" CHECK (planned_to > planned_from)
);
--> statement-breakpoint
ALTER TABLE "reviewer_territory_assignments" ADD CONSTRAINT "reviewer_territory_assignments_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reviewer_territory_assignments" ADD CONSTRAINT "reviewer_territory_assignments_territory_version_id_organization_territory_versions_id_fk" FOREIGN KEY ("territory_version_id") REFERENCES "public"."organization_territory_versions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reviewer_territory_assignments" ADD CONSTRAINT "reviewer_territory_assignments_assigned_by_user_id_fk" FOREIGN KEY ("assigned_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reviewer_territory_assignments" ADD CONSTRAINT "reviewer_territory_assignments_revoked_by_user_id_fk" FOREIGN KEY ("revoked_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "road_review_requests" ADD CONSTRAINT "road_review_requests_road_impact_id_road_impacts_id_fk" FOREIGN KEY ("road_impact_id") REFERENCES "public"."road_impacts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "road_review_requests" ADD CONSTRAINT "road_review_requests_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "road_review_requests" ADD CONSTRAINT "road_review_requests_road_segment_id_road_segments_id_fk" FOREIGN KEY ("road_segment_id") REFERENCES "public"."road_segments"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "road_review_requests" ADD CONSTRAINT "road_review_requests_territory_version_id_organization_territory_versions_id_fk" FOREIGN KEY ("territory_version_id") REFERENCES "public"."organization_territory_versions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "road_review_requests" ADD CONSTRAINT "road_review_requests_submitted_by_user_id_fk" FOREIGN KEY ("submitted_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "road_review_requests" ADD CONSTRAINT "road_review_requests_reviewed_by_user_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "reviewer_territory_assignments_version_status_idx" ON "reviewer_territory_assignments" USING btree ("territory_version_id","status");--> statement-breakpoint
CREATE INDEX "road_review_requests_event_status_idx" ON "road_review_requests" USING btree ("event_id","status","submitted_at");--> statement-breakpoint
CREATE UNIQUE INDEX "road_review_requests_one_pending_impact" ON "road_review_requests" USING btree ("road_impact_id") WHERE status = 'pending';