import { AlertDialog } from "@astryxdesign/core/AlertDialog";
import { Banner } from "@astryxdesign/core/Banner";
import { Button } from "@astryxdesign/core/Button";
import { CheckboxInput } from "@astryxdesign/core/CheckboxInput";
import { Divider } from "@astryxdesign/core/Divider";
import { FileInput } from "@astryxdesign/core/FileInput";
import { FormLayout } from "@astryxdesign/core/FormLayout";
import { Grid } from "@astryxdesign/core/Grid";
import { Heading } from "@astryxdesign/core/Heading";
import { Icon } from "@astryxdesign/core/Icon";
import {
	Layout,
	LayoutContent,
	LayoutFooter,
	LayoutHeader,
} from "@astryxdesign/core/Layout";
import { List, ListItem } from "@astryxdesign/core/List";
import {
	MetadataList,
	MetadataListItem,
} from "@astryxdesign/core/MetadataList";
import { Selector } from "@astryxdesign/core/Selector";
import { HStack, VStack } from "@astryxdesign/core/Stack";
import { Step, Stepper } from "@astryxdesign/core/Stepper";
import { Text } from "@astryxdesign/core/Text";
import { Token } from "@astryxdesign/core/Token";
import { TextArea } from "@astryxdesign/core/TextArea";
import { TextInput } from "@astryxdesign/core/TextInput";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
	AlertTriangle,
	ArrowLeft,
	ArrowRight,
	CalendarDays,
	CheckCircle2,
	FileText,
	MapPinned,
	Plus,
	Save,
	Send,
	Sparkles,
	Trash2,
	Users,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router";
import { z } from "zod";
import { RouterLinkBridge } from "../components/layout/AppShellLayout";
import {
	EmptyStateCard,
	ErrorStateBanner,
	EventLifecycleBadge,
	FieldReviewIndicator,
	LoadingStateBlock,
	RoadStatusBadge,
	type FieldReviewState,
} from "../components/rangkai";
import { BaliMapTilerView } from "../features/map/BaliMapTilerView";
import { ApiClientError } from "../lib/api-client";
import {
	cancelEvent,
	createEventDraft,
	createRoadImpact,
	fetchEventDetail,
	fetchEventRoadImpacts,
	fetchRoadSegments,
	fromIsoToWitaInput,
	getSavedOrganizationId,
	mapPublicEventToCeremonyProfile,
	publishVerifiedEvent,
	saveExtractedFields,
	toWitaIsoTimestamp,
	transitionEventToReview,
	triggerDocumentExtraction,
	uploadEventDocument,
	type DocumentRecord,
	type ExtractionRecord,
} from "../lib/events-api";
import { formatWitaDateTime, formatWitaRange } from "../lib/wita";
import { SYSTEM_STATE_MESSAGES } from "../lib/constants/labels";

const DRAFT_STORAGE_KEY = "rangkai:event-wizard-draft-v1";
const UUID_REGEX =
	/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const DESA_ADAT_OPTIONS = [
	{
		value: "11111111-1111-4111-8111-111111111111",
		label: "Banjar Uji Coba / Desa Adat Simulasi (Pangkalan Data Neon)",
	},
	{
		value: "00000000-0000-4000-8000-000000000001",
		label: "Desa Adat Ubud (Gianyar)",
	},
	{
		value: "550e8400-e29b-41d4-a716-446655440000",
		label: "Desa Adat Padangtegal (Gianyar)",
	},
	{
		value: "550e8400-e29b-41d4-a716-446655440001",
		label: "Desa Adat Intaran Sanur (Denpasar)",
	},
	{
		value: "550e8400-e29b-41d4-a716-446655440002",
		label: "Desa Adat Kuta (Badung)",
	},
];

const CATEGORY_OPTIONS = [
	{ value: "upacara", label: "Dewa Yadnya (Pujawali / Karya Agung)" },
	{ value: "prosesi", label: "Prosesi Melasti / Pawai Ogoh-Ogoh" },
	{ value: "ngaben", label: "Pitra Yadnya (Ngaben / Pelebon)" },
	{ value: "budaya", label: "Pawai Adat / Budaya Desa" },
];

const IMPACT_TYPE_OPTIONS = [
	{ value: "full_closure", label: "Penutupan Total (Bahu & Badan Jalan)" },
	{ value: "partial_closure", label: "Penutupan Sebagian (Buka-Tutup Arus)" },
	{ value: "one_way", label: "Satu Arah Sementara (Contra-flow)" },
	{ value: "speed_reduction", label: "Pengurangan Kecepatan / Pengawalan" },
];

function getImpactTypeLabel(type?: string): string {
	switch (type) {
		case "full_closure":
			return "Penutupan Total";
		case "partial_closure":
			return "Buka-Tutup";
		case "one_way":
			return "Satu Arah";
		case "speed_reduction":
			return "Pengurangan Kecepatan";
		default:
			return "Penutupan Jalan";
	}
}

function getFieldReviewStatus(
	candidate?: { value: string | null; evidence: string | null; needs_review: boolean } | null,
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
	{ label: "1. Surat Edaran", description: "Unggah dokumen & AI" },
	{ label: "2. Detail Upacara", description: "Periksa & lengkapi data" },
	{ label: "3. Peta & Jalan", description: "Ruas jalan terdampak" },
	{ label: "4. Terbitkan", description: "Verifikasi Prajuru" },
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
	const fallbackOrg = getSavedOrganizationId() || DESA_ADAT_OPTIONS[0].value;
	const defaults: DraftFormState = {
		organizationId: fallbackOrg,
		title: "",
		category: "upacara",
		venueName: "",
		startsAtWita: "2026-11-14T08:00",
		endsAtWita: "2026-11-14T13:30",
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
			organizationId: parsed.organizationId || fallbackOrg,
		};
	} catch {
		return defaults;
	}
}

export function EventWizardPage() {
	const { id: routeEventId } = useParams<{ id: string }>();
	const navigate = useNavigate();
	const queryClient = useQueryClient();

	const isCreateMode = !routeEventId;
	const isRealUuidEvent = Boolean(
		routeEventId && UUID_REGEX.test(routeEventId),
	);

	const [activeStep, setActiveStep] = useState(0);
	const [uploadedFiles, setUploadedFiles] = useState<File[]>([]);
	const [activeDocument, setActiveDocument] = useState<DocumentRecord | null>(
		null,
	);
	const [activeExtraction, setActiveExtraction] =
		useState<ExtractionRecord | null>(null);

	const [formState, setFormState] = useState<DraftFormState>(() =>
		loadSessionDraft(),
	);
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
	const [selectedRoadSegmentId, setSelectedRoadSegmentId] = useState<string>("");
	const [selectedImpactType, setSelectedImpactType] = useState<
		"full_closure" | "partial_closure" | "one_way" | "speed_reduction"
	>("full_closure");
	const [aiConsentGranted, setAiConsentGranted] = useState(true);

	// 1. Fetch Event Detail if already created
	const eventDetailQuery = useQuery({
		queryKey: ["events", "detail", routeEventId],
		queryFn: () => fetchEventDetail(routeEventId!),
		enabled: isRealUuidEvent,
		retry: false,
	});

	// 2. Fetch Verified Road Segments for Step 3
	const roadSegmentsQuery = useQuery({
		queryKey: ["road-segments", "catalog"],
		queryFn: () => fetchRoadSegments(),
		enabled: activeStep === 2,
		staleTime: 5 * 60 * 1000,
	});

	// 3. Fetch Real Road Impacts attached to this event
	const eventRoadImpactsQuery = useQuery({
		queryKey: ["events", routeEventId, "road-impacts"],
		queryFn: () => fetchEventRoadImpacts(routeEventId!),
		enabled: Boolean(routeEventId && isRealUuidEvent),
		retry: false,
	});

	const loadedEvent = eventDetailQuery.data?.event;

	if (loadedEvent && hydratedEventId !== loadedEvent.id) {
		setHydratedEventId(loadedEvent.id);
		const record = loadedEvent as unknown as Record<string, unknown>;
		setFormState({
			organizationId: loadedEvent.organizationId,
			title: loadedEvent.title,
			category: loadedEvent.category || "upacara",
			venueName: loadedEvent.venueName || "",
			startsAtWita: fromIsoToWitaInput(loadedEvent.startsAt),
			endsAtWita: fromIsoToWitaInput(loadedEvent.endsAt),
			permitReference: loadedEvent.permitReference || "",
			description: loadedEvent.description || "",
			processionDescription: (record.processionDescription as string) || "",
			trafficImpactDescription: (record.trafficImpactDescription as string) || "",
			organizerName: (record.organizerName as string) || "",
			cleanupLocationNotes: (record.cleanupLocationNotes as string) || "",
			contactInformation: (record.contactInformation as string) || "",
		});
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

	function updateField<K extends keyof DraftFormState>(
		key: K,
		value: DraftFormState[K],
	) {
		setFormState((prev) => ({ ...prev, [key]: value }));
		if (fieldErrors[key]) {
			setFieldErrors((prev) => ({ ...prev, [key]: undefined }));
		}
	}

	// ---------------------------------------------------------------------------
	// Upload Document & Trigger Gemini AI Extraction Pipeline
	// ---------------------------------------------------------------------------
	const uploadAndExtractMutation = useMutation({
		mutationFn: async (file: File) => {
			setBannerFeedback(null);

			// Ensure we have a valid draft event ID first
			let targetEventId = routeEventId;
			if (!targetEventId || !isRealUuidEvent) {
				const draftRes = await createEventDraft({
					organizationId: formState.organizationId || DESA_ADAT_OPTIONS[0].value,
					title: formState.title.trim() || `Draf Dokumen ${file.name.replace(/\.[^/.]+$/, "")}`,
					category: formState.category || "upacara",
				});
				targetEventId = draftRes.event.id;
			}

			// Upload document to private R2 storage
			const uploadRes = await uploadEventDocument(targetEventId, file, true);
			setActiveDocument(uploadRes.document);

			// Trigger server-side Gemini multimodal extraction
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
			const out = ext.outputJson;

			if (out) {
				setFormState((prev) => {
					const nextState: DraftFormState = { ...prev };
					if (out.event_name?.value) nextState.title = out.event_name.value;
					if (out.event_category?.value)
						nextState.category = out.event_category.value;
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
						nextState.processionDescription =
							out.procession_description.value;
					if (out.traffic_impact_description?.value)
						nextState.trafficImpactDescription =
							out.traffic_impact_description.value;
					if (out.organizer_name?.value)
						nextState.organizerName = out.organizer_name.value;
					if (out.cleanup_location_notes?.value)
						nextState.cleanupLocationNotes =
							out.cleanup_location_notes.value;
					if (out.contact_information?.value)
						nextState.contactInformation = out.contact_information.value;

					if (!nextState.description && out.procession_description?.value) {
						nextState.description = out.procession_description.value;
					}
					return nextState;
				});
			}

			if (isCreateMode && result.eventId) {
				navigate(`/dashboard/events/${result.eventId}`);
			}

			const issuesCount = ext.issues?.length ?? 0;
			setBannerFeedback({
				status: issuesCount > 0 ? "warning" : "success",
				title: "Analisis Surat Edaran Selesai",
				description:
					issuesCount > 0
						? `AI Gemini mendeteksi ${issuesCount} catatan keraguan yang memerlukan perhatian khusus dari Prajuru. Silakan periksa formulir di langkah berikutnya.`
						: "Informasi surat edaran berhasil diekstraksi ke draf kegiatan. Silakan periksa dan koreksi sebelum diterbitkan.",
			});
		},
		onError: (err) => {
			setBannerFeedback({
				status: "warning",
				title: "Ekstraksi AI Tidak Berhasil",
				description:
					err instanceof Error
						? `${err.message}. Anda dapat melanjutkan dengan mengisi draf kegiatan secara manual.`
						: "Dokumen tidak dapat dianalisis secara otomatis. Silakan isi draf secara manual.",
			});
		},
	});

	// ---------------------------------------------------------------------------
	// Save / Patch Draft Event Details
	// ---------------------------------------------------------------------------
	const saveDraftMutation = useMutation({
		mutationFn: async () => {
			setFieldErrors({});
			setBannerFeedback(null);

			const parsed = wizardFormSchema.safeParse(formState);
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

			if (isCreateMode || !isRealUuidEvent) {
				return createEventDraft({
					organizationId: parsed.data.organizationId,
					title: parsed.data.title,
					category: parsed.data.category || null,
					venueName: parsed.data.venueName || null,
					startsAt: startsAtIso,
					endsAt: endsAtIso,
					permitReference: parsed.data.permitReference || null,
					description: parsed.data.description || null,
				});
			}

			return saveExtractedFields(routeEventId!, {
				title: parsed.data.title,
				category: (parsed.data.category || null) as never,
				venueName: parsed.data.venueName || null,
				startsAt: startsAtIso,
				endsAt: endsAtIso,
				permitReference: parsed.data.permitReference || null,
				description: parsed.data.description || null,
				processionDescription: parsed.data.processionDescription || null,
				trafficImpactDescription: parsed.data.trafficImpactDescription || null,
				organizerName: parsed.data.organizerName || null,
				cleanupLocationNotes: parsed.data.cleanupLocationNotes || null,
				contactInformation: parsed.data.contactInformation || null,
			});
		},
		onSuccess: async (result) => {
			await queryClient.invalidateQueries({ queryKey: ["events"] });
			if (isCreateMode || !isRealUuidEvent) {
				if (typeof window !== "undefined") {
					window.sessionStorage.removeItem(DRAFT_STORAGE_KEY);
				}
				setBannerFeedback({
					status: "success",
					title: "Draf disimpan",
					description: `"${result.event.title}" berhasil disimpan sebagai draf internal.`,
				});
				navigate(`/dashboard/events/${result.event.id}`);
			} else {
				await queryClient.invalidateQueries({
					queryKey: ["events", "detail", routeEventId],
				});
				setBannerFeedback({
					status: "success",
					title: "Perubahan disimpan",
					description: "Rincian upacara dan koreksi Prajuru berhasil diperbarui.",
				});
			}
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
	// Add Road Impact Mutation
	// ---------------------------------------------------------------------------
	const addRoadImpactMutation = useMutation({
		mutationFn: async (roadSegmentId: string) => {
			if (!routeEventId || !isRealUuidEvent) {
				throw new Error("Simpan draf kegiatan terlebih dahulu.");
			}
			const startsIso = toWitaIsoTimestamp(formState.startsAtWita);
			const endsIso = toWitaIsoTimestamp(formState.endsAtWita);
			if (!startsIso || !endsIso) {
				throw new Error("Lengkapi jadwal pelaksanaan upacara terlebih dahulu.");
			}

			return createRoadImpact(routeEventId, {
				roadSegmentId,
				plannedFrom: startsIso,
				plannedTo: endsIso,
				impactType: selectedImpactType,
				diversionNote: formState.trafficImpactDescription || undefined,
			});
		},
		onSuccess: async () => {
			setSelectedRoadSegmentId("");
			await queryClient.invalidateQueries({
				queryKey: ["events", routeEventId, "road-impacts"],
			});
			setBannerFeedback({
				status: "success",
				title: "Ruas Jalan Ditambahkan",
				description: "Ruas jalan terverifikasi berhasil ditautkan ke rencana penutupan.",
			});
		},
		onError: (err) => {
			setBannerFeedback({
				status: "error",
				title: "Gagal Menambahkan Jalan",
				description: err instanceof Error ? err.message : "Terjadi kendala jaringan.",
			});
		},
	});

	// ---------------------------------------------------------------------------
	// Review & Publication Transitions
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
				description: `Diverifikasi pada ${formatWitaDateTime(result.event.verifiedAt)}. Kegiatan siap diumumkan ke publik.`,
			});
		},
		onError: (err) => {
			setBannerFeedback({
				status: "error",
				title: "Konfirmasi Gagal",
				description: err instanceof Error ? err.message : "Terjadi kendala saat konfirmasi.",
			});
		},
	});

	const publishMutation = useMutation({
		mutationFn: async () => {
			if (!routeEventId || !isRealUuidEvent) {
				throw new Error("Simpan draf terlebih dahulu.");
			}
			return publishVerifiedEvent(routeEventId);
		},
		onSuccess: async (result) => {
			setIsPublishDialogOpen(false);
			await queryClient.invalidateQueries({ queryKey: ["events"] });
			await queryClient.invalidateQueries({
				queryKey: ["events", "detail", routeEventId],
			});
			setBannerFeedback({
				status: "success",
				title: "Resmi Diumumkan",
				description: `Diterbitkan pada ${formatWitaDateTime(result.event.publishedAt)}. Publik dapat melihat status penutupan di portal desa.`,
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

	const cancelMutation = useMutation({
		mutationFn: async () => {
			if (!routeEventId || !isRealUuidEvent) {
				throw new Error("Kegiatan belum tersimpan.");
			}
			return cancelEvent(routeEventId, "Dibatalkan oleh Panitia Desa Adat.");
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
	});

	const currentLifecycleStatus = loadedEvent?.status ?? "draft";
	const previewStartsIso = toWitaIsoTimestamp(formState.startsAtWita);
	const previewEndsIso = toWitaIsoTimestamp(formState.endsAtWita);

	const wizardSpatialProfile = useMemo(() => {
		const wizardRoads = eventRoadImpactsQuery.data?.roadImpacts ?? [];
		if (loadedEvent) {
			return mapPublicEventToCeremonyProfile(
				{
					id: loadedEvent.id,
					title: loadedEvent.title,
					slug: loadedEvent.publicSlug || loadedEvent.id,
					category: loadedEvent.category ?? null,
					description: loadedEvent.description ?? null,
					venueName: loadedEvent.venueName,
					startsAt: loadedEvent.startsAt,
					endsAt: loadedEvent.endsAt,
					status: loadedEvent.status,
					publishedAt: loadedEvent.publishedAt ?? null,
					organizationName: "Desa Adat",
					village: "Bali",
					district: "Bali",
				},
				wizardRoads,
			);
		}
		if (formState.title || formState.venueName) {
			return mapPublicEventToCeremonyProfile(
				{
					id: "draft-preview",
					title: formState.title || "Draf Kegiatan",
					slug: "draf",
					startsAt: previewStartsIso,
					endsAt: previewEndsIso,
					venueName: formState.venueName || null,
					category: formState.category || null,
					description: formState.description || null,
					status: "draft",
					publishedAt: null,
					organizationName: "Desa Adat",
					village: "Bali",
					district: "Bali",
				},
				wizardRoads,
			);
		}
		return null;
	}, [loadedEvent, eventRoadImpactsQuery.data?.roadImpacts, formState, previewStartsIso, previewEndsIso]);

	return (
		<Layout
			defaultHasDividers
			height="fill"
			contentWidth={760}
			header={
				<LayoutHeader hasDivider>
					<VStack gap={3}>
						<HStack justify="between" vAlign="center" wrap="wrap" gap={2}>
							<HStack gap={2} vAlign="center" wrap="wrap">
								<Button
									as={RouterLinkBridge}
									href="/dashboard"
									variant="ghost"
									size="sm"
									label="Daftar Upacara"
									icon={<Icon icon={ArrowLeft} size="sm" />}
								/>
								<Heading level={1}>
									{isCreateMode
										? "Buat Pengumuman Upacara"
										: formState.title || "Kelola Pengumuman"}
								</Heading>
								<EventLifecycleBadge status={currentLifecycleStatus} />
							</HStack>

							<Button
								variant="secondary"
								size="sm"
								label="Simpan Draf"
								icon={<Icon icon={Save} size="sm" />}
								isLoading={saveDraftMutation.isPending}
								onClick={() => {
									void saveDraftMutation.mutateAsync();
								}}
							/>
						</HStack>

						<Stepper
							activeStep={activeStep}
							onStepClick={setActiveStep}
							orientation="horizontal"
							density="compact"
						>
							{WIZARD_STEPS.map((s, idx) => (
								<Step
									key={s.label}
									step={idx}
									label={s.label}
									description={s.description}
								/>
							))}
						</Stepper>
					</VStack>
				</LayoutHeader>
			}
			content={
				<LayoutContent>
					<VStack gap={5}>
						{bannerFeedback ? (
							<Banner
								status={bannerFeedback.status}
								collapsible={false}
								title={bannerFeedback.title}
								description={bannerFeedback.description}
							/>
						) : null}

						{isRealUuidEvent && eventDetailQuery.isLoading ? (
							<LoadingStateBlock label="Memuat data upacara..." rows={3} />
						) : isRealUuidEvent && eventDetailQuery.isError ? (
							<ErrorStateBanner
								title="Gagal Memuat Data"
								error={eventDetailQuery.error}
								onRetry={() => {
									void eventDetailQuery.refetch();
								}}
							/>
						) : null}

						{/* STEP 0: SURAT EDARAN & GEMINI EXTRACTION */}
						{activeStep === 0 ? (
							<VStack gap={4}>
								<VStack gap={1}>
									<Heading level={2}>Surat Edaran Desa Adat & AI Gemini</Heading>
									<Text type="supporting" size="sm">
										Unggah foto atau PDF surat edaran desa adat. Sistem AI
										Gemini akan membaca informasi penting menjadi draf
										terstruktur untuk diperiksa oleh Prajuru Adat.
									</Text>
								</VStack>

								<Banner
									status="info"
									collapsible={false}
									title="Prinsip Validasi Human-in-the-Loop"
									description="Hasil bacaan AI bersifat draf rekomendasi dan tidak pernah langsung dipublikasikan ke warga tanpa konfirmasi manusia."
								/>

								<Selector
									label="Desa Adat Penyelenggara"
									placeholder="Pilih Desa Adat"
									value={formState.organizationId}
									onChange={(val) => updateField("organizationId", val)}
									options={DESA_ADAT_OPTIONS}
									isRequired
								/>

								<FileInput
									mode="dropzone"
									label="Berkas Surat Edaran (PDF, JPG, PNG • Maks. 8 MB)"
									accept=".pdf,image/jpeg,image/png"
									value={uploadedFiles}
									onChange={(files) => {
										const normalized = Array.isArray(files)
											? files
											: files
												? [files]
												: [];
										setUploadedFiles(normalized);
										if (normalized.length > 0) {
											if (!aiConsentGranted) {
												setBannerFeedback({
													status: "warning",
													title: "Persetujuan Pemrosesan AI Belum Diberikan",
													description:
														"Centang persetujuan pemrosesan AI Gemini untuk mengekstrak draf otomatis, atau lewati dan isi draf formulir secara manual.",
												});
												return;
											}
											void uploadAndExtractMutation.mutateAsync(normalized[0]);
										}
									}}
								/>

								<CheckboxInput
									value={aiConsentGranted}
									onChange={(checked) => setAiConsentGranted(Boolean(checked))}
									label="Persetujuan Pemrosesan AI Gemini (Privat & Sesuai FR-012)"
									description="Dokumen disimpan secara privat di Cloudflare R2 dan diekstraksi ke draf kegiatan internal tanpa dipublikasikan otomatis."
								/>

								{uploadAndExtractMutation.isPending ? (
									<LoadingStateBlock
										label={SYSTEM_STATE_MESSAGES.loadingAiExtraction.description}
										rows={2}
									/>
								) : null}

								{activeDocument ? (
									<Text size="sm" type="supporting">
										Berkas terunggah: {activeDocument.originalName} (
										{Math.round(activeDocument.sizeBytes / 1024)} KB)
									</Text>
								) : null}

								{activeExtraction ? (
									<VStack gap={3}>
										<Divider variant="subtle" />
										<HStack justify="between" vAlign="center" wrap="wrap">
											<HStack gap={2} vAlign="center">
												<Icon icon={Sparkles} size="sm" />
												<Heading level={3}>
													Hasil Pembacaan Dokumen ({activeExtraction.modelName})
												</Heading>
											</HStack>
											<Token
												color={
													activeExtraction.status === "completed"
														? "green"
														: "orange"
												}
												size="sm"
												label={
													activeExtraction.status === "completed"
														? `Selesai (${activeExtraction.latencyMs} ms)`
														: activeExtraction.status
												}
											/>
										</HStack>

										{activeExtraction.issues.length > 0 ? (
											<Banner
												status="warning"
												collapsible={false}
												title="Catatan Keraguan Ekstraksi"
												description={
													<VStack gap={1}>
														<Text size="sm">
															AI menemukan bagian yang ambigu dan wajib diverifikasi manual:
														</Text>
														<List density="compact">
															{activeExtraction.issues.map((issue, idx) => (
																<ListItem
																	key={idx}
																	startContent={
																		<Icon icon={AlertTriangle} size="xsm" />
																	}
																	label={issue}
																/>
															))}
														</List>
													</VStack>
												}
											/>
										) : null}

										<MetadataList columns={2}>
											<MetadataListItem label="Nama Upacara Terdeteksi">
												{formState.title || "-"}
											</MetadataListItem>
											<MetadataListItem label="Penyelenggara">
												{formState.organizerName || "-"}
											</MetadataListItem>
											<MetadataListItem label="Jadwal Pelaksanaan">
												{formState.startsAtWita && formState.endsAtWita
													? `${formState.startsAtWita} s/d ${formState.endsAtWita} WITA`
													: "-"}
											</MetadataListItem>
											<MetadataListItem label="Nomor Surat / Referensi">
												{formState.permitReference || "-"}
											</MetadataListItem>
										</MetadataList>

										<HStack justify="end">
											<Button
												variant="primary"
												size="md"
												label="Lanjut Periksa Rincian"
												icon={<Icon icon={ArrowRight} size="sm" />}
												onClick={() => setActiveStep(1)}
											/>
										</HStack>
									</VStack>
								) : null}
							</VStack>
						) : null}

						{/* STEP 1: DETAIL UPACARA & KOREKSI PRAJURU */}
						{activeStep === 1 ? (
							<VStack gap={4}>
								<HStack justify="between" vAlign="center" wrap="wrap">
									<VStack gap={1}>
										<Heading level={2}>Detail Upacara & Jadwal WITA</Heading>
										<Text type="supporting" size="sm">
											Periksa dan sesuaikan seluruh kolom data. Perubahan akan
											tersimpan sebagai data hasil peninjauan Prajuru Adat.
										</Text>
									</VStack>
									{activeExtraction ? (
										<Token
											color="gray"
											size="sm"
											label="Terisi dari Surat Edaran"
										/>
									) : null}
								</HStack>

								<FormLayout direction="vertical" defaultOptionality="optional">
									<VStack gap={1.5}>
										<TextInput
											label="Nama Upacara / Kegiatan Adat"
											placeholder="Contoh: Karya Pujawali & Prosesi Melasti Pura Dalem"
											value={formState.title}
											onChange={(val) => updateField("title", val)}
											isRequired
											startIcon={FileText}
											status={
												fieldErrors.title
													? { type: "error", message: fieldErrors.title }
													: undefined
											}
											statusVariant="detached"
											width="100%"
										/>
										{activeExtraction?.outputJson ? (
											<HStack justify="between" vAlign="center" wrap="wrap" gap={2}>
												<FieldReviewIndicator
													state={
														getFieldReviewStatus(
															activeExtraction.outputJson.event_name,
															formState.title,
														).state
													}
												/>
												{activeExtraction.outputJson.event_name?.evidence ? (
													<Text size="xsm" type="supporting">
														Bukti dokumen: &quot;{activeExtraction.outputJson.event_name.evidence}&quot;
													</Text>
												) : null}
											</HStack>
										) : null}
									</VStack>

									<Grid columns={{ minWidth: 220, max: 2 }} gap={4}>
										<Selector
											label="Kategori Upacara"
											value={formState.category}
											onChange={(val) => updateField("category", val)}
											options={CATEGORY_OPTIONS}
											isRequired
										/>
										<TextInput
											label="Nomor Surat / Rekomendasi"
											placeholder="Contoh: 14/DA-UBD/XI/2026"
											value={formState.permitReference}
											onChange={(val) => updateField("permitReference", val)}
											width="100%"
										/>
									</Grid>

									<VStack gap={1.5}>
										<TextInput
											label="Titik Pura / Banjar & Rute Utama"
											placeholder="Contoh: Pura Dalem Ubud menuju Catus Pata Ubud"
											value={formState.venueName}
											onChange={(val) => updateField("venueName", val)}
											startIcon={MapPinned}
											width="100%"
										/>
										{activeExtraction?.outputJson ? (
											<HStack justify="between" vAlign="center" wrap="wrap" gap={2}>
												<FieldReviewIndicator
													state={
														getFieldReviewStatus(
															activeExtraction.outputJson.venue_name,
															formState.venueName,
														).state
													}
												/>
												{activeExtraction.outputJson.venue_name?.evidence ? (
													<Text size="xsm" type="supporting">
														Bukti dokumen: &quot;{activeExtraction.outputJson.venue_name.evidence}&quot;
													</Text>
												) : null}
											</HStack>
										) : null}
									</VStack>

									<VStack gap={1.5}>
										<Grid columns={{ minWidth: 220, max: 2 }} gap={4}>
											<TextInput
												label="Waktu Mulai (WITA)"
												placeholder="YYYY-MM-DDTHH:mm"
												value={formState.startsAtWita}
												onChange={(val) => updateField("startsAtWita", val)}
												startIcon={CalendarDays}
												width="100%"
											/>

											<TextInput
												label="Waktu Selesai (WITA)"
												placeholder="YYYY-MM-DDTHH:mm"
												value={formState.endsAtWita}
												onChange={(val) => updateField("endsAtWita", val)}
												startIcon={CalendarDays}
												width="100%"
												status={
													fieldErrors.endsAtWita
														? { type: "error", message: fieldErrors.endsAtWita }
														: undefined
												}
												statusVariant="detached"
											/>
										</Grid>
										{activeExtraction?.outputJson ? (
											<HStack justify="between" vAlign="center" wrap="wrap" gap={2}>
												<FieldReviewIndicator
													state={
														getFieldReviewStatus(
															activeExtraction.outputJson.start_datetime,
															formState.startsAtWita,
														).state
													}
												/>
												{activeExtraction.outputJson.start_datetime?.evidence ? (
													<Text size="xsm" type="supporting">
														Bukti jadwal: &quot;{activeExtraction.outputJson.start_datetime.evidence}&quot;
													</Text>
												) : null}
											</HStack>
										) : null}
									</VStack>

									<TextArea
										label="Deskripsi Prosesi / Iring-iringan"
										placeholder="Urutan barisan, sarana upakara yang diusung, dan estimasi waktu perhentian..."
										value={formState.processionDescription}
										onChange={(val) => updateField("processionDescription", val)}
										rows={2}
										maxLength={2000}
										width="100%"
									/>

									<VStack gap={1.5}>
										<TextArea
											label="Dampak Lalu Lintas & Pengalihan Arus"
											placeholder="Ruas jalan yang dialihkan, titik kantong parkir, dan imbauan bagi pengendara..."
											value={formState.trafficImpactDescription}
											onChange={(val) =>
												updateField("trafficImpactDescription", val)
											}
											rows={3}
											maxLength={2000}
											width="100%"
										/>
										{activeExtraction?.outputJson ? (
											<HStack justify="between" vAlign="center" wrap="wrap" gap={2}>
												<FieldReviewIndicator
													state={
														getFieldReviewStatus(
															activeExtraction.outputJson.traffic_impact_description,
															formState.trafficImpactDescription,
														).state
													}
												/>
												{activeExtraction.outputJson.traffic_impact_description?.evidence ? (
													<Text size="xsm" type="supporting">
														Bukti rekayasa jalan: &quot;{activeExtraction.outputJson.traffic_impact_description.evidence}&quot;
													</Text>
												) : null}
											</HStack>
										) : null}
									</VStack>

									<Grid columns={{ minWidth: 220, max: 2 }} gap={4}>
										<TextInput
											label="Panitia Penyelenggara"
											placeholder="Contoh: Prajuru Banjar Sambahan"
											value={formState.organizerName}
											onChange={(val) => updateField("organizerName", val)}
											startIcon={Users}
											width="100%"
										/>
										<TextInput
											label="Kontak Informasi / Narahubung"
											placeholder="Contoh: 0812-3456-7890 (I Made Subrata)"
											value={formState.contactInformation}
											onChange={(val) => updateField("contactInformation", val)}
											width="100%"
										/>
									</Grid>
								</FormLayout>
							</VStack>
						) : null}

						{/* STEP 2: PETA & RUAS JALAN TERDAMPAK */}
						{activeStep === 2 ? (
							<VStack gap={4}>
								<HStack justify="between" vAlign="center" wrap="wrap" gap={2}>
									<VStack gap={1}>
										<Heading level={2}>Ruas Jalan & Rencana Penutupan</Heading>
										<Text type="supporting" size="sm">
											Pilih ruas jalan terverifikasi yang dilalui iring-iringan
											upacara atau diberlakukan penutupan sementara.
										</Text>
									</VStack>
									<Token
										color="gray"
										size="sm"
										label="Katalog Ruas Terverifikasi"
									/>
								</HStack>

								<BaliMapTilerView village={wizardSpatialProfile} height={320} />

								<VStack gap={3}>
									<Heading level={3}>Tambah Ruas Jalan Terdampak</Heading>
									<Grid columns={{ minWidth: 260, max: 2 }} gap={3}>
										<Selector
											label="Pilih Ruas Jalan Terverifikasi"
											placeholder="Pilih dari katalog jalan..."
											value={selectedRoadSegmentId}
											onChange={setSelectedRoadSegmentId}
											options={
												roadSegmentsQuery.data?.segments.map((s) => ({
													value: s.id,
													label: `${s.displayName} (${s.coverageArea})`,
												})) ?? []
											}
										/>
										<Selector
											label="Rencana Dampak Operasional"
											value={selectedImpactType}
											onChange={(val) =>
												setSelectedImpactType(
													val as typeof selectedImpactType,
												)
											}
											options={IMPACT_TYPE_OPTIONS}
										/>
									</Grid>
									<HStack vAlign="end" paddingBlockEnd={1}>
										<Button
											variant="secondary"
											size="md"
											label="Tautkan Ruas Jalan"
											icon={<Icon icon={Plus} size="sm" />}
											isDisabled={!selectedRoadSegmentId || !isRealUuidEvent}
											isLoading={addRoadImpactMutation.isPending}
											onClick={() => {
												if (selectedRoadSegmentId) {
													void addRoadImpactMutation.mutateAsync(
														selectedRoadSegmentId,
													);
												}
											}}
										/>
									</HStack>
								</VStack>

								<Divider variant="subtle" />

								<Heading level={3}>Ruas Jalan yang Direncanakan Ditutup</Heading>
								{eventRoadImpactsQuery.data?.roadImpacts &&
								eventRoadImpactsQuery.data.roadImpacts.length > 0 ? (
									<List hasDividers density="balanced">
										{eventRoadImpactsQuery.data.roadImpacts.map((imp) => (
											<ListItem
												key={imp.id}
												startContent={<Icon icon={MapPinned} size="sm" />}
												label={imp.displayName || "Ruas Jalan Terverifikasi"}
												description={`${imp.coverageArea || "Kawasan"} • ${getImpactTypeLabel(imp.impactType)} • ${formatWitaRange(imp.plannedFrom, imp.plannedTo)}`}
												endContent={
													<RoadStatusBadge
														status={
															imp.operationalStatus?.effectiveStatus ===
															"unconfirmed"
																? "unknown"
																: (imp.operationalStatus?.effectiveStatus ??
																	"closed")
														}
													/>
												}
											/>
										))}
									</List>
								) : (
									<EmptyStateCard
										title={SYSTEM_STATE_MESSAGES.noMatchingRoad.title}
										description={SYSTEM_STATE_MESSAGES.noMatchingRoad.description}
									/>
								)}
							</VStack>
						) : null}

						{/* STEP 3: TERBITKAN KEGIATAN */}
						{activeStep === 3 ? (
							<VStack gap={4}>
								<VStack gap={1}>
									<Heading level={2}>Verifikasi & Terbitkan ke Warga</Heading>
									<Text type="supporting" size="sm">
										Pastikan seluruh data telah diperiksa oleh Prajuru Adat.
										Kegiatan yang telah diverifikasi dapat resmi diumumkan kepada
										masyarakat luas.
									</Text>
								</VStack>

								<MetadataList columns={2}>
									<MetadataListItem label="Nama Upacara">
										{formState.title.trim() || "Belum diisi"}
									</MetadataListItem>
									<MetadataListItem label="Lokasi & Rute">
										{formState.venueName.trim() || "Belum diisi"}
									</MetadataListItem>
									<MetadataListItem label="Jadwal (WITA)">
										{previewStartsIso && previewEndsIso
											? formatWitaRange(previewStartsIso, previewEndsIso)
											: "Belum lengkap"}
									</MetadataListItem>
									<MetadataListItem label="Nomor Surat / Izin">
										{formState.permitReference.trim() || "-"}
									</MetadataListItem>
									<MetadataListItem label="Penyelenggara">
										{formState.organizerName.trim() || "-"}
									</MetadataListItem>
									<MetadataListItem label="Narahubung">
										{formState.contactInformation.trim() || "-"}
									</MetadataListItem>
								</MetadataList>

								{formState.trafficImpactDescription ? (
									<Banner
										status="info"
										collapsible={false}
										title="Imbauan Lalu Lintas"
										description={formState.trafficImpactDescription}
									/>
								) : null}

								<Divider variant="subtle" />

								<HStack gap={2} wrap="wrap" justify="between" vAlign="center">
									<Token
										color={loadedEvent?.verifiedAt ? "green" : "orange"}
										size="sm"
										label={
											loadedEvent?.verifiedAt
												? `Diverifikasi Prajuru pada ${formatWitaDateTime(loadedEvent.verifiedAt)}`
												: "Wajib verifikasi Prajuru sebelum diterbitkan"
										}
									/>

									<HStack gap={2} wrap="wrap">
										<Button
											variant="secondary"
											size="md"
											label="Tandai Diperiksa Prajuru"
											icon={<Icon icon={CheckCircle2} size="sm" />}
											isDisabled={!isRealUuidEvent}
											isLoading={reviewMutation.isPending}
											onClick={() => {
												void reviewMutation.mutateAsync();
											}}
										/>
										<Button
											variant="primary"
											size="md"
											label="Terbitkan ke Warga"
											icon={<Icon icon={Send} size="sm" />}
											isDisabled={
												!isRealUuidEvent ||
												(!loadedEvent?.verifiedAt &&
													currentLifecycleStatus !== "review")
											}
											onClick={() => {
												setIsPublishDialogOpen(true);
											}}
										/>
									</HStack>
								</HStack>

								{isRealUuidEvent && currentLifecycleStatus !== "cancelled" ? (
									<>
										<Divider variant="subtle" />
										<HStack justify="end">
											<Button
												variant="destructive"
												size="sm"
												label="Batalkan Pengumuman"
												icon={<Icon icon={Trash2} size="sm" />}
												isLoading={cancelMutation.isPending}
												onClick={() => {
													void cancelMutation.mutateAsync();
												}}
											/>
										</HStack>
									</>
								) : null}
							</VStack>
						) : null}
					</VStack>

					<AlertDialog
						isOpen={isPublishDialogOpen}
						onOpenChange={setIsPublishDialogOpen}
						onAction={() => {
							void publishMutation.mutateAsync();
						}}
						title="Umumkan Kegiatan ke Warga?"
						description="Jadwal upacara dan status penutupan jalan akan resmi diterbitkan ke portal publik desa. Pastikan data telah sesuai dengan surat edaran."
						actionLabel="Ya, Terbitkan"
						cancelLabel="Batal"
						actionVariant="primary"
						isActionLoading={publishMutation.isPending}
					/>
				</LayoutContent>
			}
			footer={
				<LayoutFooter hasDivider>
					<HStack justify="between" vAlign="center" width="100%">
						<Button
							variant="secondary"
							size="md"
							label="Sebelumnya"
							icon={<Icon icon={ArrowLeft} size="sm" />}
							isDisabled={activeStep === 0}
							onClick={() => setActiveStep((prev) => Math.max(0, prev - 1))}
						/>

						<HStack gap={2}>
							<Button
								variant="secondary"
								size="md"
								label="Simpan Draf"
								icon={<Icon icon={Save} size="sm" />}
								isLoading={saveDraftMutation.isPending}
								onClick={() => {
									void saveDraftMutation.mutateAsync();
								}}
							/>

							{activeStep < WIZARD_STEPS.length - 1 ? (
								<Button
									variant="primary"
									size="md"
									label="Lanjut"
									icon={<Icon icon={ArrowRight} size="sm" />}
									onClick={() =>
										setActiveStep((prev) =>
											Math.min(WIZARD_STEPS.length - 1, prev + 1),
										)
									}
								/>
							) : (
								<Button
									variant="primary"
									size="md"
									label="Terbitkan"
									icon={<Icon icon={Send} size="sm" />}
									isDisabled={!isRealUuidEvent}
									onClick={() => setIsPublishDialogOpen(true)}
								/>
							)}
						</HStack>
					</HStack>
				</LayoutFooter>
			}
		/>
	);
}
