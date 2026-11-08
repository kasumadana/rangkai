ALTER TABLE "road_segments" ADD COLUMN "organization_id" uuid;--> statement-breakpoint
ALTER TABLE "road_segments" ADD COLUMN "source_type" text DEFAULT 'catalog' NOT NULL;--> statement-breakpoint
ALTER TABLE "road_segments" ADD COLUMN "created_by" text;--> statement-breakpoint
ALTER TABLE "road_segments" ADD CONSTRAINT "road_segments_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "road_segments" ADD CONSTRAINT "road_segments_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;