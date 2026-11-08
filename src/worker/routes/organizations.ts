import { and, desc, eq, sql } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import { memberships, organizations } from "../../db/schema";
import { sendError } from "../lib/errors";
import { requireAuth } from "../middleware/auth";
import type { AppVariables, Env } from "../types";

export const createOrganizationSchema = z.object({
	name: z
		.string()
		.trim()
		.min(3, "Nama organisasi/desa adat minimal 3 karakter.")
		.max(150, "Nama organisasi maksimal 150 karakter."),
	village: z
		.string()
		.trim()
		.max(100, "Nama desa/kelurahan maksimal 100 karakter.")
		.optional()
		.nullable(),
	district: z
		.string()
		.trim()
		.max(100, "Nama kecamatan/kabupaten maksimal 100 karakter.")
		.optional()
		.nullable(),
});

export const organizationsRouter = new Hono<{
	Bindings: Env;
	Variables: AppVariables;
}>();

organizationsRouter.use("*", requireAuth);

/**
 * POST /api/organizations
 * Creates a new village organization and automatically grants the caller 'organizer' role.
 * Organization, organizer membership, and audit log are created atomically.
 * (Spec §21, AGENTS.md §13)
 */
organizationsRouter.post("/", async (c) => {
	const currentUser = c.get("user")!;
	const db = c.get("db");

	let body: unknown;
	try {
		body = await c.req.json();
	} catch {
		return sendError(c, "BAD_REQUEST", "Invalid JSON payload.", 400);
	}

	const parseResult = createOrganizationSchema.safeParse(body);
	if (!parseResult.success) {
		return sendError(
			c,
			"VALIDATION_FAILED",
			parseResult.error.issues[0]?.message || "Invalid organization data.",
			422,
		);
	}

	const { name, village, district } = parseResult.data;

	// Idempotency: check if caller already created an organization with the same name
	const existing = await db
		.select({
			id: organizations.id,
			name: organizations.name,
			village: organizations.village,
			district: organizations.district,
			createdAt: organizations.createdAt,
			hasOperationalAuthority: organizations.hasOperationalAuthority,
			membershipId: memberships.id,
			role: memberships.role,
		})
		.from(memberships)
		.innerJoin(organizations, eq(memberships.organizationId, organizations.id))
		.where(
			and(
				eq(memberships.userId, currentUser.id),
				eq(memberships.role, "organizer"),
				eq(organizations.name, name),
			),
		)
		.limit(1);

	if (existing.length > 0) {
		const ex = existing[0];
		return c.json(
			{
				organization: {
					id: ex.id,
					name: ex.name,
					village: ex.village,
					district: ex.district,
					hasOperationalAuthority: ex.hasOperationalAuthority,
					createdAt: ex.createdAt,
				},
				membership: {
					id: ex.membershipId,
					organizationId: ex.id,
					userId: currentUser.id,
					role: ex.role,
				},
			},
			200,
		);
	}

	const orgId = crypto.randomUUID();
	const membershipId = crypto.randomUUID();
	const auditId = crypto.randomUUID();
	const now = new Date();

	try {
		// Single atomic CTE: inserts organization, organizer membership, and audit log together.
		// If any statement fails, the entire transaction rolls back in PostgreSQL.
		const atomicCreateQuery = sql`
			WITH new_org AS (
				INSERT INTO organizations (
					id, name, village, district, has_operational_authority, created_at
				)
				VALUES (
					${orgId}, ${name}, ${village ?? null}, ${district ?? null}, false, ${now}
				)
				RETURNING id, name, village, district, has_operational_authority, created_at
			),
			new_membership AS (
				INSERT INTO memberships (
					id, organization_id, user_id, role, created_at
				)
				SELECT
					${membershipId}, id, ${currentUser.id}, 'organizer', ${now}
				FROM new_org
				RETURNING id, organization_id, user_id, role, created_at
			),
			new_audit AS (
				INSERT INTO audit_logs (
					id, organization_id, event_id, actor_id, action, entity_type, entity_id, before_json, after_json, created_at
				)
				SELECT
					${auditId}, id, null, ${currentUser.id}, 'organization.created', 'organization', id, null,
					json_build_object('name', name, 'village', village, 'district', district)::jsonb,
					${now}
				FROM new_org
				RETURNING id
			)
			SELECT
				o.id AS "orgId",
				o.name AS "orgName",
				o.village AS "orgVillage",
				o.district AS "orgDistrict",
				o.has_operational_authority AS "orgHasOperationalAuthority",
				o.created_at AS "orgCreatedAt",
				m.id AS "membershipId",
				m.role AS "membershipRole",
				m.created_at AS "membershipCreatedAt"
			FROM new_org o
			JOIN new_membership m ON m.organization_id = o.id;
		`;

		const res = await db.execute(atomicCreateQuery);

		if (res.rows.length === 0) {
			return sendError(
				c,
				"INTERNAL_SERVER_ERROR",
				"Gagal membuat organisasi dan keanggotaan.",
				500,
			);
		}

		const row = res.rows[0];

		return c.json(
			{
				organization: {
					id: row.orgId as string,
					name: row.orgName as string,
					village: (row.orgVillage as string | null) ?? null,
					district: (row.orgDistrict as string | null) ?? null,
					hasOperationalAuthority: Boolean(row.orgHasOperationalAuthority),
					createdAt: new Date(row.orgCreatedAt as string),
				},
				membership: {
					id: row.membershipId as string,
					organizationId: row.orgId as string,
					userId: currentUser.id,
					role: row.membershipRole as string,
					createdAt: new Date(row.membershipCreatedAt as string),
				},
			},
			201,
		);
	} catch {
		// Sanitize database errors: never return internal details or err.message to client
		return sendError(
			c,
			"INTERNAL_SERVER_ERROR",
			"Gagal membuat organisasi. Terjadi kesalahan pada server.",
			500,
		);
	}
});

/**
 * GET /api/organizations/my
 * Returns the organizations the current user belongs to with their roles and operational authority.
 */
organizationsRouter.get("/my", async (c) => {
	const currentUser = c.get("user")!;
	const db = c.get("db");

	const rows = await db
		.select({
			id: organizations.id,
			name: organizations.name,
			village: organizations.village,
			district: organizations.district,
			hasOperationalAuthority: organizations.hasOperationalAuthority,
			createdAt: organizations.createdAt,
			role: memberships.role,
		})
		.from(memberships)
		.innerJoin(organizations, eq(memberships.organizationId, organizations.id))
		.where(eq(memberships.userId, currentUser.id))
		.orderBy(desc(organizations.createdAt));

	return c.json({ organizations: rows }, 200);
});
