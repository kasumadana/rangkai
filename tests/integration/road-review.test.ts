import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Hono } from "hono";
import { sql } from "drizzle-orm";
import { assertDevBranch } from "../../src/db/guard";
import { getDb, type DbClient } from "../../src/db";
import { territoriesRouter } from "../../src/worker/routes/territories";
import { roadsRouter } from "../../src/worker/routes/roads";
import { reviewerTerritoryRouter } from "../../src/worker/routes/road-review";
import type { AppVariables, Env } from "../../src/worker/types";

const suffix = crypto.randomUUID();
const adminId = `roadreview-admin-${suffix}`;
const reviewerId = `roadreview-reviewer-${suffix}`;
const reviewerBId = `roadreview-reviewer-b-${suffix}`;
const orgId = crypto.randomUUID();
const eventId = crypto.randomUUID();
const insideSegmentId = crypto.randomUUID();
const crossingSegmentId = crypto.randomUUID();
let db: DbClient;
let territoryId = "";

const app = new Hono<{ Bindings: Env; Variables: AppVariables }>();
app.use("*", async (c, next) => {
  const actorId = c.req.header("x-test-user");
  c.set("db", db);
  c.set("requestId", "synthetic-road-review-test");
  c.set("auth", { api: { getSession: async () => actorId ? { user: { id: actorId, email: `${actorId}@test.invalid` }, session: { id: "test-session", userId: actorId } } : null } } as never);
  await next();
});
app.route("/api/admin", territoriesRouter);
app.route("/api", roadsRouter);
app.route("/api", reviewerTerritoryRouter);

const request = (path: string, body?: unknown, actor = adminId, method?: string) => app.request(path, {
  method: method || (body === undefined ? "GET" : "POST"),
  headers: { ...(actor ? { "x-test-user": actor } : {}), ...(body === undefined ? {} : { "content-type": "application/json" }) },
  ...(body === undefined ? {} : { body: JSON.stringify(body) }),
});

const square = { type: "Polygon", coordinates: [[[115, -9], [116, -9], [116, -8], [115, -8], [115, -9]]] };

async function createImpact(roadSegmentId: string, plannedFrom = "2026-12-01T02:00:00Z", plannedTo = "2026-12-01T03:00:00Z") {
  const res = await request(`/api/events/${eventId}/road-impacts`, { roadSegmentId, plannedFrom, plannedTo, impactType: "closure" });
  expect(res.status).toBe(201);
  const body = await res.json() as { roadImpact: { id: string } };
  expect(body.roadImpact.id).toEqual(expect.any(String));
  expect(body.roadImpact.id.length).toBeGreaterThan(0);
  return body.roadImpact.id;
}

async function submitReview(impactId: string, actor = adminId) {
  return request(`/api/events/${eventId}/road-impacts/${impactId}/review`, {}, actor);
}

beforeAll(async () => {
  const guarded = await assertDevBranch();
  db = getDb(guarded.pinnedUrl);
  await db.execute(sql`INSERT INTO "user" (id,name,email) VALUES (${adminId},'Synthetic road review admin',${adminId + "@test.invalid"}),(${reviewerId},'Synthetic reviewer',${reviewerId + "@test.invalid"}),(${reviewerBId},'Synthetic reviewer B',${reviewerBId + "@test.invalid"})`);
  await db.execute(sql`INSERT INTO platform_grants(user_id,role,status) VALUES (${adminId},'superadmin','active'),(${reviewerId},'government_reviewer','active'),(${reviewerBId},'government_reviewer','active')`);
  await db.execute(sql`INSERT INTO organizations(id,name,village,district) VALUES (${orgId},${"SYNTHETIC_TEST_DATA road review org " + suffix},'Uji','Denpasar')`);
  await db.execute(sql`INSERT INTO memberships(organization_id,user_id,role) VALUES (${orgId},${adminId},'organizer')`);
  await db.execute(sql`INSERT INTO events(id,organization_id,created_by,title,status,is_simulation,starts_at,ends_at) VALUES (${eventId},${orgId},${adminId},${"SYNTHETIC_TEST_DATA road review event " + suffix},'draft',true,'2026-12-01T00:00:00Z','2026-12-01T06:00:00Z')`);
  await db.execute(sql`INSERT INTO road_segments(id,display_name,geom,coverage_area,source_type,created_by,verified_by,verified_at) VALUES (${insideSegmentId},'SYNTHETIC_TEST_DATA inside',ST_GeomFromText('LINESTRING(115.1 -8.5,115.9 -8.5)',4326),'Uji','catalog',${adminId},${adminId},now()),(${crossingSegmentId},'SYNTHETIC_TEST_DATA crossing',ST_GeomFromText('LINESTRING(115.1 -8.5,116.1 -8.5)',4326),'Uji','catalog',${adminId},${adminId},now())`);
});

afterAll(async () => {
  if (!db) return;
  await db.execute(sql`DELETE FROM platform_audit WHERE actor_id IN (${adminId},${reviewerId},${reviewerBId}) OR entity_id IN (SELECT id::text FROM organization_territory_versions WHERE organization_id=${orgId}) OR entity_type='road_review_request'`);
  await db.execute(sql`DELETE FROM reviewer_territory_assignments WHERE user_id IN (${adminId},${reviewerId},${reviewerBId})`);
  await db.execute(sql`DELETE FROM road_review_requests WHERE event_id=${eventId}`);
  await db.execute(sql`DELETE FROM organization_territory_versions WHERE organization_id=${orgId}`);
  await db.execute(sql`DELETE FROM road_impacts WHERE event_id=${eventId}`);
  await db.execute(sql`DELETE FROM road_segments WHERE id IN (${insideSegmentId},${crossingSegmentId})`);
  await db.execute(sql`DELETE FROM memberships WHERE organization_id=${orgId} AND user_id=${adminId}`);
  await db.execute(sql`DELETE FROM events WHERE id=${eventId}`);
  await db.execute(sql`DELETE FROM platform_grants WHERE user_id IN (${adminId},${reviewerId},${reviewerBId})`);
  await db.execute(sql`DELETE FROM organizations WHERE id=${orgId}`);
  await db.execute(sql`DELETE FROM session WHERE user_id IN (${adminId},${reviewerId},${reviewerBId})`);
  await db.execute(sql`DELETE FROM "user" WHERE id IN (${adminId},${reviewerId},${reviewerBId})`);
});

describe("road review lifecycle scoped by reviewer territory", () => {
  it("submits, deduplicates, scopes queue, approves, and rejects stale decisions", async () => {
    const created = await request(`/api/admin/organizations/${orgId}/territories`, { geojson: square, sourceType: "synthetic", sourceLabel: "SIMULASI road review", isSimulation: true });
    expect(created.status).toBe(201);
    territoryId = (await created.json() as { territory: { id: string } }).territory.id;
    const verified = await request(`/api/admin/organizations/${orgId}/territories/${territoryId}/verify`, { reason: "Tinjauan internal untuk pengujian sintetis." });
    expect(verified.status).toBe(200);

    const impactId = await createImpact(insideSegmentId);
    const submitted = await submitReview(impactId);
    expect(submitted.status).toBe(201);
    const submittedBody = await submitted.json() as { request: { id: string; status: string } };
    expect(submittedBody.request.status).toBe("pending");
    const duplicate = await submitReview(impactId);
    expect(duplicate.status).toBe(200);
    expect((await duplicate.json() as { duplicate: boolean }).duplicate).toBe(true);

    const unassignedDecision = await request(`/api/reviewer/road-requests/${submittedBody.request.id}/decision`, { decision: "approve", reason: "Tinjauan dalam wilayah tugas." }, reviewerId);
    expect(unassignedDecision.status).toBe(403);
    const unassignedQueue = await request("/api/reviewer/road-requests", undefined, reviewerId);
    expect(unassignedQueue.status).toBe(200);
    expect((await unassignedQueue.json() as { requests: unknown[] }).requests).toEqual([]);
    const otherQueue = await request("/api/reviewer/road-requests", undefined, reviewerBId);
    expect((await otherQueue.json() as { requests: unknown[] }).requests).toEqual([]);

    const assigned = await request(`/api/admin/territories/${territoryId}/reviewers`, { userId: reviewerId });
    expect(assigned.status).toBe(201);
    const scopedQueue = await request("/api/reviewer/road-requests", undefined, reviewerId);
    expect(scopedQueue.status).toBe(200);
    const scopedBody = await scopedQueue.json() as { requests: { id: string; roadName: string }[] };
    expect(scopedBody.requests.map((item) => item.id)).toEqual([submittedBody.request.id]);

    const approved = await request(`/api/reviewer/road-requests/${submittedBody.request.id}/decision`, { decision: "approve", reason: "Batas wilayah terverifikasi dan geometri cocok." }, reviewerId);
    expect(approved.status).toBe(200);
    expect((await approved.json() as { request: { status: string } }).request.status).toBe("approved");
    const secondDecision = await request(`/api/reviewer/road-requests/${submittedBody.request.id}/decision`, { decision: "reject", reason: "Keputusan kedua tidak boleh berlaku." }, reviewerId);
    expect(secondDecision.status).toBe(409);

    const impactId2 = await createImpact(insideSegmentId, "2026-12-02T02:00:00Z", "2026-12-02T03:00:00Z");
    const submitted2 = await submitReview(impactId2);
    expect(submitted2.status).toBe(201);
    const requestId2 = (await submitted2.json() as { request: { id: string } }).request.id;
    const rejected = await request(`/api/reviewer/road-requests/${requestId2}/decision`, { decision: "reject", reason: "Geometri perlu pemeriksaan ulang di lapangan." }, reviewerId);
    expect(rejected.status).toBe(200);
    expect((await rejected.json() as { request: { status: string } }).request.status).toBe("rejected");

    const impactId3 = await createImpact(insideSegmentId, "2026-12-03T02:00:00Z", "2026-12-03T03:00:00Z");
    const submitted3 = await submitReview(impactId3);
    expect(submitted3.status).toBe(201);
    const requestId3 = (await submitted3.json() as { request: { id: string } }).request.id;
    await db.execute(sql`UPDATE road_impacts SET planned_from='2026-12-03T04:00:00Z', planned_to='2026-12-03T05:00:00Z' WHERE id=${impactId3}`);
    const staleDecision = await request(`/api/reviewer/road-requests/${requestId3}/decision`, { decision: "approve", reason: "Snapshot sudah berubah sebelum keputusan." }, reviewerId);
    expect(staleDecision.status).toBe(409);
    const staleRow = await db.execute(sql`SELECT status FROM road_review_requests WHERE id=${requestId3}`);
    expect(staleRow.rows[0].status).toBe("superseded");
  });

  it("rejects review submission for roads outside verified territory", async () => {
    const crossingImpactId = crypto.randomUUID();
    await db.execute(sql`INSERT INTO road_impacts(id,event_id,road_segment_id,planned_from,planned_to,impact_type) VALUES (${crossingImpactId},${eventId},${crossingSegmentId},'2026-12-04T02:00:00Z','2026-12-04T03:00:00Z','closure')`);
    const res = await submitReview(crossingImpactId);
    expect(res.status).toBe(422);
  });

  it("requires superadmin for reviewer assignment and reviewer grant for queue", async () => {
    const forbiddenAssign = await request(`/api/admin/territories/${territoryId}/reviewers`, { userId: reviewerBId }, reviewerId);
    expect(forbiddenAssign.status).toBe(403);
    const forbiddenQueue = await request("/api/reviewer/road-requests", undefined, adminId);
    expect(forbiddenQueue.status).toBe(403);
    const list = await request(`/api/admin/reviewers?territoryVersionId=${territoryId}`, undefined, adminId);
    expect(list.status).toBe(200);
    const body = await list.json() as { reviewers: { userId: string; assignmentStatus: string | null }[] };
    expect(body.reviewers.find((item) => item.userId === reviewerId)?.assignmentStatus).toBe("active");
  });
});
