import { and, asc, desc, eq, gte, inArray, lte, sql } from "drizzle-orm";
import { Hono } from "hono";
import {
	cleanupTasks,
	events,
	organizations,
	roadStatusUpdates,
	wasteRecords,
} from "../../db/schema";
import { sendError } from "../lib/errors";
import type { AppVariables, Env } from "../types";
import { publicEventsQuerySchema } from "../validators/public";
import { evaluateEffectiveRoadStatus } from "./roads";

const publicRouter = new Hono<{
	Bindings: Env;
	Variables: AppVariables;
}>();

const PUBLIC_EVENT_STATUSES = ["published", "active", "completed"] as const;
const PUBLIC_LIST_STATUSES = ["published", "active"] as const;

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
					AND rs.verified_by IS NOT NULL
					AND rs.verified_at IS NOT NULL
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
				isSimulation: Boolean(event.isSimulation),
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
			title: events.title,
			slug: events.publicSlug,
			status: events.status,
		})
		.from(events)
		.where(
			and(
				eq(events.publicSlug, slug),
				inArray(events.status, [...PUBLIC_EVENT_STATUSES]),
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
			AND rs.verified_by IS NOT NULL
			AND rs.verified_at IS NOT NULL
		ORDER BY ri.planned_from ASC;
	`;

	const impactsRes = await db.execute(impactsQuery);
	const impactRows = impactsRes.rows as Array<Record<string, unknown>>;

	if (impactRows.length === 0) {
		return c.json(
			{
				eventSlug: event.slug,
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
				slug: event.slug,
				publicSlug: event.slug,
			},
			eventSlug: event.slug,
			roads,
			roadImpacts: roads,
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
		})
		.from(events)
		.where(
			and(
				eq(events.publicSlug, slug),
				inArray(events.status, [...PUBLIC_EVENT_STATUSES]),
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
				slug: event.slug,
				publicSlug: event.slug,
			},
			eventSlug: event.slug,
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

export { publicRouter };
export default publicRouter;
