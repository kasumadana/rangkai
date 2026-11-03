import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import * as dotenv from "dotenv";
import { eq, sql } from "drizzle-orm";
import { Hono } from "hono";
import { beforeAll, describe, expect, it } from "vitest";
import {
	assertDevBranch,
	AUTHORIZED_DEV_BRANCH,
	sanitizeDatabaseError,
} from "../../src/db/guard";
import { getDb, type DbClient } from "../../src/db/index";
import { runMigrations } from "../../src/db/migrate";
import type { EventStatus } from "../../src/db/schema";
import {
	auditLogs,
	events,
	organizations,
	roadImpacts,
	roadSegments,
	roadStatusUpdates,
	wasteRecords,
} from "../../src/db/schema";
import { user } from "../../src/db/auth-schema";
import { verifyDatabase } from "../../src/db/verify";
import {
	createMockCatalogDb,
	VALID_CATALOG,
} from "../fixtures/catalog-fixture";

dotenv.config({ path: ".dev.vars" });

function createRunIds() {
	const runKey = crypto.randomUUID().slice(0, 8);
	return {
		orgId: crypto.randomUUID(),
		userId: `usr_test_${runKey}`,
		eventId: crypto.randomUUID(),
		segmentId: crypto.randomUUID(),
		mutationId: crypto.randomUUID(),
		slug: `test-event-${runKey}`,
	};
}

describe("Neon + PostGIS + Drizzle Database Integration", () => {
	let db: DbClient;
	let pinnedUrl: string;

	// Fail-closed preflight: every mutation test requires authorized dev branch
	beforeAll(async () => {
		const preflight = await assertDevBranch();
		pinnedUrl = preflight.pinnedUrl;
		db = getDb(pinnedUrl);
	});

	describe("Target branch, migration, and connection guards", () => {
		it("fails honestly with clear recovery instructions when DATABASE_URL is missing", () => {
			expect(() => getDb("")).toThrowError(
				/DATABASE_URL is not configured\. Please supply DATABASE_URL in \.dev\.vars/,
			);
		});

		it("preflight guard succeeds against the authorized Neon dev branch", async () => {
			const res = await assertDevBranch();
			expect(res.branchId).toBe(AUTHORIZED_DEV_BRANCH);
			expect(res.pinnedUrl).toBe(pinnedUrl);
		});

		it("fails closed when connecting to an unauthorized branch", async () => {
			const mockDb = createMockCatalogDb({
				branchId: "br-wrong-production-branch",
			});

			await expect(
				verifyDatabase(mockDb, AUTHORIZED_DEV_BRANCH),
			).rejects.toThrowError(
				/expected Neon branch 'br-wandering-paper-aogdxs48'/,
			);
		});

		it("runMigrations() rejects unauthorized target before running any migrations", async () => {
			const origFetch = globalThis.fetch;
			try {
				globalThis.fetch = async () =>
					new Response(
						JSON.stringify({
							fields: [{ name: "branch_id", dataTypeID: 25 }],
							rows: [["br-unauthorized-target"]],
						}),
						{ status: 200, headers: { "Content-Type": "application/json" } },
					);
				await expect(
					runMigrations(
						"postgresql://unauthorized:pass@ep-unauth.aws.neon.tech/neondb?sslmode=require",
					),
				).rejects.toThrowError(
					/Unauthorized database target: expected Neon development branch 'br-wandering-paper-aogdxs48'/,
				);
			} finally {
				globalThis.fetch = origFetch;
			}
		});

		it("runMigrations() rejects empty database url with clear recovery instructions", async () => {
			await expect(runMigrations("")).rejects.toThrowError(
				/DATABASE_URL is not configured\. Please supply DATABASE_URL in \.dev\.vars/,
			);
		});

		it("runMigrations() fails closed when ambient DATABASE_URL_UNPOOLED points to unauthorized target", async () => {
			const origUnpooled = process.env.DATABASE_URL_UNPOOLED;
			const origFetch = globalThis.fetch;
			try {
				process.env.DATABASE_URL_UNPOOLED =
					"postgresql://ambient:pass@ep-ambient.aws.neon.tech/neondb?sslmode=require";
				globalThis.fetch = async () =>
					new Response(
						JSON.stringify({
							fields: [{ name: "branch_id", dataTypeID: 25 }],
							rows: [["br-unauthorized-target"]],
						}),
						{ status: 200, headers: { "Content-Type": "application/json" } },
					);
				await expect(runMigrations()).rejects.toThrowError(
					/Unauthorized database target/,
				);
			} finally {
				globalThis.fetch = origFetch;
				if (origUnpooled !== undefined) {
					process.env.DATABASE_URL_UNPOOLED = origUnpooled;
				} else {
					delete process.env.DATABASE_URL_UNPOOLED;
				}
			}
		});

		it("runMigrations() rejects unreachable network target before running any migrations", async () => {
			await expect(
				runMigrations(
					"postgresql://unreachable:pass@ep-unreachable.invalid/neondb?sslmode=require",
				),
			).rejects.toThrowError(
				/Preflight verification failed connecting to target database/,
			);
		});

		it("sanitizes database error messages and redacts connection strings and credentials", () => {
			const secret = "SUPER_SECRET_PASSWORD_MARKER_999";
			const rawError = new Error(
				`Failed connecting to postgresql://admin:${secret}@ep-test.aws.neon.tech:5432/neondb?sslmode=require`,
			);
			const sanitized = sanitizeDatabaseError(rawError);
			expect(sanitized).not.toContain(secret);
			expect(sanitized).toContain("[REDACTED_DATABASE_URL]");
		});

		it("migration CLI process does not leak credentials to stdout or stderr on failure", () => {
			const secretMarker = "SYNTHETIC_PASSWORD_MARKER_XYZ123";
			const malformedUrl = `postgresql://user:${secretMarker}@ep-invalid.aws.neon.tech:badport/neondb`;

			const child = spawnSync(
				process.execPath,
				["node_modules/tsx/dist/cli.mjs", "src/db/migrate.ts"],
				{
					env: {
						...process.env,
						DATABASE_URL: malformedUrl,
						DATABASE_URL_UNPOOLED: malformedUrl,
					},
					encoding: "utf8",
				},
			);

			expect(child.status).toBe(1);
			expect(child.stdout).not.toContain(secretMarker);
			expect(child.stderr).not.toContain(secretMarker);
			expect(child.stderr).toContain("[REDACTED_DATABASE_URL]");
		});
	});

	describe("Transactional migration failure and retry regression", () => {
		it("rolls back partial DDL and journal entries atomically on migration statement failure, then succeeds on retry", async () => {
			const runKey = crypto.randomUUID().slice(0, 8);
			const testSchema = `test_mig_${runKey}`;
			const tempDir = fs.mkdtempSync(
				path.join(os.tmpdir(), "rangkai-mig-tx-test-"),
			);
			const metaDir = path.join(tempDir, "meta");
			fs.mkdirSync(metaDir, { recursive: true });

			const t0 = 1000000000000;
			const t1 = 1000000001000;

			// Migration 0: valid table creation
			const m0Sql = `CREATE TABLE ${testSchema}.sample_zero (id text PRIMARY KEY);`;
			fs.writeFileSync(path.join(tempDir, "0000_zero.sql"), m0Sql, "utf8");

			// Migration 1: valid statement followed by invalid syntax statement (fails mid-migration)
			const m1SqlFail = `CREATE TABLE ${testSchema}.sample_one (id text PRIMARY KEY);--> statement-breakpoint\nINVALID SQL SYNTAX FAILS;`;
			fs.writeFileSync(path.join(tempDir, "0001_one.sql"), m1SqlFail, "utf8");

			const journal = {
				version: "7",
				dialect: "postgresql",
				entries: [
					{ idx: 0, version: "7", when: t0, tag: "0000_zero", breakpoints: true },
					{ idx: 1, version: "7", when: t1, tag: "0001_one", breakpoints: true },
				],
			};
			fs.writeFileSync(
				path.join(metaDir, "_journal.json"),
				JSON.stringify(journal),
				"utf8",
			);

			try {
				await db.execute(sql.raw(`CREATE SCHEMA ${testSchema};`));

				// Step 1: Execute migrations; migration 0 succeeds, migration 1 fails mid-flight
				await expect(
					runMigrations(pinnedUrl, {
						migrationsFolder: tempDir,
						migrationsSchema: testSchema,
					}),
				).rejects.toThrowError(/Migration execution failed/);

				// Assert transactional rollback: sample_one MUST NOT exist in schema
				const checkSampleOne = await db.execute(
					sql.raw(`SELECT to_regclass('${testSchema}.sample_one') as tbl;`),
				);
				expect(checkSampleOne.rows[0]?.tbl).toBeNull();

				// Assert journal rollback: 0001 MUST NOT be recorded in __drizzle_migrations
				const checkJournal = await db.execute(
					sql.raw(`SELECT * FROM ${testSchema}.__drizzle_migrations;`),
				);
				expect(
					checkJournal.rows.some((r) => String(r.created_at) === String(t1)),
				).toBe(false);

				// Step 2: Fix migration 1 to be completely valid DDL
				const m1SqlFixed = `CREATE TABLE ${testSchema}.sample_one (id text PRIMARY KEY);`;
				fs.writeFileSync(path.join(tempDir, "0001_one.sql"), m1SqlFixed, "utf8");

				// Step 3: Retry migration; should succeed cleanly
				const retryResult = await runMigrations(pinnedUrl, {
					migrationsFolder: tempDir,
					migrationsSchema: testSchema,
				});
				expect(retryResult.branchId).toBe(AUTHORIZED_DEV_BRANCH);

				// Verify sample_one was created
				const checkSampleOneAfter = await db.execute(
					sql.raw(`SELECT to_regclass('${testSchema}.sample_one') as tbl;`),
				);
				expect(checkSampleOneAfter.rows[0]?.tbl).not.toBeNull();

				// Verify 0001 is now recorded in journal
				const checkJournalAfter = await db.execute(
					sql.raw(`SELECT * FROM ${testSchema}.__drizzle_migrations;`),
				);
				expect(
					checkJournalAfter.rows.some(
						(r) => String(r.created_at) === String(t1),
					),
				).toBe(true);
			} finally {
				await db.execute(sql.raw(`DROP SCHEMA IF EXISTS ${testSchema} CASCADE;`));
				fs.rmSync(tempDir, { recursive: true, force: true });
			}
		});
	});

	describe("Database schema & catalog verification", () => {
		it("runs verifyDatabase() and confirms branch, PostGIS, tables, geometry, indexes, constraints on real DB", async () => {
			const result = await verifyDatabase(db);
			expect(result.branchId).toBe(AUTHORIZED_DEV_BRANCH);
			expect(result.postgisVersion).toMatch(/^3\./);
			expect(result.tableNames.length).toBeGreaterThanOrEqual(17);
			expect(result.geometries.length).toBe(2);
			expect(result.indexes.length).toBeGreaterThanOrEqual(10);
			expect(result.constraints.length).toBeGreaterThanOrEqual(100);
		});

		it("accepts valid catalog mock matching required schema structure", async () => {
			const mockDb = createMockCatalogDb();
			const result = await verifyDatabase(mockDb);
			expect(result.branchId).toBe(AUTHORIZED_DEV_BRANCH);
			expect(result.geometries.length).toBe(2);
		});

		it("rejects verification if PostGIS extension is missing or incompatible", async () => {
			const mockDb = createMockCatalogDb({ postgisVersion: "2.5.0" });
			await expect(verifyDatabase(mockDb)).rejects.toThrowError(
				/PostGIS 3\.x is required/,
			);
		});

		it("rejects verification if required application tables are missing", async () => {
			const mockDb = createMockCatalogDb({ tables: ["events"] });
			await expect(verifyDatabase(mockDb)).rejects.toThrowError(
				/missing required application table\(s\)/,
			);
		});

		it("rejects verification if geometry column has wrong type or SRID", async () => {
			const mockDbWrongType = createMockCatalogDb({
				geometryColumns: [
					{
						f_table_name: "road_segments",
						f_geometry_column: "geom",
						type: "POLYGON",
						srid: 4326,
					},
					{
						f_table_name: "cleanup_tasks",
						f_geometry_column: "location",
						type: "POINT",
						srid: 4326,
					},
				],
			});
			await expect(verifyDatabase(mockDbWrongType)).rejects.toThrowError(
				/expected type LINESTRING SRID 4326, found type POLYGON SRID 4326/,
			);

			const mockDbWrongSrid = createMockCatalogDb({
				geometryColumns: [
					{
						f_table_name: "road_segments",
						f_geometry_column: "geom",
						type: "LINESTRING",
						srid: 3857,
					},
					{
						f_table_name: "cleanup_tasks",
						f_geometry_column: "location",
						type: "POINT",
						srid: 4326,
					},
				],
			});
			await expect(verifyDatabase(mockDbWrongSrid)).rejects.toThrowError(
				/expected type LINESTRING SRID 4326, found type LINESTRING SRID 3857/,
			);
		});

		it("rejects verification if required index is missing or on wrong table", async () => {
			const mockDbMissingIndex = createMockCatalogDb({ indexes: [] });
			await expect(
				verifyDatabase(mockDbMissingIndex),
			).rejects.toThrowError(/missing required index/);

			const mockDbWrongTable = createMockCatalogDb({
				indexes: VALID_CATALOG.indexes.map((i) => ({
					...i,
					tablename: "wrong_table",
				})),
			});
			await expect(verifyDatabase(mockDbWrongTable)).rejects.toThrowError(
				/expected on table 'audit_logs', found on 'wrong_table'/,
			);
		});

		it("rejects verification if documents_event_id_idx indexes wrong column (e.g. uploaded_by)", async () => {
			const mockDbWrongColumn = createMockCatalogDb({
				indexes: VALID_CATALOG.indexes.map((i) =>
					i.indexname === "documents_event_id_idx"
						? {
								...i,
								indexdef:
									"CREATE INDEX documents_event_id_idx ON public.documents USING btree (uploaded_by)",
							}
						: i,
				),
			});
			await expect(
				verifyDatabase(mockDbWrongColumn),
			).rejects.toThrowError(
				/index 'documents_event_id_idx' key column mismatch at position 0: expected 'event_id', found 'uploaded_by'/,
			);
		});

		it("rejects verification if documents_event_id_idx uses hash access method instead of btree", async () => {
			const mockDbHashMethod = createMockCatalogDb({
				indexes: VALID_CATALOG.indexes.map((i) =>
					i.indexname === "documents_event_id_idx"
						? {
								...i,
								indexdef:
									"CREATE INDEX documents_event_id_idx ON public.documents USING hash (event_id)",
							}
						: i,
				),
			});
			await expect(
				verifyDatabase(mockDbHashMethod),
			).rejects.toThrowError(
				/index 'documents_event_id_idx' expected access method 'btree', found 'hash'/,
			);
		});

		it("rejects verification if spatial index uses btree instead of gist", async () => {
			const mockDbWrongMethod = createMockCatalogDb({
				indexes: VALID_CATALOG.indexes.map((i) =>
					i.indexname === "road_segments_geom_gist_idx"
						? {
								...i,
								indexdef:
									"CREATE INDEX road_segments_geom_gist_idx ON public.road_segments USING btree (geom)",
							}
						: i,
				),
			});
			await expect(
				verifyDatabase(mockDbWrongMethod),
			).rejects.toThrowError(
				/index 'road_segments_geom_gist_idx' expected access method 'gist', found 'btree'/,
			);
		});

		it("rejects verification if constraints are missing, on wrong table, or have wrong type", async () => {
			const mockDbNoConstraints = createMockCatalogDb({
				constraints: [],
			});
			await expect(
				verifyDatabase(mockDbNoConstraints),
			).rejects.toThrowError(/no application constraints found/);

			const mockDbWrongTable = createMockCatalogDb({
				constraints: VALID_CATALOG.constraints.map((c) => ({
					...c,
					table_name: "wrong_table",
				})),
			});
			await expect(verifyDatabase(mockDbWrongTable)).rejects.toThrowError(
				/expected on table/,
			);

			const mockDbWrongType = createMockCatalogDb({
				constraints: VALID_CATALOG.constraints.map((c) =>
					c.constraint_name === "events_status_check"
						? { ...c, constraint_type: "u" }
						: c,
				),
			});
			await expect(verifyDatabase(mockDbWrongType)).rejects.toThrowError(
				/constraint 'events_status_check' expected type 'c', found 'u'/,
			);
		});

		it("rejects verification if check constraint is weakened (e.g. CHECK (true))", async () => {
			const mockDbWeakenedCheck = createMockCatalogDb({
				constraints: VALID_CATALOG.constraints.map((c) =>
					c.constraint_name === "events_status_check"
						? { ...c, constraint_def: "CHECK (true)" }
						: c,
				),
			});
			await expect(
				verifyDatabase(mockDbWeakenedCheck),
			).rejects.toThrowError(
				/constraint 'events_status_check' definition failed validation/,
			);
		});

		it("rejects verification if road_status_updates foreign key uses CASCADE instead of RESTRICT", async () => {
			const mockDbCascadeFk = createMockCatalogDb({
				constraints: VALID_CATALOG.constraints.map((c) =>
					c.constraint_name ===
					"road_status_updates_road_impact_id_road_impacts_id_fk"
						? {
								...c,
								constraint_def:
									"FOREIGN KEY (road_impact_id) REFERENCES road_impacts(id) ON DELETE CASCADE",
							}
						: c,
				),
			});
			await expect(verifyDatabase(mockDbCascadeFk)).rejects.toThrowError(
				/constraint 'road_status_updates_road_impact_id_road_impacts_id_fk' definition failed validation/,
			);
		});
	});

	describe("Isolated fixture mutation & constraint enforcement", () => {
		it("enforces events date check constraint (ends_at > starts_at)", async () => {
			const ids = createRunIds();
			try {
				await db.insert(organizations).values({
					id: ids.orgId,
					name: "Test Org Date Check",
				});
				await db.insert(user).values({
					id: ids.userId,
					name: "Tester Date",
					email: `${ids.userId}@test.local`,
					emailVerified: true,
				});

				// Invalid: endsAt before startsAt
				await expect(
					db.insert(events).values({
						id: ids.eventId,
						organizationId: ids.orgId,
						createdBy: ids.userId,
						title: "Invalid Date Event",
						startsAt: new Date("2026-11-10T12:00:00Z"),
						endsAt: new Date("2026-11-10T10:00:00Z"),
					}),
				).rejects.toThrow();
			} finally {
				await db.delete(events).where(eq(events.id, ids.eventId));
				await db.delete(organizations).where(eq(organizations.id, ids.orgId));
				await db.delete(user).where(eq(user.id, ids.userId));
			}
		});

		it("enforces events status domain check constraint", async () => {
			const ids = createRunIds();
			try {
				await db.insert(organizations).values({
					id: ids.orgId,
					name: "Test Org Status Check",
				});
				await db.insert(user).values({
					id: ids.userId,
					name: "Tester Status",
					email: `${ids.userId}@test.local`,
					emailVerified: true,
				});

				// Invalid status value
				await expect(
					db.insert(events).values({
						id: ids.eventId,
						organizationId: ids.orgId,
						createdBy: ids.userId,
						title: "Invalid Status Event",
						status: "non_existent_status" as unknown as EventStatus,
					}),
				).rejects.toThrow();
			} finally {
				await db.delete(events).where(eq(events.id, ids.eventId));
				await db.delete(organizations).where(eq(organizations.id, ids.orgId));
				await db.delete(user).where(eq(user.id, ids.userId));
			}
		});

		it("enforces road_impacts date check constraint (planned_to > planned_from)", async () => {
			const ids = createRunIds();
			const impactId = crypto.randomUUID();

			try {
				await db.insert(organizations).values({
					id: ids.orgId,
					name: "Test Org Impact Time",
				});
				await db.insert(user).values({
					id: ids.userId,
					name: "Tester Impact Time",
					email: `${ids.userId}@test.local`,
					emailVerified: true,
				});
				await db.insert(events).values({
					id: ids.eventId,
					organizationId: ids.orgId,
					createdBy: ids.userId,
					title: "Test Event Impact Time",
				});
				await db.insert(roadSegments).values({
					id: ids.segmentId,
					displayName: "Jl. Test Segment Time",
					coverageArea: "Denpasar Selatan",
					geom: "SRID=4326;LINESTRING(115.2166 -8.6500, 115.2180 -8.6520)",
				});

				// Invalid: plannedTo before plannedFrom
				await expect(
					db.insert(roadImpacts).values({
						id: impactId,
						eventId: ids.eventId,
						roadSegmentId: ids.segmentId,
						plannedFrom: new Date("2026-11-10T12:00:00Z"),
						plannedTo: new Date("2026-11-10T10:00:00Z"),
						impactType: "closure",
					}),
				).rejects.toThrow();
			} finally {
				await db.delete(roadImpacts).where(eq(roadImpacts.id, impactId));
				await db
					.delete(roadSegments)
					.where(eq(roadSegments.id, ids.segmentId));
				await db.delete(events).where(eq(events.id, ids.eventId));
				await db.delete(organizations).where(eq(organizations.id, ids.orgId));
				await db.delete(user).where(eq(user.id, ids.userId));
			}
		});

		it("enforces waste_records check constraint (requires quantity_kg or sack_count)", async () => {
			const ids = createRunIds();
			const wasteId = crypto.randomUUID();

			try {
				await db.insert(organizations).values({
					id: ids.orgId,
					name: "Test Org Waste Check",
				});
				await db.insert(user).values({
					id: ids.userId,
					name: "Tester Waste Check",
					email: `${ids.userId}@test.local`,
					emailVerified: true,
				});
				await db.insert(events).values({
					id: ids.eventId,
					organizationId: ids.orgId,
					createdBy: ids.userId,
					title: "Test Event Waste Check",
				});

				// Invalid: both quantityKg and sackCount are null
				await expect(
					db.insert(wasteRecords).values({
						id: wasteId,
						eventId: ids.eventId,
						category: "organic",
						measurementMethod: "estimated",
						recordedBy: ids.userId,
					}),
				).rejects.toThrow();
			} finally {
				await db.delete(wasteRecords).where(eq(wasteRecords.id, wasteId));
				await db.delete(events).where(eq(events.id, ids.eventId));
				await db.delete(organizations).where(eq(organizations.id, ids.orgId));
				await db.delete(user).where(eq(user.id, ids.userId));
			}
		});

		it("prevents cascade deletion of road_status_updates when road_impact is deleted (append-only history)", async () => {
			const ids = createRunIds();
			const impactId = crypto.randomUUID();
			const updateId = crypto.randomUUID();

			try {
				await db.insert(organizations).values({
					id: ids.orgId,
					name: "Test Org Restrict Check",
				});
				await db.insert(user).values({
					id: ids.userId,
					name: "Tester Restrict",
					email: `${ids.userId}@test.local`,
					emailVerified: true,
				});
				await db.insert(events).values({
					id: ids.eventId,
					organizationId: ids.orgId,
					createdBy: ids.userId,
					title: "Test Event Restrict Check",
				});
				await db.insert(roadSegments).values({
					id: ids.segmentId,
					displayName: "Jl. Restrict Segment",
					coverageArea: "Denpasar Selatan",
					geom: "SRID=4326;LINESTRING(115.2166 -8.6500, 115.2180 -8.6520)",
				});
				await db.insert(roadImpacts).values({
					id: impactId,
					eventId: ids.eventId,
					roadSegmentId: ids.segmentId,
					plannedFrom: new Date("2026-11-10T08:00:00Z"),
					plannedTo: new Date("2026-11-10T12:00:00Z"),
					impactType: "closure",
				});
				await db.insert(roadStatusUpdates).values({
					id: updateId,
					roadImpactId: impactId,
					status: "closed",
					observedAt: new Date("2026-11-10T08:15:00Z"),
					expiresAt: new Date("2026-11-10T12:00:00Z"),
					updatedBy: ids.userId,
					mutationId: ids.mutationId,
				});

				// Deleting roadImpact MUST fail because roadStatusUpdates has ON DELETE RESTRICT
				await expect(
					db.delete(roadImpacts).where(eq(roadImpacts.id, impactId)),
				).rejects.toThrow();
			} finally {
				// Clean up in reverse dependency order
				await db
					.delete(roadStatusUpdates)
					.where(eq(roadStatusUpdates.id, updateId));
				await db.delete(roadImpacts).where(eq(roadImpacts.id, impactId));
				await db
					.delete(roadSegments)
					.where(eq(roadSegments.id, ids.segmentId));
				await db.delete(events).where(eq(events.id, ids.eventId));
				await db.delete(organizations).where(eq(organizations.id, ids.orgId));
				await db.delete(user).where(eq(user.id, ids.userId));
			}
		});

		it("supports atomic batch operations with run-owned fixtures", async () => {
			const ids = createRunIds();
			const auditId = crypto.randomUUID();

			try {
				await db.insert(organizations).values({
					id: ids.orgId,
					name: "Test Org Batch Success",
				});
				await db.insert(user).values({
					id: ids.userId,
					name: "Tester Batch Success",
					email: `${ids.userId}@test.local`,
					emailVerified: true,
				});

				// Atomic batch insert: event + audit log together
				await db.batch([
					db.insert(events).values({
						id: ids.eventId,
						organizationId: ids.orgId,
						createdBy: ids.userId,
						title: "Batch Atomic Event",
					}),
					db.insert(auditLogs).values({
						id: auditId,
						organizationId: ids.orgId,
						eventId: ids.eventId,
						actorId: ids.userId,
						action: "event.created",
						entityType: "event",
						entityId: ids.eventId,
					}),
				]);

				const eventRow = await db
					.select()
					.from(events)
					.where(eq(events.id, ids.eventId));
				expect(eventRow.length).toBe(1);

				const auditRow = await db
					.select()
					.from(auditLogs)
					.where(eq(auditLogs.id, auditId));
				expect(auditRow.length).toBe(1);
			} finally {
				await db.delete(auditLogs).where(eq(auditLogs.id, auditId));
				await db.delete(events).where(eq(events.id, ids.eventId));
				await db.delete(organizations).where(eq(organizations.id, ids.orgId));
				await db.delete(user).where(eq(user.id, ids.userId));
			}
		});

		it("rolls back batch operations atomically without leaving run-owned records", async () => {
			const ids = createRunIds();
			const auditId = crypto.randomUUID();
			const nonExistentOrgId = crypto.randomUUID();

			try {
				await db.insert(organizations).values({
					id: ids.orgId,
					name: "Test Org Batch Rollback",
				});
				await db.insert(user).values({
					id: ids.userId,
					name: "Tester Batch Rollback",
					email: `${ids.userId}@test.local`,
					emailVerified: true,
				});

				// Batch with valid first statement and invalid second statement (FK violation)
				await expect(
					db.batch([
						db.insert(events).values({
							id: ids.eventId,
							organizationId: ids.orgId,
							createdBy: ids.userId,
							title: "Rolled Back Event",
						}),
						db.insert(auditLogs).values({
							id: auditId,
							organizationId: nonExistentOrgId, // Fails foreign key constraint
							actorId: ids.userId,
							action: "event.created",
							entityType: "event",
							entityId: ids.eventId,
						}),
					]),
				).rejects.toThrow();

				// Verify first statement was rolled back
				const eventRow = await db
					.select()
					.from(events)
					.where(eq(events.id, ids.eventId));
				expect(eventRow.length).toBe(0);
			} finally {
				await db.delete(auditLogs).where(eq(auditLogs.id, auditId));
				await db.delete(events).where(eq(events.id, ids.eventId));
				await db.delete(organizations).where(eq(organizations.id, ids.orgId));
				await db.delete(user).where(eq(user.id, ids.userId));
			}
		});
	});

	describe("Isolated Hono handler database smoke (Node test harness)", () => {
		it("executes database queries through an in-memory Hono handler without deployable public routes", async () => {
			// ponytail: isolated test-only harness verifying in-memory Hono handler database query execution
			const testApp = new Hono<{ Bindings: { DATABASE_URL: string } }>();
			testApp.get("/test/db-smoke", async (c) => {
				const testDb = getDb(c.env.DATABASE_URL);
				const res = await testDb.execute<{ branch_id: string }>(
					sql`SELECT current_setting('neon.branch_id', true) AS branch_id`,
				);
				return c.json({ branchId: res.rows[0]?.branch_id });
			});

			const res = await testApp.request(
				"/test/db-smoke",
				{},
				{ DATABASE_URL: pinnedUrl },
			);
			expect(res.status).toBe(200);
			const body = (await res.json()) as { branchId: string };
			expect(body.branchId).toBe(AUTHORIZED_DEV_BRANCH);
		});
	});
});
