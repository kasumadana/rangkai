CREATE TABLE "activation_invitations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"token_hash" text NOT NULL,
	"recipient_email" text NOT NULL,
	"role" text NOT NULL,
	"organization_id" uuid,
	"event_id" uuid,
	"can_update_traffic" boolean DEFAULT false NOT NULL,
	"can_update_cleanup" boolean DEFAULT false NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_by" text NOT NULL,
	"accepted_by" text,
	"accepted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "activation_invitations_token_hash_unique" UNIQUE("token_hash"),
	CONSTRAINT "activation_invitations_role_check" CHECK (role IN ('organizer', 'officer', 'government_reviewer')),
	CONSTRAINT "activation_invitations_status_check" CHECK (status IN ('pending', 'accepted', 'revoked')),
	CONSTRAINT "activation_invitations_scope_check" CHECK ((role = 'organizer' AND organization_id IS NOT NULL AND event_id IS NULL AND NOT can_update_traffic AND NOT can_update_cleanup) OR (role = 'officer' AND organization_id IS NOT NULL AND event_id IS NOT NULL AND (can_update_traffic OR can_update_cleanup)) OR (role = 'government_reviewer' AND organization_id IS NULL AND event_id IS NULL AND NOT can_update_traffic AND NOT can_update_cleanup))
);
--> statement-breakpoint
ALTER TABLE "platform_audit" ADD COLUMN "entity_type" text;--> statement-breakpoint
ALTER TABLE "platform_audit" ADD COLUMN "entity_id" text;--> statement-breakpoint
ALTER TABLE "activation_invitations" ADD CONSTRAINT "activation_invitations_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activation_invitations" ADD CONSTRAINT "activation_invitations_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activation_invitations" ADD CONSTRAINT "activation_invitations_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activation_invitations" ADD CONSTRAINT "activation_invitations_accepted_by_user_id_fk" FOREIGN KEY ("accepted_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "activation_invitations_status_expiry_idx" ON "activation_invitations" USING btree ("status","expires_at");--> statement-breakpoint
CREATE INDEX "activation_invitations_recipient_idx" ON "activation_invitations" USING btree ("recipient_email");