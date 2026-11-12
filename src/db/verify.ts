import * as dotenv from "dotenv";
import { sql } from "drizzle-orm";
import {
	assertDevBranch,
	AUTHORIZED_DEV_BRANCH,
	sanitizeDatabaseError,
} from "./guard";
import { getDb, type DbClient } from "./index";

// ponytail: fail-closed schema, geometry, index, and constraint verification against Neon dev branch
dotenv.config({ path: ".dev.vars" });

export const REQUIRED_TABLES = [
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
] as const;

export interface RequiredGeometrySpec {
	table: string;
	column: string;
	type: "POINT" | "LINESTRING";
	srid: number;
}

export const REQUIRED_GEOMETRY_SPECS: readonly RequiredGeometrySpec[] = [
	{
		table: "cleanup_tasks",
		column: "location",
		type: "POINT",
		srid: 4326,
	},
	{
		table: "road_segments",
		column: "geom",
		type: "LINESTRING",
		srid: 4326,
	},
	{
		table: "events",
		column: "venue_location",
		type: "POINT",
		srid: 4326,
	},
];

export interface RequiredIndexSpec {
	name: string;
	table: string;
	method: "gist" | "btree";
	expectedColumns: readonly string[];
}

export const REQUIRED_INDEX_SPECS: readonly RequiredIndexSpec[] = [
	{
		name: "audit_logs_event_created_idx",
		table: "audit_logs",
		method: "btree",
		expectedColumns: ["event_id", "created_at DESC NULLS LAST"],
	},
	{
		name: "cleanup_tasks_event_status_idx",
		table: "cleanup_tasks",
		method: "btree",
		expectedColumns: ["event_id", "status"],
	},
	{
		name: "cleanup_tasks_location_gist_idx",
		table: "cleanup_tasks",
		method: "gist",
		expectedColumns: ["location"],
	},
	{
		name: "documents_event_id_idx",
		table: "documents",
		method: "btree",
		expectedColumns: ["event_id"],
	},
	{
		name: "events_org_starts_at_idx",
		table: "events",
		method: "btree",
		expectedColumns: ["organization_id", "starts_at"],
	},
	{
		name: "events_status_starts_at_idx",
		table: "events",
		method: "btree",
		expectedColumns: ["status", "starts_at"],
	},
	{
		name: "road_impacts_event_id_idx",
		table: "road_impacts",
		method: "btree",
		expectedColumns: ["event_id"],
	},
	{
		name: "road_impacts_segment_planned_idx",
		table: "road_impacts",
		method: "btree",
		expectedColumns: ["road_segment_id", "planned_from"],
	},
	{
		name: "road_segments_geom_gist_idx",
		table: "road_segments",
		method: "gist",
		expectedColumns: ["geom"],
	},
	{
		name: "road_status_updates_impact_created_idx",
		table: "road_status_updates",
		method: "btree",
		expectedColumns: ["road_impact_id", "created_at DESC NULLS LAST"],
	},
];

export function parseIndexDefinition(indexdef: string): {
	method: string;
	columns: string[];
	rawColumns: string;
} {
	const match = /USING\s+(\w+)\s*\((.+)\)/i.exec(indexdef.trim());
	if (!match) {
		throw new Error(`Unable to parse index definition: ${indexdef}`);
	}
	const method = match[1].toLowerCase();
	const rawColumns = match[2].trim();
	const columns = rawColumns
		.split(",")
		.map((col) => col.trim().replace(/\s+/g, " "));

	return { method, columns, rawColumns };
}

export interface RequiredConstraintSpec {
	name: string;
	table: string;
	type: "c" | "f" | "u";
	definitionMatch: RegExp;
	description: string;
}

export const REQUIRED_CONSTRAINT_SPECS: readonly RequiredConstraintSpec[] = [
	{
		name: "event_assignments_event_user_unique",
		table: "event_assignments",
		type: "u",
		definitionMatch: /UNIQUE.*\(event_id,\s*user_id\)/i,
		description: "unique assignment per event and user",
	},
	{
		name: "events_ends_at_after_starts_at",
		table: "events",
		type: "c",
		definitionMatch: /ends_at\s*>\s*starts_at/i,
		description: "ends_at must be after starts_at",
	},
	{
		name: "events_status_check",
		table: "events",
		type: "c",
		definitionMatch: /status.*ARRAY\['draft'/i,
		description: "finite event status domain check",
	},
	{
		name: "memberships_org_user_unique",
		table: "memberships",
		type: "u",
		definitionMatch: /UNIQUE.*\(organization_id,\s*user_id\)/i,
		description: "unique membership per organization and user",
	},
	{
		name: "memberships_role_check",
		table: "memberships",
		type: "c",
		definitionMatch: /role.*ARRAY\['organizer'/i,
		description: "finite membership role domain check",
	},
	{
		name: "road_impacts_time_check",
		table: "road_impacts",
		type: "c",
		definitionMatch: /planned_to\s*>\s*planned_from/i,
		description: "planned_to must be after planned_from",
	},
	{
		name: "road_impacts_type_check",
		table: "road_impacts",
		type: "c",
		definitionMatch: /impact_type.*ARRAY\['closure'/i,
		description: "finite road impact type domain check",
	},
	{
		name: "road_status_updates_road_impact_id_road_impacts_id_fk",
		table: "road_status_updates",
		type: "f",
		definitionMatch:
			/FOREIGN KEY.*REFERENCES.*road_impacts\(id\).*ON DELETE RESTRICT/i,
		description:
			"foreign key on road_impacts(id) with ON DELETE RESTRICT (append-only history)",
	},
	{
		name: "road_status_updates_status_check",
		table: "road_status_updates",
		type: "c",
		definitionMatch: /status.*ARRAY\['open'/i,
		description: "finite road status domain check",
	},
	{
		name: "waste_records_category_check",
		table: "waste_records",
		type: "c",
		definitionMatch: /category.*ARRAY\['organic'/i,
		description: "finite waste category domain check",
	},
	{
		name: "waste_records_method_check",
		table: "waste_records",
		type: "c",
		definitionMatch: /measurement_method.*ARRAY\['weighed'/i,
		description: "finite waste measurement method domain check",
	},
	{
		name: "waste_records_quantity_check",
		table: "waste_records",
		type: "c",
		definitionMatch: /quantity_kg IS NOT NULL.*sack_count IS NOT NULL/i,
		description: "at least one quantity or sack_count required",
	},
];

export async function verifyDatabase(
	customDb?: DbClient,
	expectedBranch = AUTHORIZED_DEV_BRANCH,
) {
	// If customDb is not provided, run fail-closed preflight to get pinned URL
	const db = customDb || getDb((await assertDevBranch()).pinnedUrl);

	// 1. Target identity assertion
	const branchRes = await db.execute<{ branch_id: string }>(
		sql`SELECT current_setting('neon.branch_id', true) AS branch_id`,
	);
	const branchId = branchRes.rows[0]?.branch_id;
	if (!branchId || branchId !== expectedBranch) {
		throw new Error(
			`Verification failed: expected Neon branch '${expectedBranch}', got '${branchId ?? "missing"}'`,
		);
	}

	// 2. PostGIS extension assertion
	const extRes = await db.execute<{ extname: string; extversion: string }>(
		sql`SELECT extname, extversion FROM pg_extension WHERE extname = 'postgis'`,
	);
	const postgisVersion = extRes.rows[0]?.extversion;
	if (!postgisVersion || !postgisVersion.startsWith("3.")) {
		throw new Error(
			`Verification failed: PostGIS 3.x is required, found '${postgisVersion ?? "missing"}'`,
		);
	}

	// 3. Application tables assertion
	const tablesRes = await db.execute<{ table_name: string }>(
		sql`SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE' ORDER BY table_name`,
	);
	const tableSet = new Set(tablesRes.rows.map((r) => r.table_name));
	const missingTables = REQUIRED_TABLES.filter((t) => !tableSet.has(t));
	if (missingTables.length > 0) {
		throw new Error(
			`Verification failed: missing required application table(s): ${missingTables.join(", ")}`,
		);
	}

	// 4. Geometry columns & SRID assertion
	const geomRes = await db.execute<{
		f_table_name: string;
		f_geometry_column: string;
		type: string;
		srid: number;
	}>(
		sql`SELECT f_table_name, f_geometry_column, type, srid FROM geometry_columns WHERE f_table_schema = 'public'`,
	);
	for (const spec of REQUIRED_GEOMETRY_SPECS) {
		const found = geomRes.rows.find(
			(g) =>
				g.f_table_name === spec.table &&
				g.f_geometry_column === spec.column,
		);
		if (!found) {
			throw new Error(
				`Verification failed: missing required geometry column '${spec.table}.${spec.column}'`,
			);
		}
		if (found.type !== spec.type || Number(found.srid) !== spec.srid) {
			throw new Error(
				`Verification failed: geometry '${spec.table}.${spec.column}' expected type ${spec.type} SRID ${spec.srid}, found type ${found.type} SRID ${found.srid}`,
			);
		}
	}

	// 5. Indexes assertion (validating table ownership, exact access method, and ordered key columns)
	const indexesRes = await db.execute<{
		tablename: string;
		indexname: string;
		indexdef: string;
	}>(
		sql`SELECT tablename, indexname, indexdef FROM pg_indexes WHERE schemaname = 'public' ORDER BY tablename, indexname`,
	);

	for (const spec of REQUIRED_INDEX_SPECS) {
		const found = indexesRes.rows.find((i) => i.indexname === spec.name);
		if (!found) {
			throw new Error(
				`Verification failed: missing required index '${spec.name}'`,
			);
		}
		if (found.tablename !== spec.table) {
			throw new Error(
				`Verification failed: index '${spec.name}' expected on table '${spec.table}', found on '${found.tablename}'`,
			);
		}
		const { method, columns } = parseIndexDefinition(found.indexdef);
		if (method !== spec.method) {
			throw new Error(
				`Verification failed: index '${spec.name}' expected access method '${spec.method}', found '${method}'`,
			);
		}
		if (columns.length !== spec.expectedColumns.length) {
			throw new Error(
				`Verification failed: index '${spec.name}' column count mismatch: expected ${spec.expectedColumns.length}, found ${columns.length}`,
			);
		}
		for (let idx = 0; idx < spec.expectedColumns.length; idx++) {
			if (
				columns[idx].toLowerCase() !==
				spec.expectedColumns[idx].toLowerCase()
			) {
				throw new Error(
					`Verification failed: index '${spec.name}' key column mismatch at position ${idx}: expected '${spec.expectedColumns[idx]}', found '${columns[idx]}'`,
				);
			}
		}
	}

	// 6. Constraints assertion from pg_constraint catalog (table ownership, type, actions, checks)
	const constraintsRes = await db.execute<{
		table_name: string;
		constraint_name: string;
		constraint_type: string;
		constraint_def: string;
	}>(
		sql`SELECT c.relname as table_name, con.conname as constraint_name, con.contype as constraint_type, pg_get_constraintdef(con.oid) as constraint_def
			FROM pg_constraint con
			JOIN pg_class c ON c.oid = con.conrelid
			JOIN pg_namespace n ON n.oid = c.relnamespace
			WHERE n.nspname = 'public' AND c.relname NOT IN ('spatial_ref_sys')
			ORDER BY c.relname, con.conname`,
	);

	if (constraintsRes.rows.length === 0) {
		throw new Error(
			"Verification failed: no application constraints found in pg_constraint",
		);
	}

	for (const spec of REQUIRED_CONSTRAINT_SPECS) {
		const found = constraintsRes.rows.find(
			(c) => c.constraint_name === spec.name,
		);
		if (!found) {
			throw new Error(
				`Verification failed: missing required constraint '${spec.name}' (${spec.description})`,
			);
		}
		if (found.table_name !== spec.table) {
			throw new Error(
				`Verification failed: constraint '${spec.name}' expected on table '${spec.table}', found on '${found.table_name}'`,
			);
		}
		if (found.constraint_type !== spec.type) {
			throw new Error(
				`Verification failed: constraint '${spec.name}' expected type '${spec.type}', found '${found.constraint_type}'`,
			);
		}
		if (!spec.definitionMatch.test(found.constraint_def)) {
			throw new Error(
				`Verification failed: constraint '${spec.name}' definition failed validation. Definition: ${found.constraint_def}`,
			);
		}
	}

	return {
		branchId,
		postgisVersion,
		tableNames: tablesRes.rows.map((r) => r.table_name),
		indexes: indexesRes.rows,
		constraints: constraintsRes.rows,
		geometries: geomRes.rows,
	};
}

// CLI runner
if (process.argv[1] && process.argv[1].endsWith("verify.ts")) {
	verifyDatabase()
		.then((result) => {
			console.log("=== Neon Database Verification ===");
			console.log("Target Neon Branch ID:", result.branchId);
			console.log("PostGIS Extension Version:", result.postgisVersion);
			console.log("Application Tables Count:", result.tableNames.length);
			console.log("Geometry Columns Count:", result.geometries.length);
			console.log("Public Indexes Count:", result.indexes.length);
			console.log(
				"Application Constraints Count (pg_constraint):",
				result.constraints.length,
			);
			console.log("Verification successful: all assertions passed.");
		})
		.catch((err: unknown) => {
			const msg = sanitizeDatabaseError(err);
			console.error("Verification failed:", msg);
			process.exit(1);
		});
}
