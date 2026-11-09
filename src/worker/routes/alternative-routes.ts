import { sql } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import { sendError } from "../lib/errors";
import { getEventAndCheckAccess } from "../middleware/assignments";
import { requireAuth } from "../middleware/auth";
import type { AppVariables, Env } from "../types";
import { uuidParamSchema } from "../validators/events";
import {
	BALI_GEOGRAPHIC_BOUNDS,
	calculatePathLengthMeters,
} from "../validators/roads";

export const alternativeRoutesRouter = new Hono<{
	Bindings: Env;
	Variables: AppVariables;
}>();

const createAlternativeRouteSchema = z
	.object({
		name: z
			.string()
			.trim()
			.min(3, "Nama rute alternatif minimal 3 karakter.")
			.max(200, "Nama rute alternatif maksimal 200 karakter."),
		description: z.string().trim().max(500).optional().nullable(),
		coordinates: z
			.array(
				z.tuple([
					z.number().refine(
						(n) =>
							Number.isFinite(n) &&
							n >= BALI_GEOGRAPHIC_BOUNDS.minLng &&
							n <= BALI_GEOGRAPHIC_BOUNDS.maxLng,
						{
							message: "Garis bujur (longitude) harus berada di wilayah Bali.",
						},
					),
					z.number().refine(
						(n) =>
							Number.isFinite(n) &&
							n >= BALI_GEOGRAPHIC_BOUNDS.minLat &&
							n <= BALI_GEOGRAPHIC_BOUNDS.maxLat,
						{
							message: "Garis lintang (latitude) harus berada di wilayah Bali.",
						},
					),
				]),
			)
			.min(2, "Tandai minimal 2 titik koordinat untuk membentuk garis rute alternatif.")
			.max(100, "Maksimal 100 titik koordinat per rute alternatif."),
	})
	.refine(
		(data) => {
			const [firstLng, firstLat] = data.coordinates[0];
			return data.coordinates.some(
				([lng, lat]) =>
					Math.abs(lng - firstLng) > 0.00005 ||
					Math.abs(lat - firstLat) > 0.00005,
			);
		},
		{
			message: "Titik awal dan titik akhir rute alternatif tidak boleh sama persis.",
			path: ["coordinates"],
		},
	)
	.refine(
		(data) => {
			const lengthMeters = calculatePathLengthMeters(data.coordinates);
			return lengthMeters >= 10 && lengthMeters <= 50000;
		},
		{
			message: "Panjang rute alternatif harus antara 10 meter dan 50 kilometer.",
			path: ["coordinates"],
		},
	);

// ---------------------------------------------------------------------------
// Protected Organizer Endpoints
// ---------------------------------------------------------------------------

/**
 * POST /api/events/:eventId/alternative-routes
 * Create a new draft manual alternative route.
 */
alternativeRoutesRouter.post(
	"/events/:eventId/alternative-routes",
	requireAuth,
	async (c) => {
		const currentUser = c.get("user")!;
		const eventId = c.req.param("eventId");

		if (!uuidParamSchema.safeParse(eventId).success) {
			return sendError(c, "VALIDATION_FAILED", "Invalid event ID format.", 422);
		}

		let body: unknown;
		try {
			body = await c.req.json();
		} catch {
			return sendError(c, "BAD_REQUEST", "Invalid JSON payload.", 400);
		}

		const parsed = createAlternativeRouteSchema.safeParse(body);
		if (!parsed.success) {
			return sendError(
				c,
				"VALIDATION_FAILED",
				parsed.error.issues[0]?.message || "Invalid alternative route data.",
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
				"Organizer permission required to create alternative routes.",
				403,
			);
		}

		const data = parsed.data;
		const routeId = crypto.randomUUID();
		const ewkt = `SRID=4326;LINESTRING(${data.coordinates.map(([lng, lat]) => `${lng} ${lat}`).join(", ")})`;

		const insertQuery = sql`
			INSERT INTO event_alternative_routes (
				id, event_id, organization_id, name, description, geom, status, created_by
			)
			VALUES (
				${routeId}::uuid,
				${eventId}::uuid,
				${access.event.organizationId}::uuid,
				${data.name},
				${data.description ?? null},
				ST_GeomFromEWKT(${ewkt}),
				'draft',
				${currentUser.id}
			)
			RETURNING
				id,
				name,
				description,
				status,
				created_by AS "createdBy",
				created_at AS "createdAt",
				ST_AsGeoJSON(geom)::json AS geometry;
		`;

		const res = await db.execute(insertQuery);
		const created = res.rows[0] as Record<string, unknown>;

		return c.json(
			{
				alternativeRoute: {
					id: created.id as string,
					eventId,
					name: created.name as string,
					description: (created.description ?? null) as string | null,
					status: created.status as string,
					createdBy: created.createdBy as string,
					createdAt: new Date(created.createdAt as string).toISOString(),
					geometry: created.geometry,
				},
			},
			201,
		);
	},
);

/**
 * GET /api/events/:eventId/alternative-routes
 * List all alternative routes (draft, approved, revoked) for an event (Organizer only).
 */
alternativeRoutesRouter.get(
	"/events/:eventId/alternative-routes",
	requireAuth,
	async (c) => {
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
				"Organizer permission required to view alternative routes.",
				403,
			);
		}

		const query = sql`
			SELECT
				id,
				event_id AS "eventId",
				name,
				description,
				status,
				created_by AS "createdBy",
				approved_by AS "approvedBy",
				approved_at AS "approvedAt",
				revoked_at AS "revokedAt",
				created_at AS "createdAt",
				ST_AsGeoJSON(geom)::json AS geometry
			FROM event_alternative_routes
			WHERE event_id = ${eventId}
			ORDER BY created_at DESC;
		`;

		const res = await db.execute(query);
		const rows = res.rows as Array<{
			id: string;
			eventId: string;
			name: string;
			description: string | null;
			status: string;
			createdBy: string;
			approvedBy: string | null;
			approvedAt: string | Date | null;
			revokedAt: string | Date | null;
			createdAt: string | Date;
			geometry: Record<string, unknown>;
		}>;

		return c.json(
			{
				alternativeRoutes: rows.map((r) => ({
					id: r.id,
					eventId: r.eventId,
					name: r.name,
					description: r.description,
					status: r.status,
					createdBy: r.createdBy,
					approvedBy: r.approvedBy,
					approvedAt: r.approvedAt ? new Date(r.approvedAt).toISOString() : null,
					revokedAt: r.revokedAt ? new Date(r.revokedAt).toISOString() : null,
					createdAt: new Date(r.createdAt).toISOString(),
					geometry: r.geometry,
				})),
			},
			200,
		);
	},
);

/**
 * POST /api/events/:eventId/alternative-routes/:routeId/approve
 * Approve a draft alternative route, making it public for eligible events.
 */
alternativeRoutesRouter.post(
	"/events/:eventId/alternative-routes/:routeId/approve",
	requireAuth,
	async (c) => {
		const currentUser = c.get("user")!;
		const eventId = c.req.param("eventId");
		const routeId = c.req.param("routeId");

		if (
			!uuidParamSchema.safeParse(eventId).success ||
			!uuidParamSchema.safeParse(routeId).success
		) {
			return sendError(c, "VALIDATION_FAILED", "Invalid ID parameter format.", 422);
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
				"Organizer permission required to approve alternative routes.",
				403,
			);
		}

		const now = new Date();
		const updateQuery = sql`
			UPDATE event_alternative_routes
			SET
				status = 'approved',
				approved_by = ${currentUser.id},
				approved_at = ${now},
				updated_at = ${now}
			WHERE id = ${routeId} AND event_id = ${eventId}
			RETURNING id, name, status, approved_at AS "approvedAt";
		`;

		const res = await db.execute(updateQuery);
		const updated = res.rows[0] as { id: string; name: string; status: string; approvedAt: string | Date } | undefined;
		if (!updated) {
			return sendError(c, "NOT_FOUND", "Alternative route not found for this event.", 404);
		}

		return c.json(
			{
				alternativeRoute: {
					id: updated.id,
					name: updated.name,
					status: updated.status,
					approvedAt: new Date(updated.approvedAt).toISOString(),
				},
			},
			200,
		);
	},
);

/**
 * POST /api/events/:eventId/alternative-routes/:routeId/revoke
 * Revoke an approved alternative route.
 */
alternativeRoutesRouter.post(
	"/events/:eventId/alternative-routes/:routeId/revoke",
	requireAuth,
	async (c) => {
		const currentUser = c.get("user")!;
		const eventId = c.req.param("eventId");
		const routeId = c.req.param("routeId");

		if (
			!uuidParamSchema.safeParse(eventId).success ||
			!uuidParamSchema.safeParse(routeId).success
		) {
			return sendError(c, "VALIDATION_FAILED", "Invalid ID parameter format.", 422);
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
				"Organizer permission required to revoke alternative routes.",
				403,
			);
		}

		const now = new Date();
		const updateQuery = sql`
			UPDATE event_alternative_routes
			SET
				status = 'revoked',
				revoked_at = ${now},
				updated_at = ${now}
			WHERE id = ${routeId} AND event_id = ${eventId}
			RETURNING id, name, status, revoked_at AS "revokedAt";
		`;

		const res = await db.execute(updateQuery);
		const updated = res.rows[0] as { id: string; name: string; status: string; revokedAt: string | Date } | undefined;
		if (!updated) {
			return sendError(c, "NOT_FOUND", "Alternative route not found for this event.", 404);
		}

		return c.json(
			{
				alternativeRoute: {
					id: updated.id,
					name: updated.name,
					status: updated.status,
					revokedAt: new Date(updated.revokedAt).toISOString(),
				},
			},
			200,
		);
	},
);

/**
 * DELETE /api/events/:eventId/alternative-routes/:routeId
 * Delete a draft alternative route.
 */
alternativeRoutesRouter.delete(
	"/events/:eventId/alternative-routes/:routeId",
	requireAuth,
	async (c) => {
		const currentUser = c.get("user")!;
		const eventId = c.req.param("eventId");
		const routeId = c.req.param("routeId");

		if (
			!uuidParamSchema.safeParse(eventId).success ||
			!uuidParamSchema.safeParse(routeId).success
		) {
			return sendError(c, "VALIDATION_FAILED", "Invalid ID parameter format.", 422);
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
				"Organizer permission required to delete alternative routes.",
				403,
			);
		}

		const deleteQuery = sql`
			DELETE FROM event_alternative_routes
			WHERE id = ${routeId} AND event_id = ${eventId} AND status = 'draft'
			RETURNING id;
		`;
		const res = await db.execute(deleteQuery);
		if (res.rows.length === 0) {
			return sendError(
				c,
				"STATE_CONFLICT",
				"Hanya rute alternatif berstatus draf yang dapat dihapus. Rute yang telah disetujui harus dicabut (revoke).",
				409,
			);
		}

		return c.json({ deleted: true, id: routeId }, 200);
	},
);

export default alternativeRoutesRouter;
