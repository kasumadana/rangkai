import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Hono } from "hono";
import { sql } from "drizzle-orm";
import { assertDevBranch } from "../../src/db/guard";
import { getDb, type DbClient } from "../../src/db";
import { territoriesRouter } from "../../src/worker/routes/territories";
import { roadsRouter } from "../../src/worker/routes/roads";
import type { AppVariables, Env } from "../../src/worker/types";

const suffix = crypto.randomUUID();
const adminId = `territory-admin-${suffix}`;
const orgId = crypto.randomUUID();
const eventId = crypto.randomUUID();
const insideSegmentId = crypto.randomUUID();
const crossingSegmentId = crypto.randomUUID();
let db: DbClient;

const app = new Hono<{ Bindings: Env; Variables: AppVariables }>();
app.use("*", async (c, next) => {
	const actorId = c.req.header("x-test-user");
	c.set("db", db);
	c.set("requestId", "synthetic-territory-test");
	c.set("auth", { api: { getSession: async () => actorId ? { user: { id: actorId, email: `${actorId}@test.invalid` }, session: { id: "test-session", userId: actorId } } : null } } as never);
	await next();
});
app.route("/api/admin", territoriesRouter);
app.route("/api", roadsRouter);

const request = (path: string, body?: unknown, actor = adminId) => app.request(path, {
	method: body === undefined ? "GET" : "POST",
	headers: { ...(actor ? { "x-test-user": actor } : {}), ...(body === undefined ? {} : { "content-type": "application/json" }) },
	...(body === undefined ? {} : { body: JSON.stringify(body) }),
});

const square = { type: "Polygon", coordinates: [[[115, -9], [116, -9], [116, -8], [115, -8], [115, -9]]] };

beforeAll(async () => {
	const guarded = await assertDevBranch();
	db = getDb(guarded.pinnedUrl);
	await db.execute(sql`INSERT INTO "user" (id,name,email) VALUES (${adminId},'Synthetic territory admin',${adminId + "@test.invalid"})`);
	await db.execute(sql`INSERT INTO platform_grants(user_id,role,status) VALUES (${adminId},'superadmin','active')`);
	await db.execute(sql`INSERT INTO organizations(id,name,village,district) VALUES (${orgId},${"SYNTHETIC_TEST_DATA territory org " + suffix},'Uji','Denpasar')`);
	await db.execute(sql`INSERT INTO memberships(organization_id,user_id,role) VALUES (${orgId},${adminId},'organizer')`);
	await db.execute(sql`INSERT INTO events(id,organization_id,created_by,title,status,is_simulation) VALUES (${eventId},${orgId},${adminId},${"SYNTHETIC_TEST_DATA territory event " + suffix},'draft',false)`);
	await db.execute(sql`INSERT INTO road_segments(id,display_name,geom,coverage_area,source_type,created_by,verified_by,verified_at) VALUES (${insideSegmentId},'SYNTHETIC_TEST_DATA inside',ST_GeomFromText('LINESTRING(115.1 -8.5,115.9 -8.5)',4326),'Uji','catalog',${adminId},${adminId},now()),(${crossingSegmentId},'SYNTHETIC_TEST_DATA crossing',ST_GeomFromText('LINESTRING(115.1 -8.5,116.1 -8.5)',4326),'Uji','catalog',${adminId},${adminId},now())`);
});

afterAll(async () => {
	if (!db) return;
	await db.execute(sql`DELETE FROM platform_audit WHERE actor_id=${adminId} OR entity_id IN (SELECT id::text FROM organization_territory_versions WHERE organization_id=${orgId})`);
	await db.execute(sql`DELETE FROM organization_territory_versions WHERE organization_id=${orgId}`);
	await db.execute(sql`DELETE FROM road_impacts WHERE event_id=${eventId}`);
	await db.execute(sql`DELETE FROM road_segments WHERE id IN (${insideSegmentId},${crossingSegmentId})`);
	await db.execute(sql`DELETE FROM memberships WHERE organization_id=${orgId} AND user_id=${adminId}`);
	await db.execute(sql`DELETE FROM events WHERE id=${eventId}`);
	await db.execute(sql`DELETE FROM platform_grants WHERE user_id=${adminId}`);
	await db.execute(sql`DELETE FROM organizations WHERE id=${orgId}`);
	await db.execute(sql`DELETE FROM session WHERE user_id=${adminId}`);
	await db.execute(sql`DELETE FROM "user" WHERE id=${adminId}`);
});

describe("superadmin territory versions and PostGIS geometry checks", () => {
	it("stores imported geometry pending, rejects ambiguous CRS, and requires a superadmin to verify", async () => {
		const unauthorized = await request(`/api/admin/organizations/${orgId}/territories`, { geojson: square, sourceType: "synthetic", sourceLabel: "SIMULASI", isSimulation: true }, "unknown-user");
		expect(unauthorized.status).toBe(403);
		const ambiguous = await request(`/api/admin/organizations/${orgId}/territories`, { geojson: { ...square, crs: { type: "name", properties: { name: "EPSG:3857" } } }, sourceType: "imported", sourceLabel: "Dataset sumber" });
		expect(ambiguous.status).toBe(422);
		const synthetic = await request(`/api/admin/organizations/${orgId}/territories`, { geojson: square, sourceType: "synthetic", sourceLabel: "SIMULASI kawasan pilot", isSimulation: true });
		expect(synthetic.status).toBe(201);
		const saved = (await synthetic.json() as { territory: { id: string; version: number; status: string; content_hash: string; is_simulation: boolean } }).territory;
		expect(saved).toMatchObject({ version: 1, status: "pending_verification", is_simulation: true });
		expect(saved.content_hash).toMatch(/^[a-f0-9]{64}$/);
		const dbRow = await db.execute(sql`SELECT ST_GeometryType(geom) AS type, ST_IsValid(geom) AS valid, status, is_simulation FROM organization_territory_versions WHERE id=${saved.id}`);
		expect(dbRow.rows[0]).toMatchObject({ type: "ST_MultiPolygon", valid: true, status: "pending_verification", is_simulation: true });
		const verify = await request(`/api/admin/organizations/${orgId}/territories/${saved.id}/verify`, { reason: "Tinjauan internal untuk pengujian sintetis." });
		expect(verify.status).toBe(200);
		const audit = await db.execute(sql`SELECT action FROM platform_audit WHERE entity_type='organization_territory_version' AND entity_id=${saved.id} ORDER BY created_at`);
		expect(audit.rows.map(row => row.action)).toEqual(["territory.version.created", "territory.version.verified"]);
		const impactPayload = (roadSegmentId: string) => ({ roadSegmentId, plannedFrom: "2026-12-01T02:00:00Z", plannedTo: "2026-12-01T03:00:00Z", impactType: "closure" });
		const insideImpact = await request(`/api/events/${eventId}/road-impacts`, impactPayload(insideSegmentId));
		expect(insideImpact.status).toBe(201);
		const crossingImpact = await request(`/api/events/${eventId}/road-impacts`, impactPayload(crossingSegmentId));
		expect(crossingImpact.status).toBe(422);
		expect((await crossingImpact.json() as { error: { message: string } }).error.message).toContain("Seluruh geometri ruas");
	});

	it("checks every point of LineStrings, including holes, concave exits, boundary touches and disconnected parts", async () => {
		const covering = (line: string, polygon: unknown) => db.execute(sql`WITH shape AS (SELECT ST_SetSRID(ST_GeomFromText(${line}),4326) AS line, ST_Multi(ST_SetSRID(ST_GeomFromGeoJSON(${JSON.stringify(polygon)}),4326))::geometry(MultiPolygon,4326) AS area) SELECT ST_CoveredBy(line,area) AS covered FROM shape`);
		const inside = await covering("LINESTRING(115.1 -8.9,115.9 -8.9)", square);
		expect(inside.rows[0].covered).toBe(true);
		const crossing = await covering("LINESTRING(114.9 -8.5,115.5 -8.5,116.1 -8.5)", square);
		expect(crossing.rows[0].covered).toBe(false);
		const edge = await covering("LINESTRING(115 -8.8,115 -8.2)", square);
		expect(edge.rows[0].covered).toBe(true);
		const withHole = { type: "Polygon", coordinates: [[[115, -9], [116, -9], [116, -8], [115, -8], [115, -9]], [[115.4, -8.6], [115.6, -8.6], [115.6, -8.4], [115.4, -8.4], [115.4, -8.6]]] };
		const hole = await covering("LINESTRING(115.45 -8.5,115.55 -8.5)", withHole);
		expect(hole.rows[0].covered).toBe(false);
		const concave = { type: "Polygon", coordinates: [[[115, -9], [116, -9], [116, -8.8], [115.2, -8.8], [115.2, -8], [115, -8], [115, -9]]] };
		const concaveExit = await covering("LINESTRING(115.1 -8.2,115.8 -8.9)", concave);
		expect(concaveExit.rows[0].covered).toBe(false);
		const split = { type: "MultiPolygon", coordinates: [[[[115, -9], [115.4, -9], [115.4, -8.6], [115, -8.6], [115, -9]]], [[[115.6, -9], [116, -9], [116, -8.6], [115.6, -8.6], [115.6, -9]]]] };
		const disconnected = await covering("LINESTRING(115.1 -8.8,115.9 -8.8)", split);
		expect(disconnected.rows[0].covered).toBe(false);
	});
});
