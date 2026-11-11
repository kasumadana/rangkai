CREATE TABLE "advisory_decisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"advisory_run_id" uuid NOT NULL,
	"event_id" uuid NOT NULL,
	"actor_id" text NOT NULL,
	"decision" text NOT NULL,
	"reason" text,
	"input_snapshot_hash" text NOT NULL,
	"corrected_output_json" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "advisory_decisions_decision_check" CHECK (decision IN ('approved', 'rejected', 'dismissed'))
);
--> statement-breakpoint
CREATE TABLE "advisory_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_id" uuid NOT NULL,
	"organization_id" uuid NOT NULL,
	"actor_id" text NOT NULL,
	"kind" text NOT NULL,
	"input_snapshot_hash" text NOT NULL,
	"model_name" text NOT NULL,
	"prompt_version" text NOT NULL,
	"schema_version" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"output_json" jsonb,
	"error_code" text,
	"error_message" text,
	"latency_ms" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "advisory_runs_kind_check" CHECK (kind IN ('impact_analysis', 'public_notice', 'waste_plan')),
	CONSTRAINT "advisory_runs_status_check" CHECK (status IN ('pending', 'completed', 'failed'))
);
--> statement-breakpoint
CREATE TABLE "event_alternative_routes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_id" uuid NOT NULL,
	"organization_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"geom" geometry(LineString, 4326) NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"created_by" text NOT NULL,
	"approved_by" text,
	"approved_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "event_alternative_routes_status_check" CHECK (status IN ('draft', 'approved', 'revoked'))
);
--> statement-breakpoint
ALTER TABLE "advisory_decisions" ADD CONSTRAINT "advisory_decisions_advisory_run_id_advisory_runs_id_fk" FOREIGN KEY ("advisory_run_id") REFERENCES "public"."advisory_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "advisory_decisions" ADD CONSTRAINT "advisory_decisions_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "advisory_decisions" ADD CONSTRAINT "advisory_decisions_actor_id_user_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "advisory_runs" ADD CONSTRAINT "advisory_runs_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "advisory_runs" ADD CONSTRAINT "advisory_runs_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "advisory_runs" ADD CONSTRAINT "advisory_runs_actor_id_user_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_alternative_routes" ADD CONSTRAINT "event_alternative_routes_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_alternative_routes" ADD CONSTRAINT "event_alternative_routes_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_alternative_routes" ADD CONSTRAINT "event_alternative_routes_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_alternative_routes" ADD CONSTRAINT "event_alternative_routes_approved_by_user_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "advisory_decisions_run_idx" ON "advisory_decisions" USING btree ("advisory_run_id");--> statement-breakpoint
CREATE INDEX "advisory_decisions_event_idx" ON "advisory_decisions" USING btree ("event_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "advisory_runs_event_kind_idx" ON "advisory_runs" USING btree ("event_id","kind","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "event_alternative_routes_event_idx" ON "event_alternative_routes" USING btree ("event_id","status");--> statement-breakpoint
CREATE INDEX "event_alternative_routes_geom_gist_idx" ON "event_alternative_routes" USING gist ("geom");