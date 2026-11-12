import "./workflow.css";
import { useUnsavedChanges } from "../lib/use-unsaved-changes";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
	AlertTriangle,
	ArrowLeft,
	ArrowRight,
	CheckCircle2,
	ClipboardCheck,
	FileText,
	MapPinned,
	PenTool,
	Plus,
	Radio,
	Save,
	Send,
	Trash2,
	Upload,
	Users,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams } from "react-router";
import { z } from "zod";
import {
	EmptyStateCard,
	ErrorStateBanner,
	EventLifecycleBadge,
	FieldReviewIndicator,
	type FieldReviewState,
	LoadingStateBlock,
	RoadStatusBadge,
} from "../components/rangkai";
import { DashboardRoadMapInput } from "../features/map/DashboardRoadMapInput";
import { VenueLocationInput } from "../features/map/VenueLocationInput";
import { ApiClientError } from "../lib/api-client";
import {
	useMyOrganizationsQuery,
} from "../lib/auth";
import { SYSTEM_STATE_MESSAGES } from "../lib/constants/labels";
import {
	type DocumentRecord,
	type ExtractionRecord,
	cancelEvent,
	completeEvent,
	createEventDraft,
	createRoadImpact,
	createSimulationRoadImpact,
	deleteRoadImpact,
	fetchEventDetail,
	fetchEventRoadImpacts,
	fetchRoadCandidates,
	fetchRoadSegments,
	fromIsoToWitaInput,
	getSavedOrganizationId,
	normalizeEventCategory,
	publishVerifiedEvent,
	saveExtractedFields,
	saveOrganizationId,
	submitRoadImpactForReview,
	toWitaIsoTimestamp,
	transitionEventToReview,
	triggerDocumentExtraction,
	uploadEventDocument,
	CATEGORY_OPTIONS,
	IMPACT_TYPE_OPTIONS,
	getImpactTypeLabel,
} from "../lib/events-api";
import { formatWitaDateTime, formatWitaRange } from "../lib/wita";

const DRAFT_STORAGE_KEY = "rangkai:event-wizard-draft-v1";
const UUID_REGEX =
	/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function getFieldReviewStatus(
	candidate?: {
		value: string | null;
		evidence: string | null;
		needs_review: boolean;
	} | null,
	currentVal?: string,
): { state: FieldReviewState; evidence?: string | null } {
	if (!candidate) {
		return { state: currentVal ? "confirmed" : "missing" };
	}
	if (!candidate.value) {
		return {
			state: currentVal ? "corrected" : "missing",
			evidence: candidate.evidence,
		};
	}
	if (currentVal && currentVal !== candidate.value) {
		return { state: "corrected", evidence: candidate.evidence };
	}
	if (candidate.needs_review) {
		return { state: "needs_review", evidence: candidate.evidence };
	}
	return { state: "extracted", evidence: candidate.evidence };
}

const WIZARD_STEPS = [
	{
		id: 0,
		label: "1. Surat Edaran & AI",
		description: "Unggah dokumen & ekstraksi Gemini",
	},
	{
		id: 1,
		label: "2. Detail & Jadwal WITA",
		description: "Periksa & lengkapi informasi",
	},
	{
		id: 2,
		label: "3. Input Peta & Ruas Jalan",
		description: "Gambar atau pilih jalan terdampak",
	},
	{
		id: 3,
		label: "4. Verifikasi & Terbitkan",
		description: "Periksa ringkasan & umumkan kegiatan",
	},
];

const wizardFormSchema = z
	.object({
		organizationId: z
			.string()
			.trim()
			.regex(UUID_REGEX, "Pilih Desa Adat penyelenggara."),
		title: z
			.string()
			.trim()
			.min(3, "Nama upacara minimal 3 karakter.")
			.max(255, "Maksimal 255 karakter."),
		category: z.string().trim().max(100).optional(),
		venueName: z.string().trim().max(255).optional(),
		venueLongitude: z.string(),
		venueLatitude: z.string(),
		startsAtWita: z.string().trim().optional(),
		endsAtWita: z.string().trim().optional(),
		permitReference: z.string().trim().max(100).optional(),
		description: z.string().trim().max(2000).optional(),
		processionDescription: z.string().trim().max(2000).optional(),
		trafficImpactDescription: z.string().trim().max(2000).optional(),
		organizerName: z.string().trim().max(200).optional(),
		cleanupLocationNotes: z.string().trim().max(2000).optional(),
		contactInformation: z.string().trim().max(500).optional(),
	})
	.refine((val) => {
		if (!val.venueLongitude.trim() && !val.venueLatitude.trim()) return true;
		if (!val.venueLongitude.trim() || !val.venueLatitude.trim()) return false;
		const lng = Number(val.venueLongitude), lat = Number(val.venueLatitude);
		return Number.isFinite(lng) && Number.isFinite(lat) && lng >= 114.3 && lng <= 115.9 && lat >= -8.95 && lat <= -7.95;
	}, { message: "Isi kedua koordinat dalam wilayah Bali, atau kosongkan keduanya.", path: ["venueLongitude"] })
	.refine(
		(val) => {
			const startIso = toWitaIsoTimestamp(val.startsAtWita);
			const endIso = toWitaIsoTimestamp(val.endsAtWita);
			if (startIso && endIso) {
				const startMs = Date.parse(startIso);
				const endMs = Date.parse(endIso);
				if (!Number.isNaN(startMs) && !Number.isNaN(endMs)) {
					return endMs > startMs;
				}
			}
			return true;
		},
		{
			message: "Waktu selesai harus setelah waktu mulai (WITA).",
			path: ["endsAtWita"],
		},
	);

interface DraftFormState {
	organizationId: string;
	title: string;
	category: string;
	venueName: string;
	venueLongitude: string;
	venueLatitude: string;
	startsAtWita: string;
	endsAtWita: string;
	permitReference: string;
	description: string;
	processionDescription: string;
	trafficImpactDescription: string;
	organizerName: string;
	cleanupLocationNotes: string;
	contactInformation: string;
}

function loadSessionDraft(): DraftFormState {
	const fallbackOrg =
		getSavedOrganizationId() || "";
	const defaults: DraftFormState = {
		organizationId: fallbackOrg,
		title: "",
		category: "upacara_adat",
		venueName: "",
		venueLongitude: "",
		venueLatitude: "",
		startsAtWita: "",
		endsAtWita: "",
		permitReference: "",
		description: "",
		processionDescription: "",
		trafficImpactDescription: "",
		organizerName: "",
		cleanupLocationNotes: "",
		contactInformation: "",
	};
	if (typeof window === "undefined") return defaults;
	try {
		const raw = window.sessionStorage.getItem(DRAFT_STORAGE_KEY);
		if (!raw) return defaults;
		const parsed = JSON.parse(raw) as Partial<DraftFormState>;
		return {
			...defaults,
			...parsed,
			category:
				normalizeEventCategory(parsed.category) ||
				parsed.category ||
				"upacara_adat",
			organizationId: parsed.organizationId || fallbackOrg,
		};
	} catch {
		return defaults;
	}
}

export function EventWizardPage() {
	const { id: savedEventId } = useParams<{ id: string }>();
	const [createdEventId, setCreatedEventId] = useState<string | null>(() => savedEventId ? null : sessionStorage.getItem("rangkai:event-wizard-id"));
	const routeEventId = savedEventId ?? createdEventId;
	const queryClient = useQueryClient();

	const isCreateMode = !savedEventId;
	const isRealUuidEvent = Boolean(
		routeEventId && UUID_REGEX.test(routeEventId),
	);

	const myOrgsQuery = useMyOrganizationsQuery();
	const myOrganizations = useMemo(
		() => myOrgsQuery.data?.organizations ?? [],
		[myOrgsQuery.data?.organizations],
	);

	const orgOptions = useMemo(() => {
		if (myOrganizations.length > 0) {
			return myOrganizations.map((org) => ({
				value: org.id,
				label: `${org.name}${org.village ? ` (${org.village})` : ""}`,
			}));
		}
		return [];
	}, [myOrganizations]);

	const [activeStep, setActiveStep] = useState(isCreateMode ? 0 : 3);
	const [activeDocument, setActiveDocument] = useState<DocumentRecord | null>(
		null,
	);
	const [activeExtraction, setActiveExtraction] =
		useState<ExtractionRecord | null>(null);

	const [formState, setFormState] = useState<DraftFormState>(() =>
		loadSessionDraft(),
	);
	const effectiveOrgId = useMemo(() => {
		if (!isCreateMode || myOrganizations.length === 0) return formState.organizationId;
		if (myOrganizations.some((o) => o.id === formState.organizationId)) return formState.organizationId;
		return (myOrganizations.find((o) => o.role === "organizer") || myOrganizations[0]).id;
	}, [isCreateMode, myOrganizations, formState.organizationId]);
	const [hydratedEventId, setHydratedEventId] = useState<string | null>(null);
	const [fieldErrors, setFieldErrors] = useState<
		Partial<Record<keyof DraftFormState, string>>
	>({});
	const [bannerFeedback, setBannerFeedback] = useState<{
		status: "success" | "warning" | "error" | "info";
		title: string;
		description: string;
	} | null>(null);
	const [isPublishDialogOpen, setIsPublishDialogOpen] = useState(false);
	const publishDialogRef = useRef<HTMLDialogElement>(null);
	useEffect(() => {
		const dialog = publishDialogRef.current;
		if (!dialog) return;
		if (isPublishDialogOpen && !dialog.open) dialog.showModal();
		if (!isPublishDialogOpen && dialog.open) dialog.close();
	}, [isPublishDialogOpen]);
	const [publishSimulation, setPublishSimulation] = useState(() => savedEventId ? true : sessionStorage.getItem("rangkai:event-wizard-mode") !== "operational");
	const [dirty, setDirty] = useState(false);
	const dirtyRevision = useRef(0);
	const savingRevision = useRef(0);
	function markDirty() { dirtyRevision.current += 1; setDirty(true); }
	const [aiConsentGranted, setAiConsentGranted] = useState(false);

	// Inline quick-create Desa Adat state

	// Step 2: Road Map Input State ("draw" vs "catalog")
	const [roadInputMode, setRoadInputMode] = useState<"draw" | "catalog">(
		"draw",
	);
	const [draftCoordinates, setDraftCoordinates] = useState<[number, number][]>(
		[],
	);
	const [newSegmentName, setNewSegmentName] = useState("");
	const [newSegmentArea, setNewSegmentArea] = useState("Bali");
	const [humanVerifiedRoad, setHumanVerifiedRoad] = useState(false);
	const roadAttempt = useRef<{ fingerprint: string; id: string } | null>(null);

	const [selectedRoadSegmentId, setSelectedRoadSegmentId] =
		useState<string>("");
	const [selectedImpactType, setSelectedImpactType] = useState<
		"closure" | "intermittent" | "narrowing" | "procession"
	>("closure");
	const [impactFromWita, setImpactFromWita] = useState<string>("");
	const [impactToWita, setImpactToWita] = useState<string>("");
	const [impactDiversionNote, setImpactDiversionNote] = useState<string>("");

	// Step 3: Cancel reason
	const [cancelReason, setCancelReason] = useState(
		"Jadwal upacara disesuaikan kembali oleh Prajuru Desa Adat.",
	);

	// 1. Fetch Event Detail if already created
	const eventDetailQuery = useQuery({
		queryKey: ["events", "detail", routeEventId],
		queryFn: () => fetchEventDetail(routeEventId!),
		enabled: isRealUuidEvent,
		retry: false,
	});

	// 2. Fetch Verified Road Segments for Step 2
	const roadSegmentsQuery = useQuery({
		queryKey: ["road-segments", "catalog"],
		queryFn: () => fetchRoadSegments(),
		enabled: activeStep === 2,
		staleTime: 60_000,
	});

	// 2b. Fetch Road Segment Candidates matched from AI extraction
	const roadCandidatesQuery = useQuery({
		queryKey: ["road-candidates", routeEventId],
		queryFn: () => fetchRoadCandidates(routeEventId!),
		enabled: Boolean(activeStep === 2 && routeEventId && isRealUuidEvent),
		staleTime: 30_000,
	});

	const roadCandidates = roadCandidatesQuery.data?.candidates ?? [];

	// 3. Fetch Real Road Impacts attached to this event
	const eventRoadImpactsQuery = useQuery({
		queryKey: ["events", routeEventId, "road-impacts"],
		queryFn: () => fetchEventRoadImpacts(routeEventId!),
		enabled: Boolean(routeEventId && isRealUuidEvent),
		retry: false,
	});

	const activeOrg = useMemo(() => {
		const orgs = myOrgsQuery.data?.organizations ?? [];
		return orgs.find((o) => o.id === formState.organizationId);
	}, [myOrgsQuery.data, formState.organizationId]);

	const hasOperationalAuthority = Boolean(activeOrg?.hasOperationalAuthority);

	const loadedEvent = eventDetailQuery.data?.event;

	if (!isCreateMode && loadedEvent && hydratedEventId !== loadedEvent.id) {
		setHydratedEventId(loadedEvent.id);
		setPublishSimulation(loadedEvent.isSimulation !== false);
		const record = loadedEvent as unknown as Record<string, unknown>;
		const startWita = fromIsoToWitaInput(loadedEvent.startsAt);
		const endWita = fromIsoToWitaInput(loadedEvent.endsAt);
		setFormState({
			organizationId: loadedEvent.organizationId,
			title: loadedEvent.title,
			category:
				normalizeEventCategory(loadedEvent.category) ||
				loadedEvent.category ||
				"upacara_adat",
			venueName: loadedEvent.venueName || "",
			venueLongitude: String((record.venueLocation as { coordinates?: number[] } | null)?.coordinates?.[0] ?? ""),
			venueLatitude: String((record.venueLocation as { coordinates?: number[] } | null)?.coordinates?.[1] ?? ""),
			startsAtWita: startWita || "",
			endsAtWita: endWita || "",
			permitReference: loadedEvent.permitReference || "",
			description: loadedEvent.description || "",
			processionDescription: (record.processionDescription as string) || "",
			trafficImpactDescription:
				(record.trafficImpactDescription as string) || "",
			organizerName: (record.organizerName as string) || "",
			cleanupLocationNotes: (record.cleanupLocationNotes as string) || "",
			contactInformation: (record.contactInformation as string) || "",
		});
		if (!impactFromWita && startWita) setImpactFromWita(startWita);
		if (!impactToWita && endWita) setImpactToWita(endWita);
	}

	useEffect(() => {
		if (!isCreateMode || typeof window === "undefined") return;
		try {
			window.sessionStorage.setItem(
				DRAFT_STORAGE_KEY,
				JSON.stringify(formState),
			);
		} catch {
			// Ignore storage quota
		}
	}, [isCreateMode, formState]);

	useEffect(() => {
		if (!isCreateMode) return;
		if (createdEventId) sessionStorage.setItem("rangkai:event-wizard-id", createdEventId);
		sessionStorage.setItem("rangkai:event-wizard-mode", publishSimulation ? "simulation" : "operational");
	}, [isCreateMode, createdEventId, publishSimulation]);

	useUnsavedChanges(dirty, isCreateMode ? () => {
		sessionStorage.removeItem(DRAFT_STORAGE_KEY);
		sessionStorage.removeItem("rangkai:event-wizard-id");
		sessionStorage.removeItem("rangkai:event-wizard-mode");
	} : undefined);

	function updateField<K extends keyof DraftFormState>(
		key: K,
		value: DraftFormState[K],
	) {
		markDirty();
		setFormState((prev) => ({ ...prev, [key]: value }));
		if (fieldErrors[key]) {
			setFieldErrors((prev) => ({ ...prev, [key]: undefined }));
		}
	}

	// Ensure a real event exists in DB before attaching documents or road impacts
	async function ensureRealEventId(): Promise<string> {
		if (routeEventId && isRealUuidEvent) {
			return routeEventId;
		}
		const orgId = effectiveOrgId;
		if (!publishSimulation && !hasOperationalAuthority) throw new Error("Organisasi belum memiliki kewenangan publikasi operasional.");
		if (!orgId) throw new Error("Pilih Desa Adat terlebih dahulu.");
		const draftRes = await createEventDraft({
			organizationId: orgId,
			isSimulation: publishSimulation,
			title:
				formState.title.trim().length >= 3
					? formState.title.trim()
					: "Draf Pengumuman Upacara Adat",
			category: normalizeEventCategory(formState.category) || "upacara_adat",
			venueName: formState.venueName.trim() || null,
			venueLocation: formState.venueLongitude && formState.venueLatitude ? { type: "Point", coordinates: [Number(formState.venueLongitude), Number(formState.venueLatitude)] } : null,
			startsAt: toWitaIsoTimestamp(formState.startsAtWita) || null,
			endsAt: toWitaIsoTimestamp(formState.endsAtWita) || null,
			permitReference: formState.permitReference.trim() || null,
			description: formState.description.trim() || null,
		});
		setCreatedEventId(draftRes.event.id);
		await queryClient.invalidateQueries({ queryKey: ["events"] });
		return draftRes.event.id;
	}

	// ---------------------------------------------------------------------------
	// Upload Document & Trigger Gemini AI Extraction Pipeline
	// ---------------------------------------------------------------------------
	const uploadAndExtractMutation = useMutation({
		mutationFn: async (file: File) => {
			setBannerFeedback(null);
			const targetEventId = await ensureRealEventId();

			const uploadRes = await uploadEventDocument(targetEventId, file, true);
			setActiveDocument(uploadRes.document);

			const extractRes = await triggerDocumentExtraction(
				targetEventId,
				uploadRes.document.id,
				true,
			);
			setActiveExtraction(extractRes.extraction);

			return {
				eventId: targetEventId,
				document: uploadRes.document,
				extraction: extractRes.extraction,
			};
		},
		onSuccess: (result) => {
			const ext = result.extraction;
			markDirty();
			const out = ext.outputJson;

			if (out) {
				setFormState((prev) => {
					const nextState: DraftFormState = { ...prev };
					if (out.event_name?.value) nextState.title = out.event_name.value;
					if (out.event_category?.value) {
						nextState.category =
							normalizeEventCategory(out.event_category.value) ||
							"upacara_adat";
					}
					if (out.venue_name?.value) nextState.venueName = out.venue_name.value;
					if (out.start_datetime?.value)
						nextState.startsAtWita = fromIsoToWitaInput(
							out.start_datetime.value,
						);
					if (out.end_datetime?.value)
						nextState.endsAtWita = fromIsoToWitaInput(out.end_datetime.value);
					if (out.permit_reference_text?.value)
						nextState.permitReference = out.permit_reference_text.value;
					if (out.procession_description?.value)
						nextState.processionDescription = out.procession_description.value;
					if (out.traffic_impact_description?.value)
						nextState.trafficImpactDescription =
							out.traffic_impact_description.value;
					if (out.organizer_name?.value)
						nextState.organizerName = out.organizer_name.value;
					if (out.cleanup_location_notes?.value)
						nextState.cleanupLocationNotes = out.cleanup_location_notes.value;
					if (out.contact_information?.value)
						nextState.contactInformation = out.contact_information.value;

					if (!nextState.description && out.procession_description?.value) {
						nextState.description = out.procession_description.value;
					}
					return nextState;
				});
			}

			const issuesCount = ext.issues?.length ?? 0;
			setBannerFeedback({
				status: issuesCount > 0 ? "warning" : "success",
				title: "Analisis Surat Edaran Selesai",
				description:
					issuesCount > 0
						? `AI Gemini mendeteksi ${issuesCount} catatan keraguan yang wajib diperiksa Prajuru pada Langkah 2.`
						: "Informasi surat edaran berhasil diekstraksi ke draf kegiatan. Silakan periksa di Langkah 2.",
			});
		},
		onError: (err) => {
			setBannerFeedback({
				status: "warning",
				title: "Ekstraksi AI Tidak Berhasil — Gunakan Input Manual",
				description:
					err instanceof Error
						? `${err.message}. Anda tetap dapat melanjutkan pengisian draf kegiatan secara manual pada Langkah 2.`
						: "Dokumen tidak dapat dianalisis otomatis. Silakan isi draf secara manual.",
			});
		},
	});

	// ---------------------------------------------------------------------------
	// Save / Patch Draft Event Details
	// ---------------------------------------------------------------------------
	const saveDraftMutation = useMutation({
		onMutate: () => { savingRevision.current = dirtyRevision.current; },
		mutationFn: async () => {
			setFieldErrors({});
			setBannerFeedback(null);

			if (!publishSimulation && !hasOperationalAuthority) throw new Error("Organisasi belum memiliki kewenangan publikasi operasional.");
			const parsed = wizardFormSchema.safeParse({ ...formState, organizationId: effectiveOrgId });
			if (!parsed.success) {
				const nextErrors: Partial<Record<keyof DraftFormState, string>> = {};
				for (const issue of parsed.error.issues) {
					const fieldKey = issue.path[0] as keyof DraftFormState | undefined;
					if (fieldKey && !nextErrors[fieldKey]) {
						nextErrors[fieldKey] = issue.message;
					}
				}
				setFieldErrors(nextErrors);
				throw new Error(
					parsed.error.issues[0]?.message || "Periksa kembali isian formulir.",
				);
			}

			const startsAtIso = toWitaIsoTimestamp(parsed.data.startsAtWita);
			const endsAtIso = toWitaIsoTimestamp(parsed.data.endsAtWita);
			const canonicalCategory =
				normalizeEventCategory(parsed.data.category) || "upacara_adat";
			const venueLocation = parsed.data.venueLongitude && parsed.data.venueLatitude
				? { type: "Point" as const, coordinates: [Number(parsed.data.venueLongitude), Number(parsed.data.venueLatitude)] as [number, number] }
				: null;

			if (!isRealUuidEvent) {
				const created = await createEventDraft({
					organizationId: parsed.data.organizationId,
					isSimulation: publishSimulation,
					title: parsed.data.title,
					category: canonicalCategory,
					venueName: parsed.data.venueName || null,
					venueLocation,
					startsAt: startsAtIso || null,
					endsAt: endsAtIso || null,
					permitReference: parsed.data.permitReference || null,
					description: parsed.data.description || null,
				});
				setCreatedEventId(created.event.id);
				return saveExtractedFields(created.event.id, {
					processionDescription: parsed.data.processionDescription || null,
					trafficImpactDescription: parsed.data.trafficImpactDescription || null,
					organizerName: parsed.data.organizerName || null,
					cleanupLocationNotes: parsed.data.cleanupLocationNotes || null,
					contactInformation: parsed.data.contactInformation || null,
				});
			}

			const result = await saveExtractedFields(routeEventId!, {
				title: parsed.data.title,
				category: canonicalCategory,
				venueName: parsed.data.venueName || null,
				venueLocation,
				startsAt: startsAtIso || null,
				endsAt: endsAtIso || null,
				permitReference: parsed.data.permitReference || null,
				description: parsed.data.description || null,
				processionDescription: parsed.data.processionDescription || null,
				trafficImpactDescription: parsed.data.trafficImpactDescription || null,
				organizerName: parsed.data.organizerName || null,
				cleanupLocationNotes: parsed.data.cleanupLocationNotes || null,
				contactInformation: parsed.data.contactInformation || null,
			});
			return result;
		},
		onSuccess: async () => {
			await queryClient.invalidateQueries({ queryKey: ["events"] });
			if (savingRevision.current === dirtyRevision.current) setDirty(false);
			setBannerFeedback({ status: "success", title: "Draf disimpan", description: savingRevision.current === dirtyRevision.current ? "Rincian kegiatan berhasil disimpan." : "Rincian tersimpan, tetapi perubahan terbaru belum disimpan." });
		},
		onError: (err) => {
			setBannerFeedback({
				status: err instanceof ApiClientError ? "error" : "warning",
				title: "Belum Dapat Menyimpan",
				description:
					err instanceof Error ? err.message : "Periksa kembali isian formulir.",
			});
		},
	});

	// ---------------------------------------------------------------------------
	// Draw New Road Segment + Attach Road Impact Mutation
	// ---------------------------------------------------------------------------
	const drawAndAttachRoadMutation = useMutation({
		mutationFn: async () => {
			if (draftCoordinates.length < 2) {
				throw new Error(
					"Klik minimal 2 titik pada peta untuk membentuk garis ruas jalan.",
				);
			}
			if (newSegmentName.trim().length < 3) {
				throw new Error(
					"Masukkan nama ruas jalan terdampak (minimal 3 karakter).",
				);
			}
			if (!humanVerifiedRoad) {
				throw new Error(
					"Centang pernyataan verifikasi lokasi ruas jalan oleh Prajuru.",
				);
			}

			const targetEventId = await ensureRealEventId();
			const startsIso = toWitaIsoTimestamp(
				impactFromWita || formState.startsAtWita,
			);
			const endsIso = toWitaIsoTimestamp(impactToWita || formState.endsAtWita);
			if (!startsIso || !endsIso || Date.parse(endsIso) <= Date.parse(startsIso)) {
				throw new Error("Isi waktu mulai dan selesai penutupan (WITA) dengan waktu selesai setelah waktu mulai.");
			}

			const payload = {
				displayName: newSegmentName.trim(),
				coverageArea:
					newSegmentArea.trim() ||
					formState.venueName.trim() ||
					"Kawasan Desa Adat",
				coordinates: draftCoordinates,
				humanVerified: true,
				impactType: selectedImpactType,
				plannedFrom: startsIso,
				plannedTo: endsIso,
				diversionNote:
					impactDiversionNote.trim() ||
					formState.trafficImpactDescription.trim() ||
					null,
			};
			const fingerprint = JSON.stringify([targetEventId, payload]);
			if (roadAttempt.current?.fingerprint !== fingerprint) roadAttempt.current = { fingerprint, id: crypto.randomUUID() };
			await createSimulationRoadImpact(targetEventId, { ...payload, mutationId: roadAttempt.current.id });
			return { eventId: targetEventId, segmentName: payload.displayName };
		},
		onSuccess: async (res) => {
			roadAttempt.current = null;
			setDraftCoordinates([]);
			setNewSegmentName("");
			setImpactDiversionNote("");
			await queryClient.invalidateQueries({
				queryKey: ["road-segments", "catalog"],
			});
			await queryClient.invalidateQueries({
				queryKey: ["events", res.eventId, "road-impacts"],
			});
			setBannerFeedback({
				status: "success",
				title: "Ruas Jalan Baru Berhasil Digambar & Ditautkan",
				description: `Ruas "${res.segmentName}" tersimpan sebagai garis latihan untuk kegiatan ini.`,
			});
		},
		onError: (err) => {
			setBannerFeedback({
				status: "error",
				title: "Gagal Menyimpan Ruas Jalan dari Peta",
				description:
					err instanceof Error ? err.message : "Periksa kembali input peta.",
			});
		},
	});

	// ---------------------------------------------------------------------------
	// Attach Existing Catalog Road Segment Mutation
	// ---------------------------------------------------------------------------
	const addCatalogRoadImpactMutation = useMutation({
		mutationFn: async (roadSegmentId: string) => {
			const targetEventId = await ensureRealEventId();
			const startsIso = toWitaIsoTimestamp(
				impactFromWita || formState.startsAtWita,
			);
			const endsIso = toWitaIsoTimestamp(impactToWita || formState.endsAtWita);
			if (!startsIso || !endsIso || Date.parse(endsIso) <= Date.parse(startsIso)) {
				throw new Error("Isi waktu mulai dan selesai penutupan (WITA) dengan waktu selesai setelah waktu mulai.");
			}

			await createRoadImpact(targetEventId, {
				roadSegmentId,
				plannedFrom: startsIso,
				plannedTo: endsIso,
				impactType: selectedImpactType,
				diversionNote:
					impactDiversionNote.trim() ||
					formState.trafficImpactDescription.trim() ||
					null,
			});
			return targetEventId;
		},
		onSuccess: async (targetEventId) => {
			setSelectedRoadSegmentId("");
			setImpactDiversionNote("");
			await queryClient.invalidateQueries({
				queryKey: ["events", targetEventId, "road-impacts"],
			});
			setBannerFeedback({
				status: "success",
				title: "Ruas Jalan Katalog Ditambahkan",
				description:
					"Ruas jalan terverifikasi berhasil ditautkan ke rencana penutupan.",
			});
		},
		onError: (err) => {
			setBannerFeedback({
				status: "error",
				title: "Gagal Menambahkan Ruas Jalan",
				description:
					err instanceof Error ? err.message : "Terjadi kendala jaringan.",
			});
		},
	});

	// ---------------------------------------------------------------------------
	// Delete Road Impact Mutation
	// ---------------------------------------------------------------------------
	const removeRoadImpactMutation = useMutation({
		mutationFn: async (impactId: string) => {
			if (!routeEventId || !isRealUuidEvent) {
				throw new Error("Kegiatan belum tersimpan.");
			}
			return deleteRoadImpact(routeEventId, impactId);
		},
		onSuccess: async () => {
			await queryClient.invalidateQueries({
				queryKey: ["events", routeEventId, "road-impacts"],
			});
			setBannerFeedback({
				status: "info",
				title: "Ruas Jalan Dihapus",
				description: "Ruas jalan terdampak telah dilepas dari kegiatan ini.",
			});
		},
		onError: (err) => {
			setBannerFeedback({
				status: "error",
				title: "Gagal Menghapus Ruas Jalan",
				description:
					err instanceof Error ? err.message : "Terjadi kendala jaringan.",
			});
		},
	});

	const submitRoadReviewMutation = useMutation({
		mutationFn: async (impactId: string) => {
			if (!routeEventId || !isRealUuidEvent) throw new Error("Kegiatan belum tersimpan.");
			return submitRoadImpactForReview(routeEventId, impactId);
		},
		onSuccess: async () => {
			await queryClient.invalidateQueries({ queryKey: ["events", routeEventId, "road-impacts"] });
			setBannerFeedback({ status: "success", title: "Pengajuan Tinjauan Terkirim", description: "Ruas jalan telah masuk ke antrean tinjauan Polisi / Reviewer Pemerintah." });
		},
		onError: (err) => {
			setBannerFeedback({ status: "error", title: "Gagal Mengajukan Tinjauan", description: err instanceof Error ? err.message : "Terjadi kendala jaringan." });
		},
	});

	// ---------------------------------------------------------------------------
	// Review, Publish, Complete & Cancel Transitions
	// ---------------------------------------------------------------------------
	const reviewMutation = useMutation({
		mutationFn: async () => {
			if (!routeEventId || !isRealUuidEvent) {
				throw new Error("Simpan draf terlebih dahulu.");
			}
			return transitionEventToReview(routeEventId);
		},
		onSuccess: async (result) => {
			await queryClient.invalidateQueries({ queryKey: ["events"] });
			await queryClient.invalidateQueries({
				queryKey: ["events", "detail", routeEventId],
			});
			setBannerFeedback({
				status: "success",
				title: "Data Dikonfirmasi Prajuru",
				description: `Diverifikasi pada ${formatWitaDateTime(result.event.verifiedAt)}. Kegiatan siap diterbitkan ke publik.`,
			});
		},
		onError: (err) => {
			setBannerFeedback({
				status: "error",
				title: "Konfirmasi Gagal",
				description:
					err instanceof Error
						? err.message
						: "Terjadi kendala saat konfirmasi.",
			});
		},
	});

	const publishMutation = useMutation({
		mutationFn: async () => {
			if (!routeEventId || !isRealUuidEvent) {
				throw new Error("Simpan draf terlebih dahulu.");
			}
			if (!publishSimulation && !hasOperationalAuthority) throw new Error("Organisasi belum memiliki kewenangan publikasi operasional.");
			return publishVerifiedEvent(routeEventId, {
				isSimulation: publishSimulation,
			});
		},
		onSuccess: async (result) => {
			setIsPublishDialogOpen(false);
			setDirty(false);
			sessionStorage.removeItem(DRAFT_STORAGE_KEY);
			sessionStorage.removeItem("rangkai:event-wizard-id");
			sessionStorage.removeItem("rangkai:event-wizard-mode");
			await queryClient.invalidateQueries({ queryKey: ["events"] });
			await queryClient.invalidateQueries({
				queryKey: ["events", "detail", routeEventId],
			});
			setBannerFeedback({
				status: "success",

				title: result.event.isSimulation !== false ? "Simulasi Diumumkan" : "Diumumkan",
				description: result.event.isSimulation === false
					? `Diterbitkan pada ${formatWitaDateTime(result.event.publishedAt)}. Publik dapat melihat status penutupan di portal desa.`
					: `Diterbitkan dalam mode simulasi pada ${formatWitaDateTime(result.event.publishedAt)}. Publik dapat melihat tanda simulasi di portal desa.`,

			});
		},
		onError: (err) => {
			setIsPublishDialogOpen(false);
			setBannerFeedback({
				status: "error",
				title: "Gagal Mengumumkan",
				description:
					err instanceof Error
						? err.message
						: "Pastikan data telah dikonfirmasi oleh Prajuru Adat sebelum diterbitkan.",
			});
		},
	});

	const completeMutation = useMutation({
		mutationFn: async () => {
			if (!routeEventId || !isRealUuidEvent) {
				throw new Error("Kegiatan belum tersimpan.");
			}
			return completeEvent(routeEventId);
		},
		onSuccess: async () => {
			await queryClient.invalidateQueries({ queryKey: ["events"] });
			await queryClient.invalidateQueries({
				queryKey: ["events", "detail", routeEventId],
			});
			setBannerFeedback({
				status: "success",
				title: "Upacara Ditandai Selesai",
				description:
					"Status kegiatan beralih ke Selesai (Completed). Dokumentasi kebersihan pasca-acara tetap dapat dilanjutkan.",
			});
		},
		onError: (err) => {
			setBannerFeedback({
				status: "error",
				title: "Gagal Menyelesaikan Acara",
				description:
					err instanceof Error ? err.message : "Terjadi kendala jaringan.",
			});
		},
	});

	const cancelMutation = useMutation({
		mutationFn: async () => {
			if (!routeEventId || !isRealUuidEvent) {
				throw new Error("Kegiatan belum tersimpan.");
			}
			return cancelEvent(
				routeEventId,
				cancelReason.trim().length >= 5
					? cancelReason.trim()
					: "Dibatalkan oleh Panitia Desa Adat.",
			);
		},
		onSuccess: async () => {
			await queryClient.invalidateQueries({ queryKey: ["events"] });
			await queryClient.invalidateQueries({
				queryKey: ["events", "detail", routeEventId],
			});
			setBannerFeedback({
				status: "warning",
				title: "Pengumuman Dibatalkan",
				description: "Status kegiatan diubah menjadi dibatalkan.",
			});
		},
		onError: (err) => {
			setBannerFeedback({
				status: "error",
				title: "Gagal Membatalkan",
				description:
					err instanceof Error ? err.message : "Terjadi kendala jaringan.",
			});
		},
	});

	const currentLifecycleStatus = loadedEvent?.status ?? "draft";
	const previewStartsIso = toWitaIsoTimestamp(formState.startsAtWita);
	const previewEndsIso = toWitaIsoTimestamp(formState.endsAtWita);
	const attachedRoadImpacts = eventRoadImpactsQuery.data?.roadImpacts ?? [];
	const catalogSegments = roadSegmentsQuery.data?.segments ?? [];
	const catalogError =
		roadSegmentsQuery.error instanceof ApiClientError
			? roadSegmentsQuery.error
			: null;
	const catalogRequestId = catalogError?.requestId ?? "";
	const canSaveDraft =
		UUID_REGEX.test(formState.organizationId) && formState.title.trim().length >= 3;

	return (
		<div className="workflow-page" onChangeCapture={() => setDirty(true)}>
			{/* Header Workspace */}
			<div className="teduh-workspace-header">
				<div>
					<div className="flex flex-wrap items-center gap-3">
						<h1 className="teduh-workspace-title">
							{isCreateMode
								? "Buat Pengumuman Upacara"
								: formState.title || "Kelola Pengumuman Upacara"}
						</h1>
						<EventLifecycleBadge status={currentLifecycleStatus} />
						{publishSimulation ? <span className="text-base font-semibold">Simulasi</span> : null}
					</div>
					<p className="teduh-workspace-subtitle">
						{isCreateMode ? "Lengkapi informasi, periksa jalan terdampak, lalu konfirmasi sebelum diterbitkan." : "Periksa ringkasan dan status kegiatan."}
					</p>
				</div>

				{!isCreateMode ? <div className="flex flex-wrap items-center gap-2">
					<Link
						to="/dashboard"
						className="ui-button"
					>
						<ArrowLeft className="w-3.5 h-3.5" />
						<span>Daftar Upacara</span>
					</Link>

				</div> : null}
			</div>

			{isCreateMode ? <p className="mb-6 text-sm font-semibold">Langkah {activeStep + 1} dari 4: {WIZARD_STEPS[activeStep].label.replace(/^\d\. /, "")}</p> : null}

			{/* Feedback Banner */}
			{bannerFeedback ? (
				<div role={bannerFeedback.status === "error" ? "alert" : "status"} className={`mb-6 rounded p-4 ${bannerFeedback.status === "error" ? "bg-red-50 text-red-900" : bannerFeedback.status === "warning" ? "bg-amber-50 text-amber-950" : bannerFeedback.status === "success" ? "bg-green-50 text-green-900" : "bg-blue-50 text-blue-900"}`}>
					<strong>{bannerFeedback.title}</strong>
					<p>{bannerFeedback.description}</p>
				</div>
			) : null}

			{isRealUuidEvent && eventDetailQuery.isLoading ? (
				<div className="workflow-panel">
					<LoadingStateBlock label="Memuat data upacara..." rows={3} />
				</div>
			) : isRealUuidEvent && eventDetailQuery.isError ? (
				<div className="workflow-panel">
					<ErrorStateBanner
						title="Gagal Memuat Data Upacara"
						error={eventDetailQuery.error}
						onRetry={() => void eventDetailQuery.refetch()}
					/>
				</div>
			) : (
				<>
					{/* ================================================================= */}
					{/* STEP 0: SURAT EDARAN & GEMINI AI EXTRACTION                       */}
					{/* ================================================================= */}
					{activeStep === 0 ? (
						<div className="grid grid-cols-1 xl:grid-cols-12 gap-6 items-start">
							<div className="xl:col-span-7 workflow-panel space-y-5">
								<div className="border-b border-[#F0EFEA] pb-3 flex flex-wrap items-start justify-between gap-3">
									<div>
										<h2 className="teduh-workspace-card-title">
											1. Pilih Desa Adat &amp; Unggah Surat Edaran
										</h2>
										<p className="text-base text-[#585854] mt-1">
											Unggah foto atau PDF surat edaran resmi desa adat. Google
											Gemini akan mengekstrak informasi ke draf terstruktur untuk
											diperiksa Prajuru.
										</p>
									</div>
									<label className="teduh-publish-mode-field">
										<span className="teduh-publish-mode-label">Mode publikasi</span>
										<select
											className="teduh-form-select"
											disabled={Boolean(createdEventId)}
											value={publishSimulation ? "simulation" : "operational"}
											onChange={(e) => { setPublishSimulation(e.target.value !== "operational"); markDirty(); }}
										>
											<option value="simulation">Simulasi</option>
											{hasOperationalAuthority ? <option value="operational">Operasional</option> : null}
										</select>
									</label>
								</div>

								{/* Desa Adat Selector */}
								<div className="space-y-2">
									<label
										htmlFor="wizard-org-select"
										className="block text-base font-semibold text-[#181817]"
									>
										Desa Adat Penyelenggara *
									</label>
									<select
										id="wizard-org-select"
										disabled={Boolean(createdEventId)}
										value={effectiveOrgId}
										onChange={(e) => {
											updateField("organizationId", e.target.value);
											saveOrganizationId(e.target.value);
										}}
										className="w-full rounded border border-[#E5E3DC] bg-white px-3.5 py-2.5 text-base font-medium text-[#181817] focus:border-[#4D702F]"
									>
										<option value="">Pilih Desa Adat</option>
										{orgOptions.map((opt) => (
											<option key={opt.value} value={opt.value}>
												{opt.label}
											</option>
										))}
									</select>

									{myOrganizations.length === 0 && <p>Belum ada organisasi terhubung. <Link to="/onboarding/organization">Ajukan organisasi untuk ditinjau</Link>.</p>}
								</div>

								{/* AI Consent Checkbox */}
								<label className="flex items-start gap-2.5 rounded border border-[#E5E3DC] bg-white p-3.5 cursor-pointer">
									<input
										type="checkbox"
										checked={aiConsentGranted}
										onChange={(e) => setAiConsentGranted(e.target.checked)}
										className="mt-0.5 rounded border-[#C5C3BC] text-[#4D702F] focus:ring-[#4D702F]"
									/>
									<div className="text-base">
										<span className="font-bold text-[#181817] block">
											Persetujuan pembacaan dokumen dengan AI
										</span>
										<span className="text-[#585854]">
											Dokumen disimpan secara privat dan dibaca untuk membuat draf tanpa
											dipublikasikan otomatis.
										</span>
									</div>
								</label>

								{/* File Upload Dropzone */}
								<div className="rounded border-2 border-dashed border-[#C6D5B8] bg-white p-6 text-center space-y-3">
									<Upload className="w-8 h-8 text-[#4D702F] mx-auto" />
									<div className="space-y-1">
										<p className="text-sm font-bold text-[#181817]">
											Unggah Berkas Surat Edaran (PDF, JPG, PNG • Maks. 8 MB)
										</p>
										<p className="text-base text-[#585854]">
											Pilih berkas dari perangkat Anda untuk langsung diekstrak
											oleh AI Gemini, atau lewati ke Langkah 2 untuk mengisi
											manual.
										</p>
									</div>
									<div>
										<label className="ui-button ui-button-primary">
											<Upload className="w-3.5 h-3.5" />
											<span>
												{uploadAndExtractMutation.isPending
													? "Mengunggah & Mengekstrak..."
													: "Pilih File Surat Edaran"}
											</span>
											<input
												type="file"
												accept=".pdf,image/jpeg,image/png"
												disabled={uploadAndExtractMutation.isPending}
												onChange={(e) => {
													const file = e.target.files?.[0];
													if (!file) return;
													if (file.size > 8 * 1024 * 1024) {
														setBannerFeedback({
															status: "error",
															title: "Ukuran Berkas Melebihi Batas",
															description:
																"Ukuran berkas melebihi batas maksimal 8 MB. Harap unggah dokumen atau foto dengan resolusi yang lebih kecil.",
														});
														return;
													}
													if (!aiConsentGranted) {
														setBannerFeedback({
															status: "warning",
															title:
																"Persetujuan Pemrosesan AI Belum Dicentang",
															description:
																"Centang persetujuan AI Gemini terlebih dahulu atau lanjut ke Langkah 2 untuk pengisian manual.",
														});
														return;
													}
													void uploadAndExtractMutation.mutateAsync(file);
												}}
												className="sr-only"
											/>
										</label>
									</div>
									{activeDocument ? (
										<p className="text-base font-semibold text-[#4D702F]">
											Berkas terunggah: {activeDocument.originalName} (
											{Math.round(activeDocument.sizeBytes / 1024)} KB)
										</p>
									) : null}
								</div>

								{uploadAndExtractMutation.isPending ? (
									<LoadingStateBlock
										label={
											SYSTEM_STATE_MESSAGES.loadingAiExtraction.description
										}
										rows={2}
									/>
								) : null}

							</div>

							{/* Right Column: AI Extraction Summary */}
							<div className="xl:col-span-5 workflow-panel space-y-4">
								<div className="flex items-center justify-between gap-2 border-b border-[#F0EFEA] pb-3">
									<div className="flex items-center gap-2">

										<h3 className="teduh-workspace-card-title">
											Hasil Ekstraksi AI Gemini
										</h3>
									</div>
									{activeExtraction ? (
										<span className="px-2.5 py-0.5 rounded border border-[#C5D5BC] bg-white text-[#4D702F] text-[11px] font-bold">
											{activeExtraction.modelName} ({activeExtraction.latencyMs}{" "}
											ms)
										</span>
									) : null}
								</div>

								{activeExtraction ? (
									<div className="space-y-4 text-base">
										{activeExtraction.issues.length > 0 ? (
											<div className="rounded border border-[#F3D9A4] bg-[#FDF7EB] p-3.5 space-y-1.5">
												<div className="flex items-center gap-1.5 font-bold text-[#9A5B13]">
													<AlertTriangle className="w-4 h-4 shrink-0" />
													<span>
														Catatan Keraguan AI ({activeExtraction.issues.length}
														)
													</span>
												</div>
												<ul className="list-disc pl-4 space-y-1 text-[#585854]">
													{activeExtraction.issues.map((issue, idx) => (
														<li key={idx}>{issue}</li>
													))}
												</ul>
											</div>
										) : null}

										<div className="space-y-2">
											<div className="rounded border border-[#E5E3DC] bg-white p-3">
												<span className="text-base text-[#585854] block">
													Nama Upacara Terdeteksi
												</span>
												<p className="font-bold text-[#181817]">
													{formState.title || "-"}
												</p>
											</div>
											<div className="rounded border border-[#E5E3DC] bg-white p-3">
												<span className="text-base text-[#585854] block">
													Lokasi / Rute Prosesi
												</span>
												<p className="font-bold text-[#181817]">
													{formState.venueName || "-"}
												</p>
											</div>
											<div className="rounded border border-[#E5E3DC] bg-white p-3">
												<span className="text-base text-[#585854] block">
													Jadwal Pelaksanaan (WITA)
												</span>
												<p className="font-bold text-[#181817]">
													{formState.startsAtWita} s/d {formState.endsAtWita}
												</p>
											</div>
										</div>

										<button
											type="button"
											onClick={() => setActiveStep(1)}
											className="ui-button"
										>
											<span>Periksa &amp; Koreksi Rincian</span>
											<ArrowRight className="w-3.5 h-3.5" />
										</button>
									</div>
								) : (
									<div className="py-8 text-center space-y-2 text-base text-[#585854]">
										<FileText className="w-8 h-8 text-[#8A8984] mx-auto" />
										<p className="font-semibold text-[#181817]">
											Belum Ada Dokumen yang Dianalisis
										</p>
										<p className="max-w-xs mx-auto">
											Unggah surat edaran di sebelah kiri untuk mengekstrak nama
											upacara, waktu pelaksanaan, nomor surat, dan dampak lalu
											lintas secara otomatis.
										</p>
									</div>
								)}
							</div>
						</div>
					) : null}
					{isCreateMode && activeStep === 0 ? (
						<div className="wizard-navigation-footer">
							<Link to="/dashboard" className="ui-button">
								<ArrowLeft className="w-3.5 h-3.5" />
								<span>Kembali ke dashboard</span>
							</Link>
							<div className="wizard-navigation-actions">
								<button
									type="button"
									disabled={!canSaveDraft || saveDraftMutation.isPending}
									onClick={() => void saveDraftMutation.mutateAsync()}
									className="ui-button"
								>
									<Save className="w-3.5 h-3.5" />
									<span>{saveDraftMutation.isPending ? "Menyimpan..." : "Simpan draf"}</span>
								</button>
								<button
									type="button"
									onClick={() => setActiveStep(1)}
									className="ui-button ui-button-primary"
								>
									<span>Lanjut ke detail kegiatan</span>
									<ArrowRight className="w-3.5 h-3.5" />
								</button>
							</div>
							{!canSaveDraft ? (
								<p className="wizard-save-hint">Pilih Desa Adat dan isi nama kegiatan pada langkah berikutnya sebelum menyimpan draf.</p>
							) : null}
						</div>
					) : null}

					{/* ================================================================= */}
					{/* STEP 1: DETAIL UPACARA & JADWAL WITA                              */}
					{/* ================================================================= */}
					{activeStep === 1 ? (
						<div className="workflow-panel space-y-5">
							<div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#F0EFEA] pb-3">
								<div>
									<h2 className="teduh-workspace-card-title">
										2. Detail Upacara &amp; Jadwal Operasional WITA
									</h2>
									<p className="text-base text-[#585854] mt-0.5">
										Periksa dan lengkapi seluruh kolom berikut. Setiap perubahan
										dicatat sebagai hasil tinjauan resmi Panitia Desa Adat.
									</p>
								</div>
								{activeExtraction ? (
									<span className="px-3 py-1 rounded border border-[#C5D5BC] bg-white text-[#4D702F] text-base font-semibold">
										Terisi dari Ekstraksi Surat Edaran
									</span>
								) : null}
							</div>

							<div className="grid grid-cols-1 md:grid-cols-2 gap-4">
								{/* Nama Upacara */}
								<div className="md:col-span-2 space-y-1.5">
									<label className="block text-base font-semibold text-[#181817]">
										Nama Upacara / Kegiatan Adat *
									</label>
									<input
										type="text"
										value={formState.title}
										onChange={(e) => updateField("title", e.target.value)}
										placeholder="Contoh: Karya Pujawali & Prosesi Melasti Pura Dalem Ubud"
										className="w-full rounded border border-[#E5E3DC] bg-white px-3.5 py-2.5 text-base text-[#181817] focus:border-[#4D702F]"
									/>
									{fieldErrors.title ? (
										<p className="text-base text-[#B91C1C] font-medium">
											{fieldErrors.title}
										</p>
									) : null}
									{activeExtraction?.outputJson ? (
										<div className="flex flex-wrap items-center justify-between gap-2 pt-1">
											<FieldReviewIndicator
												state={
													getFieldReviewStatus(
														activeExtraction.outputJson.event_name,
														formState.title,
													).state
												}
											/>
											{activeExtraction.outputJson.event_name?.evidence ? (
												<span className="text-base text-[#585854] italic">
													Bukti surat: &quot;
													{activeExtraction.outputJson.event_name.evidence}
													&quot;
												</span>
											) : null}
										</div>
									) : null}
								</div>

								{/* Kategori Upacara */}
								<div className="space-y-1.5">
									<label className="block text-base font-semibold text-[#181817]">
										Kategori Upacara *
									</label>
									<select
										value={formState.category}
										onChange={(e) => updateField("category", e.target.value)}
										className="w-full rounded border border-[#E5E3DC] bg-white px-3.5 py-2.5 text-base text-[#181817] focus:border-[#4D702F]"
									>
										{CATEGORY_OPTIONS.map((opt) => (
											<option key={opt.value} value={opt.value}>
												{opt.label}
											</option>
										))}
									</select>
								</div>

								{/* Nomor Surat */}
								<div className="space-y-1.5">
									<label className="block text-base font-semibold text-[#181817]">
										Nomor Surat Edaran / Referensi Desa Adat
									</label>
									<input
										type="text"
										value={formState.permitReference}
										onChange={(e) =>
											updateField("permitReference", e.target.value)
										}
										placeholder="Contoh: 14/DA-UBD/XI/2026"
										className="w-full rounded border border-[#E5E3DC] bg-white px-3.5 py-2.5 text-base text-[#181817] focus:border-[#4D702F]"
									/>
								</div>

								{/* Lokasi Utama / Titik Pura */}
								<div className="md:col-span-2 space-y-1.5">
									<label className="block text-base font-semibold text-[#181817]">
										Titik Pura / Banjar &amp; Kawasan Utama
									</label>
									<input
										type="text"
										value={formState.venueName}
										onChange={(e) => updateField("venueName", e.target.value)}
										placeholder="Contoh: Pura Desa Adat Ubud menuju Catus Pata Ubud"
										className="w-full rounded border border-[#E5E3DC] bg-white px-3.5 py-2.5 text-base text-[#181817] focus:border-[#4D702F]"
									/>
									{activeExtraction?.outputJson ? (
										<div className="flex flex-wrap items-center justify-between gap-2 pt-1">
											<FieldReviewIndicator
												state={
													getFieldReviewStatus(
														activeExtraction.outputJson.venue_name,
														formState.venueName,
													).state
												}
											/>
											{activeExtraction.outputJson.venue_name?.evidence ? (
												<span className="text-base text-[#585854] italic">
													Bukti surat: &quot;
													{activeExtraction.outputJson.venue_name.evidence}
													&quot;
												</span>
											) : null}
										</div>
									) : null}
								</div>

								{/* Waktu Mulai WITA */}
								<VenueLocationInput longitude={formState.venueLongitude} latitude={formState.venueLatitude} onChange={(lng, lat) => setFormState((prev) => ({ ...prev, venueLongitude: lng, venueLatitude: lat }))} />
								{fieldErrors.venueLongitude ? <p role="alert">{fieldErrors.venueLongitude}</p> : null}
								<div className="space-y-1.5">
									<label className="block text-base font-semibold text-[#181817]">
										Waktu Mulai (WITA • UTC+8) <span className="text-red-600" aria-hidden="true">*</span>
									</label>
									<input
										type="datetime-local"
										value={formState.startsAtWita}
										onChange={(e) =>
											updateField("startsAtWita", e.target.value)
										}
										className="w-full rounded border border-[#E5E3DC] bg-white px-3.5 py-2.5 text-base text-[#181817] focus:border-[#4D702F]"
									/>
								</div>

								{/* Waktu Selesai WITA */}
								<div className="space-y-1.5">
									<label className="block text-base font-semibold text-[#181817]">
										Waktu Selesai (WITA • UTC+8) <span className="text-red-600" aria-hidden="true">*</span>
									</label>
									<input
										type="datetime-local"
										value={formState.endsAtWita}
										onChange={(e) => updateField("endsAtWita", e.target.value)}
										className="w-full rounded border border-[#E5E3DC] bg-white px-3.5 py-2.5 text-base text-[#181817] focus:border-[#4D702F]"
									/>
									{fieldErrors.endsAtWita ? (
										<p className="text-base text-[#B91C1C] font-medium">
											{fieldErrors.endsAtWita}
										</p>
									) : null}
								</div>

								{/* Deskripsi Prosesi */}
								<div className="md:col-span-2 space-y-1.5">
									<label className="block text-base font-semibold text-[#181817]">
										Rincian Prosesi &amp; Rangkaian Upacara
									</label>
									<textarea
										rows={3}
										value={formState.processionDescription}
										onChange={(e) => {
											updateField("processionDescription", e.target.value);
											if (!formState.description) {
												updateField("description", e.target.value);
											}
										}}
										placeholder="Urutan iring-iringan, sarana upakara yang diusung, dan titik pemberhentian..."
										className="w-full rounded border border-[#E5E3DC] bg-white p-3 text-base text-[#181817] focus:border-[#4D702F]"
									/>
								</div>

								{/* Dampak Lalu Lintas & Pengalihan */}
								<div className="md:col-span-2 space-y-1.5">
									<label className="block text-base font-semibold text-[#181817]">
										Rekayasa Lalu Lintas &amp; Jalur Alternatif Warga
									</label>
									<textarea
										rows={3}
										value={formState.trafficImpactDescription}
										onChange={(e) =>
											updateField("trafficImpactDescription", e.target.value)
										}
										placeholder="Rute pengalihan arus kendaraan, kantong parkir krama, dan imbauan bagi pengguna jalan..."
										className="w-full rounded border border-[#E5E3DC] bg-white p-3 text-base text-[#181817] focus:border-[#4D702F]"
									/>
								</div>

								{/* Panitia & Narahubung */}
								<div className="space-y-1.5">
									<label className="block text-base font-semibold text-[#181817]">
										Nama Panitia / Prajuru Penyelenggara
									</label>
									<input
										type="text"
										value={formState.organizerName}
										onChange={(e) =>
											updateField("organizerName", e.target.value)
										}
										placeholder="Contoh: Prawartaka Karya Desa Adat Ubud"
										className="w-full rounded border border-[#E5E3DC] bg-white px-3.5 py-2.5 text-base text-[#181817] focus:border-[#4D702F]"
									/>
								</div>

								<div className="space-y-1.5">
									<label className="block text-base font-semibold text-[#181817]">
										Kontak Koordinasi / Pecalang
									</label>
									<input
										type="text"
										value={formState.contactInformation}
										onChange={(e) =>
											updateField("contactInformation", e.target.value)
										}
										placeholder="Contoh: 0812-3456-7890 (Jro Pecalang)"
										className="w-full rounded border border-[#E5E3DC] bg-white px-3.5 py-2.5 text-base text-[#181817] focus:border-[#4D702F]"
									/>
								</div>
							</div>

							<div className="wizard-navigation-footer">
								<button
									type="button"
									onClick={() => setActiveStep(0)}
									className="ui-button"
								>
									<ArrowLeft className="w-3.5 h-3.5" />
									<span>Kembali ke Surat Edaran</span>
								</button>

								<div className="wizard-navigation-actions">
									<button
										type="button"
										disabled={saveDraftMutation.isPending}
										onClick={() => void saveDraftMutation.mutateAsync()}
										className="ui-button"
									>
										<Save className="w-3.5 h-3.5" />
										<span>{saveDraftMutation.isPending ? "Menyimpan..." : "Simpan draf"}</span>
									</button>
									<button
										type="button"
										onClick={() => setActiveStep(2)}
										className="ui-button ui-button-primary"
									>
										<span>Lanjut ke Peta &amp; Ruas Jalan</span>
										<ArrowRight className="w-3.5 h-3.5" />
									</button>
								</div>
							</div>
						</div>
					) : null}

					{/* ================================================================= */}
					{/* STEP 2: INPUT PETA & RUAS JALAN TERDAMPAK                         */}
					{/* ================================================================= */}
					{activeStep === 2 ? (
						<div className="space-y-6">
							<div className="workflow-panel space-y-5">
								<div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#F0EFEA] pb-3">
									<div>
										<h2 className="teduh-workspace-card-title">
											3. Input Peta &amp; Ruas Jalan Terdampak
										</h2>
										<p className="text-base text-[#585854] mt-0.5">
											Tentukan lokasi penutupan jalan secara akurat: klik titik
											koordinat langsung di peta untuk menggambar ruas jalan
											baru, atau pilih dari katalog jalan terverifikasi.
										</p>
									</div>

									{/* Mode Switcher: Gambar di Peta vs Pilih Katalog */}
									<div className="inline-flex rounded border border-[#E5E3DC] bg-[#F3F1EC] p-1">
										<button
											type="button"
											onClick={() => setRoadInputMode("draw")}
											className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded text-base font-semibold transition-colors ${
												roadInputMode === "draw"
													? "bg-[#4D702F] text-white"
													: "text-[#585854] hover:text-[#181817]"
											}`}
										>
											<PenTool className="w-3.5 h-3.5" />
											<span>Gambar Ruas di Peta</span>
										</button>
										<button
											type="button"
											onClick={() => setRoadInputMode("catalog")}
											className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded text-base font-semibold transition-colors ${
												roadInputMode === "catalog"
													? "bg-[#4D702F] text-white"
													: "text-[#585854] hover:text-[#181817]"
											}`}
										>
											<MapPinned className="w-3.5 h-3.5" />
											<span>
												Pilih dari Katalog
												{roadSegmentsQuery.isLoading
													? " (Memuat...)"
													: roadSegmentsQuery.isError
														? " (Gagal memuat)"
														: ` (${catalogSegments.length})`}
											</span>
										</button>
									</div>
								</div>

								{/* Road Candidate Suggestions from Document Extraction */}
								{roadCandidates.length > 0 ? (
									<div className="rounded border border-stone-200 bg-white p-3 text-base space-y-2">
										<div className="flex items-center justify-between">
											<span className="font-semibold text-stone-900">
												Kandidat Ruas Jalan dari Dokumen ({roadCandidates.length} saran)
											</span>
											<span className="text-base text-stone-500">
												Pilihan memerlukan konfirmasi panitia
											</span>
										</div>
										<div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
											{roadCandidates.map((cand) => (
												<div
													key={cand.candidateId}
													className="p-2.5 rounded border border-stone-200 bg-white flex flex-col justify-between gap-2"
												>
													<div>
														<p className="font-bold text-stone-900">{cand.displayName}</p>
														<p className="text-base text-stone-500">
															Kawasan: {cand.coverageArea} • Skor: {Math.round(cand.matchScore * 100)}%
														</p>
														<p className="text-base text-stone-600 italic mt-0.5">{cand.explanation}</p>
													</div>
													<button
														type="button"
														onClick={() => {
															setRoadInputMode("catalog");
															setSelectedRoadSegmentId(cand.roadSegmentId);
														}}
														className={`w-full py-1.5 px-2 rounded-md font-semibold text-base transition-colors ${
															selectedRoadSegmentId === cand.roadSegmentId
																? "bg-[#4D702F] text-white"
																: "bg-white hover:bg-stone-200 text-stone-800"
														}`}
													>
														{selectedRoadSegmentId === cand.roadSegmentId
															? "Terpilih di Peta"
															: "Pilih Ruas Ini"}
													</button>
												</div>
											))}
										</div>
									</div>
								) : null}

								{/* Dedicated Dashboard Road Map Component */}
								{roadSegmentsQuery.isLoading ? (
									<div
										role="status"
										className="rounded border border-stone-200 bg-white p-3 text-base text-stone-600 flex items-center gap-2"
									>
										<span className="w-2 h-2 rounded-full bg-stone-400 animate-pulse" />
										<span>Memuat katalog ruas jalan terverifikasi...</span>
									</div>
								) : roadSegmentsQuery.isError ? (
									<div
										role="alert"
										className="rounded border border-red-200 bg-red-50 p-3 text-base text-red-800 flex items-center justify-between gap-3 flex-wrap"
									>
										<div>
											<p className="font-semibold">
												Katalog ruas jalan tidak dapat dimuat (503 / galat server).
											</p>
											{catalogRequestId ? (
												<p className="text-base text-red-600 mt-0.5">
													ID Permintaan: {catalogRequestId}
												</p>
											) : null}
										</div>
										<button
											type="button"
											onClick={() => void roadSegmentsQuery.refetch()}
											className="ui-button text-red-700 shrink-0"
										>
											Coba Lagi
										</button>
									</div>
								) : catalogSegments.length === 0 ? (
									<div className="rounded border border-stone-200 bg-white p-3 text-base text-stone-600">
										Katalog ruas jalan kosong untuk wilayah ini. Gunakan mode gambar untuk
										menandai garis simulasi.
									</div>
								) : null}
								<DashboardRoadMapInput
									mode={roadInputMode}
									height={420}
									draftCoordinates={draftCoordinates}
									onDraftCoordinatesChange={(coordinates) => { markDirty(); setDraftCoordinates(coordinates); }}
									catalogSegments={catalogSegments}
									selectedCatalogSegmentId={selectedRoadSegmentId}
									onSelectCatalogSegment={(id) => setSelectedRoadSegmentId(id)}
									attachedRoadImpacts={attachedRoadImpacts}
									isCatalogLoading={roadSegmentsQuery.isLoading}
									isCatalogError={roadSegmentsQuery.isError}
									catalogRequestId={catalogRequestId}
									onRetryCatalog={() => void roadSegmentsQuery.refetch()}
								/>

								{/* Input Form Based on Active Map Mode */}
								{roadInputMode === "draw" ? (
									<div className="rounded border border-[#DCE8D3] bg-white p-4 space-y-4">
										<div className="flex flex-wrap items-center justify-between gap-2">
											<div className="flex items-center gap-2">
												<PenTool className="w-4 h-4 text-[#4D702F]" />
												<span className="text-base font-bold text-[#181817]">
													Formulir Ruas Jalan dari Titik Peta (
													{draftCoordinates.length} titik dipilih)
												</span>
											</div>
											<span className="text-[11px] font-semibold text-[#4D702F]">
												{draftCoordinates.length < 2
													? "Klik minimal 2 titik pada peta di atas"
													: "Garis ruas jalan siap disimpan"}
											</span>
										</div>

										<div className="grid grid-cols-1 md:grid-cols-3 gap-3">
											<div>
												<label className="block text-base font-semibold text-[#181817] mb-1">
													Nama Ruas Jalan / Simpang *
												</label>
												<input
													type="text"
													value={newSegmentName}
													onChange={(e) => setNewSegmentName(e.target.value)}
													placeholder="Mis. Jl. Raya Ubud (Depan Puri Saren)"
													className="w-full rounded border border-[#E5E3DC] bg-white px-3 py-2 text-base text-[#181817]"
												/>
											</div>

											<div>
												<label className="block text-base font-semibold text-[#181817] mb-1">
													Kawasan / Desa Adat *
												</label>
												<input
													type="text"
													value={newSegmentArea}
													onChange={(e) => setNewSegmentArea(e.target.value)}
													placeholder="Mis. Ubud, Gianyar"
													className="w-full rounded border border-[#E5E3DC] bg-white px-3 py-2 text-base text-[#181817]"
												/>
											</div>

											<div>
												<label className="block text-base font-semibold text-[#181817] mb-1">
													Jenis Dampak Lalu Lintas *
												</label>
												<select
													value={selectedImpactType}
													onChange={(e) =>
														setSelectedImpactType(
															e.target.value as typeof selectedImpactType,
														)
													}
													className="w-full rounded border border-[#E5E3DC] bg-white px-3 py-2 text-base text-[#181817]"
												>
													{IMPACT_TYPE_OPTIONS.map((opt) => (
														<option key={opt.value} value={opt.value}>
															{opt.label}
														</option>
													))}
												</select>
											</div>

											<div>
												<label className="block text-base font-semibold text-[#181817] mb-1">
													Mulai Penutupan (WITA)
												</label>
												<input
													type="datetime-local"
													value={impactFromWita || formState.startsAtWita}
													onChange={(e) => setImpactFromWita(e.target.value)}
													className="w-full rounded border border-[#E5E3DC] bg-white px-3 py-2 text-base text-[#181817]"
												/>
											</div>

											<div>
												<label className="block text-base font-semibold text-[#181817] mb-1">
													Selesai Penutupan (WITA)
												</label>
												<input
													type="datetime-local"
													value={impactToWita || formState.endsAtWita}
													onChange={(e) => setImpactToWita(e.target.value)}
													className="w-full rounded border border-[#E5E3DC] bg-white px-3 py-2 text-base text-[#181817]"
												/>
											</div>

											<div>
												<label className="block text-base font-semibold text-[#181817] mb-1">
													Catatan Pengalihan Arus / Rute Alternatif
												</label>
												<input
													type="text"
													value={impactDiversionNote}
													onChange={(e) =>
														setImpactDiversionNote(e.target.value)
													}
													placeholder="Mis. Dialihkan melalui Jl. Sugriwa / Monkey Forest"
													className="w-full rounded border border-[#E5E3DC] bg-white px-3 py-2 text-base text-[#181817]"
												/>
											</div>
										</div>

										<div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-2">
											<label className="flex items-center gap-2 text-base text-[#181817] cursor-pointer">
												<input
													type="checkbox"
													checked={humanVerifiedRoad}
													onChange={(e) =>
														setHumanVerifiedRoad(e.target.checked)
													}
													className="rounded border-[#C5C3BC] text-[#4D702F]"
												/>
												<span>
															Saya memeriksa garis ini untuk latihan. Garis ini bukan ruas operasional terverifikasi.
												</span>
											</label>

											<button
												type="button"
												disabled={
													drawAndAttachRoadMutation.isPending ||
													draftCoordinates.length < 2
												}
												onClick={() =>
													void drawAndAttachRoadMutation.mutateAsync()
												}
												className="inline-flex items-center justify-center gap-1.5 px-4 py-2.5 rounded bg-[#4D702F] text-white text-base font-semibold hover:bg-[#405E28] disabled:opacity-50 shrink-0"
											>
												<Plus className="w-3.5 h-3.5" />
												<span>
													{drawAndAttachRoadMutation.isPending
														? "Menyimpan Ruas Jalan..."
														: "Simpan & Tautkan Ruas Jalan"}
												</span>
											</button>
										</div>
									</div>
								) : (
									<div className="rounded border border-[#E5E3DC] bg-white p-4 space-y-4">
										{roadSegmentsQuery.isError ? (
											<div
												role="alert"
												className="rounded border border-red-200 bg-red-50 p-3 text-base text-red-800 flex items-center justify-between gap-2 flex-wrap"
											>
												<span>Katalog ruas jalan tidak dapat dimuat.</span>
												<button
													type="button"
													onClick={() => void roadSegmentsQuery.refetch()}
													className="ui-button text-red-700 shrink-0"
												>
													Coba Lagi
												</button>
											</div>
										) : null}
										<div className="grid grid-cols-1 md:grid-cols-3 gap-3">
											<div className="md:col-span-2">
												<label className="block text-base font-semibold text-[#181817] mb-1">
													Pilih Ruas Jalan dari Katalog Terverifikasi *
												</label>
												<select
													value={selectedRoadSegmentId}
													onChange={(e) =>
														setSelectedRoadSegmentId(e.target.value)
													}
													className="w-full rounded border border-[#E5E3DC] bg-white px-3 py-2 text-base text-[#181817]"
												>
													<option value="">
														{roadSegmentsQuery.isLoading
															? "-- Memuat katalog ruas jalan... --"
															: roadSegmentsQuery.isError
																? "-- Gagal memuat katalog (klik coba lagi) --"
																: "-- Pilih ruas jalan atau klik garis biru di peta --"}
													</option>
													{catalogSegments.map((seg) => (
														<option key={seg.id} value={seg.id}>
															{seg.displayName} ({seg.coverageArea})
														</option>
													))}
												</select>
											</div>

											<div>
												<label className="block text-base font-semibold text-[#181817] mb-1">
													Jenis Dampak Lalu Lintas *
												</label>
												<select
													value={selectedImpactType}
													onChange={(e) =>
														setSelectedImpactType(
															e.target.value as typeof selectedImpactType,
														)
													}
													className="w-full rounded border border-[#E5E3DC] bg-white px-3 py-2 text-base text-[#181817]"
												>
													{IMPACT_TYPE_OPTIONS.map((opt) => (
														<option key={opt.value} value={opt.value}>
															{opt.label}
														</option>
													))}
												</select>
											</div>
										</div>

										<div className="grid grid-cols-1 md:grid-cols-2 gap-3">
											<label>Mulai Penutupan (WITA)<input type="datetime-local" value={impactFromWita || formState.startsAtWita} onChange={e => setImpactFromWita(e.target.value)} className="teduh-form-input" /></label>
											<label>Selesai Penutupan (WITA)<input type="datetime-local" value={impactToWita || formState.endsAtWita} onChange={e => setImpactToWita(e.target.value)} className="teduh-form-input" /></label>
										</div>
										<div className="flex justify-end">
											<button
												type="button"
												disabled={
													!selectedRoadSegmentId ||
													addCatalogRoadImpactMutation.isPending
												}
												onClick={() => {
													if (selectedRoadSegmentId) {
														void addCatalogRoadImpactMutation.mutateAsync(
															selectedRoadSegmentId,
														);
													}
												}}
												className="ui-button ui-button-primary"
											>
												<Plus className="w-3.5 h-3.5" />
												<span>
													{addCatalogRoadImpactMutation.isPending
														? "Menautkan..."
														: "Tautkan Ruas Katalog ke Acara"}
												</span>
											</button>
										</div>
									</div>
								)}
							</div>

							{/* Attached Road Impacts List */}
							<div className="workflow-panel space-y-4">
								<div className="flex items-center justify-between">
									<h3 className="teduh-workspace-card-title">
										Daftar Ruas Jalan Terdampak ({attachedRoadImpacts.length})
									</h3>
								</div>

								{attachedRoadImpacts.length > 0 ? (
									<div className="space-y-2.5">
										{attachedRoadImpacts.map((imp) => (
											<div
												key={imp.id}
												className="rounded border border-[#E5E3DC] bg-white p-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3 max-w-full overflow-hidden"
											>
												<div className="space-y-1 min-w-0 flex-1 break-words">
													<div className="flex flex-wrap items-center gap-2">
														<span className="text-base font-bold text-[#181817] break-words">
															{imp.segment?.displayName ||
																imp.displayName ||
																"Ruas Jalan Terverifikasi"}
														</span>
														<span className="px-2 py-0.5 rounded-md bg-white text-[#4D702F] text-[11px] font-semibold shrink-0">
															{getImpactTypeLabel(imp.impactType)}
														</span>
													</div>
													<p className="text-base text-[#585854] break-words">
														{imp.segment?.coverageArea ||
															imp.coverageArea ||
															"Bali"}{" "}
														•{" "}
														{imp.plannedFrom && imp.plannedTo
															? formatWitaRange(imp.plannedFrom, imp.plannedTo)
															: "Sesuai jadwal acara"}
														{imp.diversionNote
															? ` • Alihan: ${imp.diversionNote}`
															: ""}
													</p>
												</div>

												<div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 w-full sm:w-auto pt-2 sm:pt-0 border-t sm:border-t-0 border-[#E5E3DC]">
													<div className="max-w-full overflow-hidden">
														<RoadStatusBadge
															status={
																imp.operationalStatus?.effectiveStatus ===
																"unconfirmed"
																	? "unknown"
																	: (imp.operationalStatus?.effectiveStatus ??
																		"unknown")
															}
															expiresAt={imp.operationalStatus?.expiresAt}
														/>
													</div>
													<div className="flex justify-end gap-2 shrink-0">
														{imp.sourceType === "catalog" && (currentLifecycleStatus === "draft" || currentLifecycleStatus === "review") && (!imp.reviewStatus || imp.reviewStatus === "rejected" || imp.reviewStatus === "superseded") ? (
															<button
																type="button"
																disabled={submitRoadReviewMutation.isPending}
																onClick={() => void submitRoadReviewMutation.mutateAsync(imp.id)}
																className="ui-button"
															>
																<span>Ajukan Tinjauan Reviewer</span>
															</button>
														) : imp.reviewStatus ? (
															<span className="px-2 py-1 rounded bg-stone-100 text-xs font-semibold text-stone-700 self-center">
																{imp.reviewStatus === "pending" ? "Menunggu Reviewer" : imp.reviewStatus === "approved" ? "Disetujui Reviewer" : imp.reviewStatus === "rejected" ? "Ditolak Reviewer" : "Perlu Pengajuan Ulang"}
															</span>
														) : null}
														<button
															type="button"
															disabled={removeRoadImpactMutation.isPending}
															onClick={() =>
																void removeRoadImpactMutation.mutateAsync(imp.id)
															}
															className="ui-button text-red-700"
														>
															<Trash2 className="w-3 h-3" />
															<span>Hapus</span>
														</button>
													</div>
												</div>
											</div>
										))}
									</div>
								) : (
									<EmptyStateCard
										title={SYSTEM_STATE_MESSAGES.noMatchingRoad.title}

										description={
											SYSTEM_STATE_MESSAGES.noMatchingRoad.description

										}
									/>
								)}


								<div className="wizard-navigation-footer">
									<button
										type="button"
										onClick={() => setActiveStep(1)}
										className="ui-button"
									>
										<ArrowLeft className="w-3.5 h-3.5" />
										<span>Kembali ke Detail Upacara</span>
									</button>
									<div className="wizard-navigation-actions">
									<button
										type="button"
										disabled={saveDraftMutation.isPending}
										onClick={() => void saveDraftMutation.mutateAsync()}
										className="ui-button"
									>
										<Save className="w-3.5 h-3.5" />
										<span>{saveDraftMutation.isPending ? "Menyimpan..." : "Simpan draf"}</span>
									</button>
									<button
										type="button"
										onClick={() => setActiveStep(3)}
										className="ui-button ui-button-primary"
									>
										<span>Lanjut ke Verifikasi &amp; Terbitkan</span>
										<ArrowRight className="w-3.5 h-3.5" />
									</button>
									</div>
								</div>
							</div>
						</div>
					) : null}

					{/* ================================================================= */}
					{/* STEP 3: VERIFIKASI PRAJURU & TERBITKAN KE WARGA                   */}
					{/* ================================================================= */}
					{activeStep === 3 ? (
						<div className="grid grid-cols-1 xl:grid-cols-12 gap-6 items-start">
							<div className="xl:col-span-7 workflow-panel space-y-5">
								<div className="border-b border-[#F0EFEA] pb-3">
									<h2 className="teduh-workspace-card-title">
										4. Verifikasi Prajuru &amp; Penerbitan Resmi
									</h2>
									<p className="text-base text-[#585854] mt-0.5">
										Periksa ringkasan akhir di bawah ini. Sesuai invarian domain
										Rangkai, pengumuman wajib diverifikasi Prajuru (`REVIEW`)
										sebelum diterbitkan ke publik (`PUBLISHED`).
									</p>
								</div>

								<div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-base">
									<div className="rounded border border-[#E5E3DC] bg-white p-3">
										<span className="text-base text-[#585854] block">
											Nama Upacara
										</span>
										<p className="font-bold text-[#181817]">
											{formState.title.trim() || "Belum diisi"}
										</p>
									</div>
									<div className="rounded border border-[#E5E3DC] bg-white p-3">
										<span className="text-base text-[#585854] block">
											Lokasi &amp; Kawasan
										</span>
										<p className="font-bold text-[#181817]">
											{formState.venueName.trim() || "Belum diisi"}
										</p>
									</div>
									<div className="rounded border border-[#E5E3DC] bg-white p-3">
										<span className="text-base text-[#585854] block">
											Jadwal Pelaksanaan (WITA)
										</span>
										<p className="font-bold text-[#181817]">
											{previewStartsIso && previewEndsIso
												? formatWitaRange(previewStartsIso, previewEndsIso)
												: "Belum lengkap"}
										</p>
									</div>
									<div className="rounded border border-[#E5E3DC] bg-white p-3">
										<span className="text-base text-[#585854] block">
											Ruas Jalan Terdampak
										</span>
										<p className="font-bold text-[#4D702F]">
																	{attachedRoadImpacts.length} ruas jalan tercatat
										</p>
									</div>
									<div className="rounded border border-[#E5E3DC] bg-white p-3">
										<span className="text-base text-[#585854] block">
											Nomor Surat Edaran
										</span>
										<p className="font-bold text-[#181817]">
											{formState.permitReference.trim() || "-"}
										</p>
									</div>
									<div className="rounded border border-[#E5E3DC] bg-white p-3">
										<span className="text-base text-[#585854] block">
											Status Verifikasi Prajuru
										</span>
										<p className="font-bold text-[#181817]">
											{loadedEvent?.verifiedAt
												? `Diverifikasi (${formatWitaDateTime(loadedEvent.verifiedAt)})`
												: "Menunggu Konfirmasi Prajuru"}
										</p>
									</div>
								</div>

								{/* Action Bar: Save, Verify (Review), Publish, Complete */}
								<div className="rounded border border-[#DCE8D3] bg-white p-4 space-y-3">
									<div className="flex flex-wrap items-center justify-between gap-2">
										<span className="text-base font-bold text-[#181817]">
											Tindakan Siklus Hidup Acara (Event Lifecycle)
										</span>
										<EventLifecycleBadge status={currentLifecycleStatus} />
									</div>

									<div className="flex flex-wrap items-center gap-2.5">
										<button
											type="button"
											disabled={saveDraftMutation.isPending}
											onClick={() => void saveDraftMutation.mutateAsync()}
											className="ui-button"
										>
											<Save className="w-3.5 h-3.5" />
											<span>1. Simpan Draf</span>
										</button>

										<button
											type="button"
											disabled={!isRealUuidEvent || reviewMutation.isPending}
											onClick={() => void reviewMutation.mutateAsync()}
											className="ui-button"
										>
											<CheckCircle2 className="w-3.5 h-3.5" />
											<span>
												{reviewMutation.isPending
													? "Memverifikasi..."
													: "2. Tandai Diperiksa Prajuru (Review)"}
											</span>
										</button>

										<button
											type="button"
											disabled={

												!isRealUuidEvent ||
												(!loadedEvent?.verifiedAt &&
													currentLifecycleStatus !== "review")
											}
											onClick={() => setIsPublishDialogOpen(true)}
											className="ui-button ui-button-primary"
										>
											<Send className="w-3.5 h-3.5" />
											<span>3. Terbitkan ke Warga</span>
										</button>

										{isRealUuidEvent &&
										(currentLifecycleStatus === "published" ||
											currentLifecycleStatus === "active") ? (
											<button
												type="button"
												disabled={completeMutation.isPending}
												onClick={() => void completeMutation.mutateAsync()}
												className="ui-button"
											>
												<CheckCircle2 className="w-3.5 h-3.5" />
												<span>Tandai Acara Selesai</span>
											</button>
										) : null}
									</div>
								</div>

								{/* Cancellation Section */}
								{isRealUuidEvent && currentLifecycleStatus !== "cancelled" ? (
									<div className="pt-4 border-t border-[#F0EFEA] space-y-2">
										<label className="block text-base font-semibold text-[#585854]">
											Alasan Pembatalan Pengumuman (Jika Dibatalkan)
										</label>
										<div className="flex flex-col sm:flex-row gap-2">
											<input
												type="text"
												value={cancelReason}
												onChange={(e) => setCancelReason(e.target.value)}
												className="flex-1 rounded border border-[#E5E3DC] bg-white px-3 py-2 text-base text-[#181817]"
											/>
											<button
												type="button"
												disabled={cancelMutation.isPending}
												onClick={() => void cancelMutation.mutateAsync()}
												className="ui-button text-red-700 shrink-0"
											>
												<Trash2 className="w-3.5 h-3.5" />
												<span>Batalkan Pengumuman</span>
											</button>
										</div>
									</div>
								) : null}
							</div>


							{/* Right Column: Operational Modules Shortcuts */}
							<div className="xl:col-span-5 space-y-4">
								<div className="workflow-panel space-y-4">
									<h3 className="teduh-workspace-card-title">
										Modul Operasional Lanjutan
									</h3>
									<p className="text-base text-[#585854]">
										Setelah draf disimpan, Anda dapat langsung menugaskan
										Pecalang, membagikan tautan undangan petugas, memperbarui
										status jalan saat acara berlangsung, dan mencatat kebersihan
										pasca-acara.
									</p>


									{isRealUuidEvent && routeEventId ? (
										<div className="space-y-2.5">
											<Link
												to={`/dashboard/events/${routeEventId}/team`}
												className="rounded border border-[#E5E3DC] bg-white p-3.5 flex items-center justify-between hover:bg-[#F3F1EC] no-underline"
											>
												<div className="flex items-center gap-3">
													<Users className="w-4 h-4 text-[#4D702F]" />
													<div>
														<p className="text-base font-bold text-[#181817]">
															Tim Lapangan &amp; Tautan Undangan
														</p>
														<p className="text-base text-[#585854]">
															Buat tautan undangan Pecalang &amp; petugas
															kebersihan
														</p>
													</div>
												</div>
												<ArrowRight className="w-4 h-4 text-[#585854]" />
											</Link>


											<Link
												to={`/field/events/${routeEventId}`}
												className="rounded border border-[#E5E3DC] bg-white p-3.5 flex items-center justify-between hover:bg-[#F3F1EC] no-underline"
											>
												<div className="flex items-center gap-3">
													<Radio className="w-4 h-4 text-[#4D702F]" />
													<div>
														<p className="text-base font-bold text-[#181817]">
															Pos Pecalang (Status Jalan Live)
														</p>
														<p className="text-base text-[#585854]">
															Perbarui status OPEN / INTERMITTENT / CLOSED
														</p>
													</div>
												</div>
												<ArrowRight className="w-4 h-4 text-[#585854]" />
											</Link>

											<Link
												to={`/dashboard/events/${routeEventId}/cleanup`}
												className="rounded border border-[#E5E3DC] bg-white p-3.5 flex items-center justify-between hover:bg-[#F3F1EC] no-underline"
											>
												<div className="flex items-center gap-3">
													<ClipboardCheck className="w-4 h-4 text-[#4D702F]" />
													<div>
														<p className="text-base font-bold text-[#181817]">
															Kebersihan &amp; Pencatatan Sampah
														</p>
														<p className="text-base text-[#585854]">
															Unggah bukti foto &amp; catat timbangan sampah
														</p>
													</div>
												</div>
												<ArrowRight className="w-4 h-4 text-[#585854]" />
											</Link>
										</div>
									) : (
										<div className="rounded border border-dashed border-[#D5D3CB] p-4 text-base text-[#585854]">
											Klik tombol <strong>Simpan Draf</strong> terlebih dahulu
											untuk mengaktifkan modul penugasan tim, pos Pecalang, dan
											kebersihan.
										</div>
									)}
								</div>
							</div>
						</div>
					) : null}
				</>
			)}

			{isCreateMode && activeStep === 3 ? <div className="wizard-navigation-footer"><button className="ui-button" type="button" onClick={() => setActiveStep(2)}><ArrowLeft className="w-3.5 h-3.5" />Kembali ke jalan</button></div> : null}

			<dialog ref={publishDialogRef} aria-labelledby="publish-dialog-title" aria-describedby="publish-dialog-description"
				className="m-auto w-[min(92vw,32rem)] rounded-lg bg-white p-6 text-stone-900 shadow-xl backdrop:bg-black/50"
				onCancel={(event) => { if (publishMutation.isPending) event.preventDefault(); }}
				onClose={() => setIsPublishDialogOpen(false)}>
				<h2 id="publish-dialog-title" className="text-xl font-semibold">{!publishSimulation ? "Umumkan Kegiatan ke Warga?" : "Publikasikan Simulasi?"}</h2>
				<p id="publish-dialog-description" className="mt-2 text-stone-600">{!publishSimulation ? "Pastikan seluruh data telah sesuai dengan surat edaran." : "Kegiatan ini akan ditampilkan sebagai SIMULASI."}</p>
				<div className="mt-6 flex flex-wrap justify-end gap-3">
					<button type="button" className="ui-button" disabled={publishMutation.isPending} onClick={() => setIsPublishDialogOpen(false)}>Batal</button>
					<button type="button" className="ui-button" disabled={publishMutation.isPending} onClick={() => publishMutation.mutate()}>
						{publishMutation.isPending ? "Menerbitkan..." : !publishSimulation ? "Ya, Terbitkan" : "Ya, Terbitkan Simulasi"}
					</button>
				</div>
			</dialog>
		</div>

	);
}
