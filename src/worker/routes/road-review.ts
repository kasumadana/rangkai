import { and, eq, sql } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import { organizationTerritoryVersions, platformGrants, reviewerTerritoryAssignments } from "../../db/schema";
import { user } from "../../db/auth-schema";
import { sendError } from "../lib/errors";
import { getEventAndCheckAccess } from "../middleware/assignments";
import { requireAuth } from "../middleware/auth";
import type { AppVariables, Env } from "../types";

type Context = { get(key: "db"): AppVariables["db"]; get(key: "user"): AppVariables["user"]; get(key: "requestId"): string };
const idSchema = z.uuid();
const userIdSchema = z.string().trim().min(1).max(128);
const decisionSchema = z.object({ decision: z.enum(["approve", "reject"]), reason: z.string().trim().min(3).max(1000) }).strict();
const reviewerTerritoryRouter = new Hono<{ Bindings: Env; Variables: AppVariables }>();
reviewerTerritoryRouter.use("/admin/*", requireAuth);
reviewerTerritoryRouter.use("/reviewer/*", requireAuth);
reviewerTerritoryRouter.use("/events/*", requireAuth);

async function hasGrant(c: Context, role: "superadmin" | "government_reviewer") {
	const actor = c.get("user");
	if (!actor) return false;
	const rows = await c.get("db").select({ id: platformGrants.id }).from(platformGrants).where(and(eq(platformGrants.userId, actor.id), eq(platformGrants.role, role), eq(platformGrants.status, "active"))).limit(1);
	return rows.length === 1;
}

reviewerTerritoryRouter.get("/admin/reviewers", async c => {
	if (!await hasGrant(c, "superadmin")) return sendError(c, "FORBIDDEN", "Akses superadmin diperlukan.", 403);
	const territoryVersionId = c.req.query("territoryVersionId");
	if (!territoryVersionId || !idSchema.safeParse(territoryVersionId).success) return sendError(c, "VALIDATION_FAILED", "Pilih versi wilayah yang valid.", 422);
	const rows = await c.get("db").select({ userId: user.id, name: user.name, email: user.email, assignmentStatus: reviewerTerritoryAssignments.status }).from(platformGrants).innerJoin(user, eq(platformGrants.userId, user.id)).leftJoin(reviewerTerritoryAssignments, and(eq(reviewerTerritoryAssignments.userId, user.id), eq(reviewerTerritoryAssignments.territoryVersionId, territoryVersionId))).where(and(eq(platformGrants.role, "government_reviewer"), eq(platformGrants.status, "active"))).orderBy(user.name).limit(500);
	return c.json({ reviewers: rows, territoryVersionId });
});

reviewerTerritoryRouter.post("/admin/territories/:territoryVersionId/reviewers", async c => {
	if (!await hasGrant(c, "superadmin")) return sendError(c, "FORBIDDEN", "Akses superadmin diperlukan.", 403);
	const territoryVersionId = c.req.param("territoryVersionId");
	if (!idSchema.safeParse(territoryVersionId).success) return sendError(c, "VALIDATION_FAILED", "ID wilayah tidak valid.", 422);
	let body: unknown; try { body = await c.req.json(); } catch { return sendError(c, "BAD_REQUEST", "Data reviewer tidak valid.", 400); }
	const input = z.object({ userId: userIdSchema }).strict().safeParse(body);
	if (!input.success) return sendError(c, "VALIDATION_FAILED", "Pilih akun reviewer yang valid.", 422);
	const actor = c.get("user")!, requestId = c.get("requestId");
	const result = await c.get("db").execute(sql`WITH authorized AS MATERIALIZED (SELECT user_id FROM platform_grants WHERE user_id=${actor.id} AND role='superadmin' AND status='active' FOR SHARE), territory AS MATERIALIZED (SELECT id FROM organization_territory_versions WHERE id=${territoryVersionId} AND status='verified' FOR SHARE), reviewer AS MATERIALIZED (SELECT user_id FROM platform_grants WHERE user_id=${input.data.userId} AND role='government_reviewer' AND status='active' FOR SHARE), assigned AS (INSERT INTO reviewer_territory_assignments(user_id,territory_version_id,status,assigned_by,assigned_at,revoked_by,revoked_at) SELECT reviewer.user_id,territory.id,'active',${actor.id},now(),NULL,NULL FROM reviewer CROSS JOIN territory WHERE EXISTS(SELECT 1 FROM authorized) ON CONFLICT(user_id,territory_version_id) DO UPDATE SET status='active',assigned_by=EXCLUDED.assigned_by,assigned_at=now(),revoked_by=NULL,revoked_at=NULL RETURNING id,user_id,territory_version_id,status), audit AS (INSERT INTO platform_audit(actor_id,action,entity_type,entity_id,reason,request_id) SELECT ${actor.id},'reviewer.territory.assigned','reviewer_territory_assignment',id::text,territory_version_id::text,${requestId} FROM assigned RETURNING id) SELECT assigned.* FROM assigned CROSS JOIN audit`);
	if (result.rows.length) return c.json({ assignment: result.rows[0] }, 201);
	const version = await c.get("db").select({ id: organizationTerritoryVersions.id }).from(organizationTerritoryVersions).where(and(eq(organizationTerritoryVersions.id, territoryVersionId), eq(organizationTerritoryVersions.status, "verified"))).limit(1);
	if (!version.length) return sendError(c, "CONFLICT", "Reviewer hanya dapat ditugaskan pada batas yang sudah diverifikasi.", 409);
	return sendError(c, "NOT_FOUND", "Akun reviewer aktif tidak ditemukan.", 404);
});

reviewerTerritoryRouter.delete("/admin/territories/:territoryVersionId/reviewers/:reviewerId", async c => {
	if (!await hasGrant(c, "superadmin")) return sendError(c, "FORBIDDEN", "Akses superadmin diperlukan.", 403);
	const territoryVersionId = c.req.param("territoryVersionId"), reviewerId = c.req.param("reviewerId");
	if (!idSchema.safeParse(territoryVersionId).success || !userIdSchema.safeParse(reviewerId).success) return sendError(c, "VALIDATION_FAILED", "ID wilayah atau reviewer tidak valid.", 422);
	const actor = c.get("user")!, requestId = c.get("requestId");
	const result = await c.get("db").execute(sql`WITH authorized AS MATERIALIZED (SELECT user_id FROM platform_grants WHERE user_id=${actor.id} AND role='superadmin' AND status='active' FOR SHARE), revoked AS (UPDATE reviewer_territory_assignments SET status='revoked',revoked_by=${actor.id},revoked_at=now() WHERE user_id=${reviewerId} AND territory_version_id=${territoryVersionId} AND status='active' AND EXISTS(SELECT 1 FROM authorized) RETURNING id), audit AS (INSERT INTO platform_audit(actor_id,action,entity_type,entity_id,reason,request_id) SELECT ${actor.id},'reviewer.territory.revoked','reviewer_territory_assignment',id::text,${reviewerId},${requestId} FROM revoked RETURNING id) SELECT revoked.id FROM revoked CROSS JOIN audit`);
	return result.rows.length ? c.json({ success: true }) : sendError(c, "NOT_FOUND", "Penugasan reviewer aktif tidak ditemukan.", 404);
});

reviewerTerritoryRouter.post("/events/:eventId/road-impacts/:impactId/review", async c => {
	const eventId = c.req.param("eventId"), impactId = c.req.param("impactId"), actor = c.get("user")!;
	if (!idSchema.safeParse(eventId).success || !idSchema.safeParse(impactId).success) return sendError(c, "VALIDATION_FAILED", "ID kegiatan atau ruas tidak valid.", 422);
	const access = await getEventAndCheckAccess(c.get("db"), eventId, actor.id);
	if (access === "NOT_FOUND") return sendError(c, "NOT_FOUND", "Kegiatan tidak ditemukan.", 404);
	if (access === "FORBIDDEN" || !access.isOrganizer) return sendError(c, "FORBIDDEN", "Akses organizer diperlukan.", 403);
	const requestId = c.get("requestId"), requestUuid = crypto.randomUUID();
	try {
		const result = await c.get("db").execute(sql`WITH target AS MATERIALIZED (SELECT e.id AS event_id,e.organization_id,e.starts_at,e.ends_at,e.is_simulation,ri.id AS impact_id,ri.road_segment_id,ri.planned_from,ri.planned_to,ri.impact_type,rs.geom AS road_geom,rs.source_type,rs.verified_by,rs.verified_at,tv.id AS territory_version_id,tv.geom AS territory_geom,tv.content_hash AS territory_hash FROM events e JOIN memberships m ON m.organization_id=e.organization_id AND m.user_id=${actor.id} AND m.role='organizer' JOIN road_impacts ri ON ri.event_id=e.id JOIN road_segments rs ON rs.id=ri.road_segment_id JOIN LATERAL (SELECT v.id,v.geom,v.content_hash FROM organization_territory_versions v WHERE v.organization_id=e.organization_id AND v.status='verified' ORDER BY v.version DESC LIMIT 1) tv ON true WHERE e.id=${eventId} AND ri.id=${impactId} AND e.status IN ('draft','review') AND rs.source_type='catalog' AND rs.verified_by IS NOT NULL AND rs.verified_at IS NOT NULL AND ST_CoveredBy(rs.geom,tv.geom) FOR UPDATE OF e,ri), created AS (INSERT INTO road_review_requests(id,road_impact_id,event_id,road_segment_id,territory_version_id,road_geometry,geometry_wkb,territory_content_hash,event_starts_at,event_ends_at,planned_from,planned_to,impact_type,is_simulation,status,submitted_by) SELECT ${requestUuid},impact_id,event_id,road_segment_id,territory_version_id,road_geom,encode(ST_AsEWKB(road_geom),'hex'),territory_hash,starts_at,ends_at,planned_from,planned_to,impact_type,is_simulation,'pending',${actor.id} FROM target ON CONFLICT(road_impact_id) WHERE status='pending' DO NOTHING RETURNING id,road_impact_id,status,territory_version_id,submitted_at), audit AS (INSERT INTO platform_audit(actor_id,action,entity_type,entity_id,reason,request_id) SELECT ${actor.id},'road_review.submitted','road_review_request',id::text,'territory:' || territory_version_id::text,${requestId} FROM created RETURNING id) SELECT created.* FROM created CROSS JOIN audit`);
		if (result.rows.length) return c.json({ request: result.rows[0] }, 201);
		const pending = await c.get("db").execute(sql`SELECT q.id,q.status,q.territory_version_id AS "territoryVersionId" FROM road_review_requests q JOIN road_impacts ri ON ri.id=q.road_impact_id JOIN events e ON e.id=ri.event_id JOIN road_segments rs ON rs.id=ri.road_segment_id JOIN organization_territory_versions tv ON tv.id=q.territory_version_id WHERE q.road_impact_id=${impactId} AND q.status='pending' AND e.id=${eventId} AND q.planned_from=ri.planned_from AND q.planned_to=ri.planned_to AND q.impact_type=ri.impact_type AND q.geometry_wkb=encode(ST_AsEWKB(rs.geom),'hex') AND q.territory_content_hash=tv.content_hash AND tv.status='verified' AND ST_CoveredBy(rs.geom,tv.geom) LIMIT 1`);
		if (pending.rows.length) return c.json({ request: pending.rows[0], duplicate: true });
		return sendError(c, "VALIDATION_FAILED", "Pengajuan memerlukan ruas katalog terverifikasi yang seluruh geometri berada di dalam wilayah versi terverifikasi. Organisasi atau ruas lintas wilayah memerlukan peninjauan manual.", 422);
	} catch { return sendError(c, "DEPENDENCY_UNAVAILABLE", "Pengajuan tinjauan ruas belum dapat disimpan. Coba lagi.", 503); }
});

reviewerTerritoryRouter.get("/reviewer/road-requests", async c => {
	const actor = c.get("user")!;
	if (!await hasGrant(c, "government_reviewer")) return sendError(c, "FORBIDDEN", "Akses reviewer pemerintah diperlukan.", 403);
	const result = await c.get("db").execute(sql`SELECT q.id,q.event_id AS "eventId",e.title AS "eventTitle",q.road_segment_id AS "roadSegmentId",rs.display_name AS "roadName",rs.coverage_area AS "coverageArea",q.planned_from AS "plannedFrom",q.planned_to AS "plannedTo",q.impact_type AS "impactType",q.is_simulation AS "isSimulation",tv.version AS "territoryVersion",tv.is_simulation AS "territoryIsSimulation",ST_AsGeoJSON(rs.geom)::json AS geometry FROM road_review_requests q JOIN events e ON e.id=q.event_id JOIN road_impacts ri ON ri.id=q.road_impact_id JOIN road_segments rs ON rs.id=ri.road_segment_id JOIN organization_territory_versions tv ON tv.id=q.territory_version_id JOIN reviewer_territory_assignments a ON a.territory_version_id=tv.id AND a.user_id=${actor.id} AND a.status='active' WHERE q.status='pending' AND tv.status='verified' AND tv.id=(SELECT latest.id FROM organization_territory_versions latest WHERE latest.organization_id=e.organization_id AND latest.status='verified' ORDER BY latest.version DESC LIMIT 1) AND q.event_starts_at IS NOT DISTINCT FROM e.starts_at AND q.event_ends_at IS NOT DISTINCT FROM e.ends_at AND q.planned_from=ri.planned_from AND q.planned_to=ri.planned_to AND q.impact_type=ri.impact_type AND q.geometry_wkb=encode(ST_AsEWKB(rs.geom),'hex') AND q.territory_content_hash=tv.content_hash AND ST_CoveredBy(rs.geom,tv.geom) ORDER BY q.submitted_at ASC LIMIT 100`);
	return c.json({ requests: result.rows });
});

reviewerTerritoryRouter.post("/reviewer/road-requests/:id/decision", async c => {
	const actor = c.get("user")!, requestId = c.get("requestId"), id = c.req.param("id");
	if (!idSchema.safeParse(id).success) return sendError(c, "VALIDATION_FAILED", "ID pengajuan tidak valid.", 422);
	let body: unknown; try { body = await c.req.json(); } catch { return sendError(c, "BAD_REQUEST", "Keputusan reviewer tidak valid.", 400); }
	const parsed = decisionSchema.safeParse(body);
	if (!parsed.success) return sendError(c, "VALIDATION_FAILED", "Keputusan dan alasan reviewer wajib diisi.", 422);
	if (!await hasGrant(c, "government_reviewer")) return sendError(c, "FORBIDDEN", "Akses reviewer pemerintah diperlukan.", 403);
	try {
		const result = await c.get("db").execute(sql`WITH target AS MATERIALIZED (SELECT * FROM road_review_requests WHERE id=${id} AND status='pending' FOR UPDATE), authorized AS MATERIALIZED (SELECT user_id FROM platform_grants WHERE user_id=${actor.id} AND role='government_reviewer' AND status='active' FOR SHARE), scoped AS MATERIALIZED (SELECT a.territory_version_id FROM reviewer_territory_assignments a JOIN target q ON q.territory_version_id=a.territory_version_id WHERE a.user_id=${actor.id} AND a.status='active'), fresh AS MATERIALIZED (SELECT q.id FROM target q JOIN road_impacts ri ON ri.id=q.road_impact_id JOIN events e ON e.id=q.event_id JOIN road_segments rs ON rs.id=q.road_segment_id JOIN organization_territory_versions tv ON tv.id=q.territory_version_id WHERE q.event_id=ri.event_id AND q.road_segment_id=ri.road_segment_id AND q.event_starts_at IS NOT DISTINCT FROM e.starts_at AND q.event_ends_at IS NOT DISTINCT FROM e.ends_at AND q.planned_from=ri.planned_from AND q.planned_to=ri.planned_to AND q.impact_type=ri.impact_type AND q.is_simulation=e.is_simulation AND q.geometry_wkb=encode(ST_AsEWKB(rs.geom),'hex') AND q.territory_content_hash=tv.content_hash AND tv.status='verified' AND tv.id=(SELECT latest.id FROM organization_territory_versions latest WHERE latest.organization_id=e.organization_id AND latest.status='verified' ORDER BY latest.version DESC LIMIT 1) AND ST_CoveredBy(rs.geom,tv.geom)), decided AS (UPDATE road_review_requests q SET status=${parsed.data.decision === "approve" ? "approved" : "rejected"},reviewed_by=${actor.id},reviewed_at=now(),reason=${parsed.data.reason} WHERE q.id IN (SELECT id FROM fresh) AND EXISTS(SELECT 1 FROM authorized) AND EXISTS(SELECT 1 FROM scoped) RETURNING q.id,q.status,q.road_impact_id,q.is_simulation), stale AS (UPDATE road_review_requests q SET status='superseded',reason='Resource snapshot changed before reviewer decision.' WHERE q.id IN (SELECT id FROM target) AND q.status='pending' AND NOT EXISTS(SELECT 1 FROM fresh) AND EXISTS(SELECT 1 FROM authorized) AND EXISTS(SELECT 1 FROM scoped) RETURNING q.id), audit AS (INSERT INTO platform_audit(actor_id,action,entity_type,entity_id,reason,request_id) SELECT ${actor.id},'road_review.' || status,'road_review_request',id::text,${parsed.data.reason},${requestId} FROM decided UNION ALL SELECT ${actor.id},'road_review.superseded','road_review_request',id::text,'Resource snapshot changed before reviewer decision.',${requestId} FROM stale RETURNING id) SELECT decided.* FROM decided CROSS JOIN audit`);
		if (result.rows.length) return c.json({ request: result.rows[0] });
		const assignment = await c.get("db").select({ id: reviewerTerritoryAssignments.id }).from(reviewerTerritoryAssignments).where(and(eq(reviewerTerritoryAssignments.userId, actor.id), eq(reviewerTerritoryAssignments.status, "active"))).limit(1);
		if (!assignment.length) return sendError(c, "FORBIDDEN", "Reviewer belum mendapat cakupan wilayah yang sesuai.", 403);
		const current = await c.get("db").execute(sql`SELECT status FROM road_review_requests WHERE id=${id} LIMIT 1`);
		if (!current.rows.length) return sendError(c, "NOT_FOUND", "Pengajuan jalan tidak ditemukan.", 404);
		return sendError(c, "STATE_CONFLICT", current.rows[0].status === "superseded" ? "Data kegiatan, waktu, ruas, atau batas berubah. Pengajuan harus dibuat ulang." : "Pengajuan tidak lagi menunggu keputusan.", 409);
	} catch { return sendError(c, "DEPENDENCY_UNAVAILABLE", "Keputusan reviewer belum dapat disimpan. Coba lagi.", 503); }
});

export { reviewerTerritoryRouter };
