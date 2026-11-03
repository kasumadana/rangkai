import { and, eq } from "drizzle-orm";
import type { Context, MiddlewareHandler } from "hono";
import { memberships, type MembershipRole } from "../../db/schema";
import { sendError } from "../lib/errors";
import type { AppVariables, Env } from "../types";

export function requireOrgRole(
	requiredRole: MembershipRole,
	resolveOrgId: (c: Context<{ Bindings: Env; Variables: AppVariables }>) => Promise<string | undefined> | string | undefined,
): MiddlewareHandler<{ Bindings: Env; Variables: AppVariables }> {
	return async (c, next) => {
		const user = c.get("user");
		if (!user) {
			return sendError(c, "UNAUTHORIZED", "Authentication required.", 401);
		}

		const db = c.get("db");
		const orgId = await resolveOrgId(c);

		if (!orgId) {
			return sendError(
				c,
				"BAD_REQUEST",
				"Organization ID is required for this operation.",
				400,
			);
		}

		const rows = await db
			.select({
				organizationId: memberships.organizationId,
				userId: memberships.userId,
				role: memberships.role,
			})
			.from(memberships)
			.where(
				and(
					eq(memberships.organizationId, orgId),
					eq(memberships.userId, user.id),
				),
			)
			.limit(1);

		const membership = rows[0];
		if (!membership) {
			return sendError(
				c,
				"FORBIDDEN",
				"You are not a member of this organization.",
				403,
			);
		}

		if (requiredRole === "organizer" && membership.role !== "organizer") {
			return sendError(
				c,
				"FORBIDDEN",
				"Organizer permission required for this operation.",
				403,
			);
		}

		c.set("orgMembership", membership);
		await next();
	};
}
