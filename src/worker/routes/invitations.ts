import { and, eq } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import { verification } from "../../db/auth-schema";
import {
	eventAssignments,
	events,
	memberships,
	organizations,
} from "../../db/schema";
import { sendError } from "../lib/errors";
import { requireAuth } from "../middleware/auth";
import type { AppVariables, Env } from "../types";

export const createInvitationSchema = z.object({
	eventId: z.string().uuid("ID kegiatan harus berformat UUID."),
	canUpdateTraffic: z.boolean().default(false),
	canUpdateCleanup: z.boolean().default(false),
	expiresInDays: z.number().int().min(1).max(30).default(7),
});

export const invitationsRouter = new Hono<{
	Bindings: Env;
	Variables: AppVariables;
}>();

/**
 * POST /api/invitations
 * Organizer generates an invitation token for an officer to join their event.
 * (message (2).txt §6: "Organizer membuka kegiatan -> Tim & Petugas -> Undang Petugas...")
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

	const { eventId, canUpdateTraffic, canUpdateCleanup, expiresInDays } =
		parseResult.data;

	if (!canUpdateTraffic && !canUpdateCleanup) {
		return sendError(
			c,
			"VALIDATION_FAILED",
			"Pilih minimal satu hak tugas lapangan (Pecalang / Kebersihan).",
			422,
		);
	}

	// 1. Verify event exists and caller is an organizer of its organization
	const eventRows = await db
		.select({
			id: events.id,
			title: events.title,
			organizationId: events.organizationId,
		})
		.from(events)
		.where(eq(events.id, eventId))
		.limit(1);

	const event = eventRows[0];
	if (!event) {
		return sendError(c, "NOT_FOUND", "Kegiatan tidak ditemukan.", 404);
	}

	const memberRows = await db
		.select({ role: memberships.role })
		.from(memberships)
		.where(
			and(
				eq(memberships.organizationId, event.organizationId),
				eq(memberships.userId, currentUser.id),
			),
		)
		.limit(1);

	const membership = memberRows[0];
	if (!membership || membership.role !== "organizer") {
		return sendError(
			c,
			"FORBIDDEN",
			"Hanya Organizer yang berhak membuat tautan undangan petugas.",
			403,
		);
	}

	// 2. Insert invitation record into verification table
	const tokenId = `inv_${crypto.randomUUID().replace(/-/g, "")}`;
	const now = new Date();
	const expiresAt = new Date(
		now.getTime() + expiresInDays * 24 * 60 * 60 * 1000,
	);

	const payloadData = JSON.stringify({
		organizationId: event.organizationId,
		eventId: event.id,
		canUpdateTraffic,
		canUpdateCleanup,
		createdBy: currentUser.id,
	});

	await db.insert(verification).values({
		id: tokenId,
		identifier: `invitation:${event.id}`,
		value: payloadData,
		expiresAt,
		createdAt: now,
		updatedAt: now,
	});

	const origin = new URL(c.req.url).origin;
	const inviteUrl = `${origin}/invite/${tokenId}`;

	return c.json(
		{
			token: tokenId,
			inviteUrl,
			expiresAt: expiresAt.toISOString(),
			permissions: {
				canUpdateTraffic,
				canUpdateCleanup,
			},
		},
		201,
	);
});

/**
 * GET /api/invitations/:token
 * Public endpoint: inspects and validates an invitation token.
 */
invitationsRouter.get("/:token", async (c) => {
	const token = c.req.param("token");
	const db = c.get("db");

	const rows = await db
		.select()
		.from(verification)
		.where(eq(verification.id, token))
		.limit(1);

	const record = rows[0];
	if (!record) {
		return sendError(
			c,
			"NOT_FOUND",
			"Tautan undangan tidak ditemukan atau sudah tidak berlaku.",
			404,
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

	let parsedValue: {
		organizationId: string;
		eventId: string;
		canUpdateTraffic: boolean;
		canUpdateCleanup: boolean;
	};

	try {
		parsedValue = JSON.parse(record.value);
	} catch {
		return sendError(
			c,
			"INTERNAL_SERVER_ERROR",
			"Data undangan tidak valid.",
			500,
		);
	}

	// Fetch event and organization info
	const eventRows = await db
		.select({
			id: events.id,
			title: events.title,
			venueName: events.venueName,
			organizationId: events.organizationId,
		})
		.from(events)
		.where(eq(events.id, parsedValue.eventId))
		.limit(1);

	const orgRows = await db
		.select({
			id: organizations.id,
			name: organizations.name,
			village: organizations.village,
			district: organizations.district,
		})
		.from(organizations)
		.where(eq(organizations.id, parsedValue.organizationId))
		.limit(1);

	const event = eventRows[0];
	const org = orgRows[0];

	return c.json(
		{
			valid: true,
			token,
			event: event || {
				id: parsedValue.eventId,
				title: "Kegiatan Upacara Adat",
			},
			organization: org || {
				id: parsedValue.organizationId,
				name: "Desa Adat",
			},
			permissions: {
				canUpdateTraffic: parsedValue.canUpdateTraffic,
				canUpdateCleanup: parsedValue.canUpdateCleanup,
			},
			expiresAt: record.expiresAt.toISOString(),
		},
		200,
	);
});

/**
 * POST /api/invitations/:token/accept
 * Authenticated officer accepts the invitation, granting membership and event assignment.
 */
invitationsRouter.post("/:token/accept", requireAuth, async (c) => {
	const currentUser = c.get("user")!;
	const token = c.req.param("token");
	const db = c.get("db");

	const rows = await db
		.select()
		.from(verification)
		.where(eq(verification.id, token))
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

	if (new Date() > record.expiresAt) {
		return sendError(
			c,
			"VALIDATION_FAILED",
			"Tautan undangan telah kedaluwarsa.",
			410,
		);
	}

	let parsedValue: {
		organizationId: string;
		eventId: string;
		canUpdateTraffic: boolean;
		canUpdateCleanup: boolean;
	};

	try {
		parsedValue = JSON.parse(record.value);
	} catch {
		return sendError(
			c,
			"INTERNAL_SERVER_ERROR",
			"Data undangan rusak.",
			500,
		);
	}

	const now = new Date();

	try {
		// 1. Ensure user is in memberships as officer (if not already organizer/officer)
		const existingMember = await db
			.select()
			.from(memberships)
			.where(
				and(
					eq(memberships.organizationId, parsedValue.organizationId),
					eq(memberships.userId, currentUser.id),
				),
			)
			.limit(1);

		if (existingMember.length === 0) {
			await db.insert(memberships).values({
				id: crypto.randomUUID(),
				organizationId: parsedValue.organizationId,
				userId: currentUser.id,
				role: "officer",
				createdAt: now,
			});
		}

		// 2. Upsert event assignment
		const existingAssignment = await db
			.select()
			.from(eventAssignments)
			.where(
				and(
					eq(eventAssignments.eventId, parsedValue.eventId),
					eq(eventAssignments.userId, currentUser.id),
				),
			)
			.limit(1);

		if (existingAssignment.length === 0) {
			await db.insert(eventAssignments).values({
				id: crypto.randomUUID(),
				eventId: parsedValue.eventId,
				userId: currentUser.id,
				canUpdateTraffic: parsedValue.canUpdateTraffic,
				canUpdateCleanup: parsedValue.canUpdateCleanup,
				createdAt: now,
			});
		} else {
			await db
				.update(eventAssignments)
				.set({
					canUpdateTraffic:
						existingAssignment[0].canUpdateTraffic ||
						parsedValue.canUpdateTraffic,
					canUpdateCleanup:
						existingAssignment[0].canUpdateCleanup ||
						parsedValue.canUpdateCleanup,
				})
				.where(eq(eventAssignments.id, existingAssignment[0].id));
		}

		// 3. Delete used invitation token so it cannot be reused (message (2).txt §6: "berlaku sekali")
		await db.delete(verification).where(eq(verification.id, token));

		return c.json(
			{
				success: true,
				eventId: parsedValue.eventId,
				role: "officer",
				permissions: {
					canUpdateTraffic: parsedValue.canUpdateTraffic,
					canUpdateCleanup: parsedValue.canUpdateCleanup,
				},
			},
			200,
		);
	} catch (err) {
		const message = err instanceof Error ? err.message : "Database error";
		return sendError(
			c,
			"INTERNAL_SERVER_ERROR",
			`Gagal menerima undangan: ${message}`,
			500,
		);
	}
});
