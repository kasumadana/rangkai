import crypto from "node:crypto";
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

export function computeRouteSourceSnapshotHash(
	impacts: Array<{
		id: string;
		plannedFrom: string | Date;
		plannedTo: string | Date;
		impactType: string;
	}>,
): string {
	return crypto
		.createHash("sha256")
		.update(
			JSON.stringify(
				impacts.map((i) => ({
					id: i.id,
					plannedFrom: new Date(i.plannedFrom).toISOString(),
					plannedTo: new Date(i.plannedTo).toISOString(),
					impactType: i.impactType,
				})),
			),
		)
		.digest("hex");
}

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
			WITH inserted_route AS (
				INSERT INTO event_alternative_routes (
					id, event_id, organization_id, name, description, geom, status, created_by
				)
				SELECT
					${routeId}::uuid,
					${eventId}::uuid,
					${access.event.organizationId}::uuid,
					${data.name},
					${data.description ?? null},
					ST_GeomFromEWKT(${ewkt}),
					'draft',
					${currentUser.id}
				WHERE EXISTS (
					SELECT 1 FROM memberships
					WHERE user_id = ${currentUser.id}
						AND organization_id = ${access.event.organizationId}
						AND role = 'organizer'
				)
				RETURNING
					id,
					name,
					description,
					status,
					created_by AS "createdBy",
					created_at AS "createdAt",
					ST_AsGeoJSON(geom)::json AS geometry
			),
			logged_history AS (
				INSERT INTO event_alternative_route_history (
					id, route_id, event_id, organization_id, actor_id, action, metadata, created_at
				)
				SELECT
					gen_random_uuid(),
					id,
					${eventId}::uuid,
					${access.event.organizationId}::uuid,
					${currentUser.id},
					'created',
					jsonb_build_object('name', name, 'description', description),
					NOW()
				FROM inserted_route
			),
			logged_audit AS (
				INSERT INTO audit_logs (
					id, organization_id, event_id, actor_id, action, entity_type, entity_id, after_json, created_at
				)
				SELECT
					gen_random_uuid(),
					${access.event.organizationId}::uuid,
					${eventId}::uuid,
					${currentUser.id},
					'alternative_route.created',
					'event_alternative_route',
					id::text,
					jsonb_build_object('id', id, 'name', name, 'status', status),
					NOW()
				FROM inserted_route
			)
			SELECT * FROM inserted_route;
		`;

		const res = await db.execute(insertQuery);
		const created = res.rows[0] as Record<string, unknown> | undefined;
		if (!created) {
			return sendError(
				c,
				"FORBIDDEN",
				"Keanggotaan panitia Anda tidak lagi aktif untuk kegiatan ini.",
				403,
			);
		}

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
 * Binds approval to material event/closure geometry + time snapshot and expiry.
 * Atomic membership check, append-only history, and atomic audit logging.
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

		// Eligible event lifecycle check (SPEC-07)
		if (!["review", "published", "active"].includes(access.event.status)) {
			return sendError(
				c,
				"INVALID_LIFECYCLE",
				"Rute alternatif hanya dapat disetujui untuk kegiatan berstatus review, terpublikasi, atau aktif.",
				400,
			);
		}

		// Fetch road impacts to calculate snapshot hash and expiry
		const impactsQuery = sql`
			SELECT id, planned_from AS "plannedFrom", planned_to AS "plannedTo", impact_type AS "impactType"
			FROM road_impacts
			WHERE event_id = ${eventId}
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
			return sendError(
				c,
				"NO_ROAD_IMPACTS",
				"Tidak dapat menyetujui rute: kegiatan belum memiliki ruas penutupan jalan.",
				400,
			);
		}

		// Calculate expiry: latest plannedTo across impacts or event endsAt
		const impactExpiries = impacts.map((i) => new Date(i.plannedTo).getTime());
		const maxExpiryMs = Math.max(...impactExpiries, access.event.endsAt ? new Date(access.event.endsAt).getTime() : 0);
		const expiresAt = new Date(maxExpiryMs);

		if (expiresAt.getTime() <= Date.now()) {
			return sendError(
				c,
				"EXPIRED_CLOSURE",
				"Tidak dapat menyetujui rute: seluruh rencana penutupan jalan telah kedaluwarsa.",
				400,
			);
		}

		const sourceSnapshotHash = computeRouteSourceSnapshotHash(impacts);

		// Check existing route state
		const existingQuery = sql`
			SELECT id, name, status, approved_at AS "approvedAt", source_snapshot_hash AS "sourceSnapshotHash", expires_at AS "expiresAt"
			FROM event_alternative_routes
			WHERE id = ${routeId} AND event_id = ${eventId};
		`;
		const existingRes = await db.execute(existingQuery);
		const existing = existingRes.rows[0] as {
			id: string;
			name: string;
			status: string;
			approvedAt: string | Date | null;
			sourceSnapshotHash: string | null;
			expiresAt: string | Date | null;
		} | undefined;

		if (!existing) {
			return sendError(c, "NOT_FOUND", "Alternative route not found for this event.", 404);
		}

		// Idempotent repeat approval if already approved with same active source snapshot
		if (
			existing.status === "approved" &&
			existing.sourceSnapshotHash === sourceSnapshotHash &&
			existing.expiresAt &&
			new Date(existing.expiresAt).getTime() > Date.now() &&
			existing.approvedAt
		) {
			return c.json(
				{
					alternativeRoute: {
						id: existing.id,
						name: existing.name,
						status: existing.status,
						approvedAt: new Date(existing.approvedAt).toISOString(),
					},
				},
				200,
			);
		}

		const isReapproval = existing.status === "approved";
		const action = isReapproval ? "reapproved" : "approved";
		const expiresAtIso = expiresAt.toISOString();

		// Atomic guarded update + append-only history + audit log
		const updateQuery = sql`
			WITH updated_route AS (
				UPDATE event_alternative_routes
				SET
					status = 'approved',
					approved_by = ${currentUser.id},
					approved_at = NOW(),
					source_snapshot_hash = ${sourceSnapshotHash},
					expires_at = ${expiresAtIso}::timestamptz,
					updated_at = NOW()
				WHERE id = ${routeId}::uuid
					AND event_id = ${eventId}::uuid
					AND EXISTS (
						SELECT 1 FROM memberships
						WHERE user_id = ${currentUser.id}
							AND organization_id = ${access.event.organizationId}
							AND role = 'organizer'
					)
				RETURNING id, name, status, approved_at AS "approvedAt"
			),
			logged_history AS (
				INSERT INTO event_alternative_route_history (
					id, route_id, event_id, organization_id, actor_id, action, source_snapshot_hash, expires_at, created_at
				)
				SELECT
					gen_random_uuid(),
					id,
					${eventId}::uuid,
					${access.event.organizationId}::uuid,
					${currentUser.id}::text,
					${action}::text,
					${sourceSnapshotHash}::text,
					${expiresAtIso}::timestamptz,
					NOW()
				FROM updated_route
			),
			logged_audit AS (
				INSERT INTO audit_logs (
					id, organization_id, event_id, actor_id, action, entity_type, entity_id, after_json, created_at
				)
				SELECT
					gen_random_uuid(),
					${access.event.organizationId}::uuid,
					${eventId}::uuid,
					${currentUser.id}::text,
					${`alternative_route.${action}`}::text,
					'event_alternative_route',
					id::text,
					jsonb_build_object(
						'id', id,
						'name', name,
						'status', status,
						'sourceSnapshotHash', ${sourceSnapshotHash}::text,
						'expiresAt', ${expiresAtIso}::text
					),
					NOW()
				FROM updated_route
			)
			SELECT * FROM updated_route;
		`;

		const res = await db.execute(updateQuery);
		const updated = res.rows[0] as { id: string; name: string; status: string; approvedAt: string | Date } | undefined;
		if (!updated) {
			return sendError(
				c,
				"FORBIDDEN",
				"Keanggotaan panitia Anda tidak lagi aktif untuk kegiatan ini.",
				403,
			);
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
 * Atomic membership check, append-only history, and atomic audit logging.
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

		// Check if already revoked (idempotent repeat)
		const existingQuery = sql`
			SELECT id, name, status, revoked_at AS "revokedAt"
			FROM event_alternative_routes
			WHERE id = ${routeId} AND event_id = ${eventId};
		`;
		const existingRes = await db.execute(existingQuery);
		const existing = existingRes.rows[0] as { id: string; name: string; status: string; revokedAt: string | Date | null } | undefined;

		if (!existing) {
			return sendError(c, "NOT_FOUND", "Alternative route not found for this event.", 404);
		}

		if (existing.status === "revoked" && existing.revokedAt) {
			return c.json(
				{
					alternativeRoute: {
						id: existing.id,
						name: existing.name,
						status: existing.status,
						revokedAt: new Date(existing.revokedAt).toISOString(),
					},
				},
				200,
			);
		}

		// Atomic guarded update + history + audit log
		const updateQuery = sql`
			WITH updated_route AS (
				UPDATE event_alternative_routes
				SET
					status = 'revoked',
					revoked_by = ${currentUser.id},
					revoked_at = NOW(),
					updated_at = NOW()
				WHERE id = ${routeId}::uuid
					AND event_id = ${eventId}::uuid
					AND EXISTS (
						SELECT 1 FROM memberships
						WHERE user_id = ${currentUser.id}
							AND organization_id = ${access.event.organizationId}
							AND role = 'organizer'
					)
				RETURNING id, name, status, revoked_at AS "revokedAt"
			),
			logged_history AS (
				INSERT INTO event_alternative_route_history (
					id, route_id, event_id, organization_id, actor_id, action, created_at
				)
				SELECT
					gen_random_uuid(),
					id,
					${eventId}::uuid,
					${access.event.organizationId}::uuid,
					${currentUser.id},
					'revoked',
					NOW()
				FROM updated_route
			),
			logged_audit AS (
				INSERT INTO audit_logs (
					id, organization_id, event_id, actor_id, action, entity_type, entity_id, after_json, created_at
				)
				SELECT
					gen_random_uuid(),
					${access.event.organizationId}::uuid,
					${eventId}::uuid,
					${currentUser.id},
					'alternative_route.revoked',
					'event_alternative_route',
					id::text,
					jsonb_build_object('id', id, 'name', name, 'status', status),
					NOW()
				FROM updated_route
			)
			SELECT * FROM updated_route;
		`;

		const res = await db.execute(updateQuery);
		const updated = res.rows[0] as { id: string; name: string; status: string; revokedAt: string | Date } | undefined;
		if (!updated) {
			return sendError(
				c,
				"FORBIDDEN",
				"Keanggotaan panitia Anda tidak lagi aktif untuk kegiatan ini.",
				403,
			);
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
			WITH deleted_route AS (
				DELETE FROM event_alternative_routes
				WHERE id = ${routeId}::uuid
					AND event_id = ${eventId}::uuid
					AND status = 'draft'
					AND EXISTS (
						SELECT 1 FROM memberships
						WHERE user_id = ${currentUser.id}
							AND organization_id = ${access.event.organizationId}
							AND role = 'organizer'
					)
				RETURNING id, name
			),
			logged_audit AS (
				INSERT INTO audit_logs (
					id, organization_id, event_id, actor_id, action, entity_type, entity_id, before_json, created_at
				)
				SELECT
					gen_random_uuid(),
					${access.event.organizationId}::uuid,
					${eventId}::uuid,
					${currentUser.id},
					'alternative_route.deleted',
					'event_alternative_route',
					id::text,
					jsonb_build_object('id', id, 'name', name),
					NOW()
				FROM deleted_route
			)
			SELECT id FROM deleted_route;
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
