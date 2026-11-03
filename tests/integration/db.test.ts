import * as dotenv from "dotenv";
import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { getDb } from "../../src/db/index";
import {
	auditLogs,
	events,
	organizations,
	roadImpacts,
	roadSegments,
	wasteRecords,
} from "../../src/db/schema";
import { user } from "../../src/db/auth-schema";

dotenv.config({ path: ".dev.vars" });

describe("Neon + PostGIS + Drizzle Database Integration", () => {
	it("fails honestly with clear instructions when DATABASE_URL is missing", () => {
		expect(() => getDb("")).toThrowError(
			/DATABASE_URL is not configured\. Please supply DATABASE_URL in \.dev\.vars/,
		);
	});

	it("connects to the explicitly authorized Neon development branch", async () => {
		const db = getDb();
		const res = await db.execute<{ setting: string }>(
			sql`SELECT setting FROM pg_settings WHERE name = 'neon.branch_id'`,
		);
		expect(res.rows.length).toBeGreaterThan(0);
		expect(res.rows[0]?.setting).toBe("br-wandering-paper-aogdxs48");
	});

	it("verifies active PostGIS extension and spatial geometry functions", async () => {
		const db = getDb();
		const extRes = await db.execute<{ extname: string; extversion: string }>(
			sql`SELECT extname, extversion FROM pg_extension WHERE extname = 'postgis'`,
		);
		expect(extRes.rows.length).toBe(1);
		expect(extRes.rows[0]?.extname).toBe("postgis");
		expect(extRes.rows[0]?.extversion).toBeTruthy();

		// Verify spatial functions
		const pointRes = await db.execute<{ geojson: string }>(
			sql`SELECT ST_AsGeoJSON(ST_SetSRID(ST_MakePoint(115.2166, -8.6500), 4326)) as geojson`,
		);
		expect(JSON.parse(pointRes.rows[0]?.geojson as string)).toEqual({
			type: "Point",
			coordinates: [115.2166, -8.65],
		});
	});

	it("verifies all required domain and auth tables exist in the public schema", async () => {
		const db = getDb();
		const res = await db.execute<{ table_name: string }>(
			sql`SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'`,
		);
		const tables = new Set(res.rows.map((r) => r.table_name));

		const requiredTables = [
			"user",
			"session",
			"account",
			"verification",
			"organizations",
			"memberships",
			"events",
			"documents",
			"ai_extractions",
			"road_segments",
			"road_impacts",
			"road_status_updates",
			"event_assignments",
			"cleanup_tasks",
			"cleanup_evidence",
			"waste_records",
			"audit_logs",
		];

		for (const t of requiredTables) {
			expect(tables.has(t), `Table ${t} should exist`).toBe(true);
		}
	});

	it("verifies spatial GIST indexes on geometry columns", async () => {
		const db = getDb();
		const res = await db.execute<{ indexname: string; indexdef: string }>(
			sql`SELECT indexname, indexdef FROM pg_indexes WHERE schemaname = 'public' AND indexdef LIKE '%USING gist%'`,
		);
		const gistIndexes = res.rows.map((r) => r.indexname);
		expect(gistIndexes).toContain("road_segments_geom_gist_idx");
		expect(gistIndexes).toContain("cleanup_tasks_location_gist_idx");
	});

	it("enforces events date check constraint (ends_at > starts_at)", async () => {
		const db = getDb();
		const testOrgId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
		const testUserId = "usr_constraint_test_01";

		// Upsert prerequisite test org and user
		await db
			.insert(organizations)
			.values({ id: testOrgId, name: "Test Org Date Constraint" })
			.onConflictDoNothing();
		await db
			.insert(user)
			.values({
				id: testUserId,
				name: "Constraint Tester",
				email: "constraint.test@example.com",
				emailVerified: true,
			})
			.onConflictDoNothing();

		// Invalid: endsAt is earlier than startsAt
		await expect(
			db.insert(events).values({
				organizationId: testOrgId,
				createdBy: testUserId,
				title: "Invalid Event Date",
				startsAt: new Date("2026-11-10T10:00:00Z"),
				endsAt: new Date("2026-11-10T08:00:00Z"),
			}),
		).rejects.toThrow();
	});

	it("enforces road_impacts date check constraint (planned_to > planned_from)", async () => {
		const db = getDb();
		const testOrgId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
		const testUserId = "usr_constraint_test_02";
		const testEventId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
		const testSegmentId = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";

		await db
			.insert(organizations)
			.values({ id: testOrgId, name: "Test Org Impact" })
			.onConflictDoNothing();
		await db
			.insert(user)
			.values({
				id: testUserId,
				name: "Impact Tester",
				email: "impact.test@example.com",
				emailVerified: true,
			})
			.onConflictDoNothing();
		await db
			.insert(events)
			.values({
				id: testEventId,
				organizationId: testOrgId,
				createdBy: testUserId,
				title: "Impact Event Test",
			})
			.onConflictDoNothing();
		await db
			.insert(roadSegments)
			.values({
				id: testSegmentId,
				displayName: "Test Segment Impact",
				geom: sql`ST_GeomFromEWKT('SRID=4326;LINESTRING(115.2 -8.6, 115.3 -8.7)')`,
				coverageArea: "Area Test",
			})
			.onConflictDoNothing();

		// Invalid: plannedTo is equal to plannedFrom
		await expect(
			db.insert(roadImpacts).values({
				eventId: testEventId,
				roadSegmentId: testSegmentId,
				plannedFrom: new Date("2026-11-10T08:00:00Z"),
				plannedTo: new Date("2026-11-10T08:00:00Z"),
				impactType: "closure",
			}),
		).rejects.toThrow();
	});

	it("enforces waste_records check constraint (requires quantity_kg or sack_count)", async () => {
		const db = getDb();
		const testOrgId = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
		const testUserId = "usr_constraint_test_03";
		const testEventId = "ffffffff-ffff-4fff-8fff-ffffffffffff";

		await db
			.insert(organizations)
			.values({ id: testOrgId, name: "Test Org Waste" })
			.onConflictDoNothing();
		await db
			.insert(user)
			.values({
				id: testUserId,
				name: "Waste Tester",
				email: "waste.test@example.com",
				emailVerified: true,
			})
			.onConflictDoNothing();
		await db
			.insert(events)
			.values({
				id: testEventId,
				organizationId: testOrgId,
				createdBy: testUserId,
				title: "Waste Event Test",
			})
			.onConflictDoNothing();

		// Invalid: both quantityKg and sackCount are null
		await expect(
			db.insert(wasteRecords).values({
				eventId: testEventId,
				category: "organic",
				measurementMethod: "estimated",
				recordedBy: testUserId,
			}),
		).rejects.toThrow();
	});

	it("supports atomic batch operations for future event + audit mutations", async () => {
		const db = getDb();
		const testOrgId = "12121212-1212-4212-8212-121212121212";
		const testUserId = "usr_atomic_tx_test";
		const testEventId = "34343434-3434-4434-8434-343434343434";

		await db
			.insert(organizations)
			.values({ id: testOrgId, name: "Test Org Atomic Tx" })
			.onConflictDoNothing();
		await db
			.insert(user)
			.values({
				id: testUserId,
				name: "Atomic Tester",
				email: "atomic.test@example.com",
				emailVerified: true,
			})
			.onConflictDoNothing();

		// Use db.batch for atomic HTTP execution
		await db.batch([
			db
				.insert(events)
				.values({
					id: testEventId,
					organizationId: testOrgId,
					createdBy: testUserId,
					title: "Atomic Batch Event",
					status: "draft",
				})
				.onConflictDoUpdate({
					target: events.id,
					set: { title: sql`EXCLUDED.title` },
				}),
			db.insert(auditLogs).values({
				organizationId: testOrgId,
				eventId: testEventId,
				actorId: testUserId,
				action: "event:create",
				entityType: "event",
				entityId: testEventId,
				afterJson: { title: "Atomic Batch Event" },
			}),
		]);

		// Verify both persisted atomically
		const eventRows = await db
			.select()
			.from(events)
			.where(sql`${events.id} = ${testEventId}`);
		expect(eventRows.length).toBe(1);
		expect(eventRows[0]?.title).toBe("Atomic Batch Event");

		const auditRows = await db
			.select()
			.from(auditLogs)
			.where(sql`${auditLogs.eventId} = ${testEventId}`);
		expect(auditRows.length).toBeGreaterThanOrEqual(1);
		expect(auditRows[0]?.action).toBe("event:create");
	});

	it("rolls back batch operations atomically if any statement fails", async () => {
		const db = getDb();
		const testOrgId = "99999999-9999-4999-8999-999999999999";
		const testUserId = "usr_batch_rollback_test";
		const testEventId = "88888888-8888-4888-8888-888888888888";

		await db
			.insert(organizations)
			.values({ id: testOrgId, name: "Test Org Rollback" })
			.onConflictDoNothing();
		await db
			.insert(user)
			.values({
				id: testUserId,
				name: "Rollback Tester",
				email: "rollback.test@example.com",
				emailVerified: true,
			})
			.onConflictDoNothing();

		await db.delete(events).where(sql`${events.id} = ${testEventId}`);

		// Attempt atomic batch with a failing secondary statement
		await expect(
			db.batch([
				db.insert(events).values({
					id: testEventId,
					organizationId: testOrgId,
					createdBy: testUserId,
					title: "Rollback Candidate Event",
					status: "draft",
				}),
				db.insert(events).values({
					id: "00000000-0000-4000-8000-000000000000",
					organizationId: "00000000-0000-4000-8000-000000000000", // Non-existent foreign key
					createdBy: testUserId,
					title: "Invalid FK Event",
				}),
			]),
		).rejects.toThrow();

		// Verify rollback: first event was NOT persisted
		const rows = await db
			.select()
			.from(events)
			.where(sql`${events.id} = ${testEventId}`);
		expect(rows.length).toBe(0);
	});
});
