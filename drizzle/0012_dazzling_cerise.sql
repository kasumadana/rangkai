CREATE TABLE "organization_territory_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"geom" geometry(MultiPolygon, 4326) NOT NULL,
	"geojson" jsonb NOT NULL,
	"source_type" text NOT NULL,
	"source_label" text NOT NULL,
	"source_url" text,
	"content_hash" text NOT NULL,
	"is_simulation" boolean DEFAULT false NOT NULL,
	"status" text DEFAULT 'pending_verification' NOT NULL,
	"created_by" text NOT NULL,
	"verified_by" text,
	"verified_at" timestamp with time zone,
	"verification_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "organization_territory_versions_org_version_unique" UNIQUE("organization_id","version"),
	CONSTRAINT "organization_territory_versions_source_check" CHECK (source_type IN ('imported', 'manual', 'synthetic')),
	CONSTRAINT "organization_territory_versions_status_check" CHECK (status IN ('pending_verification', 'verified', 'revoked')),
	CONSTRAINT "organization_territory_versions_hash_check" CHECK (content_hash ~ '^[a-f0-9]{64}$'),
	CONSTRAINT "organization_territory_versions_review_check" CHECK ((status = 'verified') = (verified_by IS NOT NULL AND verified_at IS NOT NULL AND verification_reason IS NOT NULL)),
	CONSTRAINT "organization_territory_versions_simulation_check" CHECK (source_type <> 'synthetic' OR is_simulation)
);
--> statement-breakpoint
ALTER TABLE "organization_territory_versions" ADD CONSTRAINT "organization_territory_versions_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_territory_versions" ADD CONSTRAINT "organization_territory_versions_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_territory_versions" ADD CONSTRAINT "organization_territory_versions_verified_by_user_id_fk" FOREIGN KEY ("verified_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "organization_territory_versions_org_status_idx" ON "organization_territory_versions" USING btree ("organization_id","status","version" DESC NULLS LAST);