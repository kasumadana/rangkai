import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { Hono } from "hono";
import {
	aiExtractions,
	documents,
	events,
	memberships,
	organizations,
	roadImpacts,
	roadStatusUpdates,
} from "../../db/schema";
import { sendError } from "../lib/errors";
import { getEventAndCheckAccess } from "../middleware/assignments";
import { requireAuth } from "../middleware/auth";
import type { AppVariables, Env } from "../types";
import { uuidParamSchema } from "../validators/events";
import {
	createRoadImpactSchema,
	createSimulationRoadImpactSchema,
	createRoadStatusSchema,
	roadSegmentsQuerySchema,
	updateRoadImpactSchema,
} from "../validators/roads";

const roadsRouter = new Hono<{
	Bindings: Env;
	Variables: AppVariables;
}>();

roadsRouter.use("*", requireAuth);

// Default operational status TTL: 30 minutes (1,800,000 ms) per docs/06-API-CONTRACT.md §7
export const ROAD_STATUS_TTL_MS = 30 * 60 * 1000;
// Maximum allowed clock skew in the future for observedAt: 5 minutes
const MAX_FUTURE_OBSERVED_SKEW_MS = 5 * 60 * 1000;
// Maximum age of an observation at submission time: 2 hours
const MAX_PAST_OBSERVED_AGE_MS = 2 * 60 * 60 * 1000;

/**
 * Pure helper to evaluate whether a road status update has expired.
 * Domain invariant (AGENTS.md §13):
 * - Expired status MUST be displayed as unconfirmed ("unconfirmed").
 * - NEVER silently convert expired status to "open".
 */
export function evaluateEffectiveRoadStatus(
	latestUpdate: {
		status: string;
		observedAt: Date | string;
		expiresAt: Date | string;
		updatedBy: string;
		createdAt?: Date | string;
	} | null,
	now: Date = new Date(),
) {
	if (!latestUpdate) {
		return {
			effectiveStatus: "unconfirmed" as const,
			rawStatus: "unknown" as const,
			isStale: true,
			observedAt: null,
			expiresAt: null,
			updatedBy: null,
		};
	}

	const expiresAtDate =
		latestUpdate.expiresAt instanceof Date
			? latestUpdate.expiresAt
			: new Date(latestUpdate.expiresAt);
	const observedAtDate =
		latestUpdate.observedAt instanceof Date
			? latestUpdate.observedAt
			: new Date(latestUpdate.observedAt);

	const isExpired = expiresAtDate.getTime() <= now.getTime();

	return {
		effectiveStatus: isExpired
			? ("unconfirmed" as const)
			: (latestUpdate.status as "open" | "intermittent" | "closed" | "unknown"),
		rawStatus: latestUpdate.status as
			| "open"
			| "intermittent"
			| "closed"
			| "unknown",
		isStale: isExpired,
		observedAt: observedAtDate.toISOString(),
		expiresAt: expiresAtDate.toISOString(),
		updatedBy: latestUpdate.updatedBy,
	};
}

/**
 * GET /api/road-segments?bbox=minLng,minLat,maxLng,maxLat
 * Query human-verified road segments intersecting the requested bounding box.
 * Unverified synthetic fixtures (verified_by IS NULL OR verified_at IS NULL) are strictly excluded.
 */
roadsRouter.get("/road-segments", async (c) => {
	const currentUser = c.get("user")!;
	const db = c.get("db");

	// Verify caller has at least one organizer membership
	const orgMemberships = await db
		.select({ role: memberships.role })
		.from(memberships)
		.where(
			and(
				eq(memberships.userId, currentUser.id),
				eq(memberships.role, "organizer"),
			),
		)
		.limit(1);

	if (orgMemberships.length === 0) {
		return sendError(
			c,
			"FORBIDDEN",
			"Organizer permission required to query the road segment catalog.",
			403,
		);
	}

	const queryParse = roadSegmentsQuerySchema.safeParse(c.req.query());
	if (!queryParse.success) {
		return sendError(
			c,
			"VALIDATION_FAILED",
			queryParse.error.issues[0]?.message || "Invalid bbox query parameter.",
			422,
		);
	}

	const [minLng, minLat, maxLng, maxLat] = queryParse.data.bbox
		.split(",")
		.map((s) => Number(s.trim()));

	const query = sql`
		SELECT
			id,
			display_name AS "displayName",
			coverage_area AS "coverageArea",
			verified_by AS "verifiedBy",
			verified_at AS "verifiedAt",
			ST_AsGeoJSON(geom)::json AS geometry
		FROM road_segments
		WHERE verified_by IS NOT NULL
			AND verified_at IS NOT NULL
			AND source_type = 'catalog'
			AND ST_Intersects(
				geom,
				ST_MakeEnvelope(${minLng}, ${minLat}, ${maxLng}, ${maxLat}, 4326)
			)
		ORDER BY display_name ASC
		LIMIT 100;
	`;

	const res = await db.execute(query);

	return c.json(
		{
			segments: res.rows.map((r: Record<string, unknown>) => ({
				id: r.id as string,
				displayName: r.displayName as string,
				coverageArea: r.coverageArea as string,
				verified: true,
				verifiedBy: r.verifiedBy as string,
				verifiedAt: new Date(r.verifiedAt as string).toISOString(),
				geometry: r.geometry,
			})),
		},
		200,
	);
});

// A self-attestation cannot grant global road geometry verification.
roadsRouter.post("/road-segments", (c) =>
	sendError(c, "FORBIDDEN", "Pembuatan ruas terverifikasi belum tersedia. Pilih ruas yang sudah diverifikasi.", 403),
);

// A drawn line remains organization-scoped simulation data, never a catalog verification.
roadsRouter.post("/events/:eventId/simulation-road-impacts", async (c) => {
	const eventId = c.req.param("eventId");
	if (!uuidParamSchema.safeParse(eventId).success) return sendError(c, "VALIDATION_FAILED", "Invalid event ID.", 422);
	let body: unknown;
	try { body = await c.req.json(); } catch { return sendError(c, "BAD_REQUEST", "Invalid JSON payload.", 400); }
	const parsed = createSimulationRoadImpactSchema.safeParse(body);
	if (!parsed.success) return sendError(c, "VALIDATION_FAILED", parsed.error.issues[0]?.message ?? "Invalid road data.", 422);
	const data = parsed.data;
	const currentUser = c.get("user")!;
	const now = new Date();
	const ewkt = `SRID=4326;LINESTRING(${data.coordinates.map(([lng, lat]) => `${lng} ${lat}`).join(", ")})`;
	const query = sql`
		WITH target AS MATERIALIZED (
			SELECT e.id, e.organization_id, e.status, e.is_simulation FROM events e
			JOIN memberships m ON m.organization_id = e.organization_id AND m.user_id = ${currentUser.id} AND m.role = 'organizer'
			WHERE e.id = ${eventId} FOR UPDATE OF e, m
		), inserted_segment AS (
			INSERT INTO road_segments (id, display_name, geom, coverage_area, organization_id, source_type, created_by, created_at)
			SELECT ${data.mutationId}, ${data.displayName}, ST_GeomFromEWKT(${ewkt}), ${data.coverageArea}, organization_id, 'simulation_draft', ${currentUser.id}, ${now}
			FROM target WHERE is_simulation AND status IN ('draft', 'review')
			ON CONFLICT (id) DO NOTHING RETURNING *
		), inserted_impact AS (
			INSERT INTO road_impacts (id, event_id, road_segment_id, planned_from, planned_to, impact_type, diversion_note, created_at)
			SELECT ${data.mutationId}, t.id, s.id, ${new Date(data.plannedFrom)}, ${new Date(data.plannedTo)}, ${data.impactType}, ${data.diversionNote ?? null}, ${now}
			FROM target t CROSS JOIN inserted_segment s RETURNING *
		), reset_review AS (
			UPDATE events e SET status = 'draft', verified_by = NULL, verified_at = NULL, updated_at = ${now}
			FROM target t WHERE e.id = t.id AND t.status = 'review' AND EXISTS (SELECT 1 FROM inserted_impact) RETURNING e.id
		), logged AS (
			INSERT INTO audit_logs (id, organization_id, event_id, actor_id, action, entity_type, entity_id, before_json, after_json, created_at)
			SELECT ${crypto.randomUUID()}, t.organization_id, t.id, ${currentUser.id}, 'simulation_road.created', 'road_impact', i.id::text, NULL,
				jsonb_build_object('roadSegmentId', i.road_segment_id, 'sourceType', 'simulation_draft'), ${now}
			FROM inserted_impact i CROSS JOIN target t RETURNING id
		), existing AS (
			SELECT ri.id FROM road_impacts ri JOIN road_segments rs ON rs.id = ri.road_segment_id JOIN target t ON t.id = ri.event_id
			WHERE ri.id = ${data.mutationId} AND rs.id = ${data.mutationId} AND rs.organization_id = t.organization_id
				AND rs.source_type = 'simulation_draft' AND rs.created_by = ${currentUser.id}
				AND rs.display_name = ${data.displayName} AND rs.coverage_area = ${data.coverageArea}
				AND ST_Equals(rs.geom, ST_GeomFromEWKT(${ewkt}))
				AND ri.planned_from = ${new Date(data.plannedFrom)} AND ri.planned_to = ${new Date(data.plannedTo)}
				AND ri.impact_type = ${data.impactType} AND ri.diversion_note IS NOT DISTINCT FROM ${data.diversionNote ?? null}
		)
		SELECT (SELECT count(*)::int FROM target) AS "targetCount", (SELECT is_simulation FROM target) AS "isSimulation",
			(SELECT status FROM target) AS "eventStatus", (SELECT id FROM inserted_impact) AS "createdId",
			(SELECT id FROM existing) AS "existingId", (SELECT count(*)::int FROM logged) AS "auditCount";
	`;
	const result = await c.get("db").execute(query);
	const row = result.rows[0];
	if (!row?.targetCount) return sendError(c, "FORBIDDEN", "Akses penyelenggara diperlukan.", 403);
	if (!row.isSimulation || !["draft", "review"].includes(String(row.eventStatus))) return sendError(c, "STATE_CONFLICT", "Garis latihan hanya dapat ditambahkan ke draf simulasi.", 409);
	if (!row.createdId && !row.existingId) return sendError(c, "STATE_CONFLICT", "Permintaan ini bertentangan dengan data yang sudah tersimpan.", 409);
	return c.json({ roadImpact: { id: String(row.createdId ?? row.existingId) }, duplicate: !row.createdId }, row.createdId ? 201 : 200);
});

/**
 * POST /api/events/:eventId/road-impacts
 * Attach a verified road segment to an event as a planned road impact.
 */
roadsRouter.post("/events/:eventId/road-impacts", async (c) => {
	const currentUser = c.get("user")!;
	const eventId = c.req.param("eventId");

	if (!uuidParamSchema.safeParse(eventId).success) {
		return sendError(c, "VALIDATION_FAILED", "Invalid event ID format.", 422);
	}

	const db = c.get("db");
	const access = await getEventAndCheckAccess(db, eventId, currentUser.id);
	if (access === "NOT_FOUND") {
		return sendError(c, "NOT_FOUND", "Event not found.", 404);
	}
	if (access === "FORBIDDEN" || !access.isOrganizer) {
		return sendError(
			c,
			"FORBIDDEN",
			"Organizer permission required to manage planned road impacts.",
			403,
		);
	}

	const event = access.event;
	if (event.status !== "draft" && event.status !== "review") {
		return sendError(
			c,
			"STATE_CONFLICT",
			`Road impacts can only be added while an event is in draft or review status (current: ${event.status}).`,
			409,
		);
	}

	let body: unknown;
	try {
		body = await c.req.json();
	} catch {
		return sendError(c, "BAD_REQUEST", "Invalid JSON payload.", 400);
	}

	const parseResult = createRoadImpactSchema.safeParse(body);
	if (!parseResult.success) {
		return sendError(
			c,
			"VALIDATION_FAILED",
			parseResult.error.issues[0]?.message || "Invalid road impact data.",
			422,
		);
	}

	const data = parseResult.data;

	const impactId = crypto.randomUUID();
	const auditId = crypto.randomUUID();
	const now = new Date();
	const plannedFromDate = new Date(data.plannedFrom);
	const plannedToDate = new Date(data.plannedTo);

	const query = sql`
		WITH target_event AS (
			SELECT e.id, e.organization_id, e.status, e.verified_by
			FROM events e
			INNER JOIN memberships m
				ON m.organization_id = e.organization_id
				AND m.user_id = ${currentUser.id}
				AND m.role = 'organizer'
			WHERE e.id = ${eventId}
			FOR UPDATE OF e
		),
		target_segment AS (
			SELECT rs.id, rs.display_name, rs.verified_by, rs.verified_at, rs.source_type
			FROM road_segments rs
			WHERE rs.id = ${data.roadSegmentId}
		),
		inserted AS (
			INSERT INTO road_impacts (
				id, event_id, road_segment_id, planned_from, planned_to,
				impact_type, diversion_note, created_at
			)
			SELECT
				${impactId}::uuid, te.id, ts.id, ${plannedFromDate}::timestamptz, ${plannedToDate}::timestamptz,
				${data.impactType}::text, ${data.diversionNote ?? null}::text, ${now}::timestamptz
			FROM target_event te
			INNER JOIN target_segment ts
				ON ts.verified_by IS NOT NULL
				AND ts.verified_at IS NOT NULL
				AND ts.source_type = 'catalog'
			WHERE te.status IN ('draft', 'review')
			RETURNING *
		),
		updated_event AS (
			UPDATE events e
			SET
				status = 'draft',
				verified_by = NULL,
				verified_at = NULL,
				updated_at = ${now}
			FROM target_event te
			WHERE e.id = te.id
				AND te.status = 'review'
				AND EXISTS (SELECT 1 FROM inserted)
			RETURNING e.id, e.status
		),
		logged AS (
			INSERT INTO audit_logs (
				id, organization_id, event_id, actor_id, action, entity_type, entity_id, before_json, after_json, created_at
			)
			SELECT
				${auditId},
				te.organization_id,
				te.id,
				${currentUser.id},
				'road_impact.created',
				'road_impact',
				i.id,
				jsonb_build_object(
					'eventStatus', te.status,
					'verifiedBy', te.verified_by
				),
				jsonb_build_object(
					'roadSegmentId', i.road_segment_id,
					'plannedFrom', i.planned_from,
					'plannedTo', i.planned_to,
					'impactType', i.impact_type,
					'diversionNote', i.diversion_note,
					'eventStatusAfter', CASE WHEN te.status = 'review' THEN 'draft' ELSE te.status END
				),
				${now}
			FROM inserted i
			CROSS JOIN target_event te
			RETURNING id
		)
		SELECT
			(SELECT count(*)::int FROM target_event) AS "eventFound",
			(SELECT status FROM target_event) AS "eventStatus",
			(SELECT count(*)::int FROM target_segment) AS "segmentFound",
			(SELECT (verified_by IS NOT NULL AND verified_at IS NOT NULL AND source_type = 'catalog') FROM target_segment) AS "segmentVerified",
			(SELECT row_to_json(r) FROM (
				SELECT
					id,
					event_id AS "eventId",
					road_segment_id AS "roadSegmentId",
					planned_from AS "plannedFrom",
					planned_to AS "plannedTo",
					impact_type AS "impactType",
					diversion_note AS "diversionNote",
					created_at AS "createdAt"
				FROM inserted
			) r) AS "createdImpact";
	`;

	const res = await db.execute(query);
	const row = res.rows[0] as
		| {
				eventFound: number;
				eventStatus: string | null;
				segmentFound: number;
				segmentVerified: boolean | null;
				createdImpact: Record<string, unknown> | null;
		  }
		| undefined;

	if (!row || row.eventFound === 0) {
		return sendError(
			c,
			"FORBIDDEN",
			"Organizer permission required to manage planned road impacts.",
			403,
		);
	}

	if (row.eventStatus !== "draft" && row.eventStatus !== "review") {
		return sendError(
			c,
			"STATE_CONFLICT",
			`Road impacts can only be added while an event is in draft or review status (current: ${row.eventStatus}).`,
			409,
		);
	}

	if (row.segmentFound === 0) {
		return sendError(c, "NOT_FOUND", "Road segment not found.", 404);
	}

	if (!row.segmentVerified || !row.createdImpact) {
		return sendError(
			c,
			"VALIDATION_FAILED",
			"Selected road segment has not been verified by a human reviewer. Unverified or synthetic geometry cannot be used for operational road impacts.",
			422,
		);
	}

	const created = row.createdImpact;
	return c.json(
		{
			roadImpact: {
				id: created.id as string,
				eventId: created.eventId as string,
				roadSegmentId: created.roadSegmentId as string,
				plannedFrom: new Date(created.plannedFrom as string).toISOString(),
				plannedTo: new Date(created.plannedTo as string).toISOString(),
				impactType: created.impactType as string,
				diversionNote: (created.diversionNote ?? null) as string | null,
				createdAt: new Date(created.createdAt as string).toISOString(),
			},
		},
		201,
	);
});

/**
 * GET /api/events/:eventId/road-impacts
 * List planned road impacts for an event (Organizers and assigned event officers).
 */
roadsRouter.get("/events/:eventId/road-impacts", async (c) => {
	const currentUser = c.get("user")!;
	const eventId = c.req.param("eventId");

	if (!uuidParamSchema.safeParse(eventId).success) {
		return sendError(c, "VALIDATION_FAILED", "Invalid event ID format.", 422);
	}

	const db = c.get("db");
	const access = await getEventAndCheckAccess(db, eventId, currentUser.id);
	if (access === "NOT_FOUND") {
		return sendError(c, "NOT_FOUND", "Event not found.", 404);
	}
	if (access === "FORBIDDEN") {
		return sendError(
			c,
			"FORBIDDEN",
			"You do not have permission to view road impacts for this event.",
			403,
		);
	}

	const query = sql`
		SELECT
			ri.id,
			ri.event_id AS "eventId",
			ri.road_segment_id AS "roadSegmentId",
			ri.planned_from AS "plannedFrom",
			ri.planned_to AS "plannedTo",
			ri.impact_type AS "impactType",
			ri.diversion_note AS "diversionNote",
			ri.created_at AS "createdAt",
			rs.display_name AS "displayName",
			rs.coverage_area AS "coverageArea",
			ST_AsGeoJSON(rs.geom)::json AS geometry
		FROM road_impacts ri
		INNER JOIN road_segments rs ON ri.road_segment_id = rs.id
		WHERE ri.event_id = ${eventId}
		ORDER BY ri.planned_from ASC;
	`;

	const res = await db.execute(query);
	const impactRows = res.rows as Array<Record<string, unknown>>;

	const latestByImpactId = new Map<
		string,
		{
			status: string;
			observedAt: Date | string;
			expiresAt: Date | string;
			updatedBy: string;
			createdAt?: Date | string;
		}
	>();

	if (impactRows.length > 0) {
		const impactIds = impactRows.map((r) => r.id as string);
		const statusUpdates = await db
			.select()
			.from(roadStatusUpdates)
			.where(inArray(roadStatusUpdates.roadImpactId, impactIds))
			.orderBy(
				desc(roadStatusUpdates.observedAt),
				desc(roadStatusUpdates.createdAt),
			);

		for (const u of statusUpdates) {
			if (!latestByImpactId.has(u.roadImpactId)) {
				latestByImpactId.set(u.roadImpactId, u);
			}
		}
	}

	return c.json(
		{
			roadImpacts: impactRows.map((r: Record<string, unknown>) => {
				const impactId = r.id as string;
				const latest = latestByImpactId.get(impactId) ?? null;
				return {
					id: impactId,
					eventId: r.eventId as string,
					roadSegmentId: r.roadSegmentId as string,
					displayName: r.displayName as string,
					coverageArea: r.coverageArea as string,
					plannedFrom: new Date(r.plannedFrom as string).toISOString(),
					plannedTo: new Date(r.plannedTo as string).toISOString(),
					impactType: r.impactType as string,
					diversionNote: (r.diversionNote ?? null) as string | null,
					geometry: r.geometry,
					operationalStatus: evaluateEffectiveRoadStatus(latest),
					createdAt: new Date(r.createdAt as string).toISOString(),
				};
			}),
		},
		200,
	);
});

/**
 * GET /api/events/:eventId/road-candidates?query=...
 * Suggest verified catalog road candidates based on event announcement extraction and optional user search.
 * Restricted to organizers of the event's organization.
 * Purely deterministic heuristic ranking; no extra AI API call required.
 * Quarantined or unverified segments are strictly excluded.
 */
roadsRouter.get("/events/:eventId/road-candidates", async (c) => {
	const currentUser = c.get("user")!;
	const eventId = c.req.param("eventId");

	if (!uuidParamSchema.safeParse(eventId).success) {
		return sendError(c, "VALIDATION_FAILED", "Invalid event ID format.", 422);
	}

	const db = c.get("db");
	const access = await getEventAndCheckAccess(db, eventId, currentUser.id);
	if (access === "NOT_FOUND") {
		return sendError(c, "NOT_FOUND", "Event not found.", 404);
	}
	if (access === "FORBIDDEN" || !access.isOrganizer) {
		return sendError(
			c,
			"FORBIDDEN",
			"Organizer permission required to view road segment candidates.",
			403,
		);
	}

	const searchQuery = c.req.query("query")?.trim() || "";
	if (searchQuery.length > 100) {
		return sendError(
			c,
			"VALIDATION_FAILED",
			"Search query too long (max 100 characters).",
			422,
		);
	}

	// 1. Gather search targets from optional query and from AI extractions on this event
	const searchTargets: string[] = [];
	if (searchQuery) {
		searchTargets.push(searchQuery);
	}

	// Query latest completed AI extraction for this event to find affected_road_names
	const extractionRows = await db
		.select({ outputJson: aiExtractions.outputJson })
		.from(aiExtractions)
		.innerJoin(documents, eq(documents.id, aiExtractions.documentId))
		.where(
			and(
				eq(documents.eventId, eventId),
				eq(aiExtractions.status, "completed"),
			),
		)
		.orderBy(desc(aiExtractions.createdAt))
		.limit(1);

	const extraction = extractionRows[0]?.outputJson as {
		affected_road_names?: Array<string | { name?: string; value?: string }>;
	} | null;

	if (extraction?.affected_road_names && Array.isArray(extraction.affected_road_names)) {
		for (const item of extraction.affected_road_names) {
			const str = typeof item === "string" ? item : item.name || item.value || "";
			if (str && str.trim()) {
				searchTargets.push(str.trim());
			}
		}
	}

	// 2. Query human-verified catalog segments (quarantined/unverified strictly excluded)
	const segmentsQuery = sql`
		SELECT
			id,
			display_name AS "displayName",
			coverage_area AS "coverageArea",
			verified_by AS "verifiedBy",
			verified_at AS "verifiedAt",
			ST_AsGeoJSON(geom)::json AS geometry
		FROM road_segments
		WHERE verified_by IS NOT NULL
			AND verified_at IS NOT NULL
			AND source_type = 'catalog'
		ORDER BY display_name ASC
		LIMIT 200;
	`;

	const segmentsRes = await db.execute(segmentsQuery);
	const allSegments = segmentsRes.rows as Array<{
		id: string;
		displayName: string;
		coverageArea: string;
		verifiedBy: string;
		verifiedAt: string;
		geometry: Record<string, unknown>;
	}>;

	// 3. Normalization and deterministic heuristic scoring
	function normalizeRoad(s: string): string {
		return s
			.toLowerCase()
			.replace(/\b(jalan|jln|jl)\b\.?/gi, "")
			.replace(/[^a-z0-9]/g, " ")
			.trim()
			.replace(/\s+/g, " ");
	}

	const candidatesMap = new Map<
		string,
		{
			candidateId: string;
			roadSegmentId: string;
			displayName: string;
			coverageArea: string;
			matchScore: number;
			matchMethod: "exact_normalized" | "substring" | "token_overlap" | "catalog_browse";
			reviewRequired: true;
			explanation: string;
			sourceType: "catalog";
			geometry: Record<string, unknown>;
		}
	>();

	// If no search targets, return top catalog segments with catalog_browse method
	if (searchTargets.length === 0) {
		const defaultCandidates = allSegments.slice(0, 10).map((seg) => ({
			candidateId: seg.id,
			roadSegmentId: seg.id,
			displayName: seg.displayName,
			coverageArea: seg.coverageArea,
			matchScore: 0.5,
			matchMethod: "catalog_browse" as const,
			reviewRequired: true as const,
			explanation: "Kandidat dari katalog terverifikasi di wilayah operasional.",
			sourceType: "catalog" as const,
			geometry: seg.geometry,
		}));

		return c.json({ candidates: defaultCandidates }, 200);
	}

	for (const target of searchTargets) {
		const normTarget = normalizeRoad(target);
		if (!normTarget) continue;
		const targetTokens = new Set(
			normTarget.split(" ").filter((t) => t.length > 1),
		);

		for (const seg of allSegments) {
			const normName = normalizeRoad(seg.displayName);
			const normArea = normalizeRoad(seg.coverageArea);
			const nameTokens = normName.split(" ").filter((t) => t.length > 1);

			let score = 0;
			let method: "exact_normalized" | "substring" | "token_overlap" =
				"token_overlap";
			let explanation = "";

			if (normTarget === normName) {
				score = 0.95;
				method = "exact_normalized";
				explanation = `Nama ruas cocok persis dengan '${target}' pada dokumen pengumuman.`;
			} else if (normName.includes(normTarget) || normTarget.includes(normName)) {
				score = 0.85;
				method = "substring";
				explanation = `Nama ruas mengandung bagian dari frasa '${target}' di dokumen.`;
			} else {
				let overlapCount = 0;
				for (const token of nameTokens) {
					if (targetTokens.has(token)) overlapCount++;
				}
				if (overlapCount > 0 && targetTokens.size > 0) {
					const ratio =
						overlapCount / Math.max(nameTokens.length, targetTokens.size);
					score = 0.5 + ratio * 0.35;
					method = "token_overlap";
					explanation = `Memiliki ${overlapCount} kata yang sama dengan '${target}'.`;
				}
			}

			// Area overlap bonus
			if (normArea && normTarget.includes(normArea)) {
				score = Math.min(score + 0.05, 0.99);
			}

			if (score >= 0.4) {
				const existing = candidatesMap.get(seg.id);
				if (!existing || existing.matchScore < score) {
					candidatesMap.set(seg.id, {
						candidateId: seg.id,
						roadSegmentId: seg.id,
						displayName: seg.displayName,
						coverageArea: seg.coverageArea,
						matchScore: Math.round(score * 100) / 100,
						matchMethod: method,
						reviewRequired: true,
						explanation,
						sourceType: "catalog",
						geometry: seg.geometry,
					});
				}
			}
		}
	}

	const sortedCandidates = Array.from(candidatesMap.values())
		.sort((a, b) => b.matchScore - a.matchScore)
		.slice(0, 10);

	return c.json({ candidates: sortedCandidates }, 200);
});

/**
 * PATCH /api/events/:eventId/road-impacts/:impactId
 * Update a planned road impact (Organizer only, draft/review only, verified road segment only).
 */
roadsRouter.patch("/events/:eventId/road-impacts/:impactId", async (c) => {
	const currentUser = c.get("user")!;
	const eventId = c.req.param("eventId");
	const impactId = c.req.param("impactId");

	if (
		!uuidParamSchema.safeParse(eventId).success ||
		!uuidParamSchema.safeParse(impactId).success
	) {
		return sendError(
			c,
			"VALIDATION_FAILED",
			"Invalid event or road impact ID format.",
			422,
		);
	}

	const db = c.get("db");
	const access = await getEventAndCheckAccess(db, eventId, currentUser.id);
	if (access === "NOT_FOUND") {
		return sendError(c, "NOT_FOUND", "Event not found.", 404);
	}
	if (access === "FORBIDDEN" || !access.isOrganizer) {
		return sendError(
			c,
			"FORBIDDEN",
			"Organizer permission required to update planned road impacts.",
			403,
		);
	}

	let body: unknown;
	try {
		body = await c.req.json();
	} catch {
		return sendError(c, "BAD_REQUEST", "Invalid JSON payload.", 400);
	}

	const parseResult = updateRoadImpactSchema.safeParse(body);
	if (!parseResult.success) {
		return sendError(
			c,
			"VALIDATION_FAILED",
			parseResult.error.issues[0]?.message ||
				"Invalid road impact update data.",
			422,
		);
	}

	const data = parseResult.data;

	const hasSegment = data.roadSegmentId !== undefined;
	const hasPlannedFrom = data.plannedFrom !== undefined;
	const hasPlannedTo = data.plannedTo !== undefined;
	const hasImpactType = data.impactType !== undefined;
	const hasDiversionNote = data.diversionNote !== undefined;

	const newPlannedFrom =
		hasPlannedFrom && data.plannedFrom ? new Date(data.plannedFrom) : null;
	const newPlannedTo =
		hasPlannedTo && data.plannedTo ? new Date(data.plannedTo) : null;

	const now = new Date();
	const auditId = crypto.randomUUID();

	const query = sql`
		WITH current_impact AS (
			SELECT
				ri.*,
				e.organization_id,
				e.status AS event_status,
				e.verified_by AS event_verified_by
			FROM road_impacts ri
			INNER JOIN events e ON e.id = ri.event_id
			INNER JOIN memberships m
				ON m.organization_id = e.organization_id
				AND m.user_id = ${currentUser.id}
				AND m.role = 'organizer'
			WHERE ri.id = ${impactId}
				AND ri.event_id = ${eventId}
			FOR UPDATE OF ri, e
		),
		merged AS (
			SELECT
				ci.*,
				CASE WHEN ${hasSegment} THEN ${data.roadSegmentId ?? null}::uuid ELSE ci.road_segment_id END AS next_road_segment_id,
				CASE WHEN ${hasPlannedFrom} THEN ${newPlannedFrom}::timestamptz ELSE ci.planned_from END AS next_planned_from,
				CASE WHEN ${hasPlannedTo} THEN ${newPlannedTo}::timestamptz ELSE ci.planned_to END AS next_planned_to,
				CASE WHEN ${hasImpactType} THEN ${data.impactType ?? null}::text ELSE ci.impact_type END AS next_impact_type,
				CASE WHEN ${hasDiversionNote} THEN ${data.diversionNote ?? null}::text ELSE ci.diversion_note END AS next_diversion_note
			FROM current_impact ci
			WHERE ci.event_status IN ('draft', 'review')
		),
		verified_target AS (
			SELECT
				m.*,
				rs.id AS found_segment_id,
				(rs.verified_by IS NOT NULL AND rs.verified_at IS NOT NULL) AS is_segment_verified,
				(
					m.next_road_segment_id IS DISTINCT FROM m.road_segment_id OR
					m.next_planned_from IS DISTINCT FROM m.planned_from OR
					m.next_planned_to IS DISTINCT FROM m.planned_to OR
					m.next_impact_type IS DISTINCT FROM m.impact_type OR
					m.next_diversion_note IS DISTINCT FROM m.diversion_note
				) AS is_modified
			FROM merged m
			LEFT JOIN road_segments rs ON rs.id = m.next_road_segment_id
		),
		updated_impact AS (
			UPDATE road_impacts ri
			SET
				road_segment_id = vt.next_road_segment_id,
				planned_from = vt.next_planned_from,
				planned_to = vt.next_planned_to,
				impact_type = vt.next_impact_type,
				diversion_note = vt.next_diversion_note
			FROM verified_target vt
			WHERE ri.id = vt.id
				AND vt.found_segment_id IS NOT NULL
				AND vt.is_segment_verified = true
				AND vt.next_planned_to > vt.next_planned_from
			RETURNING ri.*
		),
		updated_event AS (
			UPDATE events e
			SET
				status = 'draft',
				verified_by = NULL,
				verified_at = NULL,
				updated_at = ${now}
			FROM verified_target vt
			WHERE e.id = ${eventId}
				AND vt.event_status = 'review'
				AND vt.is_modified = true
				AND EXISTS (SELECT 1 FROM updated_impact)
			RETURNING e.id, e.status
		),
		logged AS (
			INSERT INTO audit_logs (
				id, organization_id, event_id, actor_id, action, entity_type, entity_id, before_json, after_json, created_at
			)
			SELECT
				${auditId},
				vt.organization_id,
				vt.event_id,
				${currentUser.id},
				'road_impact.updated',
				'road_impact',
				ui.id,
				jsonb_build_object(
					'roadSegmentId', vt.road_segment_id,
					'plannedFrom', vt.planned_from,
					'plannedTo', vt.planned_to,
					'impactType', vt.impact_type,
					'diversionNote', vt.diversion_note,
					'eventStatus', vt.event_status
				),
				jsonb_build_object(
					'roadSegmentId', ui.road_segment_id,
					'plannedFrom', ui.planned_from,
					'plannedTo', ui.planned_to,
					'impactType', ui.impact_type,
					'diversionNote', ui.diversion_note,
					'eventStatusAfter', CASE
						WHEN vt.event_status = 'review' AND vt.is_modified THEN 'draft'
						ELSE vt.event_status
					END
				),
				${now}
			FROM updated_impact ui
			INNER JOIN verified_target vt ON vt.id = ui.id
			RETURNING id
		)
		SELECT
			(SELECT count(*)::int FROM current_impact) AS "impactFound",
			(SELECT event_status FROM current_impact) AS "eventStatus",
			(SELECT found_segment_id FROM verified_target) AS "foundSegmentId",
			(SELECT is_segment_verified FROM verified_target) AS "isSegmentVerified",
			(SELECT (next_planned_to > next_planned_from) FROM verified_target) AS "datesValid",
			(SELECT row_to_json(r) FROM (
				SELECT
					id,
					event_id AS "eventId",
					road_segment_id AS "roadSegmentId",
					planned_from AS "plannedFrom",
					planned_to AS "plannedTo",
					impact_type AS "impactType",
					diversion_note AS "diversionNote",
					created_at AS "createdAt"
				FROM updated_impact
			) r) AS "updatedImpact";
	`;

	const res = await db.execute(query);
	const row = res.rows[0] as
		| {
				impactFound: number;
				eventStatus: string | null;
				foundSegmentId: string | null;
				isSegmentVerified: boolean | null;
				datesValid: boolean | null;
				updatedImpact: Record<string, unknown> | null;
		  }
		| undefined;

	if (!row || row.impactFound === 0) {
		return sendError(
			c,
			"NOT_FOUND",
			"Road impact not found for this event.",
			404,
		);
	}

	if (row.eventStatus !== "draft" && row.eventStatus !== "review") {
		return sendError(
			c,
			"STATE_CONFLICT",
			`Road impacts can only be edited while an event is in draft or review status (current: ${row.eventStatus}).`,
			409,
		);
	}

	if (!row.foundSegmentId) {
		return sendError(c, "NOT_FOUND", "Road segment not found.", 404);
	}

	if (!row.isSegmentVerified) {
		return sendError(
			c,
			"VALIDATION_FAILED",
			"Selected road segment has not been verified by a human reviewer.",
			422,
		);
	}

	if (!row.datesValid || !row.updatedImpact) {
		return sendError(
			c,
			"VALIDATION_FAILED",
			"plannedTo must be strictly after plannedFrom",
			422,
		);
	}

	const updated = row.updatedImpact;
	return c.json(
		{
			roadImpact: {
				id: updated.id as string,
				eventId: updated.eventId as string,
				roadSegmentId: updated.roadSegmentId as string,
				plannedFrom: new Date(updated.plannedFrom as string).toISOString(),
				plannedTo: new Date(updated.plannedTo as string).toISOString(),
				impactType: updated.impactType as string,
				diversionNote: (updated.diversionNote ?? null) as string | null,
				createdAt: new Date(updated.createdAt as string).toISOString(),
			},
		},
		200,
	);
});

/**
 * DELETE /api/events/:eventId/road-impacts/:impactId
 * Remove a planned road impact (Organizer only, draft/review only).
 * Fails with 409 if operational status history already exists for the impact.
 */
roadsRouter.delete("/events/:eventId/road-impacts/:impactId", async (c) => {
	const currentUser = c.get("user")!;
	const eventId = c.req.param("eventId");
	const impactId = c.req.param("impactId");

	if (
		!uuidParamSchema.safeParse(eventId).success ||
		!uuidParamSchema.safeParse(impactId).success
	) {
		return sendError(
			c,
			"VALIDATION_FAILED",
			"Invalid event or road impact ID format.",
			422,
		);
	}

	const db = c.get("db");
	const access = await getEventAndCheckAccess(db, eventId, currentUser.id);
	if (access === "NOT_FOUND") {
		return sendError(c, "NOT_FOUND", "Event not found.", 404);
	}
	if (access === "FORBIDDEN" || !access.isOrganizer) {
		return sendError(
			c,
			"FORBIDDEN",
			"Organizer permission required to delete planned road impacts.",
			403,
		);
	}

	const now = new Date();
	const auditId = crypto.randomUUID();

	const query = sql`
		WITH current_impact AS (
			SELECT
				ri.*,
				e.organization_id,
				e.status AS event_status,
				EXISTS (
					SELECT 1 FROM road_status_updates rsu WHERE rsu.road_impact_id = ri.id
				) AS has_status_history
			FROM road_impacts ri
			INNER JOIN events e ON e.id = ri.event_id
			INNER JOIN memberships m
				ON m.organization_id = e.organization_id
				AND m.user_id = ${currentUser.id}
				AND m.role = 'organizer'
			WHERE ri.id = ${impactId}
				AND ri.event_id = ${eventId}
			FOR UPDATE OF ri, e
		),
		deleted AS (
			DELETE FROM road_impacts ri
			USING current_impact ci
			WHERE ri.id = ci.id
				AND ci.event_status IN ('draft', 'review')
				AND ci.has_status_history = false
			RETURNING ri.*, ci.organization_id, ci.event_status
		),
		updated_event AS (
			UPDATE events e
			SET
				status = 'draft',
				verified_by = NULL,
				verified_at = NULL,
				updated_at = ${now}
			FROM deleted d
			WHERE e.id = d.event_id
				AND d.event_status = 'review'
			RETURNING e.id, e.status
		),
		logged AS (
			INSERT INTO audit_logs (
				id, organization_id, event_id, actor_id, action, entity_type, entity_id, before_json, after_json, created_at
			)
			SELECT
				${auditId},
				d.organization_id,
				d.event_id,
				${currentUser.id},
				'road_impact.deleted',
				'road_impact',
				d.id,
				jsonb_build_object(
					'roadSegmentId', d.road_segment_id,
					'plannedFrom', d.planned_from,
					'plannedTo', d.planned_to,
					'impactType', d.impact_type,
					'diversionNote', d.diversion_note,
					'eventStatus', d.event_status
				),
				jsonb_build_object(
					'deleted', true,
					'eventStatusAfter', CASE WHEN d.event_status = 'review' THEN 'draft' ELSE d.event_status END
				),
				${now}
			FROM deleted d
			RETURNING id
		)
		SELECT
			(SELECT count(*)::int FROM current_impact) AS "impactFound",
			(SELECT event_status FROM current_impact) AS "eventStatus",
			(SELECT has_status_history FROM current_impact) AS "hasStatusHistory",
			(SELECT id FROM deleted) AS "deletedId";
	`;

	const res = await db.execute(query);
	const row = res.rows[0] as
		| {
				impactFound: number;
				eventStatus: string | null;
				hasStatusHistory: boolean | null;
				deletedId: string | null;
		  }
		| undefined;

	if (!row || row.impactFound === 0) {
		return sendError(
			c,
			"NOT_FOUND",
			"Road impact not found for this event.",
			404,
		);
	}

	if (row.eventStatus !== "draft" && row.eventStatus !== "review") {
		return sendError(
			c,
			"STATE_CONFLICT",
			`Road impacts can only be deleted while an event is in draft or review status (current: ${row.eventStatus}).`,
			409,
		);
	}

	if (row.hasStatusHistory || !row.deletedId) {
		return sendError(
			c,
			"STATE_CONFLICT",
			"Cannot delete road impact because append-only operational status history already exists.",
			409,
		);
	}

	return c.json({ deleted: true, id: impactId }, 200);
});

/**
 * POST /api/road-impacts/:impactId/status
 * Append-only operational road status update by an assigned traffic officer (or organizer).
 */
roadsRouter.post("/road-impacts/:impactId/status", async (c) => {
	const currentUser = c.get("user")!;
	const impactId = c.req.param("impactId");

	if (!uuidParamSchema.safeParse(impactId).success) {
		return sendError(
			c,
			"VALIDATION_FAILED",
			"Invalid road impact ID format.",
			422,
		);
	}

	const db = c.get("db");

	// Lookup road impact and owning event
	const impactRows = await db
		.select({
			id: roadImpacts.id,
			eventId: roadImpacts.eventId,
			roadSegmentId: roadImpacts.roadSegmentId,
			organizationId: events.organizationId,
			eventStatus: events.status,
			isSimulation: events.isSimulation,
			hasOperationalAuthority: organizations.hasOperationalAuthority,
		})
		.from(roadImpacts)
		.innerJoin(events, eq(roadImpacts.eventId, events.id))
		.innerJoin(organizations, eq(events.organizationId, organizations.id))
		.where(eq(roadImpacts.id, impactId))
		.limit(1);

	const impact = impactRows[0];
	if (!impact) {
		return sendError(c, "NOT_FOUND", "Road impact not found.", 404);
	}

	const access = await getEventAndCheckAccess(
		db,
		impact.eventId,
		currentUser.id,
		"traffic",
	);
	if (access === "NOT_FOUND") {
		return sendError(c, "NOT_FOUND", "Road impact not found.", 404);
	}
	if (access === "FORBIDDEN") {
		return sendError(
			c,
			"FORBIDDEN",
			"You must be an assigned traffic officer for this event to update road status.",
			403,
		);
	}
	if (!impact.isSimulation && !impact.hasOperationalAuthority) {
		return sendError(c, "FORBIDDEN", "Wewenang operasional organisasi tidak lagi aktif.", 403);
	}

	if (
		impact.eventStatus === "completed" ||
		impact.eventStatus === "cancelled" ||
		impact.eventStatus === "archived"
	) {
		return sendError(
			c,
			"STATE_CONFLICT",
			`Cannot update road status for an event in '${impact.eventStatus}' status.`,
			409,
		);
	}

	let body: unknown;
	try {
		body = await c.req.json();
	} catch {
		return sendError(c, "BAD_REQUEST", "Invalid JSON payload.", 400);
	}

	const parseResult = createRoadStatusSchema.safeParse(body);
	if (!parseResult.success) {
		return sendError(
			c,
			"VALIDATION_FAILED",
			parseResult.error.issues[0]?.message ||
				"Invalid road status update payload.",
			422,
		);
	}

	const data = parseResult.data;
	const now = new Date();
	const observedAtDate = new Date(data.observedAt);
	const requestedNote = data.note ?? null;

	if (
		observedAtDate.getTime() >
		now.getTime() + MAX_FUTURE_OBSERVED_SKEW_MS
	) {
		return sendError(
			c,
			"VALIDATION_FAILED",
			"observedAt timestamp cannot be more than 5 minutes in the future.",
			422,
		);
	}

	if (observedAtDate.getTime() < now.getTime() - MAX_PAST_OBSERVED_AGE_MS) {
		return sendError(
			c,
			"VALIDATION_FAILED",
			"observedAt timestamp is already older than the 2-hour operational freshness window.",
			422,
		);
	}

	// Idempotency precheck
	const existingMutationRows = await db
		.select()
		.from(roadStatusUpdates)
		.where(eq(roadStatusUpdates.mutationId, data.mutationId))
		.limit(1);

	const existingMutation = existingMutationRows[0];
	if (existingMutation) {
		if (existingMutation.roadImpactId !== impactId) {
			return sendError(
				c,
				"STATE_CONFLICT",
				"mutationId has already been used for a different road impact.",
				409,
			);
		}
		if (
			existingMutation.updatedBy !== currentUser.id ||
			existingMutation.status !== data.status ||
			existingMutation.observedAt.getTime() !== observedAtDate.getTime() ||
			(existingMutation.note ?? null) !== requestedNote
		) {
			return sendError(
				c,
				"STATE_CONFLICT",
				"mutationId has already been used with a different status payload.",
				409,
			);
		}

		const impactSummary = {
			id: existingMutation.roadImpactId,
			status: existingMutation.status,
			observedAt: existingMutation.observedAt.toISOString(),
			expiresAt: existingMutation.expiresAt.toISOString(),
			updatedBy: existingMutation.updatedBy,
		};

		return c.json(
			{
				status: existingMutation.status,
				observedAt: existingMutation.observedAt.toISOString(),
				expiresAt: existingMutation.expiresAt.toISOString(),
				updatedBy: existingMutation.updatedBy,
				duplicate: true,
				impact: impactSummary,
				roadImpact: impactSummary,
			},
			200,
		);
	}

	const updateId = crypto.randomUUID();
	const auditId = crypto.randomUUID();
	const expiresAtDate = new Date(
		observedAtDate.getTime() + ROAD_STATUS_TTL_MS,
	);

	// Atomic append-only insert + audit log with row-level lock on event & impact
	// and authoritative membership + traffic assignment verification inside SQL
	const query = sql`
		WITH target_impact AS (
			SELECT
				ri.id,
				ri.event_id,
				e.organization_id,
				e.status AS event_status,
				e.is_simulation,
				o.has_operational_authority,
				m.role AS member_role,
				COALESCE(ea.can_update_traffic, false) AS can_update_traffic
			FROM road_impacts ri
			INNER JOIN events e ON e.id = ri.event_id
			INNER JOIN organizations o ON o.id = e.organization_id
			INNER JOIN memberships m
				ON m.organization_id = e.organization_id
				AND m.user_id = ${currentUser.id}
			LEFT JOIN event_assignments ea
				ON ea.event_id = e.id
				AND ea.user_id = ${currentUser.id}
			WHERE ri.id = ${impactId}
			FOR UPDATE OF ri, e, o
		),
		authorized_impact AS (
			SELECT *
			FROM target_impact
			WHERE event_status NOT IN ('completed', 'cancelled', 'archived')
				AND (is_simulation OR has_operational_authority)
				AND (
					member_role = 'organizer'
					OR (member_role = 'officer' AND can_update_traffic = true)
				)
		),
		inserted AS (
			INSERT INTO road_status_updates (
				id, road_impact_id, status, observed_at, expires_at,
				updated_by, note, mutation_id, created_at
			)
			SELECT
				${updateId}::uuid, ai.id, ${data.status}::text, ${observedAtDate}::timestamptz, ${expiresAtDate}::timestamptz,
				${currentUser.id}::text, ${requestedNote}::text, ${data.mutationId}::uuid, ${now}::timestamptz
			FROM authorized_impact ai
			ON CONFLICT (mutation_id) DO NOTHING
			RETURNING *
		),
		logged AS (
			INSERT INTO audit_logs (
				id, organization_id, event_id, actor_id, action, entity_type, entity_id, before_json, after_json, created_at
			)
			SELECT
				${auditId},
				ai.organization_id,
				ai.event_id,
				${currentUser.id},
				'road_status.updated',
				'road_status_update',
				i.id,
				null,
				jsonb_build_object(
					'roadImpactId', i.road_impact_id,
					'status', i.status,
					'observedAt', i.observed_at,
					'expiresAt', i.expires_at,
					'mutationId', i.mutation_id
				),
				${now}
			FROM inserted i
			CROSS JOIN authorized_impact ai
			RETURNING id
		)
		SELECT
			(SELECT count(*)::int FROM target_impact) AS "impactFound",
			(SELECT event_status FROM target_impact) AS "eventStatus",
			(SELECT count(*)::int FROM authorized_impact) AS "authorizedCount",
			(SELECT row_to_json(r) FROM (
				SELECT
					id,
					road_impact_id AS "roadImpactId",
					status,
					observed_at AS "observedAt",
					expires_at AS "expiresAt",
					updated_by AS "updatedBy",
					mutation_id AS "mutationId",
					created_at AS "createdAt"
				FROM inserted
			) r) AS "createdRow";
	`;

	const res = await db.execute(query);
	const row = res.rows[0] as
		| {
				impactFound: number;
				eventStatus: string | null;
				authorizedCount: number;
				createdRow: Record<string, unknown> | null;
		  }
		| undefined;

	if (!row || row.impactFound === 0) {
		return sendError(c, "NOT_FOUND", "Road impact not found.", 404);
	}

	if (
		row.eventStatus === "completed" ||
		row.eventStatus === "cancelled" ||
		row.eventStatus === "archived"
	) {
		return sendError(
			c,
			"STATE_CONFLICT",
			`Cannot update road status for an event in '${row.eventStatus}' status.`,
			409,
		);
	}

	if (row.authorizedCount === 0) {
		return sendError(
			c,
			"FORBIDDEN",
			"You must be an assigned traffic officer for this event to update road status.",
			403,
		);
	}

	if (!row.createdRow) {
		const raceRows = await db
			.select()
			.from(roadStatusUpdates)
			.where(eq(roadStatusUpdates.mutationId, data.mutationId))
			.limit(1);

		const raceRow = raceRows[0];
		if (!raceRow || raceRow.roadImpactId !== impactId) {
			return sendError(
				c,
				"STATE_CONFLICT",
				"mutationId conflict detected.",
				409,
			);
		}
		if (
			raceRow.updatedBy !== currentUser.id ||
			raceRow.status !== data.status ||
			raceRow.observedAt.getTime() !== observedAtDate.getTime() ||
			(raceRow.note ?? null) !== requestedNote
		) {
			return sendError(
				c,
				"STATE_CONFLICT",
				"mutationId has already been used with a different status payload.",
				409,
			);
		}

		const impactSummary = {
			id: raceRow.roadImpactId,
			status: raceRow.status,
			observedAt: raceRow.observedAt.toISOString(),
			expiresAt: raceRow.expiresAt.toISOString(),
			updatedBy: raceRow.updatedBy,
		};

		return c.json(
			{
				status: raceRow.status,
				observedAt: raceRow.observedAt.toISOString(),
				expiresAt: raceRow.expiresAt.toISOString(),
				updatedBy: raceRow.updatedBy,
				duplicate: true,
				impact: impactSummary,
				roadImpact: impactSummary,
			},
			200,
		);
	}

	const created = row.createdRow;
	const impactSummary = {
		id: created.roadImpactId as string,
		status: created.status as string,
		observedAt: new Date(created.observedAt as string).toISOString(),
		expiresAt: new Date(created.expiresAt as string).toISOString(),
		updatedBy: created.updatedBy as string,
	};

	return c.json(
		{
			status: created.status as string,
			observedAt: impactSummary.observedAt,
			expiresAt: impactSummary.expiresAt,
			updatedBy: created.updatedBy as string,
			duplicate: false,
			impact: impactSummary,
			roadImpact: impactSummary,
		},
		200,
	);
});

/**
 * GET /api/road-impacts/:impactId/status-history
 * Retrieve append-only status update history and current effective freshness status.
 */
roadsRouter.get("/road-impacts/:impactId/status-history", async (c) => {
	const currentUser = c.get("user")!;
	const impactId = c.req.param("impactId");

	if (!uuidParamSchema.safeParse(impactId).success) {
		return sendError(
			c,
			"VALIDATION_FAILED",
			"Invalid road impact ID format.",
			422,
		);
	}

	const db = c.get("db");
	const impactRows = await db
		.select({
			id: roadImpacts.id,
			eventId: roadImpacts.eventId,
		})
		.from(roadImpacts)
		.where(eq(roadImpacts.id, impactId))
		.limit(1);

	const impact = impactRows[0];
	if (!impact) {
		return sendError(c, "NOT_FOUND", "Road impact not found.", 404);
	}

	const access = await getEventAndCheckAccess(
		db,
		impact.eventId,
		currentUser.id,
	);
	if (access === "NOT_FOUND") {
		return sendError(c, "NOT_FOUND", "Road impact not found.", 404);
	}
	if (access === "FORBIDDEN") {
		return sendError(
			c,
			"FORBIDDEN",
			"You do not have permission to view status history for this road impact.",
			403,
		);
	}

	const updates = await db
		.select()
		.from(roadStatusUpdates)
		.where(eq(roadStatusUpdates.roadImpactId, impactId))
		.orderBy(desc(roadStatusUpdates.observedAt), desc(roadStatusUpdates.createdAt))
		.limit(50);

	const effective = evaluateEffectiveRoadStatus(updates[0] || null);

	return c.json(
		{
			roadImpactId: impactId,
			current: effective,
			history: updates.map((u) => ({
				id: u.id,
				status: u.status,
				observedAt: u.observedAt.toISOString(),
				expiresAt: u.expiresAt.toISOString(),
				updatedBy: u.updatedBy,
				note: u.note,
				mutationId: u.mutationId,
				createdAt: u.createdAt.toISOString(),
			})),
		},
		200,
	);
});

export { roadsRouter };
export default roadsRouter;
