import { and, eq, inArray, sql } from "drizzle-orm";
import { Hono } from "hono";
import { cleanupTasks, events, wasteRecords } from "../../db/schema";
import { sendError } from "../lib/errors";
import type { AppVariables, Env } from "../types";
import { publicEventsQuerySchema } from "../validators/public";

export const publicRouter = new Hono<{
	Bindings: Env;
	Variables: AppVariables;
}>();

// GET /api/public/events - Public published and active events list
publicRouter.get("/events", async (c) => {
	const db = c.get("db");

	const queryParse = publicEventsQuerySchema.safeParse(c.req.query());
	if (!queryParse.success) {
		return sendError(
			c,
			"VALIDATION_FAILED",
			queryParse.error.issues[0]?.message || "Invalid public query parameters.",
			422,
		);
	}

	const { from, to, bbox } = queryParse.data;

	const conditions: ReturnType<typeof sql>[] = [
		sql`events.status IN ('published', 'active')`,
	];

	if (from) {
		const fromDate = new Date(from);
		conditions.push(
			sql`(events.ends_at >= ${fromDate} OR (events.ends_at IS NULL AND events.starts_at >= ${fromDate}))`,
		);
	}

	if (to) {
		const toDate = new Date(to);
		conditions.push(sql`events.starts_at <= ${toDate}`);
	}

	if (bbox) {
		const [minLng, minLat, maxLng, maxLat] = bbox
			.split(",")
			.map((s) => parseFloat(s.trim()));
		conditions.push(sql`
			EXISTS (
				SELECT 1 FROM road_impacts ri
				INNER JOIN road_segments rs ON ri.road_segment_id = rs.id
				WHERE ri.event_id = events.id
					AND ST_Intersects(rs.geom, ST_MakeEnvelope(${minLng}, ${minLat}, ${maxLng}, ${maxLat}, 4326))
			)
		`);
	}

	const whereClause =
		conditions.length > 1
			? sql.join(conditions, sql` AND `)
			: conditions[0];

	const query = sql`
		SELECT
			id,
			public_slug AS "publicSlug",
			title,
			category,
			venue_name AS "venueName",
			starts_at AS "startsAt",
			ends_at AS "endsAt",
			status
		FROM events
		WHERE ${whereClause}
		ORDER BY starts_at ASC NULLS LAST
		LIMIT 100;
	`;

	const res = await db.execute(query);
	const eventList = res.rows.map((row) => ({
		id: row.id as string,
		publicSlug: row.publicSlug as string,
		title: row.title as string,
		category: (row.category ?? null) as string | null,
		venueName: (row.venueName ?? null) as string | null,
		startsAt: row.startsAt ? new Date(row.startsAt as string) : null,
		endsAt: row.endsAt ? new Date(row.endsAt as string) : null,
		status: row.status as string,
	}));

	return c.json({ events: eventList }, 200);
});

// GET /api/public/events/:slug - Public event detail by publicSlug
publicRouter.get("/events/:slug", async (c) => {
	const slug = c.req.param("slug");
	const db = c.get("db");

	const query = sql`
		SELECT
			id,
			public_slug AS "publicSlug",
			title,
			category,
			description,
			venue_name AS "venueName",
			starts_at AS "startsAt",
			ends_at AS "endsAt",
			status,
			published_at AS "publishedAt"
		FROM events
		WHERE public_slug = ${slug}
			AND status IN ('published', 'active')
		LIMIT 1;
	`;

	const res = await db.execute(query);
	const row = res.rows[0];

	if (!row) {
		return sendError(
			c,
			"NOT_FOUND",
			"Public event not found or not visible.",
			404,
		);
	}

	return c.json(
		{
			event: {
				id: row.id as string,
				publicSlug: row.publicSlug as string,
				title: row.title as string,
				category: (row.category ?? null) as string | null,
				description: (row.description ?? null) as string | null,
				venueName: (row.venueName ?? null) as string | null,
				startsAt: row.startsAt ? new Date(row.startsAt as string) : null,
				endsAt: row.endsAt ? new Date(row.endsAt as string) : null,
				status: row.status as string,
				publishedAt: row.publishedAt
					? new Date(row.publishedAt as string)
					: null,
			},
		},
		200,
	);
});

// GET /api/public/events/:slug/roads - Public road impacts & effective live status
publicRouter.get("/events/:slug/roads", async (c) => {
	const slug = c.req.param("slug");
	const db = c.get("db");

	// First verify event is published or active
	const eventRows = await db
		.select({ id: events.id, status: events.status })
		.from(events)
		.where(
			and(
				eq(events.publicSlug, slug),
				inArray(events.status, ["published", "active"]),
			),
		)
		.limit(1);

	const event = eventRows[0];
	if (!event) {
		return sendError(
			c,
			"NOT_FOUND",
			"Public event not found or not visible.",
			404,
		);
	}

	const query = sql`
		SELECT
			ri.id,
			rs.display_name AS "roadSegmentName",
			ri.impact_type AS "impactType",
			ri.planned_from AS "plannedFrom",
			ri.planned_to AS "plannedTo",
			ri.diversion_note AS "diversionNote",
			ST_AsGeoJSON(rs.geom)::json AS geometry,
			rsu.status AS "lastStatus",
			rsu.observed_at AS "observedAt",
			rsu.expires_at AS "expiresAt"
		FROM road_impacts ri
		INNER JOIN road_segments rs ON ri.road_segment_id = rs.id
		LEFT JOIN LATERAL (
			SELECT status, observed_at, expires_at
			FROM road_status_updates
			WHERE road_impact_id = ri.id
			ORDER BY observed_at DESC, created_at DESC
			LIMIT 1
		) rsu ON true
		WHERE ri.event_id = ${event.id}
		ORDER BY ri.planned_from ASC;
	`;

	const res = await db.execute(query);
	const now = new Date();

	const roads = res.rows.map((row) => {
		let effectiveStatus: string;
		let isExpired = false;
		let lastConfirmedAt: string | null = null;
		let expiresAt: string | null = null;

		if (!row.lastStatus) {
			effectiveStatus = "unknown";
		} else {
			const expiryDate = new Date(row.expiresAt as string);
			if (expiryDate <= now) {
				effectiveStatus = "unconfirmed";
				isExpired = true;
			} else {
				effectiveStatus = row.lastStatus as string;
			}
			lastConfirmedAt = new Date(row.observedAt as string).toISOString();
			expiresAt = expiryDate.toISOString();
		}

		return {
			id: row.id as string,
			roadSegmentName: row.roadSegmentName as string,
			impactType: row.impactType as string,
			plannedFrom: new Date(row.plannedFrom as string).toISOString(),
			plannedTo: new Date(row.plannedTo as string).toISOString(),
			diversionNote: (row.diversionNote ?? null) as string | null,
			geometry: row.geometry,
			effectiveStatus,
			isExpired,
			lastConfirmedAt,
			expiresAt,
		};
	});

	return c.json({ roads }, 200);
});

// GET /api/public/events/:slug/cleanup-summary - Public aggregate cleanup summary
publicRouter.get("/events/:slug/cleanup-summary", async (c) => {
	const slug = c.req.param("slug");
	const db = c.get("db");

	const eventRows = await db
		.select({ id: events.id })
		.from(events)
		.where(
			and(
				eq(events.publicSlug, slug),
				inArray(events.status, ["published", "active"]),
			),
		)
		.limit(1);

	if (eventRows.length === 0) {
		return sendError(
			c,
			"NOT_FOUND",
			"Public event not found or not visible.",
			404,
		);
	}

	const eventId = eventRows[0].id;

	// Aggregate cleanup tasks: count total and verified
	const taskStats = await db
		.select({
			totalTasks: sql<number>`count(*)::int`,
			verifiedTasks: sql<number>`count(*) filter (where ${cleanupTasks.status} = 'verified')::int`,
		})
		.from(cleanupTasks)
		.where(eq(cleanupTasks.eventId, eventId));

	// Aggregate waste records
	const wasteRows = await db
		.select({
			category: wasteRecords.category,
			quantityKg: wasteRecords.quantityKg,
			sackCount: wasteRecords.sackCount,
		})
		.from(wasteRecords)
		.where(eq(wasteRecords.eventId, eventId));

	let totalKg = 0;
	const byCategory: Record<string, { totalKg: number; totalSacks: number }> = {
		organic: { totalKg: 0, totalSacks: 0 },
		recyclable: { totalKg: 0, totalSacks: 0 },
		residual: { totalKg: 0, totalSacks: 0 },
	};

	for (const row of wasteRows) {
		const kg = row.quantityKg ? Number(row.quantityKg) : 0;
		const sacks = row.sackCount ? Number(row.sackCount) : 0;
		totalKg += kg;
		if (byCategory[row.category]) {
			byCategory[row.category].totalKg += kg;
			byCategory[row.category].totalSacks += sacks;
		}
	}

	return c.json(
		{
			cleanupSummary: {
				totalTasks: taskStats[0]?.totalTasks ?? 0,
				verifiedTasks: taskStats[0]?.verifiedTasks ?? 0,
				wasteTotals: {
					totalKg,
					byCategory,
				},
			},
		},
		200,
	);
});
