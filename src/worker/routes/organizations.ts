import { desc, eq } from "drizzle-orm";
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
 * (message (2).txt §2: "Organizer pertama otomatis menjadi pengelola organisasi yang dibuatnya")
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
	const orgId = crypto.randomUUID();
	const membershipId = crypto.randomUUID();
	const now = new Date();

	try {
		// Atomic creation: insert organization then membership
		const [createdOrg] = await db
			.insert(organizations)
			.values({
				id: orgId,
				name,
				village: village ?? null,
				district: district ?? null,
				createdAt: now,
			})
			.returning();

		const [createdMembership] = await db
			.insert(memberships)
			.values({
				id: membershipId,
				organizationId: orgId,
				userId: currentUser.id,
				role: "organizer",
				createdAt: now,
			})
			.returning();

		return c.json(
			{
				organization: createdOrg,
				membership: createdMembership,
			},
			201,
		);
	} catch (err) {
		const message = err instanceof Error ? err.message : "Database error";
		return sendError(
			c,
			"INTERNAL_SERVER_ERROR",
			`Gagal membuat organisasi: ${message}`,
			500,
		);
	}
});

/**
 * GET /api/organizations/my
 * Returns the organizations the current user belongs to with their roles.
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
			createdAt: organizations.createdAt,
			role: memberships.role,
		})
		.from(memberships)
		.innerJoin(organizations, eq(memberships.organizationId, organizations.id))
		.where(eq(memberships.userId, currentUser.id))
		.orderBy(desc(organizations.createdAt));

	return c.json({ organizations: rows }, 200);
});
