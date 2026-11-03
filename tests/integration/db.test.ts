import crypto from "node:crypto";
import * as dotenv from "dotenv";
import { eq, sql } from "drizzle-orm";
import { Hono } from "hono";
import { beforeAll, describe, expect, it } from "vitest";
import { assertDevBranch, AUTHORIZED_DEV_BRANCH } from "../../src/db/guard";
import { getDb, type DbClient } from "../../src/db/index";
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

	describe("Target branch and connection guards", () => {
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
			// Test negative guard assertion using a mock or mismatched branch target
			const mockDb = {
				execute: async () => ({
					rows: [{ branch_id: "br-wrong-production-branch" }],
				}),
			} as unknown as DbClient;

			await expect(
				verifyDatabase(mockDb, AUTHORIZED_DEV_BRANCH),
			).rejects.toThrowError(/expected Neon branch 'br-wandering-paper-aogdxs48'/);
		});
	});

	describe("Database schema & catalog verification", () => {
		it("runs verifyDatabase() and confirms branch, PostGIS, tables, indexes, constraints", async () => {
			const result = await verifyDatabase(db);
			expect(result.branchId).toBe(AUTHORIZED_DEV_BRANCH);
			expect(result.postgisVersion).toMatch(/^3\./);
			expect(result.tableNames.length).toBeGreaterThanOrEqual(17);
			expect(result.indexes.length).toBeGreaterThanOrEqual(10);
			expect(result.constraints.length).toBeGreaterThanOrEqual(100);
		});

		it("rejects verification if PostGIS extension is missing or incompatible", async () => {
			const mockDb = {
				execute: async (query: unknown) => {
					const str = JSON.stringify(query);
					if (str.includes("neon.branch_id")) {
						return { rows: [{ branch_id: AUTHORIZED_DEV_BRANCH }] };
					}
					if (str.includes("pg_extension")) {
						return { rows: [] }; // missing PostGIS
					}
					return { rows: [] };
				},
			} as unknown as DbClient;

			await expect(verifyDatabase(mockDb)).rejects.toThrowError(
				/PostGIS 3\.x is required/,
			);
		});

		it("rejects verification if required application tables are missing", async () => {
			const mockDb = {
				execute: async (query: unknown) => {
					const str = JSON.stringify(query);
					if (str.includes("neon.branch_id")) {
						return { rows: [{ branch_id: AUTHORIZED_DEV_BRANCH }] };
					}
					if (str.includes("pg_extension")) {
						return { rows: [{ extname: "postgis", extversion: "3.6.4" }] };
					}
					if (str.includes("information_schema.tables")) {
						return { rows: [{ table_name: "events" }] }; // only 1 table
					}
					return { rows: [] };
				},
			} as unknown as DbClient;

			await expect(verifyDatabase(mockDb)).rejects.toThrowError(
				/missing required application table\(s\)/,
			);
		});

		it("rejects verification if required indexes are missing", async () => {
			const mockDb = {
				execute: async (query: unknown) => {
					const str = JSON.stringify(query);
					if (str.includes("neon.branch_id")) {
						return { rows: [{ branch_id: AUTHORIZED_DEV_BRANCH }] };
					}
					if (str.includes("pg_extension")) {
						return { rows: [{ extname: "postgis", extversion: "3.6.4" }] };
					}
					if (str.includes("information_schema.tables")) {
						return {
							rows: [
								{ table_name: "account" },
								{ table_name: "ai_extractions" },
								{ table_name: "audit_logs" },
								{ table_name: "cleanup_evidence" },
								{ table_name: "cleanup_tasks" },
								{ table_name: "documents" },
								{ table_name: "event_assignments" },
								{ table_name: "events" },
								{ table_name: "memberships" },
								{ table_name: "organizations" },
								{ table_name: "road_impacts" },
								{ table_name: "road_segments" },
								{ table_name: "road_status_updates" },
								{ table_name: "session" },
								{ table_name: "user" },
								{ table_name: "verification" },
								{ table_name: "waste_records" },
							],
						};
					}
					if (str.includes("pg_indexes")) {
						return { rows: [] }; // missing indexes
					}
					return { rows: [] };
				},
			} as unknown as DbClient;

			await expect(verifyDatabase(mockDb)).rejects.toThrowError(
				/missing required index\(es\)/,
			);
		});

		it("rejects verification if required constraints are missing", async () => {
			const mockDb = {
				execute: async (query: unknown) => {
					const str = JSON.stringify(query);
					if (str.includes("neon.branch_id")) {
						return { rows: [{ branch_id: AUTHORIZED_DEV_BRANCH }] };
					}
					if (str.includes("pg_extension")) {
						return { rows: [{ extname: "postgis", extversion: "3.6.4" }] };
					}
					if (str.includes("information_schema.tables")) {
						return {
							rows: [
								{ table_name: "account" },
								{ table_name: "ai_extractions" },
								{ table_name: "audit_logs" },
								{ table_name: "cleanup_evidence" },
								{ table_name: "cleanup_tasks" },
								{ table_name: "documents" },
								{ table_name: "event_assignments" },
								{ table_name: "events" },
								{ table_name: "memberships" },
								{ table_name: "organizations" },
								{ table_name: "road_impacts" },
								{ table_name: "road_segments" },
								{ table_name: "road_status_updates" },
								{ table_name: "session" },
								{ table_name: "user" },
								{ table_name: "verification" },
								{ table_name: "waste_records" },
							],
						};
					}
					if (str.includes("pg_indexes")) {
						return {
							rows: [
								{ indexname: "audit_logs_event_created_idx" },
								{ indexname: "cleanup_tasks_event_status_idx" },
								{ indexname: "cleanup_tasks_location_gist_idx" },
								{ indexname: "documents_event_id_idx" },
								{ indexname: "events_org_starts_at_idx" },
								{ indexname: "events_status_starts_at_idx" },
								{ indexname: "road_impacts_event_id_idx" },
								{ indexname: "road_impacts_segment_planned_idx" },
								{ indexname: "road_segments_geom_gist_idx" },
								{ indexname: "road_status_updates_impact_created_idx" },
							],
						};
					}
					if (str.includes("pg_constraint")) {
						return { rows: [] }; // missing constraints
					}
					return { rows: [] };
				},
			} as unknown as DbClient;

			await expect(verifyDatabase(mockDb)).rejects.toThrowError(
				/no application constraints found/,
			);
		});
	});

	describe("Isolated fixture mutation & constraint enforcement", () => {
		it("enforces events date check constraint (ends_at > starts_at) with run-owned fixtures", async () => {
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

				// Invalid: endsAt is earlier than startsAt
				await expect(
					db.insert(events).values({
						id: ids.eventId,
						organizationId: ids.orgId,
						createdBy: ids.userId,
						title: "Invalid Event Date",
						startsAt: new Date("2026-11-10T10:00:00Z"),
						endsAt: new Date("2026-11-10T08:00:00Z"),
					}),
				).rejects.toThrow();
			} finally {
				// Clean only run-owned fixtures
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
					title: "Impact Event Test",
				});
				await db.insert(roadSegments).values({
					id: ids.segmentId,
					displayName: "Test Segment Time Check",
					geom: sql`ST_GeomFromEWKT('SRID=4326;LINESTRING(115.2 -8.6, 115.3 -8.7)')`,
					coverageArea: "Area Test",
				});

				// Invalid: plannedTo is equal to plannedFrom
				await expect(
					db.insert(roadImpacts).values({
						id: impactId,
						eventId: ids.eventId,
						roadSegmentId: ids.segmentId,
						plannedFrom: new Date("2026-11-10T08:00:00Z"),
						plannedTo: new Date("2026-11-10T08:00:00Z"),
						impactType: "closure",
					}),
				).rejects.toThrow();
			} finally {
				await db.delete(roadImpacts).where(eq(roadImpacts.id, impactId));
				await db.delete(roadSegments).where(eq(roadSegments.id, ids.segmentId));
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
					title: "Waste Event Test",
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
					name: "Test Org Restrict Status",
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
					title: "Restrict Impact Event",
				});
				await db.insert(roadSegments).values({
					id: ids.segmentId,
					displayName: "Test Segment Restrict",
					geom: sql`ST_GeomFromEWKT('SRID=4326;LINESTRING(115.2 -8.6, 115.3 -8.7)')`,
					coverageArea: "Area Restrict",
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
					observedAt: new Date("2026-11-10T08:00:00Z"),
					expiresAt: new Date("2026-11-10T09:00:00Z"),
					updatedBy: ids.userId,
					mutationId: ids.mutationId,
				});

				// Deleting roadImpact MUST be restricted because road_status_updates references it
				await expect(
					db.delete(roadImpacts).where(eq(roadImpacts.id, impactId)),
				).rejects.toThrow();
			} finally {
				// Clean only run-owned fixtures in correct dependent order
				await db.delete(roadStatusUpdates).where(eq(roadStatusUpdates.id, updateId));
				await db.delete(roadImpacts).where(eq(roadImpacts.id, impactId));
				await db.delete(roadSegments).where(eq(roadSegments.id, ids.segmentId));
				await db.delete(events).where(eq(events.id, ids.eventId));
				await db.delete(organizations).where(eq(organizations.id, ids.orgId));
				await db.delete(user).where(eq(user.id, ids.userId));
			}
		});

		it("supports atomic batch operations with run-owned fixtures", async () => {
			const ids = createRunIds();

			try {
				await db.insert(organizations).values({
					id: ids.orgId,
					name: "Test Org Atomic Batch",
				});
				await db.insert(user).values({
					id: ids.userId,
					name: "Atomic Tester",
					email: `${ids.userId}@test.local`,
					emailVerified: true,
				});

				await db.batch([
					db.insert(events).values({
						id: ids.eventId,
						organizationId: ids.orgId,
						createdBy: ids.userId,
						title: "Atomic Batch Event",
						status: "draft",
					}),
					db.insert(auditLogs).values({
						organizationId: ids.orgId,
						eventId: ids.eventId,
						actorId: ids.userId,
						action: "event:create",
						entityType: "event",
						entityId: ids.eventId,
						afterJson: { title: "Atomic Batch Event" },
					}),
				]);

				const eventRows = await db
					.select()
					.from(events)
					.where(eq(events.id, ids.eventId));
				expect(eventRows.length).toBe(1);

				const auditRows = await db
					.select()
					.from(auditLogs)
					.where(eq(auditLogs.eventId, ids.eventId));
				expect(auditRows.length).toBe(1);
			} finally {
				await db.delete(auditLogs).where(eq(auditLogs.eventId, ids.eventId));
				await db.delete(events).where(eq(events.id, ids.eventId));
				await db.delete(organizations).where(eq(organizations.id, ids.orgId));
				await db.delete(user).where(eq(user.id, ids.userId));
			}
		});

		it("rolls back batch operations atomically without leaving run-owned records", async () => {
			const ids = createRunIds();

			try {
				await db.insert(organizations).values({
					id: ids.orgId,
					name: "Test Org Rollback",
				});
				await db.insert(user).values({
					id: ids.userId,
					name: "Rollback Tester",
					email: `${ids.userId}@test.local`,
					emailVerified: true,
				});

				await expect(
					db.batch([
						db.insert(events).values({
							id: ids.eventId,
							organizationId: ids.orgId,
							createdBy: ids.userId,
							title: "Rollback Candidate Event",
							status: "draft",
						}),
						db.insert(events).values({
							id: crypto.randomUUID(),
							organizationId: crypto.randomUUID(), // non-existent org FK
							createdBy: ids.userId,
							title: "Invalid FK Event",
						}),
					]),
				).rejects.toThrow();

				const rows = await db
					.select()
					.from(events)
					.where(eq(events.id, ids.eventId));
				expect(rows.length).toBe(0);
			} finally {
				await db.delete(events).where(eq(events.id, ids.eventId));
				await db.delete(organizations).where(eq(organizations.id, ids.orgId));
				await db.delete(user).where(eq(user.id, ids.userId));
			}
		});
	});

	describe("Isolated Workers connection smoke harness", () => {
		it("executes database queries through an isolated test-only Hono harness without deployable public routes", async () => {
			// ponytail: isolated test-only harness verifying Workers Hono handler connectivity
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
