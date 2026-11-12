import { and, desc, eq, sql } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import { activationInvitations, events, organizations, platformGrants } from "../../db/schema";
import { sendError } from "../lib/errors";
import { requireAuth } from "../middleware/auth";
import type { AppVariables, Env } from "../types";

type Context = { get(key: "db"): AppVariables["db"]; get(key: "user"): AppVariables["user"]; get(key: "requestId"): string };

async function isSuperadmin(c: Context) {
	const actor = c.get("user");
	if (!actor) return false;
	const rows = await c.get("db").select({ id: platformGrants.id }).from(platformGrants).where(and(eq(platformGrants.userId, actor.id), eq(platformGrants.role, "superadmin"), eq(platformGrants.status, "active"))).limit(1);
	return rows.length === 1;
}

function randomToken() {
	const bytes = crypto.getRandomValues(new Uint8Array(32));
	return Array.from(bytes, value => value.toString(16).padStart(2, "0")).join("");
}

function getCanonicalOrigin(c: { env?: Env }) {
	const configuredUrl = c.env?.BETTER_AUTH_URL || (typeof process !== "undefined" ? process.env?.BETTER_AUTH_URL : undefined);
	if (!configuredUrl) return null;
	try {
		const url = new URL(configuredUrl);
		return url.protocol === "https:" || url.hostname === "localhost" || url.hostname === "127.0.0.1" ? url.origin : null;
	} catch {
		return null;
	}
}

async function hashToken(token: string) {
	const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
	return Array.from(new Uint8Array(digest), value => value.toString(16).padStart(2, "0")).join("");
}

const idSchema = z.uuid();
const createSchema = z.object({
	recipientEmail: z.string().trim().email().max(255).toLowerCase(),
	role: z.enum(["organizer", "officer", "government_reviewer"]),
	organizationId: z.uuid().nullable().optional(),
	eventId: z.uuid().nullable().optional(),
	canUpdateTraffic: z.boolean().default(false),
	canUpdateCleanup: z.boolean().default(false),
	expiresInDays: z.number().int().min(1).max(30).default(7),
}).strict().superRefine((data, ctx) => {
	if (data.role === "organizer" && (!data.organizationId || data.eventId || data.canUpdateTraffic || data.canUpdateCleanup)) ctx.addIssue({ code: "custom", message: "Undangan organizer memerlukan organisasi dan tidak memuat tugas lapangan." });
	if (data.role === "officer" && (!data.organizationId || !data.eventId || (!data.canUpdateTraffic && !data.canUpdateCleanup))) ctx.addIssue({ code: "custom", message: "Petugas memerlukan organisasi, kegiatan, dan setidaknya satu izin tugas." });
	if (data.role === "government_reviewer" && (data.organizationId || data.eventId || data.canUpdateTraffic || data.canUpdateCleanup)) ctx.addIssue({ code: "custom", message: "Reviewer pemerintah tidak ditautkan ke organisasi atau kegiatan pada undangan ini." });
});

export const adminAccountsRouter = new Hono<{ Bindings: Env; Variables: AppVariables }>();
adminAccountsRouter.use("*", requireAuth);

adminAccountsRouter.get("/users/organizations", async c => {
	if (!await isSuperadmin(c)) return sendError(c, "FORBIDDEN", "Akses superadmin diperlukan.", 403);
	const rows = await c.get("db").select({ id: organizations.id, name: organizations.name, village: organizations.village, district: organizations.district }).from(organizations).orderBy(desc(organizations.createdAt)).limit(500);
	return c.json({ organizations: rows });
});

adminAccountsRouter.get("/users/events", async c => {
	if (!await isSuperadmin(c)) return sendError(c, "FORBIDDEN", "Akses superadmin diperlukan.", 403);
	const organizationId = c.req.query("organizationId");
	if (!organizationId || !idSchema.safeParse(organizationId).success) return sendError(c, "VALIDATION_FAILED", "Pilih organisasi yang valid.", 422);
	const rows = await c.get("db").select({ id: events.id, title: events.title, status: events.status }).from(events).where(eq(events.organizationId, organizationId)).orderBy(desc(events.createdAt)).limit(200);
	return c.json({ events: rows });
});

adminAccountsRouter.get("/users/activation-invitations", async c => {
	if (!await isSuperadmin(c)) return sendError(c, "FORBIDDEN", "Akses superadmin diperlukan.", 403);
	const rows = await c.get("db").select({ id: activationInvitations.id, recipientEmail: activationInvitations.recipientEmail, role: activationInvitations.role, organizationId: activationInvitations.organizationId, organizationName: organizations.name, eventId: activationInvitations.eventId, eventTitle: events.title, status: activationInvitations.status, expiresAt: activationInvitations.expiresAt, createdAt: activationInvitations.createdAt, acceptedAt: activationInvitations.acceptedAt }).from(activationInvitations).leftJoin(organizations, eq(activationInvitations.organizationId, organizations.id)).leftJoin(events, eq(activationInvitations.eventId, events.id)).orderBy(desc(activationInvitations.createdAt)).limit(100);
	return c.json({ invitations: rows });
});

adminAccountsRouter.post("/users/activation-invitations", async c => {
	if (!await isSuperadmin(c)) return sendError(c, "FORBIDDEN", "Akses superadmin diperlukan.", 403);
	let body: unknown;
	try { body = await c.req.json(); } catch { return sendError(c, "BAD_REQUEST", "Data undangan tidak valid.", 400); }
	const parsed = createSchema.safeParse(body);
	if (!parsed.success) return sendError(c, "VALIDATION_FAILED", parsed.error.issues[0]?.message || "Periksa data undangan.", 422);
	const input = parsed.data;
	if (input.organizationId) {
		const org = await c.get("db").select({ id: organizations.id }).from(organizations).where(eq(organizations.id, input.organizationId)).limit(1);
		if (!org.length) return sendError(c, "NOT_FOUND", "Organisasi tidak ditemukan.", 404);
	}
	if (input.eventId) {
		const event = await c.get("db").select({ id: events.id }).from(events).where(and(eq(events.id, input.eventId), eq(events.organizationId, input.organizationId!))).limit(1);
		if (!event.length) return sendError(c, "NOT_FOUND", "Kegiatan tidak ditemukan pada organisasi tersebut.", 404);
	}
	const origin = getCanonicalOrigin(c);
	if (!origin) return sendError(c, "DEPENDENCY_UNAVAILABLE", "URL aplikasi belum dikonfigurasi dengan aman.", 503);
	const token = randomToken();
	const tokenHash = await hashToken(token);
	const id = crypto.randomUUID();
	const actor = c.get("user")!;
	const expiresAt = new Date(Date.now() + input.expiresInDays * 86_400_000);
	const inviteUrl = new URL(`/activate/${token}`, origin).toString();
	try {
		const result = await c.get("db").execute(sql`
			WITH authorized AS MATERIALIZED (
				SELECT user_id FROM platform_grants WHERE user_id = ${actor.id} AND role = 'superadmin' AND status = 'active' FOR SHARE
			), created AS (
				INSERT INTO activation_invitations (id, token_hash, recipient_email, role, organization_id, event_id, can_update_traffic, can_update_cleanup, expires_at, created_by)
				SELECT ${id}, ${tokenHash}, ${input.recipientEmail}, ${input.role}, ${input.organizationId ?? null}, ${input.eventId ?? null}, ${input.canUpdateTraffic}, ${input.canUpdateCleanup}, ${expiresAt}, ${actor.id}
				WHERE EXISTS (SELECT 1 FROM authorized) RETURNING id, recipient_email, role, organization_id, event_id, expires_at
			), audit AS (
				INSERT INTO platform_audit (actor_id, action, entity_type, entity_id, reason, request_id)
				SELECT ${actor.id}, 'activation_invitation.created', 'activation_invitation', id::text, role, ${c.get("requestId")} FROM created RETURNING id
			)
			SELECT created.* FROM created CROSS JOIN audit
		`);
		if (!result.rows.length) return sendError(c, "FORBIDDEN", "Akses superadmin tidak aktif.", 403);
		c.header("Cache-Control", "no-store");
		c.header("Referrer-Policy", "no-referrer");
		return c.json({ invitation: { id, recipientEmail: input.recipientEmail, role: input.role, organizationId: input.organizationId ?? null, eventId: input.eventId ?? null, expiresAt, inviteUrl } }, 201);
	} catch {
		return sendError(c, "DEPENDENCY_UNAVAILABLE", "Undangan belum dapat dibuat. Coba lagi.", 503);
	}
});

adminAccountsRouter.delete("/users/activation-invitations/:id", async c => {
	if (!await isSuperadmin(c)) return sendError(c, "FORBIDDEN", "Akses superadmin diperlukan.", 403);
	const id = c.req.param("id");
	if (!idSchema.safeParse(id).success) return sendError(c, "VALIDATION_FAILED", "ID undangan tidak valid.", 422);
	const actor = c.get("user")!;
	const requestId = c.get("requestId");
	try {
		const result = await c.get("db").execute(sql`
			WITH authorized AS MATERIALIZED (SELECT user_id FROM platform_grants WHERE user_id=${actor.id} AND role='superadmin' AND status='active' FOR SHARE),
			revoked AS (UPDATE activation_invitations SET status='revoked' WHERE id=${id} AND status='pending' AND expires_at > now() AND EXISTS(SELECT 1 FROM authorized) RETURNING id, role),
			audit AS (INSERT INTO platform_audit(actor_id, action, entity_type, entity_id, reason, request_id) SELECT ${actor.id},'activation_invitation.revoked','activation_invitation',id::text,role,${requestId} FROM revoked RETURNING id)
			SELECT revoked.id FROM revoked CROSS JOIN audit
		`);
		if (!result.rows.length) return sendError(c, "CONFLICT", "Undangan tidak lagi dapat dicabut.", 409);
		return c.json({ success: true });
	} catch { return sendError(c, "DEPENDENCY_UNAVAILABLE", "Undangan belum dapat dicabut. Coba lagi.", 503); }
});

export const activationRouter = new Hono<{ Bindings: Env; Variables: AppVariables }>();
activationRouter.get("/:token", async c => {
	c.header("Cache-Control", "no-store");
	c.header("Referrer-Policy", "no-referrer");
	const token = c.req.param("token");
	if (!/^[a-f0-9]{64}$/.test(token)) return sendError(c, "NOT_FOUND", "Tautan aktivasi tidak berlaku.", 404);
	const tokenHash = await hashToken(token);
	const rows = await c.get("db").execute(sql`
		SELECT i.recipient_email AS "recipientEmail", i.role, i.expires_at AS "expiresAt", o.name AS "organizationName", e.title AS "eventTitle", i.can_update_traffic AS "canUpdateTraffic", i.can_update_cleanup AS "canUpdateCleanup"
		FROM activation_invitations i LEFT JOIN organizations o ON o.id=i.organization_id LEFT JOIN events e ON e.id=i.event_id
		WHERE i.token_hash=${tokenHash} AND i.status='pending' AND i.expires_at > now() LIMIT 1
	`);
	if (!rows.rows.length) return sendError(c, "NOT_FOUND", "Tautan aktivasi tidak berlaku atau sudah kedaluwarsa.", 404);
	return c.json({ valid: true, invitation: rows.rows[0] });
});

activationRouter.post("/:token/accept", requireAuth, async c => {
	const token = c.req.param("token");
	if (!/^[a-f0-9]{64}$/.test(token)) return sendError(c, "NOT_FOUND", "Tautan aktivasi tidak berlaku.", 404);
	const actor = c.get("user")!;
	const tokenHash = await hashToken(token);
	const requestId = c.get("requestId");
	try {
		const result = await c.get("db").execute(sql`
			WITH target AS MATERIALIZED (
				SELECT * FROM activation_invitations WHERE token_hash=${tokenHash} AND status='pending' AND expires_at > now() FOR UPDATE
			), locked AS MATERIALIZED (
				SELECT pg_advisory_xact_lock(hashtext(${actor.id}), hashtext(COALESCE(organization_id::text, 'platform:' || role))) FROM target
			), eligible AS MATERIALIZED (
				SELECT t.* FROM target t CROSS JOIN locked
				WHERE lower(t.recipient_email)=lower(${actor.email}) AND (
					(t.role='government_reviewer' AND NOT EXISTS(SELECT 1 FROM platform_grants g WHERE g.user_id=${actor.id} AND g.role='government_reviewer' AND g.status <> 'active')) OR
					(t.role IN ('organizer','officer') AND NOT EXISTS(SELECT 1 FROM memberships m WHERE m.organization_id=t.organization_id AND m.user_id=${actor.id} AND m.role <> t.role))
				)
			), member AS (
				INSERT INTO memberships(organization_id,user_id,role)
				SELECT organization_id,${actor.id},role FROM eligible WHERE role IN ('organizer','officer')
				ON CONFLICT(organization_id,user_id) DO UPDATE SET role=memberships.role WHERE memberships.role=EXCLUDED.role
				RETURNING organization_id,user_id,role
			), assigned AS (
				INSERT INTO event_assignments(event_id,user_id,can_update_traffic,can_update_cleanup)
				SELECT event_id,${actor.id},can_update_traffic,can_update_cleanup FROM eligible WHERE role='officer'
				ON CONFLICT(event_id,user_id) DO UPDATE SET can_update_traffic=event_assignments.can_update_traffic OR EXCLUDED.can_update_traffic, can_update_cleanup=event_assignments.can_update_cleanup OR EXCLUDED.can_update_cleanup
				RETURNING event_id,user_id
			), grant_role AS (
				INSERT INTO platform_grants(user_id,role,status)
				SELECT ${actor.id},'government_reviewer','active' FROM eligible WHERE role='government_reviewer'
				ON CONFLICT(user_id,role) DO UPDATE SET status=platform_grants.status WHERE platform_grants.status='active'
				RETURNING user_id,role
			), effect AS (
				SELECT e.id FROM eligible e JOIN member m ON m.organization_id=e.organization_id WHERE e.role='organizer'
				UNION ALL SELECT e.id FROM eligible e JOIN member m ON m.organization_id=e.organization_id JOIN assigned a ON a.event_id=e.event_id WHERE e.role='officer'
				UNION ALL SELECT e.id FROM eligible e JOIN grant_role g ON g.user_id=${actor.id} WHERE e.role='government_reviewer'
			), accepted AS (
				UPDATE activation_invitations i SET status='accepted', accepted_by=${actor.id}, accepted_at=now()
				FROM eligible e WHERE i.id=e.id AND EXISTS(SELECT 1 FROM effect) RETURNING i.id,i.role,i.organization_id,i.event_id
			), audit AS (
				INSERT INTO platform_audit(actor_id,action,entity_type,entity_id,reason,request_id)
				SELECT ${actor.id},'activation_invitation.accepted','activation_invitation',id::text,role,${requestId} FROM accepted RETURNING id
			)
			SELECT accepted.id,accepted.role,accepted.organization_id AS "organizationId",accepted.event_id AS "eventId" FROM accepted CROSS JOIN audit
		`);
		if (result.rows.length) return c.json({ success: true, ...result.rows[0] });
		const rows = await c.get("db").select().from(activationInvitations).where(eq(activationInvitations.tokenHash, tokenHash)).limit(1);
		const invitation = rows[0];
		if (!invitation || invitation.status !== "pending" || invitation.expiresAt <= new Date()) return sendError(c, "GONE", "Tautan aktivasi telah kedaluwarsa, dicabut, atau sudah digunakan.", 410);
		if (invitation.recipientEmail.toLowerCase() !== actor.email.toLowerCase()) return sendError(c, "FORBIDDEN", "Masuk dengan alamat email yang menerima undangan.", 403);
		return sendError(c, "CONFLICT", "Akses akun bertentangan dengan keanggotaan yang sudah ada. Hubungi superadmin.", 409);
	} catch { return sendError(c, "DEPENDENCY_UNAVAILABLE", "Aktivasi belum dapat diselesaikan. Coba lagi.", 503); }
});
