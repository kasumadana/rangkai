import { and, desc, eq, sql } from "drizzle-orm";
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { z } from "zod";
import { organizationTerritoryVersions, organizations, platformGrants } from "../../db/schema";
import { sendError } from "../lib/errors";
import { requireAuth } from "../middleware/auth";
import type { AppVariables, Env } from "../types";

type Context = { get(key: "db"): AppVariables["db"]; get(key: "user"): AppVariables["user"]; get(key: "requestId"): string };
const idSchema = z.uuid();
const geometrySchema = z.object({ type: z.enum(["Polygon", "MultiPolygon"]), coordinates: z.unknown() }).strict();
const createSchema = z.object({
	geojson: z.unknown(),
	sourceType: z.enum(["imported", "manual", "synthetic"]),
	sourceLabel: z.string().trim().min(2).max(200),
	sourceUrl: z.string().trim().url().max(2048).refine(value => new URL(value).protocol === "https:", "Tautan sumber harus menggunakan HTTPS.").optional(),
	isSimulation: z.boolean().default(false),
}).strict();
const verifySchema = z.object({ reason: z.string().trim().min(3).max(1000) }).strict();

async function isSuperadmin(c: Context) {
	const actor = c.get("user");
	if (!actor) return false;
	const rows = await c.get("db").select({ id: platformGrants.id }).from(platformGrants).where(and(eq(platformGrants.userId, actor.id), eq(platformGrants.role, "superadmin"), eq(platformGrants.status, "active"))).limit(1);
	return rows.length === 1;
}

function getGeometry(value: unknown) {
	if (!value || typeof value !== "object" || Array.isArray(value)) return null;
	const item = value as Record<string, unknown>;
	if ("crs" in item) return null;
	const feature = item.type === "FeatureCollection" && Array.isArray(item.features) && item.features.length === 1 && item.features[0] && typeof item.features[0] === "object" ? item.features[0] as Record<string, unknown> : null;
	if (feature && "crs" in feature) return null;
	const candidate = item.type === "Feature" ? item.geometry : feature ? feature.geometry : item;
	if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) return null;
	const geometry = candidate as Record<string, unknown>;
	if ("crs" in geometry) return null;
	const parsed = geometrySchema.safeParse(geometry);
	return parsed.success ? parsed.data : null;
}

function countAndValidatePositions(coordinates: unknown) {
	let count = 0;
	const visit = (node: unknown): boolean => {
		if (!Array.isArray(node)) return false;
		if (node.length === 2 && node.every(value => typeof value === "number")) {
			const [longitude, latitude] = node as number[];
			count += 1;
			return Number.isFinite(longitude) && Number.isFinite(latitude) && longitude >= -180 && longitude <= 180 && latitude >= -90 && latitude <= 90;
		}
		return node.length > 0 && node.every(visit);
	};
	return { valid: visit(coordinates) && count >= 4 && count <= 10_000, count };
}

function canonicalJson(value: unknown): string {
	if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
	if (value && typeof value === "object") {
		return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`).join(",")}}`;
	}
	return JSON.stringify(value);
}

async function hashGeometry(geometry: unknown) {
	const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonicalJson(geometry)));
	return Array.from(new Uint8Array(digest), value => value.toString(16).padStart(2, "0")).join("");
}

export const territoriesRouter = new Hono<{ Bindings: Env; Variables: AppVariables }>();
territoriesRouter.use("*", requireAuth);
territoriesRouter.use("*", bodyLimit({ maxSize: 512 * 1024, onError: c => sendError(c, "VALIDATION_FAILED", "GeoJSON melebihi batas 512 KiB.", 413) }));

territoriesRouter.get("/territories", async c => {
	if (!await isSuperadmin(c)) return sendError(c, "FORBIDDEN", "Akses superadmin diperlukan.", 403);
	const organizationId = c.req.query("organizationId");
	if (organizationId && !idSchema.safeParse(organizationId).success) return sendError(c, "VALIDATION_FAILED", "ID organisasi tidak valid.", 422);
	const rows = await c.get("db").select({ id: organizationTerritoryVersions.id, organizationId: organizationTerritoryVersions.organizationId, version: organizationTerritoryVersions.version, geojson: organizationTerritoryVersions.geojson, sourceType: organizationTerritoryVersions.sourceType, sourceLabel: organizationTerritoryVersions.sourceLabel, sourceUrl: organizationTerritoryVersions.sourceUrl, contentHash: organizationTerritoryVersions.contentHash, isSimulation: organizationTerritoryVersions.isSimulation, status: organizationTerritoryVersions.status, createdAt: organizationTerritoryVersions.createdAt, verifiedAt: organizationTerritoryVersions.verifiedAt, verificationReason: organizationTerritoryVersions.verificationReason }) .from(organizationTerritoryVersions)
		.where(organizationId ? eq(organizationTerritoryVersions.organizationId, organizationId) : undefined)
		.orderBy(desc(organizationTerritoryVersions.organizationId), desc(organizationTerritoryVersions.version)).limit(200);
	return c.json({ territories: rows });
});

territoriesRouter.post("/organizations/:organizationId/territories", async c => {
	if (!await isSuperadmin(c)) return sendError(c, "FORBIDDEN", "Akses superadmin diperlukan.", 403);
	const organizationId = c.req.param("organizationId");
	if (!idSchema.safeParse(organizationId).success) return sendError(c, "VALIDATION_FAILED", "ID organisasi tidak valid.", 422);
	let body: unknown;
	try { body = await c.req.json(); } catch { return sendError(c, "BAD_REQUEST", "GeoJSON atau metadata tidak valid.", 400); }
	const parsed = createSchema.safeParse(body);
	if (!parsed.success) return sendError(c, "VALIDATION_FAILED", parsed.error.issues[0]?.message || "Periksa GeoJSON dan sumber batas.", 422);
	const geometry = getGeometry(parsed.data.geojson);
	if (!geometry) return sendError(c, "VALIDATION_FAILED", "Masukkan GeoJSON Polygon atau MultiPolygon berkoordinat WGS84 lon/lat tanpa properti CRS.", 422);
	const positions = countAndValidatePositions(geometry.coordinates);
	if (!positions.valid) return sendError(c, "VALIDATION_FAILED", "GeoJSON harus memiliki 4–10.000 posisi 2D lon/lat yang finite dalam rentang WGS84.", 422);
	if (parsed.data.sourceType === "synthetic" && !parsed.data.isSimulation) return sendError(c, "VALIDATION_FAILED", "Geometri sintetis wajib ditandai sebagai simulasi.", 422);
	const actor = c.get("user")!;
	const organization = await c.get("db").select({ id: organizations.id }).from(organizations).where(eq(organizations.id, organizationId)).limit(1);
	if (!organization.length) return sendError(c, "NOT_FOUND", "Organisasi tidak ditemukan.", 404);
	const geojson = JSON.stringify(geometry);
	const isValid = await c.get("db").execute(sql`WITH shape AS (SELECT ST_Multi(ST_SetSRID(ST_GeomFromGeoJSON(${geojson}),4326))::geometry(MultiPolygon,4326) AS geom) SELECT ST_IsValid(geom) AS valid, ST_IsValidReason(geom) AS reason FROM shape`);
	if (!isValid.rows[0]?.valid) return sendError(c, "VALIDATION_FAILED", `Polygon tidak valid: ${isValid.rows[0]?.reason || "topologi tidak valid"}.`, 422);
	const id = crypto.randomUUID();
	const contentHash = await hashGeometry(geometry);
	const requestId = c.get("requestId");
	const simulation = parsed.data.isSimulation || parsed.data.sourceType === "synthetic";
	try {
		const result = await c.get("db").execute(sql`WITH authorized AS MATERIALIZED (SELECT user_id FROM platform_grants WHERE user_id=${actor.id} AND role='superadmin' AND status='active' FOR SHARE), locked_org AS MATERIALIZED (SELECT id FROM organizations WHERE id=${organizationId} FOR UPDATE), next_version AS MATERIALIZED (SELECT o.id, COALESCE(MAX(t.version),0)+1 AS version FROM locked_org o LEFT JOIN organization_territory_versions t ON t.organization_id=o.id GROUP BY o.id), shape AS (SELECT ST_Multi(ST_SetSRID(ST_GeomFromGeoJSON(${geojson}),4326))::geometry(MultiPolygon,4326) AS geom), created AS (INSERT INTO organization_territory_versions (id,organization_id,version,geom,geojson,source_type,source_label,source_url,content_hash,is_simulation,status,created_by) SELECT ${id},n.id,n.version,s.geom,${geojson}::jsonb,${parsed.data.sourceType},${parsed.data.sourceLabel},${parsed.data.sourceUrl || null},${contentHash},${simulation},'pending_verification',${actor.id} FROM next_version n CROSS JOIN shape s WHERE EXISTS(SELECT 1 FROM authorized) RETURNING id,organization_id,version,status,content_hash,is_simulation), audit AS (INSERT INTO platform_audit(actor_id,action,entity_type,entity_id,reason,request_id) SELECT ${actor.id},'territory.version.created','organization_territory_version',id::text,${parsed.data.sourceType} || ':' || ${parsed.data.sourceLabel},${requestId} FROM created RETURNING id) SELECT created.* FROM created CROSS JOIN audit`);
		if (!result.rows.length) return sendError(c, "FORBIDDEN", "Akses superadmin tidak aktif.", 403);
		return c.json({ territory: result.rows[0] }, 201);
	} catch {
		return sendError(c, "DEPENDENCY_UNAVAILABLE", "Versi batas wilayah belum dapat disimpan. Coba lagi.", 503);
	}
});

territoriesRouter.post("/organizations/:organizationId/territories/:territoryId/verify", async c => {
	if (!await isSuperadmin(c)) return sendError(c, "FORBIDDEN", "Akses superadmin diperlukan.", 403);
	const organizationId = c.req.param("organizationId"), territoryId = c.req.param("territoryId");
	if (!idSchema.safeParse(organizationId).success || !idSchema.safeParse(territoryId).success) return sendError(c, "VALIDATION_FAILED", "ID organisasi atau batas wilayah tidak valid.", 422);
	let body: unknown;
	try { body = await c.req.json(); } catch { return sendError(c, "BAD_REQUEST", "Alasan verifikasi tidak valid.", 400); }
	const parsed = verifySchema.safeParse(body);
	if (!parsed.success) return sendError(c, "VALIDATION_FAILED", "Alasan verifikasi wajib diisi (3–1.000 karakter).", 422);
	const actor = c.get("user")!, requestId = c.get("requestId");
	try {
		const result = await c.get("db").execute(sql`WITH authorized AS MATERIALIZED (SELECT user_id FROM platform_grants WHERE user_id=${actor.id} AND role='superadmin' AND status='active' FOR SHARE), target AS MATERIALIZED (SELECT id FROM organization_territory_versions WHERE id=${territoryId} AND organization_id=${organizationId} AND status='pending_verification' AND ST_IsValid(geom) FOR UPDATE), verified AS (UPDATE organization_territory_versions t SET status='verified',verified_by=${actor.id},verified_at=now(),verification_reason=${parsed.data.reason} FROM target WHERE t.id=target.id AND EXISTS(SELECT 1 FROM authorized) RETURNING t.id,t.organization_id,t.version,t.status,t.is_simulation), stale_requests AS (UPDATE road_review_requests q SET status='superseded',reason='A newer verified territory version replaced this review scope.' FROM verified v JOIN events e ON e.organization_id=v.organization_id WHERE q.event_id=e.id AND q.territory_version_id<>v.id AND q.status IN ('pending','approved') RETURNING q.id), stale_audit AS (INSERT INTO platform_audit(actor_id,action,entity_type,entity_id,reason,request_id) SELECT ${actor.id},'road_review.superseded','road_review_request',id::text,'A newer verified territory version replaced this review scope.',${requestId} FROM stale_requests RETURNING id), audit AS (INSERT INTO platform_audit(actor_id,action,entity_type,entity_id,reason,request_id) SELECT ${actor.id},'territory.version.verified','organization_territory_version',id::text,${parsed.data.reason},${requestId} FROM verified RETURNING id) SELECT verified.*, (SELECT count(*)::int FROM stale_requests) AS "invalidatedReviewCount" FROM verified CROSS JOIN audit`);
		if (result.rows.length) return c.json({ territory: result.rows[0] });
		const existing = await c.get("db").select({ status: organizationTerritoryVersions.status }).from(organizationTerritoryVersions).where(and(eq(organizationTerritoryVersions.id, territoryId), eq(organizationTerritoryVersions.organizationId, organizationId))).limit(1);
		if (!existing.length) return sendError(c, "NOT_FOUND", "Versi batas wilayah tidak ditemukan.", 404);
		return sendError(c, "CONFLICT", "Versi wilayah tidak lagi menunggu verifikasi.", 409);
	} catch {
		return sendError(c, "DEPENDENCY_UNAVAILABLE", "Verifikasi batas wilayah belum dapat disimpan. Coba lagi.", 503);
	}
});
