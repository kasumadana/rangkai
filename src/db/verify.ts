import * as dotenv from "dotenv";
import { sql } from "drizzle-orm";
import { assertDevBranch, AUTHORIZED_DEV_BRANCH } from "./guard";
import { getDb, type DbClient } from "./index";

// ponytail: fail-closed schema & constraint verification against Neon development branch
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

export const REQUIRED_INDEXES = [
	"audit_logs_event_created_idx",
	"cleanup_tasks_event_status_idx",
	"cleanup_tasks_location_gist_idx",
	"documents_event_id_idx",
	"events_org_starts_at_idx",
	"events_status_starts_at_idx",
	"road_impacts_event_id_idx",
	"road_impacts_segment_planned_idx",
	"road_segments_geom_gist_idx",
	"road_status_updates_impact_created_idx",
] as const;

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

	// 4. Indexes assertion (including spatial GIST indexes)
	const indexesRes = await db.execute<{
		tablename: string;
		indexname: string;
		indexdef: string;
	}>(
		sql`SELECT tablename, indexname, indexdef FROM pg_indexes WHERE schemaname = 'public' ORDER BY tablename, indexname`,
	);
	const indexSet = new Set(indexesRes.rows.map((r) => r.indexname));
	const missingIndexes = REQUIRED_INDEXES.filter((i) => !indexSet.has(i));
	if (missingIndexes.length > 0) {
		throw new Error(
			`Verification failed: missing required index(es): ${missingIndexes.join(", ")}`,
		);
	}

	// 5. Constraints assertion from pg_constraint catalog
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

	// Verify key integrity constraints
	const constraintNames = new Set(
		constraintsRes.rows.map((c) => c.constraint_name),
	);
	const requiredConstraints = [
		"events_ends_at_after_starts_at",
		"events_status_check",
		"road_impacts_time_check",
		"road_impacts_type_check",
		"road_status_updates_status_check",
		"road_status_updates_road_impact_id_road_impacts_id_fk",
		"waste_records_quantity_check",
		"memberships_org_user_unique",
		"event_assignments_event_user_unique",
	];

	const missingConstraints = requiredConstraints.filter(
		(c) => !constraintNames.has(c),
	);
	if (missingConstraints.length > 0) {
		throw new Error(
			`Verification failed: missing required constraint(s): ${missingConstraints.join(", ")}`,
		);
	}

	return {
		branchId,
		postgisVersion,
		tableNames: tablesRes.rows.map((r) => r.table_name),
		indexes: indexesRes.rows,
		constraints: constraintsRes.rows,
	};
}

if (process.argv[1] && process.argv[1].endsWith("verify.ts")) {
	verifyDatabase()
		.then((result) => {
			console.log("=== Neon Database Verification ===");
			console.log("Target Neon Branch ID:", result.branchId);
			console.log("PostGIS Extension Version:", result.postgisVersion);
			console.log("Application Tables Count:", result.tableNames.length);
			console.log("Public Indexes Count:", result.indexes.length);
			console.log(
				"Application Constraints Count (pg_constraint):",
				result.constraints.length,
			);
			console.log("Verification successful: all assertions passed.");
		})
		.catch((err) => {
			console.error("Verification failed:", err.message);
			process.exit(1);
		});
}
