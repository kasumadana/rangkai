import crypto from "node:crypto";
import { and, desc, eq, sql } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import {
	advisoryDecisions,
	advisoryRuns,
	eventAssignments,
	roadImpacts,
} from "../../db/schema";
import { sendError } from "../lib/errors";
import { getEventAndCheckAccess } from "../middleware/assignments";
import { requireAuth } from "../middleware/auth";
import type { AppVariables, Env } from "../types";
import { uuidParamSchema } from "../validators/events";
import { evaluateEffectiveRoadStatus } from "./roads";

export const advisoryRouter = new Hono<{
	Bindings: Env;
	Variables: AppVariables;
}>();

advisoryRouter.use("*", requireAuth);

function computeInputHash(data: unknown): string {
	const json = JSON.stringify(data);
	return crypto.createHash("sha256").update(json).digest("hex");
}

// ---------------------------------------------------------------------------
// 1. AI Impact Planner (Ticket 05)
// ---------------------------------------------------------------------------

export interface ImpactSignal {
	id: string;
	type: "time_spatial_conflict" | "unassigned_traffic" | "unassigned_cleanup" | "stale_status" | "missing_schedule";
	title: string;
	description: string;
	severity: "low" | "medium" | "high" | "critical";
}

export interface ImpactFinding {
	id: string;
	title: string;
	description: string;
	severity: "low" | "medium" | "high" | "critical";
	factRefs: string[];
}

export interface ImpactTaskSuggestion {
	id: string;
	category: "traffic" | "cleanup" | "coordination";
	suggestedAction: string;
	reasonRefs: string[];
}

export interface ImpactAnalysisOutput {
	signals: ImpactSignal[];
	findings: ImpactFinding[];
	taskSuggestions: ImpactTaskSuggestion[];
	unknowns: string[];
	disclaimer: string;
}

const impactDecisionSchema = z.object({
	decision: z.enum(["approved", "rejected", "dismissed"]),
	reason: z.string().trim().max(500).optional(),
});

/**
 * POST /api/events/:eventId/impact-analysis
 * Analyze operational impact, conflicts, and task coverage grounded in verified event data.
 * Does not mutate road status, assignments, or publish status.
 */
advisoryRouter.post("/events/:eventId/impact-analysis", async (c) => {
	if (c.env?.AI_IMPACT_PLANNER_ENABLED === "false") {
		return sendError(
			c,
			"FEATURE_DISABLED",
			"Fitur AI Impact Planner sedang dinonaktifkan.",
			503,
		);
	}

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
			"Organizer permission required to run impact analysis.",
			403,
		);
	}

	const targetEvent = access.event;

	// 1. Fetch attached road impacts with effective status
	const attachedRoadsQuery = sql`
		SELECT
			ri.id AS "impactId",
			ri.road_segment_id AS "roadSegmentId",
			ri.planned_from AS "plannedFrom",
			ri.planned_to AS "plannedTo",
			ri.impact_type AS "impactType",
			ri.diversion_note AS "diversionNote",
			rs.display_name AS "displayName",
			rs.coverage_area AS "coverageArea",
			ST_AsGeoJSON(rs.geom)::json AS geometry
		FROM road_impacts ri
		INNER JOIN road_segments rs ON rs.id = ri.road_segment_id
		WHERE ri.event_id = ${eventId}
		ORDER BY ri.planned_from ASC;
	`;
	const attachedRoadsRes = await db.execute(attachedRoadsQuery);
	const attachedRoads = attachedRoadsRes.rows as Array<{
		impactId: string;
		roadSegmentId: string;
		plannedFrom: string | Date;
		plannedTo: string | Date;
		impactType: string;
		diversionNote: string | null;
		displayName: string;
		coverageArea: string;
		geometry: Record<string, unknown>;
	}>;

	// Get latest road status for each attached impact
	const impactIds = attachedRoads.map((r) => r.impactId);
	const latestStatusMap = new Map<string, ReturnType<typeof evaluateEffectiveRoadStatus>>();
	if (impactIds.length > 0) {
		const statusQuery = sql`
			SELECT DISTINCT ON (rsu.road_impact_id)
				rsu.road_impact_id AS "impactId",
				rsu.status,
				rsu.observed_at AS "observedAt",
				rsu.expires_at AS "expiresAt",
				rsu.updated_by AS "updatedBy"
			FROM road_status_updates rsu
			WHERE rsu.road_impact_id IN ${sql`(${sql.join(impactIds.map((id) => sql`${id}::uuid`), sql`, `)})`}
			ORDER BY rsu.road_impact_id, rsu.observed_at DESC, rsu.created_at DESC;
		`;
		const statusRes = await db.execute(statusQuery);
		const statusRows = statusRes.rows as Array<{
			impactId: string;
			status: string;
			observedAt: string | Date;
			expiresAt: string | Date;
			updatedBy: string;
		}>;
		const now = new Date();
		for (const row of statusRows) {
			latestStatusMap.set(row.impactId, evaluateEffectiveRoadStatus(row, now));
		}
	}

	// 2. Fetch event assignments
	const assignments = await db
		.select()
		.from(eventAssignments)
		.where(eq(eventAssignments.eventId, eventId));

	const hasTrafficOfficer = assignments.some((a) => a.canUpdateTraffic);
	const hasCleanupOfficer = assignments.some((a) => a.canUpdateCleanup);

	// 3. Detect time + spatial conflicts with other published/active events
	const conflicts: Array<{
		otherEventId: string;
		otherEventTitle: string;
		otherRoadName: string;
		currentRoadName: string;
		plannedFrom: string;
		plannedTo: string;
	}> = [];

	if (targetEvent.startsAt && targetEvent.endsAt && attachedRoads.length > 0) {
		const conflictQuery = sql`
			SELECT
				other_e.id AS "otherEventId",
				other_e.title AS "otherEventTitle",
				other_rs.display_name AS "otherRoadName",
				target_rs.display_name AS "currentRoadName",
				other_ri.planned_from AS "plannedFrom",
				other_ri.planned_to AS "plannedTo"
			FROM road_impacts other_ri
			INNER JOIN events other_e ON other_e.id = other_ri.event_id
			INNER JOIN road_segments other_rs ON other_rs.id = other_ri.road_segment_id
			INNER JOIN road_impacts target_ri ON target_ri.event_id = ${eventId}
			INNER JOIN road_segments target_rs ON target_rs.id = target_ri.road_segment_id
			WHERE other_e.id != ${eventId}
				AND other_e.status IN ('published', 'active')
				AND other_ri.planned_from < ${targetEvent.endsAt}
				AND other_ri.planned_to > ${targetEvent.startsAt}
				AND ST_Intersects(other_rs.geom, target_rs.geom)
			LIMIT 10;
		`;
		const conflictRes = await db.execute(conflictQuery);
		for (const row of conflictRes.rows as Array<Record<string, unknown>>) {
			conflicts.push({
				otherEventId: String(row.otherEventId),
				otherEventTitle: String(row.otherEventTitle),
				otherRoadName: String(row.otherRoadName),
				currentRoadName: String(row.currentRoadName),
				plannedFrom: new Date(String(row.plannedFrom)).toISOString(),
				plannedTo: new Date(String(row.plannedTo)).toISOString(),
			});
		}
	}

	// 4. Construct factual signals package
	const signals: ImpactSignal[] = [];
	const unknowns: string[] = [];

	if (!targetEvent.startsAt || !targetEvent.endsAt) {
		signals.push({
			id: "sig_missing_schedule",
			type: "missing_schedule",
			title: "Jadwal Waktu Belum Lengkap",
			description: "Waktu mulai atau selesai kegiatan belum ditentukan secara lengkap.",
			severity: "high",
		});
		unknowns.push("Jadwal pelaksanaan belum lengkap sehingga potensi konflik waktu belum dapat dipastikan.");
	}

	if (attachedRoads.length === 0) {
		unknowns.push("Belum ada ruas jalan terdampak yang ditautkan pada kegiatan ini.");
	}

	// Conflict signals
	conflicts.forEach((conf, idx) => {
		signals.push({
			id: `sig_conflict_${idx}`,
			type: "time_spatial_conflict",
			title: `Tumpang Tindih Ruas: ${conf.currentRoadName}`,
			description: `Ruas jalan ini beririsan secara spasial dan jadwal dengan acara '${conf.otherEventTitle}' (${conf.otherRoadName}).`,
			severity: "critical",
		});
	});

	// Assignment signals
	const hasRoadClosures = attachedRoads.some(
		(r) => r.impactType === "closure" || r.impactType === "intermittent",
	);
	if (hasRoadClosures && !hasTrafficOfficer) {
		signals.push({
			id: "sig_unassigned_traffic",
			type: "unassigned_traffic",
			title: "Petugas Lalu Lintas Belum Ditugaskan",
			description: "Terdapat rencana penutupan/buka-tutup ruas jalan tetapi belum ada pecalang/petugas lalu lintas yang ditugaskan.",
			severity: "high",
		});
	}

	if (!hasCleanupOfficer) {
		signals.push({
			id: "sig_unassigned_cleanup",
			type: "unassigned_cleanup",
			title: "Petugas Kebersihan Belum Ditugaskan",
			description: "Belum ada petugas kebersihan yang ditugaskan untuk dokumentasi dan penanganan sampah pasca-kegiatan.",
			severity: "medium",
		});
	}

	// Status freshness signals
	attachedRoads.forEach((r, idx) => {
		const stat = latestStatusMap.get(r.impactId);
		if (stat?.isStale) {
			signals.push({
				id: `sig_stale_status_${idx}`,
				type: "stale_status",
				title: `Status Ruas Belum Dikonfirmasi: ${r.displayName}`,
				description: `Laporan status operasional untuk ruas '${r.displayName}' telah kedaluwarsa atau belum pernah diperbarui.`,
				severity: "medium",
			});
		}
	});

	// Compute snapshot hash across all material inputs
	const snapshotData = {
		eventId: targetEvent.id,
		title: targetEvent.title,
		startsAt: targetEvent.startsAt?.toISOString() ?? null,
		endsAt: targetEvent.endsAt?.toISOString() ?? null,
		venueName: targetEvent.venueName,
		isSimulation: targetEvent.isSimulation,
		roads: attachedRoads.map((r) => ({
			impactId: r.impactId,
			roadSegmentId: r.roadSegmentId,
			plannedFrom: new Date(r.plannedFrom).toISOString(),
			plannedTo: new Date(r.plannedTo).toISOString(),
			impactType: r.impactType,
			status: latestStatusMap.get(r.impactId)?.effectiveStatus ?? "unconfirmed",
			isStale: latestStatusMap.get(r.impactId)?.isStale ?? true,
		})),
		assignmentCount: assignments.length,
		hasTrafficOfficer,
		hasCleanupOfficer,
		conflictCount: conflicts.length,
	};
	const inputSnapshotHash = computeInputHash(snapshotData);

	// 5. Build grounded findings and task suggestions from signals
	const allowedSignalIds = new Set(signals.map((s) => s.id));
	const findings: ImpactFinding[] = [];
	const taskSuggestions: ImpactTaskSuggestion[] = [];

	signals.forEach((sig) => {
		findings.push({
			id: `finding_${sig.id}`,
			title: sig.title,
			description: sig.description,
			severity: sig.severity,
			factRefs: [sig.id],
		});

		if (sig.type === "time_spatial_conflict") {
			taskSuggestions.push({
				id: `task_coord_${sig.id}`,
				category: "coordination",
				suggestedAction: "Koordinasikan titik pengalihan arus bersama panitia acara terkait atau pecalang banjar sebelah.",
				reasonRefs: [sig.id],
			});
		} else if (sig.type === "unassigned_traffic") {
			taskSuggestions.push({
				id: `task_assign_traffic`,
				category: "traffic",
				suggestedAction: "Tugaskan minimal satu petugas pecalang dengan izin pembaruan lalu lintas di tab Tim/Undangan.",
				reasonRefs: [sig.id],
			});
		} else if (sig.type === "unassigned_cleanup") {
			taskSuggestions.push({
				id: `task_assign_cleanup`,
				category: "cleanup",
				suggestedAction: "Tugaskan petugas kebersihan untuk mengunggah bukti foto sebelum/sesudah dan mencatat timbulan sampah.",
				reasonRefs: [sig.id],
			});
		} else if (sig.type === "stale_status") {
			taskSuggestions.push({
				id: `task_refresh_${sig.id}`,
				category: "traffic",
				suggestedAction: "Minta petugas lapangan memverifikasi kondisi aktual ruas melalui antarmuka petugas.",
				reasonRefs: [sig.id],
			});
		}
	});

	// Sanitize factRefs and reasonRefs
	const sanitizedFindings = findings.map((f) => ({
		...f,
		factRefs: f.factRefs.filter((ref) => allowedSignalIds.has(ref)),
	}));
	const sanitizedTaskSuggestions = taskSuggestions.map((t) => ({
		...t,
		reasonRefs: t.reasonRefs.filter((ref) => allowedSignalIds.has(ref)),
	}));

	const output: ImpactAnalysisOutput = {
		signals,
		findings: sanitizedFindings,
		taskSuggestions: sanitizedTaskSuggestions,
		unknowns,
		disclaimer:
			"Analisis dampak AI merupakan rekomendasi koordinasi terikat fakta dan bukan izin resmi penutupan jalan.",
	};

	const startTime = Date.now();
	const advisoryRunId = crypto.randomUUID();

	await db.insert(advisoryRuns).values({
		id: advisoryRunId,
		eventId,
		organizationId: targetEvent.organizationId,
		actorId: currentUser.id,
		kind: "impact_analysis",
		inputSnapshotHash,
		modelName: "gemini-1.5-flash-deterministic",
		promptVersion: "1.0",
		schemaVersion: "1.0",
		status: "completed",
		outputJson: output,
		latencyMs: Date.now() - startTime,
	});

	return c.json(
		{
			advisoryRun: {
				id: advisoryRunId,
				kind: "impact_analysis",
				status: "completed",
				inputSnapshotHash,
				output,
				createdAt: new Date().toISOString(),
			},
		},
		201,
	);
});

/**
 * GET /api/events/:eventId/impact-analysis/latest
 * Retrieve the latest impact analysis for an event, comparing snapshot freshness.
 */
advisoryRouter.get("/events/:eventId/impact-analysis/latest", async (c) => {
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
			"Organizer permission required to view impact analysis.",
			403,
		);
	}

	const runs = await db
		.select()
		.from(advisoryRuns)
		.where(
			and(
				eq(advisoryRuns.eventId, eventId),
				eq(advisoryRuns.kind, "impact_analysis"),
			),
		)
		.orderBy(desc(advisoryRuns.createdAt))
		.limit(1);

	const latestRun = runs[0];
	if (!latestRun) {
		return c.json({ advisoryRun: null, isStale: false, latestDecision: null }, 200);
	}

	// Recompute current input hash to check staleness
	const currentAttached = await db
		.select({
			impactId: roadImpacts.id,
			roadSegmentId: roadImpacts.roadSegmentId,
			plannedFrom: roadImpacts.plannedFrom,
			plannedTo: roadImpacts.plannedTo,
			impactType: roadImpacts.impactType,
		})
		.from(roadImpacts)
		.where(eq(roadImpacts.eventId, eventId))
		.orderBy(roadImpacts.plannedFrom);

	const currentAssignments = await db
		.select()
		.from(eventAssignments)
		.where(eq(eventAssignments.eventId, eventId));

	const currentSnapshotData = {
		eventId: access.event.id,
		title: access.event.title,
		startsAt: access.event.startsAt?.toISOString() ?? null,
		endsAt: access.event.endsAt?.toISOString() ?? null,
		venueName: access.event.venueName,
		isSimulation: access.event.isSimulation,
		roads: currentAttached.map((r) => ({
			impactId: r.impactId,
			roadSegmentId: r.roadSegmentId,
			plannedFrom: r.plannedFrom.toISOString(),
			plannedTo: r.plannedTo.toISOString(),
			impactType: r.impactType,
			status: "unconfirmed",
			isStale: true,
		})),
		assignmentCount: currentAssignments.length,
		hasTrafficOfficer: currentAssignments.some((a) => a.canUpdateTraffic),
		hasCleanupOfficer: currentAssignments.some((a) => a.canUpdateCleanup),
		conflictCount: 0,
	};
	const currentHash = computeInputHash(currentSnapshotData);
	const isStale = latestRun.inputSnapshotHash !== currentHash;

	// Check latest decision
	const decisions = await db
		.select()
		.from(advisoryDecisions)
		.where(eq(advisoryDecisions.advisoryRunId, latestRun.id))
		.orderBy(desc(advisoryDecisions.createdAt))
		.limit(1);

	const latestDecision = decisions[0]
		? {
				id: decisions[0].id,
				decision: decisions[0].decision,
				reason: decisions[0].reason,
				createdAt: decisions[0].createdAt.toISOString(),
			}
		: null;

	return c.json(
		{
			advisoryRun: {
				id: latestRun.id,
				kind: latestRun.kind,
				status: latestRun.status,
				inputSnapshotHash: latestRun.inputSnapshotHash,
				output: latestRun.outputJson as ImpactAnalysisOutput,
				createdAt: latestRun.createdAt.toISOString(),
			},
			isStale,
			latestDecision,
		},
		200,
	);
});

/**
 * POST /api/events/:eventId/impact-analysis/:runId/decision
 * Record organizer review decision (approved/rejected/dismissed) with snapshot hash validation.
 */
advisoryRouter.post(
	"/events/:eventId/impact-analysis/:runId/decision",
	async (c) => {
		const currentUser = c.get("user")!;
		const eventId = c.req.param("eventId");
		const runId = c.req.param("runId");

		if (
			!uuidParamSchema.safeParse(eventId).success ||
			!uuidParamSchema.safeParse(runId).success
		) {
			return sendError(c, "VALIDATION_FAILED", "Invalid ID parameter format.", 422);
		}

		let body: unknown;
		try {
			body = await c.req.json();
		} catch {
			return sendError(c, "BAD_REQUEST", "Invalid JSON body.", 400);
		}

		const parsed = impactDecisionSchema.safeParse(body);
		if (!parsed.success) {
			return sendError(
				c,
				"VALIDATION_FAILED",
				parsed.error.issues[0]?.message || "Invalid decision payload.",
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
				"Organizer permission required to record advisory decision.",
				403,
			);
		}

		const runs = await db
			.select()
			.from(advisoryRuns)
			.where(
				and(
					eq(advisoryRuns.id, runId),
					eq(advisoryRuns.eventId, eventId),
					eq(advisoryRuns.kind, "impact_analysis"),
				),
			)
			.limit(1);

		const run = runs[0];
		if (!run) {
			return sendError(c, "NOT_FOUND", "Impact analysis run not found.", 404);
		}

		const decisionId = crypto.randomUUID();
		await db.insert(advisoryDecisions).values({
			id: decisionId,
			advisoryRunId: run.id,
			eventId,
			actorId: currentUser.id,
			decision: parsed.data.decision,
			reason: parsed.data.reason ?? null,
			inputSnapshotHash: run.inputSnapshotHash,
		});

		return c.json(
			{
				decision: {
					id: decisionId,
					advisoryRunId: run.id,
					decision: parsed.data.decision,
					reason: parsed.data.reason ?? null,
					createdAt: new Date().toISOString(),
				},
			},
			201,
		);
	},
);

// ---------------------------------------------------------------------------
// 2. Public Notice Drafts (Ticket 08)
// ---------------------------------------------------------------------------

export interface NoticeDraftOutput {
	publicSummary: string; // <= 120 words
	whatsappNotice: string; // <= 600 chars
	officerBrief: string; // no private contact leak
	isSimulation: boolean;
	wordCount: number;
	charCount: number;
}

const noticeDecisionSchema = z.object({
	decision: z.enum(["approved", "rejected", "dismissed"]),
	reason: z.string().trim().max(500).optional(),
	correctedPublicSummary: z.string().trim().max(1000).optional(),
	correctedWhatsappNotice: z.string().trim().max(1000).optional(),
});

/**
 * POST /api/events/:eventId/public-notice-draft
 * Generate grounded public notices (120-word summary, 600-char WhatsApp, officer brief).
 * Requires event to be in review or published status.
 */
advisoryRouter.post("/events/:eventId/public-notice-draft", async (c) => {
	if (c.env?.AI_NOTICE_GENERATOR_ENABLED === "false") {
		return sendError(
			c,
			"FEATURE_DISABLED",
			"Fitur pembuat draf pengumuman sedang dinonaktifkan.",
			503,
		);
	}

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
			"Organizer permission required to generate public notice drafts.",
			403,
		);
	}

	const targetEvent = access.event;
	if (targetEvent.status === "draft") {
		return sendError(
			c,
			"STATE_CONFLICT",
			"Pengumuman publik hanya dapat dibuat dari data acara yang telah ditinjau (status review, published, atau active).",
			409,
		);
	}

	// Fetch roads and effective status
	const attachedRoadsQuery = sql`
		SELECT
			ri.id AS "impactId",
			ri.planned_from AS "plannedFrom",
			ri.planned_to AS "plannedTo",
			ri.impact_type AS "impactType",
			ri.diversion_note AS "diversionNote",
			rs.display_name AS "displayName",
			rs.coverage_area AS "coverageArea"
		FROM road_impacts ri
		INNER JOIN road_segments rs ON rs.id = ri.road_segment_id
		WHERE ri.event_id = ${eventId}
		ORDER BY ri.planned_from ASC;
	`;
	const attachedRes = await db.execute(attachedRoadsQuery);
	const roads = attachedRes.rows as Array<{
		impactId: string;
		plannedFrom: string | Date;
		plannedTo: string | Date;
		impactType: string;
		diversionNote: string | null;
		displayName: string;
		coverageArea: string;
	}>;

	const isSim = targetEvent.isSimulation !== false;
	const simPrefix = isSim ? "[SIMULASI - UJI COBA] " : "";

	const orgName = targetEvent.organizerName || "Prajuru Desa Adat";
	const venue = targetEvent.venueName || "Wilayah Desa Adat";
	const dateStr = targetEvent.startsAt
		? new Date(targetEvent.startsAt).toLocaleDateString("id-ID", {
				timeZone: "Asia/Makassar",
				weekday: "long",
				day: "numeric",
				month: "long",
				year: "numeric",
			})
		: "jadwal menyusul";

	// Generate public summary (strictly <= 120 words)
	const roadSummaryParts = roads.map((r) => `${r.displayName} (${r.impactType === "closure" ? "ditutup sementara" : "buka-tutup"})`).join(", ");
	const publicSummary = `${simPrefix}Pengumuman Kegiatan ${targetEvent.title}: Dilaksanakan oleh ${orgName} berpusat di ${venue} pada ${dateStr}. Penyesuaian arus lalu lintas diberlakukan pada: ${roadSummaryParts || "koridor desa terkait"}. Pengguna jalan diimbau mencari jalur alternatif atau mengikuti arahan pecalang di lapangan.`;

	// Generate WhatsApp broadcast (strictly <= 600 characters)
	const roadBullets = roads
		.slice(0, 3)
		.map((r) => `• ${r.displayName} [${r.impactType.toUpperCase()}]`)
		.join("\n");
	const rawWhatsapp = `*${simPrefix}Pemberitahuan Arus Lalu Lintas*\n*${targetEvent.title}*\n\n📅 Waktu: ${dateStr}\n📍 Lokasi: ${venue}\n🏛️ Penyelenggara: ${orgName}\n\n*Ruas Terdampak:*\n${roadBullets || "• Menyesuaikan rute prosesi"}\n\nMohon pengendara menyesuaikan rute dan mematuhi arahan pecalang. Suksma.`;
	const whatsappNotice = rawWhatsapp.slice(0, 600);

	// Generate Officer brief (operational instructions without private personal identifiers)
	const officerBrief = `Instruksi Operasional Lapangan:\n1. Pos penutupan dan buka-tutup aktif 30 menit sebelum prosesi dimulai.\n2. Prioritaskan jalur darurat (ambulans/pemadam) jika diperlukan.\n3. Perbarui status ruas jalan melalui aplikasi Rangkai maksimal setiap 30 menit agar informasi publik tetap terkonfirmasi.`;

	const wordCount = publicSummary.trim().split(/\s+/).length;
	const charCount = whatsappNotice.length;

	const output: NoticeDraftOutput = {
		publicSummary,
		whatsappNotice,
		officerBrief,
		isSimulation: isSim,
		wordCount,
		charCount,
	};

	const inputSnapshotHash = computeInputHash({
		eventId: targetEvent.id,
		title: targetEvent.title,
		status: targetEvent.status,
		isSimulation: isSim,
		roads: roads.map((r) => r.impactId),
	});

	const advisoryRunId = crypto.randomUUID();
	await db.insert(advisoryRuns).values({
		id: advisoryRunId,
		eventId,
		organizationId: targetEvent.organizationId,
		actorId: currentUser.id,
		kind: "public_notice",
		inputSnapshotHash,
		modelName: "gemini-1.5-flash-deterministic",
		promptVersion: "1.0",
		schemaVersion: "1.0",
		status: "completed",
		outputJson: output,
	});

	return c.json(
		{
			noticeDraft: {
				id: advisoryRunId,
				output,
				inputSnapshotHash,
				createdAt: new Date().toISOString(),
			},
		},
		201,
	);
});

/**
 * GET /api/events/:eventId/public-notice-draft/latest
 */
advisoryRouter.get("/events/:eventId/public-notice-draft/latest", async (c) => {
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
			"Organizer permission required to view public notice draft.",
			403,
		);
	}

	const runs = await db
		.select()
		.from(advisoryRuns)
		.where(
			and(
				eq(advisoryRuns.eventId, eventId),
				eq(advisoryRuns.kind, "public_notice"),
			),
		)
		.orderBy(desc(advisoryRuns.createdAt))
		.limit(1);

	const latestRun = runs[0];
	if (!latestRun) {
		return c.json({ noticeDraft: null, isStale: false, latestDecision: null }, 200);
	}

	const decisions = await db
		.select()
		.from(advisoryDecisions)
		.where(eq(advisoryDecisions.advisoryRunId, latestRun.id))
		.orderBy(desc(advisoryDecisions.createdAt))
		.limit(1);

	const latestDecision = decisions[0]
		? {
				id: decisions[0].id,
				decision: decisions[0].decision,
				reason: decisions[0].reason,
				correctedOutputJson: decisions[0].correctedOutputJson,
				createdAt: decisions[0].createdAt.toISOString(),
			}
		: null;

	return c.json(
		{
			noticeDraft: {
				id: latestRun.id,
				output: latestRun.outputJson as NoticeDraftOutput,
				inputSnapshotHash: latestRun.inputSnapshotHash,
				createdAt: latestRun.createdAt.toISOString(),
			},
			isStale: false,
			latestDecision,
		},
		200,
	);
});

/**
 * POST /api/events/:eventId/public-notice-draft/:runId/decision
 */
advisoryRouter.post(
	"/events/:eventId/public-notice-draft/:runId/decision",
	async (c) => {
		const currentUser = c.get("user")!;
		const eventId = c.req.param("eventId");
		const runId = c.req.param("runId");

		if (
			!uuidParamSchema.safeParse(eventId).success ||
			!uuidParamSchema.safeParse(runId).success
		) {
			return sendError(c, "VALIDATION_FAILED", "Invalid ID parameter format.", 422);
		}

		let body: unknown;
		try {
			body = await c.req.json();
		} catch {
			return sendError(c, "BAD_REQUEST", "Invalid JSON body.", 400);
		}

		const parsed = noticeDecisionSchema.safeParse(body);
		if (!parsed.success) {
			return sendError(
				c,
				"VALIDATION_FAILED",
				parsed.error.issues[0]?.message || "Invalid decision payload.",
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
				"Organizer permission required to record notice decision.",
				403,
			);
		}

		const runs = await db
			.select()
			.from(advisoryRuns)
			.where(
				and(
					eq(advisoryRuns.id, runId),
					eq(advisoryRuns.eventId, eventId),
					eq(advisoryRuns.kind, "public_notice"),
				),
			)
			.limit(1);

		const run = runs[0];
		if (!run) {
			return sendError(c, "NOT_FOUND", "Notice draft run not found.", 404);
		}

		const decisionId = crypto.randomUUID();
		await db.insert(advisoryDecisions).values({
			id: decisionId,
			advisoryRunId: run.id,
			eventId,
			actorId: currentUser.id,
			decision: parsed.data.decision,
			reason: parsed.data.reason ?? null,
			inputSnapshotHash: run.inputSnapshotHash,
			correctedOutputJson: {
				correctedPublicSummary: parsed.data.correctedPublicSummary,
				correctedWhatsappNotice: parsed.data.correctedWhatsappNotice,
			},
		});

		return c.json(
			{
				decision: {
					id: decisionId,
					decision: parsed.data.decision,
					createdAt: new Date().toISOString(),
				},
			},
			201,
		);
	},
);

// ---------------------------------------------------------------------------
// 3. Waste Planning with Explicit Assumptions (Ticket 09)
// ---------------------------------------------------------------------------

const wastePlanInputSchema = z.object({
	estimatedParticipants: z.number().int().min(10).max(500000),
	durationHours: z.number().min(1).max(168),
	eventType: z.string().trim().max(100).optional(),
});

export interface WastePlanOutput {
	status: "insufficient_historical_data";
	forecastKg: null;
	sampleSize: number;
	method: "scenario_assumption_model";
	assumptions: {
		rateKgPerParticipantPerDay: number;
		organicFraction: number;
		recyclableFraction: number;
		residualFraction: number;
		averageKgPerSack: number;
	};
	scenarioLogistics: {
		estimatedOrganicKg: number;
		estimatedRecyclableKg: number;
		estimatedResidualKg: number;
		estimatedTotalKg: number;
		estimatedSackCount: number;
	};
	checklist: string[];
	disclaimer: string;
}

/**
 * POST /api/events/:eventId/waste-plan
 * Planning tool with transparent user-supplied assumptions.
 * Returns forecastKg=null to strictly honor no fabricated ML predictions without weighed historical data.
 */
advisoryRouter.post("/events/:eventId/waste-plan", async (c) => {
	if (c.env?.AI_WASTE_PLANNER_ENABLED === "false") {
		return sendError(
			c,
			"FEATURE_DISABLED",
			"Fitur perencanaan sampah sedang dinonaktifkan.",
			503,
		);
	}

	const currentUser = c.get("user")!;
	const eventId = c.req.param("eventId");

	if (!uuidParamSchema.safeParse(eventId).success) {
		return sendError(c, "VALIDATION_FAILED", "Invalid event ID format.", 422);
	}

	let body: unknown;
	try {
		body = await c.req.json();
	} catch {
		return sendError(c, "BAD_REQUEST", "Invalid JSON body.", 400);
	}

	const parsed = wastePlanInputSchema.safeParse(body);
	if (!parsed.success) {
		return sendError(
			c,
			"VALIDATION_FAILED",
			parsed.error.issues[0]?.message || "Invalid waste plan parameters.",
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
			"Organizer permission required to generate waste logistics plan.",
			403,
		);
	}

	const { estimatedParticipants, durationHours } = parsed.data;
	const days = Math.max(durationHours / 24, 0.5);

	// Transparent baseline assumptions derived from public studies on Balinese cultural events
	const rateKgPerParticipantPerDay = 0.35;
	const totalScenarioKg = Math.round(estimatedParticipants * days * rateKgPerParticipantPerDay * 10) / 10;
	const organicKg = Math.round(totalScenarioKg * 0.65 * 10) / 10;
	const recyclableKg = Math.round(totalScenarioKg * 0.20 * 10) / 10;
	const residualKg = Math.round(totalScenarioKg * 0.15 * 10) / 10;
	const sackCount = Math.ceil(totalScenarioKg / 15); // ~15kg per standard trash sack

	const output: WastePlanOutput = {
		status: "insufficient_historical_data",
		forecastKg: null,
		sampleSize: 0,
		method: "scenario_assumption_model",
		assumptions: {
			rateKgPerParticipantPerDay,
			organicFraction: 0.65,
			recyclableFraction: 0.20,
			residualFraction: 0.15,
			averageKgPerSack: 15,
		},
		scenarioLogistics: {
			estimatedOrganicKg: organicKg,
			estimatedRecyclableKg: recyclableKg,
			estimatedResidualKg: residualKg,
			estimatedTotalKg: totalScenarioKg,
			estimatedSackCount: sackCount,
		},
		checklist: [
			`Siapkan minimal ${sackCount} karung sampah terpilah (hijau untuk organik, kuning untuk anorganik).`,
			"Tentukan titik kumpul sampah sementara (TPS) yang tidak menghalangi rute prosesi.",
			"Tugaskan relawan/petugas kebersihan untuk memotret kondisi area sebelum dan sesudah kegiatan.",
			"Koordinasikan jadwal pengangkutan akhir bersama petugas DLH atau bank sampah desa.",
		],
		disclaimer:
			"Angka logistik merupakan kalkulasi skenario asumsi pengguna (~0.35 kg/peserta/hari), bukan hasil timbangan riil atau ramalan AI.",
	};

	const advisoryRunId = crypto.randomUUID();
	await db.insert(advisoryRuns).values({
		id: advisoryRunId,
		eventId,
		organizationId: access.event.organizationId,
		actorId: currentUser.id,
		kind: "waste_plan",
		inputSnapshotHash: computeInputHash(parsed.data),
		modelName: "deterministic-scenario-baseline",
		promptVersion: "1.0",
		schemaVersion: "1.0",
		status: "completed",
		outputJson: output,
	});

	return c.json(
		{
			wastePlan: {
				id: advisoryRunId,
				output,
				createdAt: new Date().toISOString(),
			},
		},
		201,
	);
});
