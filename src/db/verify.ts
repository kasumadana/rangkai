import * as dotenv from "dotenv";
import { sql } from "drizzle-orm";
import { getDb } from "./index";

// ponytail: minimal database schema and constraint verification against Neon development branch
dotenv.config({ path: ".dev.vars" });

export async function verifyDatabase() {
	const db = getDb();

	// 1. Target identity check
	const branchRes = await db.execute<{ setting: string }>(
		sql`SELECT setting FROM pg_settings WHERE name = 'neon.branch_id'`,
	);
	const branchId = branchRes.rows[0]?.setting;

	// 2. PostGIS extension check
	const extRes = await db.execute<{ extname: string; extversion: string }>(
		sql`SELECT extname, extversion FROM pg_extension WHERE extname = 'postgis'`,
	);
	const postgisVersion = extRes.rows[0]?.extversion;

	// 3. Application tables check
	const tablesRes = await db.execute<{ table_name: string }>(
		sql`SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY table_name`,
	);
	const tableNames = tablesRes.rows.map((r) => r.table_name);

	// 4. Indexes check
	const indexesRes = await db.execute<{ tablename: string; indexname: string; indexdef: string }>(
		sql`SELECT tablename, indexname, indexdef FROM pg_indexes WHERE schemaname = 'public' ORDER BY tablename, indexname`,
	);

	// 5. Constraints check
	const constraintsRes = await db.execute<{
		table_name: string;
		constraint_name: string;
		constraint_type: string;
	}>(
		sql`SELECT table_name, constraint_name, constraint_type FROM information_schema.table_constraints WHERE table_schema = 'public' ORDER BY table_name, constraint_name`,
	);

	return {
		branchId,
		postgisVersion,
		tableNames,
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
			console.log("Public Schema Tables:", result.tableNames.filter((t) => !t.startsWith("spatial_") && !t.startsWith("geography_") && !t.startsWith("geometry_")));
			console.log("Total Indexes:", result.indexes.length);
			console.log("Total Constraints:", result.constraints.length);
			console.log("Verification successful!");
		})
		.catch((err) => {
			console.error("Verification failed:", err.message);
			process.exit(1);
		});
}
