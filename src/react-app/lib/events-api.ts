import {
	apiFetch,
	type EventLifecycleStatus,
	type EventRecord,
	type PaginatedEventsResponse,
} from "./api-client";
import {
	BALI_DISTRICTS_DATA,
	type BaliDistrictFeatureCollection,
	type DistrictCeremonySummary,
} from "./bali-districts";
import {
	BALI_ISLAND_CENTER,
	type BaliVillageCeremonyProfile,
	type VillageRoadRouteSegment,
} from "./bali-villages";
import type { OperationalRoadStatus } from "./road-status";

export type { EventLifecycleStatus, EventRecord, PaginatedEventsResponse };

export interface ListEventsParams {
	page?: number;
	limit?: number;
	status?: EventLifecycleStatus;
	organizationId?: string;
}

export interface CreateEventPayload {
	organizationId: string;
	title: string;
	startsAt?: string | null;
	endsAt?: string | null;
	category?: string | null;
	description?: string | null;
	venueName?: string | null;
	permitReference?: string | null;
}

export interface UpdateEventPayload {
	title?: string;
	startsAt?: string | null;
	endsAt?: string | null;
	category?: string | null;
	description?: string | null;
	venueName?: string | null;
	permitReference?: string | null;
}

export interface DocumentRecord {
	id: string;
	eventId: string;
	originalName: string;
	mimeType: string;
	sizeBytes: number;
	visibility: string;
	uploadedBy: string;
	aiConsentGranted: boolean;
	createdAt: string;
}

export interface ExtractionCandidateField<T = string> {
	value: T | null;
	evidence: string | null;
	needs_review: boolean;
}

export interface RoadCandidate {
	name: string;
	evidence: string | null;
	needs_review: boolean;
}

export interface GeminiExtractionResult {
	schema_version: string;
	event_name: ExtractionCandidateField<string>;
	event_category: ExtractionCandidateField<string>;
	start_datetime: ExtractionCandidateField<string>;
	end_datetime: ExtractionCandidateField<string>;
	venue_name: ExtractionCandidateField<string>;
	affected_road_names: RoadCandidate[];
	procession_description: ExtractionCandidateField<string>;
	traffic_impact_description: ExtractionCandidateField<string>;
	organizer_name: ExtractionCandidateField<string>;
	cleanup_location_notes?: ExtractionCandidateField<string> | null;
	permit_reference_text?: ExtractionCandidateField<string> | null;
	contact_information?: ExtractionCandidateField<string> | null;
	issues: string[];
}

export interface ExtractionRecord {
	id: string;
	documentId: string;
	modelName: string;
	promptVersion: string;
	schemaVersion: string;
	status: "pending" | "processing" | "completed" | "failed";
	errorCode: string | null;
	errorMessage: string | null;
	latencyMs: number;
	outputJson: GeminiExtractionResult | null;
	extractedJson: GeminiExtractionResult | null;
	issues: string[];
	createdAt: string;
}

export interface ExtractedFieldsPayload {
	title?: string;
	category?: string | null;
	startsAt?: string | null;
	endsAt?: string | null;
	venueName?: string | null;
	description?: string | null;
	permitReference?: string | null;
	processionDescription?: string | null;
	trafficImpactDescription?: string | null;
	organizerName?: string | null;
	cleanupLocationNotes?: string | null;
	contactInformation?: string | null;
}

export type RoadImpactType =
	| "closure"
	| "intermittent"
	| "narrowing"
	| "procession"
	| "full_closure"
	| "partial_closure"
	| "one_way"
	| "speed_reduction";

export function normalizeRoadImpactType(
	type?: string | null,
): "closure" | "intermittent" | "narrowing" | "procession" {
	switch (type) {
		case "closure":
		case "full_closure":
			return "closure";
		case "intermittent":
		case "partial_closure":
			return "intermittent";
		case "narrowing":
		case "one_way":
			return "narrowing";
		case "procession":
		case "speed_reduction":
			return "procession";
		default:
			return "closure";
	}
}

export function normalizeEventCategory(
	category?: string | null,
): string | null {
	if (!category) return null;
	const trimmed = category.trim().toLowerCase();
	switch (trimmed) {
		case "prosesi":
			return "procession";
		case "ngaben":
			return "upacara_adat";
		default:
			return trimmed;
	}
}

export interface RoadSegmentRecord {
	id: string;
	displayName: string;
	coverageArea: string;
	verifiedBy: string;
	verifiedAt: string;
	geometry?: {
		type: string;
		coordinates: unknown;
	} | null;
}

export interface CreateRoadSegmentPayload {
	displayName: string;
	coverageArea: string;
	coordinates: Array<[number, number]>;
	humanVerified: boolean;
}

export async function createSimulationRoadImpact(eventId: string, payload: CreateRoadSegmentPayload & {
	mutationId: string;
	plannedFrom: string | null;
	plannedTo: string | null;
	impactType: RoadImpactType;
	diversionNote: string | null;
}): Promise<{ roadImpact: { id: string }; duplicate: boolean }> {
	return apiFetch(`/api/events/${encodeURIComponent(eventId)}/simulation-road-impacts`, { method: "POST", body: payload });
}

export interface RoadImpactRecord {
	id: string;
	eventId?: string;
	roadSegmentId: string;
	plannedFrom: string | null;
	plannedTo: string | null;
	impactType: RoadImpactType;
	diversionNote: string | null;
	displayName?: string;
	coverageArea?: string;
	segment?: {
		id: string;
		displayName: string;
		coverageArea: string;
	} | null;
	geometry?: {
		type: string;
		coordinates: unknown;
	} | null;
	operationalStatus?: {
		effectiveStatus: "open" | "intermittent" | "closed" | "unconfirmed";
		rawStatus: "open" | "intermittent" | "closed" | "unknown";
		isStale: boolean;
		observedAt: string | null;
		expiresAt: string | null;
	};
}

export interface CreateRoadImpactPayload {
	roadSegmentId: string;
	plannedFrom?: string | null;
	plannedTo?: string | null;
	impactType: RoadImpactType;
	diversionNote?: string | null;
}

export interface EventAssignmentRecord {
	id: string;
	eventId: string;
	userId: string;
	userName: string;
	userEmail: string;
	canUpdateTraffic: boolean;
	canUpdateCleanup: boolean;
	createdAt: string;
	assignedAt?: string;
}

export interface CreateEventInvitationPayload {
	eventId: string;
	canUpdateTraffic: boolean;
	canUpdateCleanup: boolean;
	expiresInDays?: number;
}

export interface CreatedInvitationResponse {
	token: string;
	inviteUrl: string;
	invitePath?: string;
	expiresAt: string;
	permissions: {
		canUpdateTraffic: boolean;
		canUpdateCleanup: boolean;
	};
}

export interface UpdateRoadStatusPayload {
	status: "open" | "intermittent" | "closed";
	observedAt: string;
	mutationId: string;
	note?: string | null;
}

export interface CleanupEvidenceRecord {
	id: string;
	taskId: string;
	stage: "before" | "after";
	uploadedBy: string;
	createdAt: string;
}

export interface CleanupTaskRecord {
	id: string;
	eventId: string;
	title: string;
	description: string | null;
	location: { lng: number; lat: number } | null;
	assignedUserId: string | null;
	status: "todo" | "in_progress" | "submitted" | "verified" | "reopened";
	dueAt: string | null;
	verifiedBy: string | null;
	verifiedAt: string | null;
	createdAt: string;
	updatedAt: string;
	evidenceCount?: number;
	evidence?: CleanupEvidenceRecord[];
}

export interface CreateCleanupTaskPayload {
	title: string;
	description?: string;
	location?: { lng: number; lat: number };
	assignedUserId?: string;
	dueAt?: string;
}

export interface WasteRecordItem {
	id: string;
	eventId: string;
	category: "organic" | "recyclable" | "residual";
	quantityKg: number | null;
	sackCount: number | null;
	measurementMethod: "weighed" | "estimated";
	destination: string | null;
	taskId: string | null;
	recordedBy: string;
	createdAt: string;
}

export interface CreateWastePayload {
	category: "organic" | "recyclable" | "residual";
	quantityKg?: number;
	sackCount?: number;
	measurementMethod: "weighed" | "estimated";
	destination?: string;
	taskId?: string;
}

export interface PublicEventItem {
	id: string;
	title: string;
	slug: string;
	publicSlug?: string;
	category: string | null;
	description: string | null;
	venueName: string | null;
	startsAt: string | null;
	endsAt: string | null;
	status: string;
	publishedAt: string | null;
	organizationName: string;
	village: string;
	district: string;
	isSimulation?: boolean;
	organization?: {
		name: string;
		village: string;
		district: string;
	};
}

const ACTIVE_ORG_STORAGE_KEY = "rangkai:last-organization-id";

export function getSavedOrganizationId(): string {
	const storage = (
		globalThis as unknown as {
			localStorage?: { getItem: (k: string) => string | null };
		}
	).localStorage;
	if (!storage) return "";
	try {
		return storage.getItem(ACTIVE_ORG_STORAGE_KEY) || "";
	} catch {
		return "";
	}
}

export function saveOrganizationId(organizationId: string): void {
	const storage = (
		globalThis as unknown as {
			localStorage?: { setItem: (k: string, v: string) => void };
		}
	).localStorage;
	if (!storage || !organizationId) return;
	try {
		storage.setItem(ACTIVE_ORG_STORAGE_KEY, organizationId.trim());
	} catch {
		// Ignore storage quota errors
	}
}

/**
 * Converts a user-entered WITA date-time string (`YYYY-MM-DDTHH:mm` or `YYYY-MM-DD HH:mm`)
 * into an explicit ISO 8601 timestamp with `+08:00` offset as required by `docs/06-API-CONTRACT.md §1`.
 */
export function toWitaIsoTimestamp(
	rawInput: string | null | undefined,
): string | null {
	if (!rawInput) return null;
	const trimmed = rawInput.trim();
	if (trimmed.length === 0) return null;

	if (
		/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})$/i.test(
			trimmed,
		)
	) {
		return trimmed;
	}

	const normalized = trimmed.replace(" ", "T");

	if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(normalized)) {
		return `${normalized}:00+08:00`;
	}

	if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/.test(normalized)) {
		return `${normalized}+08:00`;
	}

	return trimmed;
}

/**
 * Formats an ISO 8601 timestamp from the server into `YYYY-MM-DDTHH:mm` in `Asia/Makassar` (WITA)
 * so organizer form controls always display local Bali time (`AGENTS.md §15`).
 */
export function fromIsoToWitaInput(
	isoString: string | null | undefined,
): string {
	if (!isoString) return "";
	const date = new Date(isoString);
	if (Number.isNaN(date.getTime())) return "";

	const parts = new Intl.DateTimeFormat("en-CA", {
		timeZone: "Asia/Makassar",
		year: "numeric",
		month: "2-digit",
		day: "2-digit",
		hour: "2-digit",
		minute: "2-digit",
		hourCycle: "h23",
	}).formatToParts(date);

	const getPart = (type: string) =>
		parts.find((p) => p.type === type)?.value ?? "";
	const year = getPart("year");
	const month = getPart("month");
	const day = getPart("day");
	const hour = getPart("hour");
	const minute = getPart("minute");

	if (!year || !month || !day || !hour || !minute) return "";
	return `${year}-${month}-${day}T${hour}:${minute}`;
}

// ---------------------------------------------------------------------------
// 1. Events API
// ---------------------------------------------------------------------------

export async function fetchEventsList(
	params: ListEventsParams = {},
): Promise<PaginatedEventsResponse> {
	const search = new URLSearchParams();
	if (params.page) search.set("page", String(params.page));
	if (params.limit) search.set("limit", String(params.limit));
	if (params.status) search.set("status", params.status);
	if (params.organizationId) {
		search.set("organizationId", params.organizationId);
	}

	const queryString = search.toString();
	const path = queryString ? `/api/events?${queryString}` : "/api/events";
	const response = await apiFetch<PaginatedEventsResponse>(path, {
		method: "GET",
	});

	const firstOrgId = response.events[0]?.organizationId;
	if (firstOrgId) {
		saveOrganizationId(firstOrgId);
	}

	return response;
}

export async function fetchEventDetail(
	eventId: string,
): Promise<{ event: EventRecord }> {
	const response = await apiFetch<{ event: EventRecord }>(
		`/api/events/${encodeURIComponent(eventId)}`,
		{ method: "GET" },
	);
	if (response.event?.organizationId) {
		saveOrganizationId(response.event.organizationId);
	}
	return response;
}

export async function createEventDraft(
	payload: CreateEventPayload,
): Promise<{ event: EventRecord }> {
	const response = await apiFetch<{ event: EventRecord }>("/api/events", {
		method: "POST",
		body: payload,
	});
	if (response.event?.organizationId) {
		saveOrganizationId(response.event.organizationId);
	}
	return response;
}

export async function patchEventDetails(
	eventId: string,
	payload: UpdateEventPayload,
): Promise<{ event: EventRecord }> {
	return apiFetch<{ event: EventRecord }>(
		`/api/events/${encodeURIComponent(eventId)}`,
		{
			method: "PATCH",
			body: payload,
		},
	);
}

export async function transitionEventToReview(
	eventId: string,
): Promise<{ event: EventRecord }> {
	return apiFetch<{ event: EventRecord }>(
		`/api/events/${encodeURIComponent(eventId)}/review`,
		{
			method: "POST",
			body: {},
		},
	);
}

export async function publishVerifiedEvent(
	eventId: string,
	options?: { isSimulation?: boolean },
): Promise<{ event: EventRecord }> {
	return apiFetch<{ event: EventRecord }>(
		`/api/events/${encodeURIComponent(eventId)}/publish`,
		{
			method: "POST",
			body: options?.isSimulation !== undefined ? { isSimulation: options.isSimulation } : {},
		},
	);
}

export async function cancelEvent(
	eventId: string,
	reason: string,
): Promise<{ event: EventRecord }> {
	return apiFetch<{ event: EventRecord }>(
		`/api/events/${encodeURIComponent(eventId)}/cancel`,
		{
			method: "POST",
			body: { reason: reason.trim() },
		},
	);
}

export async function completeEvent(
	eventId: string,
): Promise<{ event: EventRecord }> {
	return apiFetch<{ event: EventRecord }>(
		`/api/events/${encodeURIComponent(eventId)}/complete`,
		{
			method: "POST",
			body: {},
		},
	);
}

export async function fetchEventAssignments(
	eventId: string,
): Promise<{ assignments: EventAssignmentRecord[] }> {
	return apiFetch<{ assignments: EventAssignmentRecord[] }>(
		`/api/events/${encodeURIComponent(eventId)}/assignments`,
		{ method: "GET" },
	);
}

export async function assignEventOfficer(
	eventId: string,
	payload: {
		userId: string;
		canUpdateTraffic: boolean;
		canUpdateCleanup: boolean;
	},
): Promise<{ assignment: EventAssignmentRecord }> {
	return apiFetch<{ assignment: EventAssignmentRecord }>(
		`/api/events/${encodeURIComponent(eventId)}/assignments`,
		{
			method: "POST",
			body: payload,
		},
	);
}

export async function revokeEventAssignment(
	eventId: string,
	assignmentId: string,
): Promise<{ success: boolean; revokedId: string }> {
	return apiFetch<{ success: boolean; revokedId: string }>(
		`/api/events/${encodeURIComponent(eventId)}/assignments/${encodeURIComponent(assignmentId)}`,
		{
			method: "DELETE",
		},
	);
}

export async function createEventInvitation(
	payload: CreateEventInvitationPayload,
): Promise<CreatedInvitationResponse> {
	return apiFetch<CreatedInvitationResponse>("/api/invitations", {
		method: "POST",
		body: payload,
	});
}

// ---------------------------------------------------------------------------
// 2. Documents & AI Extractions API
// ---------------------------------------------------------------------------

export async function uploadEventDocument(
	eventId: string,
	file: File,
	processingConsent = true,
): Promise<{ document: DocumentRecord }> {
	const formData = new FormData();
	formData.append("file", file);
	formData.append("processingConsent", processingConsent ? "true" : "false");

	return apiFetch<{ document: DocumentRecord }>(
		`/api/events/${encodeURIComponent(eventId)}/documents`,
		{
			method: "POST",
			rawBody: formData,
		},
	);
}

export async function fetchEventDocuments(
	eventId: string,
): Promise<{ documents: DocumentRecord[] }> {
	return apiFetch<{ documents: DocumentRecord[] }>(
		`/api/events/${encodeURIComponent(eventId)}/documents`,
		{ method: "GET" },
	);
}

export async function triggerDocumentExtraction(
	eventId: string,
	documentId: string,
	processingConsent = true,
): Promise<{
	extraction: ExtractionRecord;
	manualFallbackAvailable: boolean;
}> {
	return apiFetch<{
		extraction: ExtractionRecord;
		manualFallbackAvailable: boolean;
	}>(`/api/events/${encodeURIComponent(eventId)}/extractions`, {
		method: "POST",
		body: {
			documentId,
			processingConsent,
		},
	});
}

export async function fetchExtractionDetail(
	extractionId: string,
): Promise<{
	extraction: ExtractionRecord;
	manualFallbackAvailable: boolean;
}> {
	return apiFetch<{
		extraction: ExtractionRecord;
		manualFallbackAvailable: boolean;
	}>(`/api/extractions/${encodeURIComponent(extractionId)}`, {
		method: "GET",
	});
}

export async function saveExtractedFields(
	eventId: string,
	corrections: ExtractedFieldsPayload,
): Promise<{ event: EventRecord }> {
	const normalizedCorrections: ExtractedFieldsPayload = {
		...corrections,
		category:
			corrections.category !== undefined
				? normalizeEventCategory(corrections.category)
				: undefined,
	};
	return apiFetch<{ event: EventRecord }>(
		`/api/events/${encodeURIComponent(eventId)}/extracted-fields`,
		{
			method: "PATCH",
			body: normalizedCorrections,
		},
	);
}

// ---------------------------------------------------------------------------
// 3. Road Catalog, Impacts & Pecalang Live Status API
// ---------------------------------------------------------------------------

export async function fetchRoadSegments(
	bbox = "114.4,-8.9,115.8,-8.0",
): Promise<{ segments: RoadSegmentRecord[]; roadSegments: RoadSegmentRecord[] }> {
	const res = await apiFetch<{
		segments?: RoadSegmentRecord[];
		roadSegments?: RoadSegmentRecord[];
	}>(`/api/road-segments?bbox=${encodeURIComponent(bbox)}`, {
		method: "GET",
	});
	const list = res.segments ?? res.roadSegments ?? [];
	return { segments: list, roadSegments: list };
}

export async function createRoadSegment(
	payload: CreateRoadSegmentPayload,
): Promise<{ segment: RoadSegmentRecord }> {
	return apiFetch<{ segment: RoadSegmentRecord }>("/api/road-segments", {
		method: "POST",
		body: payload,
	});
}

export async function fetchEventRoadImpacts(
	eventId: string,
): Promise<{ roadImpacts: RoadImpactRecord[] }> {
	return apiFetch<{ roadImpacts: RoadImpactRecord[] }>(
		`/api/events/${encodeURIComponent(eventId)}/road-impacts`,
		{ method: "GET" },
	);
}

export async function createRoadImpact(
	eventId: string,
	payload: CreateRoadImpactPayload,
): Promise<{ roadImpact: RoadImpactRecord }> {
	return apiFetch<{ roadImpact: RoadImpactRecord }>(
		`/api/events/${encodeURIComponent(eventId)}/road-impacts`,
		{
			method: "POST",
			body: {
				...payload,
				impactType: normalizeRoadImpactType(payload.impactType),
			},
		},
	);
}

export async function deleteRoadImpact(
	eventId: string,
	impactId: string,
): Promise<{ deleted: boolean; id: string }> {
	return apiFetch<{ deleted: boolean; id: string }>(
		`/api/events/${encodeURIComponent(eventId)}/road-impacts/${encodeURIComponent(impactId)}`,
		{
			method: "DELETE",
		},
	);
}

export async function updateRoadStatus(
	impactId: string,
	payload: UpdateRoadStatusPayload,
): Promise<{
	impact: {
		id: string;
		status: "open" | "intermittent" | "closed";
		observedAt: string;
		expiresAt: string;
		updatedBy: string;
	};
}> {
	return apiFetch<{
		impact: {
			id: string;
			status: "open" | "intermittent" | "closed";
			observedAt: string;
			expiresAt: string;
			updatedBy: string;
		};
	}>(`/api/road-impacts/${encodeURIComponent(impactId)}/status`, {
		method: "POST",
		body: payload,
	});
}

// ---------------------------------------------------------------------------
// 4. Cleanup Tasks & Waste Tracking API
// ---------------------------------------------------------------------------

export async function fetchCleanupTasks(
	eventId: string,
): Promise<{ cleanupTasks: CleanupTaskRecord[] }> {
	return apiFetch<{ cleanupTasks: CleanupTaskRecord[] }>(
		`/api/events/${encodeURIComponent(eventId)}/cleanup-tasks`,
		{ method: "GET" },
	);
}

export async function createCleanupTask(
	eventId: string,
	payload: CreateCleanupTaskPayload,
): Promise<{ cleanupTask: CleanupTaskRecord }> {
	return apiFetch<{ cleanupTask: CleanupTaskRecord }>(
		`/api/events/${encodeURIComponent(eventId)}/cleanup-tasks`,
		{
			method: "POST",
			body: payload,
		},
	);
}

export async function uploadCleanupEvidence(
	taskId: string,
	photoFile: File,
	stage: "before" | "after",
): Promise<{ evidence: CleanupEvidenceRecord }> {
	const formData = new FormData();
	formData.append("file", photoFile);
	formData.append("stage", stage);

	return apiFetch<{ evidence: CleanupEvidenceRecord }>(
		`/api/cleanup-tasks/${encodeURIComponent(taskId)}/evidence`,
		{
			method: "POST",
			rawBody: formData,
		},
	);
}

export async function submitCleanupTask(
	taskId: string,
): Promise<{ cleanupTask: CleanupTaskRecord }> {
	return apiFetch<{ cleanupTask: CleanupTaskRecord }>(
		`/api/cleanup-tasks/${encodeURIComponent(taskId)}/submit`,
		{
			method: "POST",
			body: {},
		},
	);
}

export async function startCleanupTask(taskId: string): Promise<{ cleanupTask: CleanupTaskRecord }> {
	return apiFetch(`/api/cleanup-tasks/${encodeURIComponent(taskId)}`, { method: "PATCH", body: { status: "in_progress" } });
}

export async function verifyCleanupTask(
	taskId: string,
	notes?: string,
): Promise<{ cleanupTask: CleanupTaskRecord }> {
	return apiFetch<{ cleanupTask: CleanupTaskRecord }>(
		`/api/cleanup-tasks/${encodeURIComponent(taskId)}/verify`,
		{
			method: "POST",
			body: { notes: notes?.trim() || undefined },
		},
	);
}

export async function reopenCleanupTask(
	taskId: string,
	reason?: string,
): Promise<{ cleanupTask: CleanupTaskRecord }> {
	return apiFetch<{ cleanupTask: CleanupTaskRecord }>(
		`/api/cleanup-tasks/${encodeURIComponent(taskId)}/reopen`,
		{
			method: "POST",
			body: { reason: reason?.trim() || undefined },
		},
	);
}

export async function fetchWasteRecords(
	eventId: string,
): Promise<{ wasteRecords: WasteRecordItem[] }> {
	return apiFetch<{ wasteRecords: WasteRecordItem[] }>(
		`/api/events/${encodeURIComponent(eventId)}/waste-records`,
		{ method: "GET" },
	);
}

export async function createWasteRecord(
	eventId: string,
	payload: CreateWastePayload,
): Promise<{ wasteRecord: WasteRecordItem }> {
	return apiFetch<{ wasteRecord: WasteRecordItem }>(
		`/api/events/${encodeURIComponent(eventId)}/waste-records`,
		{
			method: "POST",
			body: payload,
		},
	);
}

// ---------------------------------------------------------------------------
// 5. Public Portal Endpoints (Anonymous Read-only)
// ---------------------------------------------------------------------------

interface RawPublicEventPayload {
	id: string;
	title: string;
	slug?: string;
	publicSlug?: string;
	category?: string | null;
	description?: string | null;
	venueName?: string | null;
	startsAt?: string | null;
	endsAt?: string | null;
	status?: string;
	publishedAt?: string | null;
	updatedAt?: string;
	processionDescription?: string | null;
	trafficImpactDescription?: string | null;
	organizerName?: string | null;
	organizationName?: string;
	village?: string;
	district?: string;
	isSimulation?: boolean;
	organization?: {
		name?: string;
		village?: string;
		district?: string;
	};
}

function normalizePublicEvent(raw: RawPublicEventPayload): PublicEventItem & {
	processionDescription: string | null;
	trafficImpactDescription: string | null;
	organizerName: string | null;
	updatedAt: string | null;
} {
	const orgName =
		raw.organization?.name || raw.organizationName || "Desa Adat Bali";
	const village =
		raw.organization?.village || raw.village || orgName;
	const district =
		raw.organization?.district || raw.district || "Bali";
	const slug = raw.slug || raw.publicSlug || raw.id;

	return {
		id: raw.id,
		title: raw.title,
		slug,
		publicSlug: raw.publicSlug || slug,
		category: raw.category ?? null,
		description: raw.description ?? null,
		venueName: raw.venueName ?? null,
		startsAt: raw.startsAt ?? null,
		endsAt: raw.endsAt ?? null,
		status: raw.status ?? "published",
		publishedAt: raw.publishedAt ?? null,
		updatedAt: raw.updatedAt ?? null,
		processionDescription: raw.processionDescription ?? null,
		trafficImpactDescription: raw.trafficImpactDescription ?? null,
		organizerName: raw.organizerName ?? null,
		organizationName: orgName,
		village,
		district,
		isSimulation: raw.isSimulation !== false,
		organization: {
			name: orgName,
			village,
			district,
		},
	};
}

export async function fetchPublicEvents(params: {
	status?: "published" | "active";
	from?: string;
	to?: string;
	bbox?: string;
	page?: number;
	limit?: number;
} = {}): Promise<{
	events: PublicEventItem[];
	total: number;
	page: number;
	totalPages: number;
}> {
	const search = new URLSearchParams();
	if (params.status) search.set("status", params.status);
	if (params.from) search.set("from", params.from);
	if (params.to) search.set("to", params.to);
	if (params.bbox) search.set("bbox", params.bbox);
	if (params.page) search.set("page", String(params.page));
	if (params.limit) search.set("limit", String(params.limit));

	const qs = search.toString();
	const path = qs ? `/api/public/events?${qs}` : "/api/public/events";
	const res = await apiFetch<{
		events?: RawPublicEventPayload[];
		total?: number;
		page?: number;
		totalPages?: number;
		pagination?: {
			page: number;
			limit: number;
			total: number;
			totalPages: number;
		};
	}>(path, { method: "GET" });

	const normalized = (res.events ?? []).map(normalizePublicEvent);
	return {
		events: normalized,
		total: res.pagination?.total ?? res.total ?? normalized.length,
		page: res.pagination?.page ?? res.page ?? 1,
		totalPages: res.pagination?.totalPages ?? res.totalPages ?? 1,
	};
}

export async function fetchPublicEventDetail(slug: string): Promise<{
	event: PublicEventItem & {
		processionDescription: string | null;
		trafficImpactDescription: string | null;
		organizerName: string | null;
		updatedAt?: string | null;
	};
}> {
	const res = await apiFetch<{
		event: RawPublicEventPayload;
	}>(`/api/public/events/${encodeURIComponent(slug)}`, { method: "GET" });
	return {
		event: normalizePublicEvent(res.event),
	};
}

export async function fetchPublicEventRoads(slug: string): Promise<{
	eventSlug: string;
	isSimulation: boolean;
	roads: RoadImpactRecord[];
	roadImpacts: RoadImpactRecord[];
}> {
	const res = await apiFetch<{
		eventSlug: string;
		isSimulation?: boolean;
		roads?: RoadImpactRecord[];
		roadImpacts?: RoadImpactRecord[];
	}>(`/api/public/events/${encodeURIComponent(slug)}/roads`, {
		method: "GET",
	});
	const list = res.roads ?? res.roadImpacts ?? [];
	return {
		eventSlug: res.eventSlug || slug,
		isSimulation: res.isSimulation !== false,
		roads: list,
		roadImpacts: list,
	};
}

export interface PublicCleanupSummaryData {
	eventSlug: string;
	isSimulation: boolean;
	summary: {
		totalTasks: number;
		verifiedTasks: number;
		submittedTasks: number;
		inProgressTasks: number;
		todoTasks: number;
		reopenedTasks: number;
	};
	wasteTotals: {
		weighedKg: number;
		estimatedKg: number;
		totalSacks: number;
	};
	byCategory: {
		organic: { weighedKg: number; estimatedKg: number; totalSacks: number };
		recyclable: { weighedKg: number; estimatedKg: number; totalSacks: number };
		residual: { weighedKg: number; estimatedKg: number; totalSacks: number };
	};
	cleanupSummary: {
		totalTasks: number;
		verifiedTasks: number;
		wasteTotals: {
			weighedKg: number;
			estimatedKg: number;
			totalSacks: number;
			organicKg: number;
			recyclableKg: number;
			residualKg: number;
			residualSacks: number;
		};
	};
}

export async function fetchPublicCleanupSummary(
	slug: string,
): Promise<PublicCleanupSummaryData> {
	const res = await apiFetch<{
		eventSlug?: string;
		isSimulation?: boolean;
		summary?: PublicCleanupSummaryData["summary"];
		wasteTotals?: PublicCleanupSummaryData["wasteTotals"];
		byCategory?: PublicCleanupSummaryData["byCategory"];
		cleanupSummary?: {
			totalTasks?: number;
			verifiedTasks?: number;
			submittedTasks?: number;
			inProgressTasks?: number;
			todoTasks?: number;
			reopenedTasks?: number;
			wasteTotals?: {
				weighedKg?: number;
				estimatedKg?: number;
				totalSacks?: number;
				organicKg?: number;
				recyclableKg?: number;
				residualKg?: number;
				residualSacks?: number;
			};
		};
	}>(`/api/public/events/${encodeURIComponent(slug)}/cleanup-summary`, {
		method: "GET",
	});

	const cs = res.cleanupSummary;
	const summary = res.summary ?? {
		totalTasks: cs?.totalTasks ?? 0,
		verifiedTasks: cs?.verifiedTasks ?? 0,
		submittedTasks: cs?.submittedTasks ?? 0,
		inProgressTasks: cs?.inProgressTasks ?? 0,
		todoTasks: cs?.todoTasks ?? 0,
		reopenedTasks: cs?.reopenedTasks ?? 0,
	};

	const wasteTotals = res.wasteTotals ?? {
		weighedKg:
			cs?.wasteTotals?.weighedKg ??
			(cs?.wasteTotals?.organicKg ?? 0) +
				(cs?.wasteTotals?.recyclableKg ?? 0) +
				(cs?.wasteTotals?.residualKg ?? 0),
		estimatedKg: cs?.wasteTotals?.estimatedKg ?? 0,
		totalSacks: cs?.wasteTotals?.totalSacks ?? cs?.wasteTotals?.residualSacks ?? 0,
	};

	const byCategory = res.byCategory ?? {
		organic: {
			weighedKg: cs?.wasteTotals?.organicKg ?? 0,
			estimatedKg: 0,
			totalSacks: 0,
		},
		recyclable: {
			weighedKg: cs?.wasteTotals?.recyclableKg ?? 0,
			estimatedKg: 0,
			totalSacks: 0,
		},
		residual: {
			weighedKg: cs?.wasteTotals?.residualKg ?? 0,
			estimatedKg: 0,
			totalSacks: cs?.wasteTotals?.residualSacks ?? 0,
		},
	};

	return {
		eventSlug: res.eventSlug || slug,
		isSimulation: res.isSimulation !== false,
		summary,
		wasteTotals,
		byCategory,
		cleanupSummary: {
			totalTasks: summary.totalTasks,
			verifiedTasks: summary.verifiedTasks,
			wasteTotals: {
				weighedKg: wasteTotals.weighedKg,
				estimatedKg: wasteTotals.estimatedKg,
				totalSacks: wasteTotals.totalSacks,
				organicKg: byCategory.organic.weighedKg + byCategory.organic.estimatedKg,
				recyclableKg:
					byCategory.recyclable.weighedKg + byCategory.recyclable.estimatedKg,
				residualKg:
					byCategory.residual.weighedKg + byCategory.residual.estimatedKg,
				residualSacks: byCategory.residual.totalSacks,
			},
		},
	};
}

/**
 * Formats an ISO date range into a human-friendly WITA date label and time window.
 */
export function formatWitaEventSchedule(
	startsAt: string | null | undefined,
	endsAt: string | null | undefined,
): { dateLabel: string; windowWita: string } {
	if (!startsAt) {
		return {
			dateLabel: "Jadwal Menyusul",
			windowWita: "Waktu disesuaikan panitia",
		};
	}
	const start = new Date(startsAt);
	if (Number.isNaN(start.getTime())) {
		return {
			dateLabel: startsAt,
			windowWita: "WITA",
		};
	}

	const dateLabel = new Intl.DateTimeFormat("id-ID", {
		weekday: "long",
		day: "numeric",
		month: "long",
		year: "numeric",
		timeZone: "Asia/Makassar",
	}).format(start);

	const startTime = new Intl.DateTimeFormat("id-ID", {
		hour: "2-digit",
		minute: "2-digit",
		hourCycle: "h23",
		timeZone: "Asia/Makassar",
	})
		.format(start)
		.replace(":", ".");

	if (!endsAt) {
		return {
			dateLabel,
			windowWita: `${startTime} WITA – Selesai`,
		};
	}

	const end = new Date(endsAt);
	if (Number.isNaN(end.getTime())) {
		return {
			dateLabel,
			windowWita: `${startTime} WITA – Selesai`,
		};
	}

	const endTime = new Intl.DateTimeFormat("id-ID", {
		hour: "2-digit",
		minute: "2-digit",
		hourCycle: "h23",
		timeZone: "Asia/Makassar",
	})
		.format(end)
		.replace(":", ".");

	return {
		dateLabel,
		windowWita: `${startTime}–${endTime} WITA`,
	};
}

/**
 * Maps a real backend PublicEventItem (and optional verified road impacts from PostGIS)
 * into a BaliVillageCeremonyProfile for MapLibre rendering without any dummy parking or pecalang data.
 */
export function mapPublicEventToCeremonyProfile(
	evt: PublicEventItem & {
		processionDescription?: string | null;
		trafficImpactDescription?: string | null;
		organizerName?: string | null;
	},
	roads: RoadImpactRecord[] = [],
	indexOffset = 0,
): BaliVillageCeremonyProfile {
	const orgName = evt.organization?.name || evt.organizationName || "Desa Adat";
	const villageName = evt.organization?.village || evt.village || orgName;
	const districtName = evt.organization?.district || evt.district || "Bali";

	// Match to a Bali district polygon for territory grouping & fallback center coordinates
	const searchTarget = `${villageName} ${districtName} ${orgName} ${evt.venueName || ""}`.toLowerCase();
	const matchedDistrict =
		BALI_DISTRICTS_DATA.features.find((f) => {
			const dName = f.properties.name.toLowerCase().replace("kecamatan ", "");
			const kName = f.properties.kabupaten.toLowerCase().replace("kabupaten ", "").replace("kota ", "");
			return (
				searchTarget.includes(dName) ||
				searchTarget.includes(kName) ||
				dName.includes(villageName.toLowerCase()) ||
				dName.includes(districtName.toLowerCase())
			);
		})?.properties ?? null;

	// Extract coordinates from PostGIS road geometry if available
	let derivedCenter: [number, number] | null = null;
	const mappedRoads: VillageRoadRouteSegment[] = roads.map((r, rIdx) => {
		let coords: Array<[number, number]> = [];
		const geom = r.geometry;
		if (
			geom &&
			geom.type === "LineString" &&
			Array.isArray(geom.coordinates)
		) {
			coords = (geom.coordinates as Array<[number, number]>).filter(
				(pt) => Array.isArray(pt) && pt.length >= 2,
			);
		} else if (
			geom &&
			geom.type === "MultiLineString" &&
			Array.isArray(geom.coordinates) &&
			Array.isArray(geom.coordinates[0])
		) {
			coords = (geom.coordinates[0] as Array<[number, number]>).filter(
				(pt) => Array.isArray(pt) && pt.length >= 2,
			);
		}

		if (!derivedCenter && coords.length > 0) {
			const mid = coords[Math.floor(coords.length / 2)];
			if (mid) {
				derivedCenter = [mid[0], mid[1]];
			}
		}

		const effStatus = r.operationalStatus?.effectiveStatus;
		const normalizedImpact = normalizeRoadImpactType(r.impactType);
		let roadStatus: OperationalRoadStatus = "unknown";
		if (!r.operationalStatus?.isStale && (effStatus === "closed" || effStatus === "intermittent" || effStatus === "open")) {
			roadStatus = effStatus;
		}

		const schedule = formatWitaEventSchedule(r.plannedFrom, r.plannedTo);

		return {
			id: r.id || `road-${rIdx}`,
			roadName: r.displayName || "Ruas Jalan Terdampak",
			corridorSection: r.coverageArea || villageName,
			roleInCeremony:
				normalizedImpact === "closure" ? "rute_utama" : "akses_penyangga",
			roleLabel:
				normalizedImpact === "closure"
					? "Penutupan Penuh"
					: normalizedImpact === "intermittent"
						? "Buka-Tutup Berkala"
						: normalizedImpact === "narrowing"
							? "Penyempitan / Satu Arah"
							: "Jalur Prosesi",
			status: roadStatus,
			windowWita: schedule.windowWita,
			pecalangPost: orgName,
			lastConfirmedLabel: r.operationalStatus?.observedAt
				? formatWitaEventSchedule(r.operationalStatus.observedAt, null).dateLabel
				: "Belum dikonfirmasi",
			guidanceNote:
				r.diversionNote ||
				evt.trafficImpactDescription ||
				"Ikuti arahan petugas pecalang di simpang jalan.",
			coordinates: coords,
			svgPath: "M 180 260 L 760 260",
			labelPoint: { x: 460, y: 245 },
		};
	});

	if (!derivedCenter) {
		if (matchedDistrict) {
			// Slight deterministic offset if multiple events share a district center
			const offsetLng = (indexOffset % 3) * 0.0035;
			const offsetLat = Math.floor(indexOffset / 3) * 0.0035;
			derivedCenter = [
				matchedDistrict.center[0] + offsetLng,
				matchedDistrict.center[1] + offsetLat,
			];
		} else {
			derivedCenter = BALI_ISLAND_CENTER;
		}
	}

	const schedule = formatWitaEventSchedule(evt.startsAt, evt.endsAt);

	// Derive primary operational status from road segments or event lifecycle status
	let primaryStatus: OperationalRoadStatus = "unknown";
	if (mappedRoads.some((r) => r.status === "closed")) {
		primaryStatus = "closed";
	} else if (mappedRoads.some((r) => r.status === "intermittent")) {
		primaryStatus = "intermittent";
	} else if (mappedRoads.some((r) => r.status === "open")) {
		primaryStatus = "open";
	}

	return {
		id: evt.id,
		isSimulation: evt.isSimulation !== false,
		slug: evt.slug || evt.publicSlug || evt.id,
		desaAdatName: orgName,
		kabupaten: matchedDistrict?.kabupaten || districtName,
		kecamatan: matchedDistrict?.name || villageName,
		ceremonyTitle: evt.title,
		yadnyaCategory: evt.category || "Upacara Adat",
		sacredCenterName: evt.venueName || orgName,
		destinationName: evt.venueName || orgName,
		participatingBanjars: [villageName],
		scheduleDateLabel: schedule.dateLabel,
		scheduleWindowWita: schedule.windowWita,
		coordinatorName: evt.organizerName || orgName,
		primaryStatus,
		overview:
			evt.description ||
			evt.processionDescription ||
			`Pelaksanaan ${evt.title} oleh ${orgName}.`,
		alternativeRouteSummary:
			evt.trafficImpactDescription ||
			mappedRoads[0]?.guidanceNote ||
			"Penyesuaian arus lalu lintas mengikuti arahan petugas di lapangan.",
		mapCenter: derivedCenter,
		mapZoom: 14.2,
		puraPoint: {
			name: evt.venueName || orgName,
			coordinates: derivedCenter,
			description: evt.description || evt.title,
		},
		destinationPoint: {
			name: evt.venueName || orgName,
			coordinates: derivedCenter,
			description: evt.processionDescription || evt.title,
		},
		roadSegments: mappedRoads,
		parkingLots: [],
		pecalangPosts: [],
		communityNotices: [],
		mapGeometry: {
			riverPath: "",
			riverLabel: "",
			riverLabelPos: { x: 480, y: 270 },
			backgroundRoads: [],
			puraPoint: { x: 480, y: 270, label: evt.venueName || orgName },
			destinationPoint: { x: 480, y: 270, label: evt.venueName || orgName },
			banjarPoints: [],
			coordinatesLabel: `${Math.abs(derivedCenter[1]).toFixed(4)}° S, ${derivedCenter[0].toFixed(4)}° E`,
		},
	};
}

/**
 * Computes district polygon features whose ceremony counts and ceremony lists
 * reflect ONLY the provided live backend events (never dummy fallback ceremonies).
 */
export function buildDistrictFeaturesFromEvents(
	profiles: BaliVillageCeremonyProfile[],
): BaliDistrictFeatureCollection {
	return {
		type: "FeatureCollection",
		features: BALI_DISTRICTS_DATA.features.map((feat) => {
			const distName = feat.properties.name.toLowerCase().replace("kecamatan ", "");
			const kabName = feat.properties.kabupaten
				.toLowerCase()
				.replace("kabupaten ", "")
				.replace("kota ", "");

			const matched = profiles.filter((p) => {
				const kec = p.kecamatan.toLowerCase();
				const kab = p.kabupaten.toLowerCase();
				const desa = p.desaAdatName.toLowerCase();
				return (
					kec.includes(distName) ||
					distName.includes(kec.replace("kecamatan ", "")) ||
					desa.includes(distName) ||
					(kab.includes(kabName) &&
						!BALI_DISTRICTS_DATA.features.some(
							(other) =>
								other.id !== feat.id &&
								kec.includes(
									other.properties.name.toLowerCase().replace("kecamatan ", ""),
								),
						))
				);
			});

			const ceremonies: DistrictCeremonySummary[] = matched.map((m) => ({
				id: m.id,
				title: m.ceremonyTitle,
				desaAdatName: m.desaAdatName,
				slug: m.slug,
				status: m.primaryStatus,
				dateLabel: m.scheduleDateLabel,
				windowWita: m.scheduleWindowWita,
				sacredCenterName: m.sacredCenterName,
				coordinates: m.mapCenter,
				roadName: m.roadSegments[0]?.roadName,
				detourRoute: m.roadSegments[0]?.guidanceNote || m.alternativeRouteSummary,
			}));

			return {
				...feat,
				properties: {
					...feat.properties,
					hasCeremony: ceremonies.length > 0,
					ceremonyCount: ceremonies.length,
					ceremonies,
				},
			};
		}),
	};
}

// ---------------------------------------------------------------------------
// 7. Field Officer Operational APIs (Ticket 04)
// ---------------------------------------------------------------------------

export interface FieldTaskItem {
	assignmentId: string | null;
	eventId: string;
	eventTitle: string;
	eventStatus: string;
	venueName: string | null;
	startsAt: string | null;
	endsAt: string | null;
	isSimulation: boolean;
	organizationId: string;
	organizationName: string;
	canUpdateTraffic: boolean;
	canUpdateCleanup: boolean;
	isOrganizerOversight: boolean;
}

export interface FieldEventDetailResponse {
	event: EventRecord & { isSimulation: boolean };
	permissions: {
		canUpdateTraffic: boolean;
		canUpdateCleanup: boolean;
		isOrganizer: boolean;
	};
	roadImpacts: Array<{
		id: string;
		displayName: string;
		plannedFrom: string | null;
		plannedTo: string | null;
		coverageArea: string | null;
		status: "open" | "intermittent" | "closed" | "unknown";
		expiresAt: string | null;
		isStale: boolean;
	}>;
	cleanupTasks: CleanupTaskRecord[];
}

export async function fetchFieldTasks(): Promise<{ assignments: FieldTaskItem[] }> {
	return apiFetch<{ assignments: FieldTaskItem[] }>("/api/field/tasks", {
		method: "GET",
	});
}

export async function fetchFieldEventDetail(
	eventId: string,
): Promise<FieldEventDetailResponse> {
	return apiFetch<FieldEventDetailResponse>(
		`/api/field/events/${encodeURIComponent(eventId)}`,
		{ method: "GET" },
	);
}
