import { and, desc, eq, sql } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import { user as userTable } from "../../db/auth-schema";
import {
	events,
	invitations,
	memberships,
	organizations,
} from "../../db/schema";
import { sendError } from "../lib/errors";
import { requireAuth } from "../middleware/auth";
import type { AppVariables, Env } from "../types";

export const createInvitationSchema = z.object({
	organizationId: z.string().uuid("ID organisasi harus berformat UUID.").optional(),
	recipientEmail: z
		.string()
		.trim()
		.min(1, "Email penerima wajib diisi.")
		.email("Format email penerima tidak valid.")
		.toLowerCase()
		.optional(),
	role: z.enum(["officer", "organizer"]).default("officer"),
	eventId: z.string().uuid("ID kegiatan harus berformat UUID.").optional().nullable(),
	canUpdateTraffic: z.boolean().default(false),
	canUpdateCleanup: z.boolean().default(false),
	expiresInDays: z.number().int().min(1).max(30).default(7),
});

export const invitationsRouter = new Hono<{
	Bindings: Env;
	Variables: AppVariables;
}>();

export async function hashToken(token: string): Promise<string> {
	const data = new TextEncoder().encode(token.trim());
	const digest = await crypto.subtle.digest("SHA-256", data);
	return Array.from(new Uint8Array(digest))
		.map((b) => b.toString(16).padStart(2, "0"))
		.join("");
}

/**
 * POST /api/invitations
 * Organizer creates an invitation token for an officer or an additional organizer.
 * (Spec §24-32, SRS FR-003-005, FR-070-072)
 */
invitationsRouter.post("/", requireAuth, async (c) => {
	const currentUser = c.get("user")!;
	const db = c.get("db");

	let body: unknown;
	try {
		body = await c.req.json();
	} catch {
		return sendError(c, "BAD_REQUEST", "Invalid JSON payload.", 400);
	}

	const parseResult = createInvitationSchema.safeParse(body);
	if (!parseResult.success) {
		return sendError(
			c,
			"VALIDATION_FAILED",
			parseResult.error.issues[0]?.message || "Invalid invitation payload.",
			422,
		);
	}

	const {
		organizationId,
		recipientEmail,
		role,
		eventId,
		canUpdateTraffic,
		canUpdateCleanup,
		expiresInDays,
	} = parseResult.data;

	// Resolve organization ID from eventId if omitted
	let resolvedOrgId = organizationId;
	if (!resolvedOrgId && eventId) {
		const evRows = await db
			.select({ organizationId: events.organizationId })
			.from(events)
			.where(eq(events.id, eventId))
			.limit(1);
		if (evRows[0]) {
			resolvedOrgId = evRows[0].organizationId;
		}
	}

	if (!resolvedOrgId) {
		return sendError(
			c,
			"VALIDATION_FAILED",
			"ID organisasi wajib ditentukan.",
			422,
		);
	}

	const normalizedRecipientEmail = recipientEmail
		? recipientEmail.trim().toLowerCase()
		: "petugas@desaadat.id";

	// 1. Verify caller has 'organizer' role in the specified organization
	const memberRows = await db
		.select({ role: memberships.role })
		.from(memberships)
		.where(
			and(
				eq(memberships.organizationId, resolvedOrgId),
				eq(memberships.userId, currentUser.id),
			),
		)
		.limit(1);

	const membership = memberRows[0];
	if (!membership || membership.role !== "organizer") {
		return sendError(
			c,
			"FORBIDDEN",
			"Hanya Organizer yang berhak membuat tautan undangan petugas atau prajuru.",
			403,
		);
	}

	// 2. Role-specific validation
	let effectiveEventId: string | null = null;
	let effectiveCanUpdateTraffic = false;
	let effectiveCanUpdateCleanup = false;

	if (role === "officer") {
		if (!eventId) {
			return sendError(
				c,
				"VALIDATION_FAILED",
				"Undangan petugas lapangan wajib memilih kegiatan yang ditugaskan.",
				422,
			);
		}

		if (!canUpdateTraffic && !canUpdateCleanup) {
			return sendError(
				c,
				"VALIDATION_FAILED",
				"Pilih minimal satu hak tugas lapangan (Pecalang / Kebersihan).",
				422,
			);
		}

		// Verify event exists and belongs to this organization
		const eventRows = await db
			.select({ id: events.id, organizationId: events.organizationId })
			.from(events)
			.where(and(eq(events.id, eventId), eq(events.organizationId, resolvedOrgId)))
			.limit(1);

		if (eventRows.length === 0) {
			return sendError(
				c,
				"NOT_FOUND",
				"Kegiatan tidak ditemukan di organisasi ini.",
				404,
			);
		}

		effectiveEventId = eventId;
		effectiveCanUpdateTraffic = canUpdateTraffic;
		effectiveCanUpdateCleanup = canUpdateCleanup;
	} else {
		// Organizer invite: grants organizer membership only, no field permissions or event assignment
		effectiveEventId = null;
		effectiveCanUpdateTraffic = false;
		effectiveCanUpdateCleanup = false;
	}

	// 3. Generate cryptographically random token and its SHA-256 hash
	const rawRandom = crypto.randomUUID().replace(/-/g, "") + crypto.randomUUID().replace(/-/g, "").slice(0, 8);
	const plainToken = `inv_${rawRandom}`;
	const tokenHash = await hashToken(plainToken);

	const invitationId = crypto.randomUUID();
	const auditId = crypto.randomUUID();
	const now = new Date();
	const expiresAt = new Date(now.getTime() + expiresInDays * 24 * 60 * 60 * 1000);

	try {
		// Insert invitation and audit log atomically in CTE
		const atomicQuery = sql`
			WITH new_inv AS (
				INSERT INTO invitations (
					id, organization_id, event_id, invitation_role, recipient_email, token_hash,
					can_update_traffic, can_update_cleanup, status, invited_by, expires_at, created_at, updated_at
				)
				VALUES (
					${invitationId}, ${resolvedOrgId}, ${effectiveEventId}, ${role}, ${normalizedRecipientEmail}, ${tokenHash},
					${effectiveCanUpdateTraffic}, ${effectiveCanUpdateCleanup}, 'pending', ${currentUser.id},
					${expiresAt}, ${now}, ${now}
				)
				RETURNING *
			),
			new_audit AS (
				INSERT INTO audit_logs (
					id, organization_id, event_id, actor_id, action, entity_type, entity_id, before_json, after_json, created_at
				)
				SELECT
					${auditId},
					organization_id,
					event_id,
					${currentUser.id},
					'invitation.created',
					'invitation',
					id,
					null,
					json_build_object(
						'recipientEmail', recipient_email,
						'invitationRole', invitation_role,
						'eventId', event_id,
						'canUpdateTraffic', can_update_traffic,
						'canUpdateCleanup', can_update_cleanup,
						'expiresAt', expires_at
					)::jsonb,
					${now}
				FROM new_inv
				RETURNING id
			)
			SELECT * FROM new_inv;
		`;

		await db.execute(atomicQuery);

		const origin = new URL(c.req.url).origin;
		const inviteUrl = `${origin}/invite/${plainToken}`;

		return c.json(
			{
				invitation: {
					id: invitationId,
					token: plainToken,
					inviteUrl,
					recipientEmail: normalizedRecipientEmail,
					role,
					eventId: effectiveEventId,
					permissions: {
						canUpdateTraffic: effectiveCanUpdateTraffic,
						canUpdateCleanup: effectiveCanUpdateCleanup,
					},
					expiresAt: expiresAt.toISOString(),
				},
			},
			201,
		);
	} catch {
		return sendError(
			c,
			"INTERNAL_SERVER_ERROR",
			"Gagal membuat undangan. Terjadi kesalahan pada server.",
			500,
		);
	}
});

/**
 * GET /api/invitations
 * Organizer lists invitations for their organization.
 */
invitationsRouter.get("/", requireAuth, async (c) => {
	const currentUser = c.get("user")!;
	const organizationId = c.req.query("organizationId");
	const statusFilter = c.req.query("status");
	const db = c.get("db");

	if (!organizationId) {
		return sendError(
			c,
			"BAD_REQUEST",
			"Parameter organizationId wajib disertakan.",
			400,
		);
	}

	// Verify organizer membership
	const memberRows = await db
		.select({ role: memberships.role })
		.from(memberships)
		.where(
			and(
				eq(memberships.organizationId, organizationId),
				eq(memberships.userId, currentUser.id),
			),
		)
		.limit(1);

	if (!memberRows[0] || memberRows[0].role !== "organizer") {
		return sendError(c, "FORBIDDEN", "Akses daftar undangan ditolak.", 403);
	}

	const rows = await db
		.select({
			id: invitations.id,
			organizationId: invitations.organizationId,
			eventId: invitations.eventId,
			eventTitle: events.title,
			invitationRole: invitations.invitationRole,
			recipientEmail: invitations.recipientEmail,
			canUpdateTraffic: invitations.canUpdateTraffic,
			canUpdateCleanup: invitations.canUpdateCleanup,
			status: invitations.status,
			invitedBy: invitations.invitedBy,
			invitedByName: userTable.name,
			acceptedBy: invitations.acceptedBy,
			acceptedAt: invitations.acceptedAt,
			revokedAt: invitations.revokedAt,
			expiresAt: invitations.expiresAt,
			createdAt: invitations.createdAt,
		})
		.from(invitations)
		.leftJoin(events, eq(invitations.eventId, events.id))
		.leftJoin(userTable, eq(invitations.invitedBy, userTable.id))
		.where(
			and(
				eq(invitations.organizationId, organizationId),
				statusFilter ? eq(invitations.status, statusFilter as "pending" | "accepted" | "revoked" | "expired") : undefined,
			),
		)
		.orderBy(desc(invitations.createdAt));

	return c.json({ invitations: rows }, 200);
});

/**
 * GET /api/invitations/:token
 * Public endpoint: inspects and validates an invitation token.
 * Returns recipient-safe inspect metadata only; never leaks internal secrets or tokens.
 */
invitationsRouter.get("/:token", async (c) => {
	const rawToken = c.req.param("token");
	if (!rawToken || !rawToken.startsWith("inv_")) {
		return sendError(
			c,
			"NOT_FOUND",
			"Tautan undangan tidak ditemukan atau sudah tidak berlaku.",
			404,
		);
	}

	const db = c.get("db");
	const tokenHash = await hashToken(rawToken);

	const rows = await db
		.select({
			id: invitations.id,
			organizationId: invitations.organizationId,
			eventId: invitations.eventId,
			invitationRole: invitations.invitationRole,
			recipientEmail: invitations.recipientEmail,
			canUpdateTraffic: invitations.canUpdateTraffic,
			canUpdateCleanup: invitations.canUpdateCleanup,
			status: invitations.status,
			expiresAt: invitations.expiresAt,
			orgName: organizations.name,
			orgVillage: organizations.village,
			orgDistrict: organizations.district,
			eventTitle: events.title,
			eventVenue: events.venueName,
		})
		.from(invitations)
		.innerJoin(organizations, eq(invitations.organizationId, organizations.id))
		.leftJoin(events, eq(invitations.eventId, events.id))
		.where(eq(invitations.tokenHash, tokenHash))
		.limit(1);

	const record = rows[0];
	if (!record) {
		return sendError(
			c,
			"NOT_FOUND",
			"Tautan undangan tidak ditemukan atau sudah digunakan.",
			404,
		);
	}

	if (record.status === "revoked") {
		return sendError(
			c,
			"FORBIDDEN",
			"Tautan undangan ini telah dibatalkan oleh pihak penyelenggara.",
			410,
		);
	}

	if (record.status === "accepted") {
		return sendError(
			c,
			"STATE_CONFLICT",
			"Tautan undangan ini sudah pernah digunakan.",
			409,
		);
	}

	if (new Date() > record.expiresAt) {
		return sendError(
			c,
			"VALIDATION_FAILED",
			"Tautan undangan telah kedaluwarsa. Mintalah tautan baru dari panitia.",
			410,
		);
	}

	return c.json(
		{
			valid: true,
			token: rawToken,
			invitationRole: record.invitationRole,
			recipientEmail: record.recipientEmail,
			organization: {
				id: record.organizationId,
				name: record.orgName,
				village: record.orgVillage,
				district: record.orgDistrict,
			},
			event: record.eventId
				? {
						id: record.eventId,
						title: record.eventTitle || "Kegiatan Upacara Adat",
						venueName: record.eventVenue,
					}
				: null,
			permissions: {
				canUpdateTraffic: record.canUpdateTraffic,
				canUpdateCleanup: record.canUpdateCleanup,
			},
			expiresAt: record.expiresAt.toISOString(),
		},
		200,
	);
});

/**
 * POST /api/invitations/:token/accept
 * Authenticated user accepts the invitation, atomically granting membership and event assignment.
 * Enforces recipient email binding, atomic single consumption (CAS), and creator authority re-check.
 */
invitationsRouter.post("/:token/accept", requireAuth, async (c) => {
	const currentUser = c.get("user")!;
	const rawToken = c.req.param("token");
	const db = c.get("db");

	if (!rawToken || !rawToken.startsWith("inv_")) {
		return sendError(
			c,
			"NOT_FOUND",
			"Tautan undangan tidak ditemukan atau format tidak valid.",
			404,
		);
	}

	const tokenHash = await hashToken(rawToken);

	// 1. Fetch invitation record
	const rows = await db
		.select()
		.from(invitations)
		.where(eq(invitations.tokenHash, tokenHash))
		.limit(1);

	const invitation = rows[0];
	if (!invitation) {
		return sendError(
			c,
			"NOT_FOUND",
			"Tautan undangan tidak ditemukan atau sudah digunakan.",
			404,
		);
	}

	if (invitation.status === "revoked") {
		return sendError(
			c,
			"STATE_CONFLICT",
			"Tautan undangan ini telah dibatalkan oleh pihak penyelenggara.",
			409,
		);
	}

	if (invitation.status === "accepted") {
		return sendError(
			c,
			"STATE_CONFLICT",
			"Tautan undangan ini sudah pernah digunakan.",
			409,
		);
	}

	const now = new Date();
	if (now > invitation.expiresAt) {
		return sendError(
			c,
			"VALIDATION_FAILED",
			"Tautan undangan telah kedaluwarsa.",
			410,
		);
	}

	// 2. Enforce strict recipient email binding (trim and lowercase)
	const sessionEmail = currentUser.email.trim().toLowerCase();
	const targetEmail = invitation.recipientEmail.trim().toLowerCase();
	if (sessionEmail !== targetEmail) {
		return sendError(
			c,
			"FORBIDDEN",
			`Alamat email akun Anda (${sessionEmail}) tidak cocok dengan email tujuan undangan (${targetEmail}). Silakan masuk dengan akun yang sesuai.`,
			403,
		);
	}

	// 3. Recheck invitation creator's current authority in the organization
	const creatorMembership = await db
		.select({ role: memberships.role })
		.from(memberships)
		.where(
			and(
				eq(memberships.organizationId, invitation.organizationId),
				eq(memberships.userId, invitation.invitedBy),
			),
		)
		.limit(1);

	if (!creatorMembership[0] || creatorMembership[0].role !== "organizer") {
		return sendError(
			c,
			"FORBIDDEN",
			"Pembuat undangan sudah tidak memiliki hak akses Organizer di organisasi ini.",
			403,
		);
	}

	// 4. Atomic conditional CAS consumption + membership/assignment grants + audit log
	// Exactly ONE concurrent request can transition status from 'pending' to 'accepted'.
	const membershipId = crypto.randomUUID();
	const assignmentId = crypto.randomUUID();
	const auditId = crypto.randomUUID();

	try {
		const atomicAcceptQuery = sql`
			WITH consumed AS (
				UPDATE invitations
				SET
					status = 'accepted',
					accepted_by = ${currentUser.id},
					accepted_at = ${now},
					updated_at = ${now}
				WHERE
					id = ${invitation.id}
					AND status = 'pending'
					AND expires_at > ${now}
				RETURNING *
			),
			upsert_membership AS (
				INSERT INTO memberships (
					id, organization_id, user_id, role, created_at
				)
				SELECT
					${membershipId}, organization_id, ${currentUser.id}, invitation_role, ${now}
				FROM consumed
				ON CONFLICT (organization_id, user_id)
				DO UPDATE SET
					role = CASE
						WHEN memberships.role = 'organizer' THEN 'organizer'
						ELSE EXCLUDED.role
					END
				RETURNING id, organization_id, user_id, role
			),
			upsert_assignment AS (
				INSERT INTO event_assignments (
					id, event_id, user_id, can_update_traffic, can_update_cleanup, created_at
				)
				SELECT
					${assignmentId}, event_id, ${currentUser.id}, can_update_traffic, can_update_cleanup, ${now}
				FROM consumed
				WHERE event_id IS NOT NULL
				ON CONFLICT (event_id, user_id)
				DO UPDATE SET
					can_update_traffic = event_assignments.can_update_traffic OR EXCLUDED.can_update_traffic,
					can_update_cleanup = event_assignments.can_update_cleanup OR EXCLUDED.can_update_cleanup
				RETURNING id, event_id, user_id, can_update_traffic, can_update_cleanup
			),
			logged AS (
				INSERT INTO audit_logs (
					id, organization_id, event_id, actor_id, action, entity_type, entity_id, before_json, after_json, created_at
				)
				SELECT
					${auditId},
					organization_id,
					event_id,
					${currentUser.id},
					'invitation.accepted',
					'invitation',
					id,
					json_build_object('status', 'pending', 'recipientEmail', recipient_email)::jsonb,
					json_build_object(
						'status', 'accepted',
						'acceptedBy', accepted_by,
						'role', invitation_role,
						'canUpdateTraffic', can_update_traffic,
						'canUpdateCleanup', can_update_cleanup
					)::jsonb,
					${now}
				FROM consumed
				RETURNING id
			)
			SELECT
				id,
				organization_id AS "organizationId",
				event_id AS "eventId",
				invitation_role AS "invitationRole",
				can_update_traffic AS "canUpdateTraffic",
				can_update_cleanup AS "canUpdateCleanup"
			FROM consumed;
		`;

		const res = await db.execute(atomicAcceptQuery);

		if (res.rows.length === 0) {
			// Another concurrent request consumed the token first or token expired
			return sendError(
				c,
				"STATE_CONFLICT",
				"Tautan undangan ini telah digunakan atau tidak lagi berlaku.",
				409,
			);
		}

		const row = res.rows[0];

		return c.json(
			{
				success: true,
				organizationId: row.organizationId as string,
				eventId: (row.eventId as string | null) ?? null,
				role: row.invitationRole as string,
				permissions: {
					canUpdateTraffic: Boolean(row.canUpdateTraffic),
					canUpdateCleanup: Boolean(row.canUpdateCleanup),
				},
			},
			200,
		);
	} catch {
		return sendError(
			c,
			"INTERNAL_SERVER_ERROR",
			"Gagal menerima undangan. Terjadi kesalahan pada server.",
			500,
		);
	}
});

/**
 * DELETE /api/invitations/:id
 * Organizer revokes an unused invitation.
 */
invitationsRouter.delete("/:id", requireAuth, async (c) => {
	const currentUser = c.get("user")!;
	const invitationId = c.req.param("id");
	const db = c.get("db");

	// 1. Fetch invitation and verify caller is organizer of that organization
	const rows = await db
		.select({
			id: invitations.id,
			organizationId: invitations.organizationId,
			eventId: invitations.eventId,
			status: invitations.status,
			recipientEmail: invitations.recipientEmail,
		})
		.from(invitations)
		.where(eq(invitations.id, invitationId))
		.limit(1);

	const record = rows[0];
	if (!record) {
		return sendError(c, "NOT_FOUND", "Undangan tidak ditemukan.", 404);
	}

	const memberRows = await db
		.select({ role: memberships.role })
		.from(memberships)
		.where(
			and(
				eq(memberships.organizationId, record.organizationId),
				eq(memberships.userId, currentUser.id),
			),
		)
		.limit(1);

	if (!memberRows[0] || memberRows[0].role !== "organizer") {
		return sendError(
			c,
			"FORBIDDEN",
			"Hanya Organizer yang berhak membatalkan undangan.",
			403,
		);
	}

	const now = new Date();
	const auditId = crypto.randomUUID();

	try {
		// Atomic revocation CTE
		const atomicRevokeQuery = sql`
			WITH revoked AS (
				UPDATE invitations
				SET
					status = 'revoked',
					revoked_by = ${currentUser.id},
					revoked_at = ${now},
					updated_at = ${now}
				WHERE
					id = ${invitationId}
					AND status = 'pending'
				RETURNING id, organization_id, event_id, recipient_email, revoked_by
			),
			logged AS (
				INSERT INTO audit_logs (
					id, organization_id, event_id, actor_id, action, entity_type, entity_id, before_json, after_json, created_at
				)
				SELECT
					${auditId},
					organization_id,
					event_id,
					${currentUser.id},
					'invitation.revoked',
					'invitation',
					id,
					json_build_object('status', 'pending', 'recipientEmail', recipient_email)::jsonb,
					json_build_object('status', 'revoked', 'revokedBy', revoked_by)::jsonb,
					${now}
				FROM revoked
				RETURNING id
			)
			SELECT id FROM revoked;
		`;

		const res = await db.execute(atomicRevokeQuery);

		if (res.rows.length === 0) {
			return sendError(
				c,
				"STATE_CONFLICT",
				"Undangan tidak dapat dibatalkan (sudah diterima, kedaluwarsa, atau sudah dibatalkan).",
				409,
			);
		}

		return c.json({ success: true, revokedId: invitationId }, 200);
	} catch {
		return sendError(
			c,
			"INTERNAL_SERVER_ERROR",
			"Gagal membatalkan undangan.",
			500,
		);
	}
});
