CREATE TABLE "event_alternative_route_history" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"route_id" uuid NOT NULL,
	"event_id" uuid NOT NULL,
	"organization_id" uuid NOT NULL,
	"actor_id" text NOT NULL,
	"action" text NOT NULL,
	"source_snapshot_hash" text,
	"expires_at" timestamp with time zone,
	"metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "event_alternative_route_history_action_check" CHECK (action IN ('created', 'approved', 'reapproved', 'revoked'))
);
--> statement-breakpoint
ALTER TABLE "event_alternative_routes" ADD COLUMN "revoked_by" text;--> statement-breakpoint
ALTER TABLE "event_alternative_routes" ADD COLUMN "revocation_reason" text;--> statement-breakpoint
ALTER TABLE "event_alternative_routes" ADD COLUMN "source_snapshot_hash" text;--> statement-breakpoint
ALTER TABLE "event_alternative_routes" ADD COLUMN "expires_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "event_alternative_route_history" ADD CONSTRAINT "event_alternative_route_history_route_id_event_alternative_routes_id_fk" FOREIGN KEY ("route_id") REFERENCES "public"."event_alternative_routes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_alternative_route_history" ADD CONSTRAINT "event_alternative_route_history_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_alternative_route_history" ADD CONSTRAINT "event_alternative_route_history_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_alternative_route_history" ADD CONSTRAINT "event_alternative_route_history_actor_id_user_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "event_alternative_route_history_route_idx" ON "event_alternative_route_history" USING btree ("route_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "event_alternative_route_history_event_idx" ON "event_alternative_route_history" USING btree ("event_id","created_at" DESC NULLS LAST);--> statement-breakpoint
ALTER TABLE "event_alternative_routes" ADD CONSTRAINT "event_alternative_routes_revoked_by_user_id_fk" FOREIGN KEY ("revoked_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;