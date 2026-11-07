import { describe, expect, it } from "vitest";
import { ApiClientError, apiFetch } from "../../src/react-app/lib/api-client";
import {
	BALI_VILLAGE_CEREMONIES,
	MAPTILER_API_KEY,
	MAPTILER_STYLE_URL,
	buildBaliVillageMapSvgDataUri,
} from "../../src/react-app/lib/bali-villages";
import {
	OPERATIONAL_DISCLAIMERS,
	UX_EMPTY_COPY,
} from "../../src/react-app/lib/constants";
import {
	createEventDraft,
	fromIsoToWitaInput,
	toWitaIsoTimestamp,
} from "../../src/react-app/lib/events-api";
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
	it("formats UTC timestamps into Asia/Makassar (WITA, UTC+8) accurately", () => {
		expect(WITA_TIMEZONE).toBe("Asia/Makassar");
		expect(WITA_LABEL).toBe("WITA");

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

	it("generates Bali Desa Adat ceremony profiles and SVG corridor maps with road status routes", () => {
		expect(BALI_VILLAGE_CEREMONIES.length).toBeGreaterThanOrEqual(4);
		const ubud = BALI_VILLAGE_CEREMONIES[0];
		expect(ubud.desaAdatName).toContain("Desa Adat Ubud");
		expect(ubud.roadSegments.length).toBeGreaterThanOrEqual(3);

		const svgUri = buildBaliVillageMapSvgDataUri(
			ubud,
			ubud.roadSegments[0]?.id,
		);
		expect(svgUri.startsWith("data:image/svg+xml;utf8,")).toBe(true);
		const decodedSvg = decodeURIComponent(
			svgUri.replace("data:image/svg+xml;utf8,", ""),
		);
		expect(decodedSvg).toContain("Pura Dalem Ubud");
		expect(decodedSvg).toContain("Jl. Raya Ubud");
	});

	it("provides valid MapTiler configuration and comprehensive village allocation data (parking, notices, pecalang)", () => {
		expect(typeof MAPTILER_API_KEY).toBe("string");
		if (MAPTILER_API_KEY) {
			expect(MAPTILER_STYLE_URL).toContain("api.maptiler.com");
		}

		for (const village of BALI_VILLAGE_CEREMONIES) {
			// Center coordinates in Bali: lat between -9.0 and -8.0, lon between 114.5 and 115.8
			expect(village.mapCenter[0]).toBeGreaterThan(114.5);
			expect(village.mapCenter[0]).toBeLessThan(115.8);
			expect(village.mapCenter[1]).toBeGreaterThan(-9.0);
			expect(village.mapCenter[1]).toBeLessThan(-8.0);

			// Road segments have valid GeoJSON coordinates
			for (const seg of village.roadSegments) {
				expect(seg.coordinates.length).toBeGreaterThanOrEqual(2);
			}

			// Village allocation & citizen data
			expect(village.parkingLots.length).toBeGreaterThanOrEqual(2);
			expect(village.pecalangPosts.length).toBeGreaterThanOrEqual(2);
			expect(village.communityNotices.length).toBeGreaterThanOrEqual(2);
		}
	});
});
