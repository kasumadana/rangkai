import { and, asc, desc, eq, gte, inArray, lte, sql } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import {
	cleanupTasks,
	events,
	organizations,
	roadStatusUpdates,
	wasteRecords,
} from "../../db/schema";
import { sendError } from "../lib/errors";
import type { AppVariables, Env } from "../types";
import {
	publicEventsQuerySchema,
	publicRoadImpactsQuerySchema,
} from "../validators/public";
import { evaluateEffectiveRoadStatus } from "./roads";
import { computeRouteSourceSnapshotHash } from "./alternative-routes";
import { BALI_GEOGRAPHIC_BOUNDS } from "../validators/roads";

const publicRouter = new Hono<{
	Bindings: Env;
	Variables: AppVariables;
}>();

const PUBLIC_EVENT_STATUSES = ["published", "active", "completed"] as const;
const PUBLIC_LIST_STATUSES = ["published", "active"] as const;
const publicAuthority = sql`(${events.isSimulation} IS DISTINCT FROM FALSE OR EXISTS (
	SELECT 1 FROM organizations o WHERE o.id = ${events.organizationId} AND o.has_operational_authority = TRUE
))`;

/**
 * GET /api/public/events
 * Read-only anonymous list of published/active events.
 * Excludes draft, review, cancelled, completed, and archived events, and strips all private fields.
 */
publicRouter.get("/events", async (c) => {
	const db = c.get("db");
	const queryParse = publicEventsQuerySchema.safeParse(c.req.query());
	if (!queryParse.success) {
		return sendError(
			c,
			"VALIDATION_FAILED",
			queryParse.error.issues[0]?.message || "Invalid query parameters.",
			422,
		);
	}

	const { status, from, to, bbox, page, limit } = queryParse.data;
	const conditions = [
		publicAuthority,
		status
			? eq(events.status, status)
			: inArray(events.status, [...PUBLIC_LIST_STATUSES]),
	];
	if (from) {
		conditions.push(gte(events.endsAt, new Date(from)));
	}
	if (to) {
		conditions.push(lte(events.startsAt, new Date(to)));
	}
	if (bbox) {
		const [minLng, minLat, maxLng, maxLat] = bbox
			.split(",")
			.map((s) => Number(s.trim()));
		conditions.push(
			sql`EXISTS (
				SELECT 1
				FROM road_impacts ri
				INNER JOIN road_segments rs ON ri.road_segment_id = rs.id
				WHERE ri.event_id = ${events.id}
					AND ((rs.source_type = 'catalog' AND rs.verified_by IS NOT NULL AND rs.verified_at IS NOT NULL)
						OR (${events.isSimulation} AND rs.source_type = 'simulation_draft' AND rs.organization_id = ${events.organizationId}))
					AND ST_Intersects(
						rs.geom,
						ST_MakeEnvelope(${minLng}, ${minLat}, ${maxLng}, ${maxLat}, 4326)
					)
			)`,
		);
	}

	const whereClause = and(...conditions);

	const countRes = await db
		.select({ count: sql<number>`count(*)::int` })
		.from(events)
		.where(whereClause);

	const total = countRes[0]?.count ?? 0;
	const totalPages = Math.ceil(total / limit);
	const offset = (page - 1) * limit;

	const rows = await db
		.select({
			id: events.id,
			organizationId: events.organizationId,
			title: events.title,
			slug: events.publicSlug,
			category: events.category,
			description: events.description,
			venueName: events.venueName,
			startsAt: events.startsAt,
			endsAt: events.endsAt,
			status: events.status,
			isSimulation: events.isSimulation,
			publishedAt: events.publishedAt,
			organizationName: organizations.name,
			village: organizations.village,
			district: organizations.district,
		})
		.from(events)
		.innerJoin(organizations, eq(events.organizationId, organizations.id))
		.where(whereClause)
		.orderBy(asc(events.startsAt), desc(events.publishedAt))
		.limit(limit)
		.offset(offset);

	return c.json(
		{
			events: rows.map((r) => ({
				id: r.id,
				title: r.title,
				slug: r.slug,
				publicSlug: r.slug,
				category: r.category,
				description: r.description,
				venueName: r.venueName,
				startsAt: r.startsAt ? r.startsAt.toISOString() : null,
				endsAt: r.endsAt ? r.endsAt.toISOString() : null,
				status: r.status,
				isSimulation: r.isSimulation !== false,
				publishedAt: r.publishedAt ? r.publishedAt.toISOString() : null,
				organization: {
					name: r.organizationName,
					village: r.village,
					district: r.district,
				},
			})),
			pagination: {
				page,
				limit,
				total,
				totalPages,
			},
		},
		200,
	);
});

/**
 * GET /api/public/events/:slug
 * Public event detail by publicSlug.
 * Never exposes private documents, R2 keys, internal IDs of actors, or permit references.
 */
publicRouter.get("/events/:slug", async (c) => {
	const slug = c.req.param("slug")?.trim();
	if (!slug) {
		return sendError(c, "VALIDATION_FAILED", "Event slug is required.", 422);
	}

	const db = c.get("db");
	const rows = await db
		.select({
			id: events.id,
			title: events.title,
			slug: events.publicSlug,
			category: events.category,
			description: events.description,
			venueName: events.venueName,
			processionDescription: events.processionDescription,
			trafficImpactDescription: events.trafficImpactDescription,
			organizerName: events.organizerName,
			startsAt: events.startsAt,
			endsAt: events.endsAt,
			status: events.status,
			isSimulation: events.isSimulation,
			publishedAt: events.publishedAt,
			updatedAt: events.updatedAt,
			organizationName: organizations.name,
			village: organizations.village,
			district: organizations.district,
		})
		.from(events)
		.innerJoin(organizations, eq(events.organizationId, organizations.id))
		.where(
			and(
				eq(events.publicSlug, slug),
				inArray(events.status, [...PUBLIC_EVENT_STATUSES]),
				publicAuthority,
			),
		)
		.limit(1);

	const event = rows[0];
	if (!event) {
		return sendError(c, "NOT_FOUND", "Published event not found.", 404);
	}

	return c.json(
		{
			event: {
				id: event.id,
				title: event.title,
				slug: event.slug,
				publicSlug: event.slug,
				category: event.category,
				description: event.description,
				venueName: event.venueName,
				processionDescription: event.processionDescription,
				trafficImpactDescription: event.trafficImpactDescription,
				organizerName: event.organizerName,
				startsAt: event.startsAt ? event.startsAt.toISOString() : null,
				endsAt: event.endsAt ? event.endsAt.toISOString() : null,
				status: event.status,
				isSimulation: event.isSimulation !== false,
				publishedAt: event.publishedAt ? event.publishedAt.toISOString() : null,
				updatedAt: event.updatedAt.toISOString(),
				organization: {
					name: event.organizationName,
					village: event.village,
					district: event.district,
				},
			},
		},
		200,
	);
});

/**
 * GET /api/public/events/:slug/roads
 * Public road impacts and operational status for a published/active/completed event.
 * Domain invariants (AGENTS.md §13):
 * - Only genuinely human-verified road segments (rs.verified_by IS NOT NULL AND rs.verified_at IS NOT NULL)
 *   are ever returned on public endpoints; unverified/synthetic segments are strictly excluded.
 * - Expired status is displayed as unconfirmed (effectiveStatus: "unconfirmed", isStale: true).
 * - Never silently converts expired status to "open".
 */
publicRouter.get("/events/:slug/roads", async (c) => {
	const slug = c.req.param("slug")?.trim();
	if (!slug) {
		return sendError(c, "VALIDATION_FAILED", "Event slug is required.", 422);
	}

	const db = c.get("db");
	const eventRows = await db
		.select({
			id: events.id,
			organizationId: events.organizationId,
			title: events.title,
			slug: events.publicSlug,
			status: events.status,
			isSimulation: events.isSimulation,
		})
		.from(events)
		.where(
			and(
				eq(events.publicSlug, slug),
				inArray(events.status, [...PUBLIC_EVENT_STATUSES]),
				publicAuthority,
			),
		)
		.limit(1);

	const event = eventRows[0];
	if (!event) {
		return sendError(c, "NOT_FOUND", "Published event not found.", 404);
	}

	const impactsQuery = sql`
		SELECT
			ri.id,
			ri.road_segment_id AS "roadSegmentId",
			ri.planned_from AS "plannedFrom",
			ri.planned_to AS "plannedTo",
			ri.impact_type AS "impactType",
			ri.diversion_note AS "diversionNote",
			rs.display_name AS "displayName",
			rs.coverage_area AS "coverageArea",
			ST_AsGeoJSON(rs.geom)::json AS geometry
		FROM road_impacts ri
		INNER JOIN road_segments rs ON ri.road_segment_id = rs.id
		WHERE ri.event_id = ${event.id}
			AND ((rs.source_type = 'catalog' AND rs.verified_by IS NOT NULL AND rs.verified_at IS NOT NULL)
				OR (${event.isSimulation} AND rs.source_type = 'simulation_draft' AND rs.organization_id = ${event.organizationId}))
		ORDER BY ri.planned_from ASC;
	`;

	const impactsRes = await db.execute(impactsQuery);
	const impactRows = impactsRes.rows as Array<Record<string, unknown>>;

	if (impactRows.length === 0) {
		return c.json(
			{
				eventSlug: event.slug,
				isSimulation: event.isSimulation !== false,
				roads: [],
				roadImpacts: [],
			},
			200,
		);
	}

	const impactIds = impactRows.map((r) => r.id as string);
	const allStatusUpdates = await db
		.select()
		.from(roadStatusUpdates)
		.where(inArray(roadStatusUpdates.roadImpactId, impactIds))
		.orderBy(
			desc(roadStatusUpdates.observedAt),
			desc(roadStatusUpdates.createdAt),
		);

	const latestByImpactId = new Map<
		string,
		(typeof allStatusUpdates)[number]
	>();
	for (const update of allStatusUpdates) {
		if (!latestByImpactId.has(update.roadImpactId)) {
			latestByImpactId.set(update.roadImpactId, update);
		}
	}

	const now = new Date();
	const roads = impactRows.map((impact) => {
		const latest = latestByImpactId.get(impact.id as string) || null;
		const statusEval = evaluateEffectiveRoadStatus(latest, now);

		return {
			id: impact.id as string,
			roadSegmentId: impact.roadSegmentId as string,
			displayName: impact.displayName as string,
			coverageArea: impact.coverageArea as string,
			plannedFrom: new Date(impact.plannedFrom as string).toISOString(),
			plannedTo: new Date(impact.plannedTo as string).toISOString(),
			impactType: impact.impactType as string,
			diversionNote: (impact.diversionNote ?? null) as string | null,
			geometry: impact.geometry,
			operationalStatus: {
				effectiveStatus: statusEval.effectiveStatus,
				rawStatus: statusEval.rawStatus,
				isStale: statusEval.isStale,
				observedAt: statusEval.observedAt,
				expiresAt: statusEval.expiresAt,
			},
		};
	});

	return c.json(
		{
			event: {
				id: event.id,
				title: event.title,
				status: event.status,
				isSimulation: event.isSimulation !== false,
				slug: event.slug,
				publicSlug: event.slug,
			},
			eventSlug: event.slug,
			isSimulation: event.isSimulation !== false,
			roads,
			roadImpacts: roads,
		},
		200,
	);
});

/**
 * GET /api/public/road-impacts
 * Aggregate read-only GeoJSON FeatureCollection of verified public road impacts across all active/published events.
 * Filterable by bounding box (bbox=west,south,east,north), time interval (from, to), status, and bounded limit.
 * Excludes drafts, reviews, unverified geometry, and private operational data.
 */
publicRouter.get("/road-impacts", async (c) => {
	const db = c.get("db");
	const queryParse = publicRoadImpactsQuerySchema.safeParse(c.req.query());
	if (!queryParse.success) {
		return sendError(
			c,
			"VALIDATION_FAILED",
			queryParse.error.issues[0]?.message || "Invalid query parameters.",
			422,
		);
	}

	const { bbox, from, to, status, operationalStatus, eventStatus, page, limit } = queryParse.data;
	const roadStatusFilter = status || operationalStatus;

	const conditions: Array<ReturnType<typeof sql>> = [
		sql`(${events.isSimulation} IS DISTINCT FROM FALSE OR EXISTS (
			SELECT 1 FROM organizations o WHERE o.id = ${events.organizationId} AND o.has_operational_authority = TRUE
		))`,
		eventStatus
			? sql`${events.status} = ${eventStatus}`
			: sql`${events.status} IN ('published', 'active')`,
		sql`((rs.source_type = 'catalog' AND rs.verified_by IS NOT NULL AND rs.verified_at IS NOT NULL)
			OR (${events.isSimulation} AND rs.source_type = 'simulation_draft' AND rs.organization_id = ${events.organizationId}))`,
	];

	if (roadStatusFilter === "unconfirmed") {
		conditions.push(sql`(latest_status.status IS NULL OR latest_status.expires_at < NOW())`);
	} else if (roadStatusFilter) {
		conditions.push(sql`(latest_status.status = ${roadStatusFilter} AND latest_status.expires_at >= NOW())`);
	}

	if (from) {
		const fromDate = new Date(from);
		conditions.push(sql`${events.endsAt} >= ${fromDate}`);
		conditions.push(sql`ri.planned_to >= ${fromDate}`);
	}

	if (to) {
		const toDate = new Date(to);
		conditions.push(sql`${events.startsAt} <= ${toDate}`);
		conditions.push(sql`ri.planned_from <= ${toDate}`);
	}

	if (bbox) {
		const [minLng, minLat, maxLng, maxLat] = bbox
			.split(",")
			.map((s) => Number(s.trim()));
		conditions.push(
			sql`ST_Intersects(rs.geom, ST_MakeEnvelope(${minLng}, ${minLat}, ${maxLng}, ${maxLat}, 4326))`,
		);
	}

	const whereSql = sql.join(conditions, sql` AND `);

	// Count total matching impacts
	const countQuery = sql`
		SELECT count(*)::int AS total
		FROM road_impacts ri
		INNER JOIN events ON events.id = ri.event_id
		INNER JOIN road_segments rs ON rs.id = ri.road_segment_id
		LEFT JOIN LATERAL (
			SELECT rsu.status, rsu.observed_at, rsu.expires_at
			FROM road_status_updates rsu
			WHERE rsu.road_impact_id = ri.id
			ORDER BY rsu.observed_at DESC, rsu.created_at DESC
			LIMIT 1
		) latest_status ON true
		WHERE ${whereSql};
	`;

	const countRes = await db.execute(countQuery);
	const total = (countRes.rows[0] as { total: number } | undefined)?.total ?? 0;
	const totalPages = Math.ceil(total / limit);
	const offset = (page - 1) * limit;

	// Fetch page with latest status update joined atomically via DISTINCT ON
	const dataQuery = sql`
		SELECT
			ri.id AS "impactId",
			ri.road_segment_id AS "roadSegmentId",
			ri.event_id AS "eventId",
			events.public_slug AS "eventSlug",
			events.title AS "eventTitle",
			events.is_simulation AS "isSimulation",
			rs.display_name AS "displayName",
			rs.coverage_area AS "coverageArea",
			ri.planned_from AS "plannedFrom",
			ri.planned_to AS "plannedTo",
			ri.impact_type AS "impactType",
			ri.diversion_note AS "diversionNote",
			ST_AsGeoJSON(rs.geom)::json AS geometry,
			latest_status.status AS "status",
			latest_status.observed_at AS "observedAt",
			latest_status.expires_at AS "expiresAt",
			latest_status.updated_by AS "updatedBy"
		FROM road_impacts ri
		INNER JOIN events ON events.id = ri.event_id
		INNER JOIN road_segments rs ON rs.id = ri.road_segment_id
		LEFT JOIN LATERAL (
			SELECT rsu.status, rsu.observed_at, rsu.expires_at, rsu.updated_by
			FROM road_status_updates rsu
			WHERE rsu.road_impact_id = ri.id
			ORDER BY rsu.observed_at DESC, rsu.created_at DESC
			LIMIT 1
		) latest_status ON true
		WHERE ${whereSql}
		ORDER BY ri.planned_from ASC, ri.id ASC
		LIMIT ${limit}
		OFFSET ${offset};
	`;

	const dataRes = await db.execute(dataQuery);
	const rows = dataRes.rows as Array<{
		impactId: string;
		roadSegmentId: string;
		eventId: string;
		eventSlug: string;
		eventTitle: string;
		isSimulation: boolean;
		displayName: string;
		coverageArea: string;
		plannedFrom: string | Date;
		plannedTo: string | Date;
		impactType: string;
		diversionNote: string | null;
		geometry: Record<string, unknown>;
		status: string | null;
		observedAt: string | Date | null;
		expiresAt: string | Date | null;
		updatedBy: string | null;
	}>;

	const now = new Date();
	const features = rows.map((r) => {
		const statusEval = evaluateEffectiveRoadStatus(
			r.status
				? {
						status: r.status,
						observedAt: r.observedAt!,
						expiresAt: r.expiresAt!,
						updatedBy: r.updatedBy ?? "",
					}
				: null,
			now,
		);

		return {
			type: "Feature" as const,
			id: r.impactId,
			geometry: r.geometry,
			properties: {
				impactId: r.impactId,
				roadSegmentId: r.roadSegmentId,
				eventId: r.eventId,
				eventSlug: r.eventSlug,
				eventTitle: r.eventTitle,
				displayName: r.displayName,
				coverageArea: r.coverageArea,
				impactType: r.impactType,
				plannedFrom: r.plannedFrom ? new Date(r.plannedFrom).toISOString() : null,
				plannedTo: r.plannedTo ? new Date(r.plannedTo).toISOString() : null,
				diversionNote: r.diversionNote ?? null,
				effectiveStatus: statusEval.effectiveStatus,
				rawStatus: statusEval.rawStatus,
				isStale: statusEval.isStale,
				observedAt: statusEval.observedAt,
				expiresAt: statusEval.expiresAt,
				isSimulation: r.isSimulation !== false,
			},
		};
	});

	return c.json(
		{
			type: "FeatureCollection" as const,
			features,
			pagination: {
				page,
				limit,
				total,
				totalPages,
				truncated: total > page * limit,
			},
		},
		200,
	);
});

/**
 * GET /api/public/events/:slug/cleanup-summary
 * Public post-event cleanup and waste summary.
 * Distinguishes weighed weight, estimated weight, and sack counts (never converts estimates into measured facts).
 * Strips all private evidence keys, officer IDs, and internal notes.
 */
publicRouter.get("/events/:slug/cleanup-summary", async (c) => {
	const slug = c.req.param("slug")?.trim();
	if (!slug) {
		return sendError(c, "VALIDATION_FAILED", "Event slug is required.", 422);
	}

	const db = c.get("db");
	const eventRows = await db
		.select({
			id: events.id,
			slug: events.publicSlug,
			title: events.title,
			status: events.status,
			isSimulation: events.isSimulation,
		})
		.from(events)
		.where(
			and(
				eq(events.publicSlug, slug),
				inArray(events.status, [...PUBLIC_EVENT_STATUSES]),
				publicAuthority,
			),
		)
		.limit(1);

	const event = eventRows[0];
	if (!event) {
		return sendError(c, "NOT_FOUND", "Published event not found.", 404);
	}

	const tasks = await db
		.select({
			status: cleanupTasks.status,
		})
		.from(cleanupTasks)
		.where(eq(cleanupTasks.eventId, event.id));

	const taskCounts = {
		total: tasks.length,
		todo: 0,
		inProgress: 0,
		submitted: 0,
		verified: 0,
		reopened: 0,
	};

	for (const t of tasks) {
		if (t.status === "todo") taskCounts.todo++;
		else if (t.status === "in_progress") taskCounts.inProgress++;
		else if (t.status === "submitted") taskCounts.submitted++;
		else if (t.status === "verified") taskCounts.verified++;
		else if (t.status === "reopened") taskCounts.reopened++;
	}

	const wastes = await db
		.select({
			category: wasteRecords.category,
			quantityKg: wasteRecords.quantityKg,
			sackCount: wasteRecords.sackCount,
			measurementMethod: wasteRecords.measurementMethod,
		})
		.from(wasteRecords)
		.where(eq(wasteRecords.eventId, event.id));

	let totalWeighedKg = 0;
	let totalEstimatedKg = 0;
	let totalSacks = 0;

	const byCategory: Record<
		"organic" | "recyclable" | "residual",
		{ weighedKg: number; estimatedKg: number; totalSacks: number }
	> = {
		organic: { weighedKg: 0, estimatedKg: 0, totalSacks: 0 },
		recyclable: { weighedKg: 0, estimatedKg: 0, totalSacks: 0 },
		residual: { weighedKg: 0, estimatedKg: 0, totalSacks: 0 },
	};

	for (const w of wastes) {
		const cat = w.category as "organic" | "recyclable" | "residual";
		const kg = w.quantityKg !== null ? Number(w.quantityKg) : 0;
		const sacks = w.sackCount ?? 0;

		if (w.measurementMethod === "weighed") {
			totalWeighedKg += kg;
			if (byCategory[cat]) {
				byCategory[cat].weighedKg += kg;
			}
		} else {
			totalEstimatedKg += kg;
			if (byCategory[cat]) {
				byCategory[cat].estimatedKg += kg;
			}
		}

		totalSacks += sacks;
		if (byCategory[cat]) {
			byCategory[cat].totalSacks += sacks;
		}
	}

	const roundedByCategory = {
		organic: {
			weighedKg: Number(byCategory.organic.weighedKg.toFixed(2)),
			estimatedKg: Number(byCategory.organic.estimatedKg.toFixed(2)),
			totalSacks: byCategory.organic.totalSacks,
			sackCount: byCategory.organic.totalSacks,
		},
		recyclable: {
			weighedKg: Number(byCategory.recyclable.weighedKg.toFixed(2)),
			estimatedKg: Number(byCategory.recyclable.estimatedKg.toFixed(2)),
			totalSacks: byCategory.recyclable.totalSacks,
			sackCount: byCategory.recyclable.totalSacks,
		},
		residual: {
			weighedKg: Number(byCategory.residual.weighedKg.toFixed(2)),
			estimatedKg: Number(byCategory.residual.estimatedKg.toFixed(2)),
			totalSacks: byCategory.residual.totalSacks,
			sackCount: byCategory.residual.totalSacks,
		},
	};

	const wasteTotals = {
		weighedKg: Number(totalWeighedKg.toFixed(2)),
		estimatedKg: Number(totalEstimatedKg.toFixed(2)),
		totalSacks,
		sackCount: totalSacks,
		byCategory: roundedByCategory,
	};

	return c.json(
		{
			event: {
				id: event.id,
				title: event.title,
				status: event.status,
				isSimulation: event.isSimulation !== false,
				slug: event.slug,
				publicSlug: event.slug,
			},
			eventSlug: event.slug,
			isSimulation: event.isSimulation !== false,
			summary: {
				totalTasks: taskCounts.total,
				verifiedTasks: taskCounts.verified,
				submittedTasks: taskCounts.submitted,
				inProgressTasks: taskCounts.inProgress,
				todoTasks: taskCounts.todo,
				reopenedTasks: taskCounts.reopened,
			},
			wasteTotals: {
				weighedKg: wasteTotals.weighedKg,
				estimatedKg: wasteTotals.estimatedKg,
				totalSacks: wasteTotals.totalSacks,
			},
			byCategory: roundedByCategory,
			cleanupSummary: {
				totalTasks: taskCounts.total,
				verifiedTasks: taskCounts.verified,
				submittedTasks: taskCounts.submitted,
				inProgressTasks: taskCounts.inProgress,
				todoTasks: taskCounts.todo,
				reopenedTasks: taskCounts.reopened,
				tasks: taskCounts,
				wasteTotals,
			},
		},
		200,
	);
});

/**
 * GET /api/public/events/:slug/alternative-routes
 * Anonymous read-only list of approved alternative routes for a published/active/completed event.
 * Never returns draft or revoked alternative routes.
 */
publicRouter.get("/events/:slug/alternative-routes", async (c) => {
	const slug = c.req.param("slug")?.trim();
	if (!slug) {
		return sendError(c, "VALIDATION_FAILED", "Event slug is required.", 422);
	}

	const db = c.get("db");
	const eventRows = await db
		.select({
			id: events.id,
			slug: events.publicSlug,
			status: events.status,
			isSimulation: events.isSimulation,
		})
		.from(events)
		.where(
			and(
				eq(events.publicSlug, slug),
				inArray(events.status, ["published", "active"]),
				publicAuthority,
			),
		)
		.limit(1);

	const event = eventRows[0];
	if (!event) {
		return sendError(c, "NOT_FOUND", "Published event not found.", 404);
	}

	// Material road impacts freshness & snapshot comparison (SPEC-07)
	const impactsQuery = sql`
		SELECT id, planned_from AS "plannedFrom", planned_to AS "plannedTo", impact_type AS "impactType"
		FROM road_impacts
		WHERE event_id = ${event.id}
		ORDER BY planned_from ASC;
	`;
	const impactsRes = await db.execute(impactsQuery);
	const impacts = impactsRes.rows as Array<{
		id: string;
		plannedFrom: string | Date;
		plannedTo: string | Date;
		impactType: string;
	}>;

	if (impacts.length === 0) {
		return c.json({
			eventSlug: event.slug,
			isSimulation: event.isSimulation !== false,
			alternativeRoutes: [],
		});
	}

	const currentSourceSnapshotHash = computeRouteSourceSnapshotHash(impacts);

	const query = sql`
		SELECT
			id,
			name,
			description,
			approved_at AS "approvedAt",
			ST_AsGeoJSON(geom)::json AS geometry
		FROM event_alternative_routes
		WHERE event_id = ${event.id}
			AND status = 'approved'
			AND source_snapshot_hash IS NOT NULL
			AND source_snapshot_hash = ${currentSourceSnapshotHash}
			AND (expires_at IS NULL OR expires_at > NOW())
			AND EXISTS (
				SELECT 1 FROM road_impacts ri
				WHERE ri.event_id = ${event.id}
					AND ri.planned_to > NOW()
			)
		ORDER BY approved_at ASC;
	`;

	const res = await db.execute(query);
	const rows = res.rows as Array<{
		id: string;
		name: string;
		description: string | null;
		approvedAt: string | Date;
		geometry: Record<string, unknown>;
	}>;

	return c.json(
		{
			eventSlug: event.slug,
			isSimulation: event.isSimulation !== false,
			alternativeRoutes: rows.map((r) => ({
				id: r.id,
				name: r.name,
				description: r.description,
				provenance: "organizer_approved_manual_simulation",
				approvedAt: new Date(r.approvedAt).toISOString(),
				geometry: r.geometry,
			})),
		},
		200,
	);
});

const networkRoutingSchema = z.object({
	origin: z.tuple([
		z.number().refine(
			(n) =>
				Number.isFinite(n) &&
				n >= BALI_GEOGRAPHIC_BOUNDS.minLng &&
				n <= BALI_GEOGRAPHIC_BOUNDS.maxLng,
			{ message: "Titik asal (origin longitude) harus di wilayah Bali." },
		),
		z.number().refine(
			(n) =>
				Number.isFinite(n) &&
				n >= BALI_GEOGRAPHIC_BOUNDS.minLat &&
				n <= BALI_GEOGRAPHIC_BOUNDS.maxLat,
			{ message: "Titik asal (origin latitude) harus di wilayah Bali." },
		),
	]),
	destination: z.tuple([
		z.number().refine(
			(n) =>
				Number.isFinite(n) &&
				n >= BALI_GEOGRAPHIC_BOUNDS.minLng &&
				n <= BALI_GEOGRAPHIC_BOUNDS.maxLng,
			{ message: "Titik tujuan (destination longitude) harus di wilayah Bali." },
		),
		z.number().refine(
			(n) =>
				Number.isFinite(n) &&
				n >= BALI_GEOGRAPHIC_BOUNDS.minLat &&
				n <= BALI_GEOGRAPHIC_BOUNDS.maxLat,
			{ message: "Titik tujuan (destination latitude) harus di wilayah Bali." },
		),
	]),
	profile: z
		.enum(["driving-car", "cycling-regular", "foot-walking"])
		.default("driving-car"),
	eventSlug: z.string().trim().max(100).optional(),
});

/**
 * POST /api/public/routes/alternatives (Ticket 07)
 * Network routing candidate with avoidance of road closures.
 * Enforces conditional gate: if ORS_API_KEY is not configured or NETWORK_ROUTING_ENABLED !== 'true',
 * returns honest 503 SERVICE_UNAVAILABLE pointing to verified manual alternative routes.
 */
publicRouter.post("/routes/alternatives", async (c) => {
	let body: unknown;
	try {
		body = await c.req.json();
	} catch {
		return sendError(c, "BAD_REQUEST", "Invalid JSON payload.", 400);
	}

	const parsed = networkRoutingSchema.safeParse(body);
	if (!parsed.success) {
		return sendError(
			c,
			"VALIDATION_FAILED",
			parsed.error.issues[0]?.message || "Invalid routing parameters.",
			422,
		);
	}

	const orsApiKey = c.env?.ORS_API_KEY;
	const isEnabled = c.env?.NETWORK_ROUTING_ENABLED === "true";
	const requestId = (c.get("requestId") as string) || "unknown";

	// Ticket 07: Unconditionally unavailable safe gate (SPEC-01)
	// Network routing capability is deferred. Real-network obstacle avoidance polygon
	// calculation and LineString safety validation against closures is not implemented/reviewed.
	// We strictly do NOT retain a dormant unsafe success path that config/keys can activate.
	// Never makes external requests to providers and never invents pretend network geometry.
	return c.json(
		{
			error: {
				code: "SERVICE_UNAVAILABLE",
				message:
					"Network routing is temporarily unavailable. Avoidance polygon validation is not certified. Please consult reviewed manual alternative routes for active events.",
				requestId,
				details: {
					configured: Boolean(isEnabled && orsApiKey),
					deferred: true,
					alternativeRoutesUrl: "/api/public/events/:slug/alternative-routes",
					ticket: "07",
				},
			},
		},
		503,
	);
});

export { publicRouter };
export default publicRouter;
