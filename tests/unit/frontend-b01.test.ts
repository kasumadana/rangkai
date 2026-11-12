import { describe, expect, it } from "vitest";
import { ApiClientError, apiFetch } from "../../src/react-app/lib/api-client";
import {
	MAPTILER_API_KEY,
	MAPTILER_STYLE_URL,
} from "../../src/react-app/lib/bali-villages";
import { BALI_DISTRICTS_DATA } from "../../src/react-app/lib/bali-districts";
import {
	OPERATIONAL_DISCLAIMERS,
	UX_EMPTY_COPY,
} from "../../src/react-app/lib/constants";
import {
	buildDistrictFeaturesFromEvents,
	createEventDraft,
	fromIsoToWitaInput,
	mapPublicEventToCeremonyProfile,
	normalizeEventCategory,
	normalizeRoadImpactType,
	toWitaIsoTimestamp,
} from "../../src/react-app/lib/events-api";
import { createRoadSegmentSchema } from "../../src/worker/validators/roads";
import { getRoadStatusPresentation } from "../../src/react-app/lib/road-status";
import {
	WITA_LABEL,
	WITA_TIMEZONE,
	formatRelativeAgeId,
	formatWitaDateTime,
	formatWitaRange,
	isTimestampExpired,
} from "../../src/react-app/lib/wita";

describe("B01 Frontend Foundation & Rangkai UI Domain Helpers", () => {
	it("preserves disconnected road parts without joining invalid coordinates", () => {
		const event = { id: "event", title: "Latihan", slug: "latihan", category: null, description: null, venueName: null, startsAt: null, endsAt: null, status: "active", publishedAt: null, organizationName: "Organisasi", village: "Bali", district: "Bali" };
		const road = { id: "road", roadSegmentId: "segment", plannedFrom: null, plannedTo: null, impactType: "closure" as const, diversionNote: null, geometry: { type: "MultiLineString", coordinates: [[[115.1, -8.1], [115.2, -8.2]], [[115.3, -8.3], [115.4, -8.4]], [[115.5, -8.5], [null, -8.6], [115.7, -8.7]]] } };
		const segment = mapPublicEventToCeremonyProfile(event, [road]).roadSegments[0];
		expect(segment.coordinateParts).toEqual([[[115.1, -8.1], [115.2, -8.2]], [[115.3, -8.3], [115.4, -8.4]]]);
		const profile = mapPublicEventToCeremonyProfile(event, [road]);
		expect(profile.alternativeRoutes).toEqual([]);
		expect(profile.alternativeRouteSummary).toBe("Belum ada informasi jalur alternatif.");
	});
	it("does not summarize mixed open and unconfirmed roads as open", () => {
		const event = { id: "event", title: "Latihan", slug: "latihan", category: null, description: null, venueName: null, startsAt: null, endsAt: null, status: "active", publishedAt: null, organizationName: "Organisasi", village: "Bali", district: "Bali" };
		const road = { id: "open", roadSegmentId: "road", plannedFrom: null, plannedTo: null, impactType: "closure" as const, diversionNote: null, operationalStatus: { effectiveStatus: "open" as const, rawStatus: "open" as const, isStale: false, observedAt: null, expiresAt: "2099-01-01T00:00:00Z" } };
		expect(mapPublicEventToCeremonyProfile(event, [road]).primaryStatus).toBe("open");
		expect(mapPublicEventToCeremonyProfile(event, [road, { ...road, id: "stale", operationalStatus: { ...road.operationalStatus, isStale: true } }]).primaryStatus).toBe("unknown");
		expect(mapPublicEventToCeremonyProfile(event, [{ ...road, operationalStatus: { ...road.operationalStatus, expiresAt: null } }]).primaryStatus).toBe("unknown");
	});
	it("keeps missing or stale status unconfirmed and treats missing mode as simulation", () => {
		const event = { id: "event", title: "Latihan", slug: "latihan", category: null, description: null, venueName: null, startsAt: null, endsAt: null, status: "active", publishedAt: null, organizationName: "Organisasi", village: "Bali", district: "Bali" };
		const profile = mapPublicEventToCeremonyProfile(event, [{ id: "impact", roadSegmentId: "road", plannedFrom: null, plannedTo: null, impactType: "closure", diversionNote: null, operationalStatus: { effectiveStatus: "unconfirmed", rawStatus: "open", isStale: true, observedAt: null, expiresAt: null } }]);
		expect(profile.primaryStatus).toBe("unknown");
		expect(profile.roadSegments[0].status).toBe("unknown");
		expect(profile.isSimulation).toBe(true);
		expect(mapPublicEventToCeremonyProfile(event).primaryStatus).toBe("unknown");
	});
	it("formats UTC timestamps into Asia/Makassar (WITA, UTC+8) accurately", () => {
		expect(WITA_TIMEZONE).toBe("Asia/Makassar");
		expect(WITA_LABEL).toBe("WITA");
		expect(formatWitaRange(null, null)).toBe("Jadwal belum ditentukan");

		const formatted = formatWitaDateTime("2026-11-05T01:30:00Z");
		expect(formatted).toContain("2026");
		expect(formatted).toContain("09.30");
		expect(formatted).toContain("WITA");

		const range = formatWitaRange(
			"2026-11-05T00:00:00Z",
			"2026-11-05T04:00:00Z",
		);
		expect(range).toContain("08.00–12.00 WITA");
	});

	it("detects expired road status timestamps without converting to open", () => {
		const now = new Date("2026-11-05T06:00:00Z");
		expect(isTimestampExpired("2026-11-05T05:59:59Z", now)).toBe(true);
		expect(isTimestampExpired("2026-11-05T06:00:00Z", now)).toBe(true);
		expect(isTimestampExpired("2026-11-05T06:15:00Z", now)).toBe(false);
		expect(isTimestampExpired(null, now)).toBe(false);

		expect(formatRelativeAgeId("2026-11-05T05:45:00Z", now)).toBe(
			"15 menit lalu",
		);
	});

	it("maps all 4 operational road statuses to distinct labels and variants", () => {
		const open = getRoadStatusPresentation("open");
		const intermittent = getRoadStatusPresentation("intermittent");
		const closed = getRoadStatusPresentation("closed");
		const unknown = getRoadStatusPresentation("unknown");

		expect(open.code).toBe("OPEN");
		expect(open.tokenColor).toBe("green");
		expect(open.summary).toContain("kepadatan");

		expect(intermittent.code).toBe("INTERMITTENT");
		expect(intermittent.tokenColor).toBe("orange");

		expect(closed.code).toBe("CLOSED");
		expect(closed.tokenColor).toBe("red");

		expect(unknown.code).toBe("UNKNOWN");
		expect(unknown.tokenColor).toBe("gray");
	});

	it("preserves exact canonical UX-FLOW §7 empty and error state messages", () => {
		expect(UX_EMPTY_COPY.NO_PUBLISHED_EVENTS).toBe(
			"Belum ada kegiatan yang dipublikasikan.",
		);
		expect(UX_EMPTY_COPY.NO_MATCHING_ROAD).toBe(
			"Ruas jalan belum ditemukan. Pilih secara manual.",
		);
		expect(UX_EMPTY_COPY.AI_UNAVAILABLE).toBe(
			"Ekstraksi otomatis belum tersedia. Isi data secara manual.",
		);
		expect(UX_EMPTY_COPY.STALE_STATUS).toBe(
			"Status terakhir belum dikonfirmasi ulang.",
		);
		expect(UX_EMPTY_COPY.MAP_UNAVAILABLE).toBe(
			"Peta tidak tersedia. Informasi jalan tetap dapat dibaca.",
		);
		expect(UX_EMPTY_COPY.UPLOAD_FAILED).toBe(
			"Dokumen belum tersimpan. Coba unggah kembali.",
		);
		expect(OPERATIONAL_DISCLAIMERS.CLEANUP_INDEPENDENCE_NOTE).toContain(
			"independen",
		);
	});

	it("parses structured API error envelopes into ApiClientError with requestId", async () => {
		const originalFetch = globalThis.fetch;
		globalThis.fetch = async () =>
			new Response(
				JSON.stringify({
					error: {
						code: "FORBIDDEN",
						message: "You cannot update this road status.",
						requestId: "req_test_123",
					},
				}),
				{
					status: 403,
					headers: {
						"Content-Type": "application/json",
						"x-request-id": "req_test_123",
					},
				},
			);

		try {
			await expect(apiFetch("/api/events")).rejects.toThrowError(ApiClientError);
			await apiFetch("/api/events").catch((err: unknown) => {
				expect(err).toBeInstanceOf(ApiClientError);
				const apiErr = err as ApiClientError;
				expect(apiErr.status).toBe(403);
				expect(apiErr.code).toBe("FORBIDDEN");
				expect(apiErr.requestId).toBe("req_test_123");
			});
		} finally {
			globalThis.fetch = originalFetch;
		}
	});

	it("converts WITA form inputs to explicit +08:00 ISO 8601 and back (B03)", () => {
		expect(toWitaIsoTimestamp("2026-11-14T16:00")).toBe(
			"2026-11-14T16:00:00+08:00",
		);
		expect(toWitaIsoTimestamp("2026-11-14 16:30")).toBe(
			"2026-11-14T16:30:00+08:00",
		);
		expect(toWitaIsoTimestamp("2026-11-14T08:00:00Z")).toBe(
			"2026-11-14T08:00:00Z",
		);
		expect(toWitaIsoTimestamp("")).toBeNull();

		// 08:00 UTC is 16:00 WITA (Asia/Makassar)
		expect(fromIsoToWitaInput("2026-11-14T08:00:00.000Z")).toBe(
			"2026-11-14T16:00",
		);
	});

	it("sends POST /api/events with application/json payload for draft creation (B03)", async () => {
		const originalFetch = globalThis.fetch;
		let capturedBody: Record<string, unknown> = {};
		let capturedContentType = "";

		globalThis.fetch = async (_input, init) => {
			const headers = new Headers(init?.headers);
			capturedContentType = headers.get("Content-Type") || "";
			capturedBody = JSON.parse(String(init?.body || "{}"));
			return new Response(
				JSON.stringify({
					event: {
						id: "550e8400-e29b-41d4-a716-446655440000",
						organizationId: "11111111-2222-4333-8444-555555555555",
						createdBy: "usr_1",
						title: "Upacara Melasti Desa Adat",
						venueName: "Pura Segara",
						startsAt: "2026-11-14T08:00:00.000Z",
						endsAt: "2026-11-14T14:00:00.000Z",
						status: "draft",
						createdAt: "2026-11-04T00:00:00.000Z",
						updatedAt: "2026-11-04T00:00:00.000Z",
					},
				}),
				{
					status: 201,
					headers: { "Content-Type": "application/json" },
				},
			);
		};

		try {
			const result = await createEventDraft({
				organizationId: "11111111-2222-4333-8444-555555555555",
				title: "Upacara Melasti Desa Adat",
				venueName: "Pura Segara",
				startsAt: toWitaIsoTimestamp("2026-11-14T16:00"),
				endsAt: toWitaIsoTimestamp("2026-11-14T22:00"),
			});

			expect(capturedContentType).toBe("application/json");
			expect(capturedBody?.title).toBe("Upacara Melasti Desa Adat");
			expect(capturedBody?.startsAt).toBe("2026-11-14T16:00:00+08:00");
			expect(result.event.status).toBe("draft");
		} finally {
			globalThis.fetch = originalFetch;
		}
	});

	it("contains zero static dummy ceremonies in BALI_DISTRICTS_DATA and populates ceremonies strictly from backend events", () => {
		for (const feature of BALI_DISTRICTS_DATA.features) {
			expect(feature.properties.hasCeremony).toBe(false);
			expect(feature.properties.ceremonyCount).toBe(0);
			expect(feature.properties.ceremonies).toEqual([]);
		}

		const emptyBuilt = buildDistrictFeaturesFromEvents([]);
		expect(emptyBuilt.features.every((f) => f.properties.ceremonyCount === 0)).toBe(true);
	});

	it("provides valid MapTiler configuration and maps backend event profiles accurately", () => {
		expect(typeof MAPTILER_API_KEY).toBe("string");
		if (MAPTILER_API_KEY) {
			expect(MAPTILER_STYLE_URL).toContain("api.maptiler.com");
		}

		const profile = mapPublicEventToCeremonyProfile(
			{
				id: "evt-ubud-1",
				title: "Karya Pujawali Pura Dalem Ubud",
				slug: "pujawali-ubud",
				category: "pujawali",
				description: "Upacara pujawali",
				venueName: "Pura Dalem Ubud",
				venueLocation: { type: "Point", coordinates: [115.2625, -8.5069] },
				startsAt: "2026-11-14T00:00:00Z",
				endsAt: "2026-11-14T05:30:00Z",
				status: "published",
				publishedAt: "2026-11-10T00:00:00Z",
				organizationName: "Desa Adat Ubud",
				village: "Ubud",
				district: "Ubud",
				isSimulation: false,
			},
			[
				{
					id: "road-1",
					roadSegmentId: "seg-1",
					displayName: "Jl. Raya Ubud",
					plannedFrom: "2026-11-14T00:00:00Z",
					plannedTo: "2026-11-14T05:30:00Z",
					impactType: "closure",
					diversionNote: "Dialihkan ke Jl. Sugriwa",
					geometry: {
						type: "LineString",
						coordinates: [
							[115.261, -8.5068],
							[115.264, -8.507],
						],
					},
				},
			],
		);

		expect(profile.desaAdatName).toContain("Desa Adat Ubud");
		expect(profile.venueLocation).toEqual([115.2625, -8.5069]);
		expect(profile.mapCenter[0]).toBeGreaterThan(114.5);
		expect(profile.mapCenter[0]).toBeLessThan(115.8);
		expect(profile.mapCenter[1]).toBeGreaterThan(-9.0);
		expect(profile.mapCenter[1]).toBeLessThan(-8.0);
		expect(profile.roadSegments[0]?.coordinates.length).toBe(2);
	});

	it("validates human-verified map-drawn road segments and normalizes enums for backend contracts", () => {
		const validSegment = createRoadSegmentSchema.safeParse({
			displayName: "Jl. Raya Ubud — Depan Puri Saren",
			coverageArea: "Ubud, Gianyar",
			coordinates: [
				[115.2612, -8.5068],
				[115.2645, -8.5069],
			],
			humanVerified: true,
		});
		expect(validSegment.success).toBe(true);

		// Rejects identical coordinates (zero-length line)
		const zeroLength = createRoadSegmentSchema.safeParse({
			displayName: "Jl. Raya Ubud",
			coverageArea: "Ubud",
			coordinates: [
				[115.2612, -8.5068],
				[115.2612, -8.5068],
			],
			humanVerified: true,
		});
		expect(zeroLength.success).toBe(false);

		// Normalizes legacy and canonical road impact types & event categories
		expect(normalizeRoadImpactType("full_closure")).toBe("closure");
		expect(normalizeRoadImpactType("partial_closure")).toBe("intermittent");
		expect(normalizeRoadImpactType("one_way")).toBe("narrowing");
		expect(normalizeRoadImpactType("speed_reduction")).toBe("procession");
		expect(normalizeRoadImpactType("closure")).toBe("closure");

		expect(normalizeEventCategory("prosesi")).toBe("procession");
		expect(normalizeEventCategory("ngaben")).toBe("upacara_adat");
		expect(normalizeEventCategory("melasti")).toBe("melasti");
	});

	it("preserves simulation flag truthfully across mapper and district feature builder (SPEC-1, STD-1)", () => {
		const baseEvent = {
			id: "evt-sim-check",
			title: "Upacara Melasti",
			slug: "melasti-check",
			category: null,
			description: null,
			venueName: "Pantai Sanur",
			startsAt: null,
			endsAt: null,
			status: "published",
			publishedAt: null,
			organizationName: "Desa Adat Sanur",
			village: "Sanur",
			district: "Denpasar Selatan",
		};

		// 1. Explicit true: preserves simulation true
		const profileSimTrue = mapPublicEventToCeremonyProfile({ ...baseEvent, isSimulation: true });
		expect(profileSimTrue.isSimulation).toBe(true);

		// 2. Explicit false: preserves genuine operational event (does not force simulated)
		const profileSimFalse = mapPublicEventToCeremonyProfile({ ...baseEvent, isSimulation: false });
		expect(profileSimFalse.isSimulation).toBe(false);

		// 3. Missing/undefined: fail-safe defaults to simulation true
		const profileSimMissing = mapPublicEventToCeremonyProfile({ ...baseEvent, isSimulation: undefined });
		expect(profileSimMissing.isSimulation).toBe(true);

		// 4. District Feature Builder propagation: verifies DistrictCeremonySummary preserves flag
		const districtFc = buildDistrictFeaturesFromEvents([profileSimTrue, profileSimFalse, profileSimMissing]);
		const sanurDistrict = districtFc.features.find((f) => f.properties.name.toLowerCase().includes("denpasar selatan"));
		expect(sanurDistrict).toBeDefined();
		const summaries = sanurDistrict!.properties.ceremonies;
		expect(summaries.length).toBe(3);

		// True case
		expect(summaries[0].isSimulation).toBe(true);
		// False case (explicit operational)
		expect(summaries[1].isSimulation).toBe(false);
		// Missing case (fail-safe defaults true)
		expect(summaries[2].isSimulation).toBe(true);
		expect(summaries.every((summary) => summary.hasVenueLocation === false)).toBe(true);

		const point: [number, number] = [115.263, -8.685];
		const located = mapPublicEventToCeremonyProfile({ ...baseEvent, id: "located", venueLocation: { type: "Point", coordinates: point } });
		const locatedDistrict = buildDistrictFeaturesFromEvents([located]).features.find((f) => f.properties.name.toLowerCase().includes("denpasar selatan"));
		expect(locatedDistrict?.properties.ceremonies[0]).toMatchObject({ hasVenueLocation: true, coordinates: point });
	});
});
