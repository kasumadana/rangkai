import type { DbClient } from "../../src/db/index";
import { AUTHORIZED_DEV_BRANCH } from "../../src/db/guard";

export const VALID_CATALOG = {
	branchId: AUTHORIZED_DEV_BRANCH,
	postgisVersion: "3.6.4",
	tables: [
		"account",
		"ai_extractions",
		"audit_logs",
		"cleanup_evidence",
		"cleanup_tasks",
		"documents",
		"event_assignments",
		"events",
		"memberships",
		"organizations",
		"road_impacts",
		"road_segments",
		"road_status_updates",
		"session",
		"user",
		"verification",
		"waste_records",
	],
	geometryColumns: [
		{
			f_table_name: "events",
			f_geometry_column: "venue_location",
			type: "POINT",
			srid: 4326,
		},
		{
			f_table_name: "cleanup_tasks",
			f_geometry_column: "location",
			type: "POINT",
			srid: 4326,
		},
		{
			f_table_name: "road_segments",
			f_geometry_column: "geom",
			type: "LINESTRING",
			srid: 4326,
		},
	],
	indexes: [
		{
			tablename: "audit_logs",
			indexname: "audit_logs_event_created_idx",
			indexdef:
				"CREATE INDEX audit_logs_event_created_idx ON public.audit_logs USING btree (event_id, created_at DESC NULLS LAST)",
		},
		{
			tablename: "cleanup_tasks",
			indexname: "cleanup_tasks_event_status_idx",
			indexdef:
				"CREATE INDEX cleanup_tasks_event_status_idx ON public.cleanup_tasks USING btree (event_id, status)",
		},
		{
			tablename: "cleanup_tasks",
			indexname: "cleanup_tasks_location_gist_idx",
			indexdef:
				"CREATE INDEX cleanup_tasks_location_gist_idx ON public.cleanup_tasks USING gist (location)",
		},
		{
			tablename: "documents",
			indexname: "documents_event_id_idx",
			indexdef:
				"CREATE INDEX documents_event_id_idx ON public.documents USING btree (event_id)",
		},
		{
			tablename: "events",
			indexname: "events_org_starts_at_idx",
			indexdef:
				"CREATE INDEX events_org_starts_at_idx ON public.events USING btree (organization_id, starts_at)",
		},
		{
			tablename: "events",
			indexname: "events_status_starts_at_idx",
			indexdef:
				"CREATE INDEX events_status_starts_at_idx ON public.events USING btree (status, starts_at)",
		},
		{
			tablename: "road_impacts",
			indexname: "road_impacts_event_id_idx",
			indexdef:
				"CREATE INDEX road_impacts_event_id_idx ON public.road_impacts USING btree (event_id)",
		},
		{
			tablename: "road_impacts",
			indexname: "road_impacts_segment_planned_idx",
			indexdef:
				"CREATE INDEX road_impacts_segment_planned_idx ON public.road_impacts USING btree (road_segment_id, planned_from)",
		},
		{
			tablename: "road_segments",
			indexname: "road_segments_geom_gist_idx",
			indexdef:
				"CREATE INDEX road_segments_geom_gist_idx ON public.road_segments USING gist (geom)",
		},
		{
			tablename: "road_status_updates",
			indexname: "road_status_updates_impact_created_idx",
			indexdef:
				"CREATE INDEX road_status_updates_impact_created_idx ON public.road_status_updates USING btree (road_impact_id, created_at DESC NULLS LAST)",
		},
	],
	constraints: [
		{
			table_name: "event_assignments",
			constraint_name: "event_assignments_event_user_unique",
			constraint_type: "u",
			constraint_def: "UNIQUE (event_id, user_id)",
		},
		{
			table_name: "events",
			constraint_name: "events_ends_at_after_starts_at",
			constraint_type: "c",
			constraint_def:
				"CHECK (((ends_at IS NULL) OR (starts_at IS NULL) OR (ends_at > starts_at)))",
		},
		{
			table_name: "events",
			constraint_name: "events_status_check",
			constraint_type: "c",
			constraint_def:
				"CHECK ((status = ANY (ARRAY['draft'::text, 'review'::text, 'published'::text, 'active'::text, 'completed'::text, 'cancelled'::text, 'archived'::text])))",
		},
		{
			table_name: "memberships",
			constraint_name: "memberships_org_user_unique",
			constraint_type: "u",
			constraint_def: "UNIQUE (organization_id, user_id)",
		},
		{
			table_name: "memberships",
			constraint_name: "memberships_role_check",
			constraint_type: "c",
			constraint_def:
				"CHECK ((role = ANY (ARRAY['organizer'::text, 'officer'::text])))",
		},
		{
			table_name: "road_impacts",
			constraint_name: "road_impacts_time_check",
			constraint_type: "c",
			constraint_def: "CHECK ((planned_to > planned_from))",
		},
		{
			table_name: "road_impacts",
			constraint_name: "road_impacts_type_check",
			constraint_type: "c",
			constraint_def:
				"CHECK ((impact_type = ANY (ARRAY['closure'::text, 'intermittent'::text, 'narrowing'::text, 'procession'::text])))",
		},
		{
			table_name: "road_status_updates",
			constraint_name: "road_status_updates_road_impact_id_road_impacts_id_fk",
			constraint_type: "f",
			constraint_def:
				"FOREIGN KEY (road_impact_id) REFERENCES road_impacts(id) ON DELETE RESTRICT",
		},
		{
			table_name: "road_status_updates",
			constraint_name: "road_status_updates_status_check",
			constraint_type: "c",
			constraint_def:
				"CHECK ((status = ANY (ARRAY['open'::text, 'intermittent'::text, 'closed'::text, 'unknown'::text])))",
		},
		{
			table_name: "waste_records",
			constraint_name: "waste_records_category_check",
			constraint_type: "c",
			constraint_def:
				"CHECK ((category = ANY (ARRAY['organic'::text, 'recyclable'::text, 'residual'::text])))",
		},
		{
			table_name: "waste_records",
			constraint_name: "waste_records_method_check",
			constraint_type: "c",
			constraint_def:
				"CHECK ((measurement_method = ANY (ARRAY['weighed'::text, 'estimated'::text])))",
		},
		{
			table_name: "waste_records",
			constraint_name: "waste_records_quantity_check",
			constraint_type: "c",
			constraint_def:
				"CHECK (((quantity_kg IS NOT NULL) OR (sack_count IS NOT NULL)))",
		},
	],
};

export function createMockCatalogDb(
	overrides?: Partial<typeof VALID_CATALOG>,
): DbClient {
	const data = { ...VALID_CATALOG, ...overrides };
	return {
		execute: async (query: unknown) => {
			const str = JSON.stringify(query);
			if (str.includes("neon.branch_id")) {
				return { rows: [{ branch_id: data.branchId }] };
			}
			if (str.includes("pg_extension")) {
				return {
					rows: data.postgisVersion
						? [{ extname: "postgis", extversion: data.postgisVersion }]
						: [],
				};
			}
			if (str.includes("geometry_columns")) {
				return { rows: data.geometryColumns };
			}
			if (str.includes("information_schema.tables")) {
				return { rows: data.tables.map((t) => ({ table_name: t })) };
			}
			if (str.includes("pg_indexes")) {
				return { rows: data.indexes };
			}
			if (str.includes("pg_constraint")) {
				return { rows: data.constraints };
			}
			return { rows: [] };
		},
	} as unknown as DbClient;
}
