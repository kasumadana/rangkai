import { and, desc, eq } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import { memberships, organizations, platformGrants } from "../../db/schema";
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

// Public identity registration does not grant organizer privileges.
organizationsRouter.post("/", (c) => sendError(c, "FORBIDDEN", "Ajukan organisasi untuk ditinjau terlebih dahulu.", 403));

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

	const grants = await db
		.select({ role: platformGrants.role })
		.from(platformGrants)
		.where(
			and(
				eq(platformGrants.userId, currentUser.id),
				eq(platformGrants.status, "active"),
			),
		);

	return c.json(
		{
			organizations: rows,
			platformRoles: grants.map((g) => g.role),
		},
		200,
	);
});
