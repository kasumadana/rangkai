import { describe, expect, it, vi } from "vitest";
import type { BaliVillageCeremonyProfile } from "../../src/react-app/lib/bali-villages";
import {
	buildFallbackRoadGeometry,
	buildGoogleMapsNavigationUrl,
	calculateUserBypassRoute,
	deriveDefaultSimulatedUserOrigin,
	doesPathIntersectCorridor,
	generateBypassWaypointsForClosure,
	isWithinBaliBounds,
	snapCoordinatesToRoad,
} from "../../src/react-app/lib/routing-engine";

const mockCeremony: BaliVillageCeremonyProfile = {
	id: "evt-catur-muka-1",
	isSimulation: true,
	slug: "simulasi-pengerupukan-catur-muka-denpasar",
	desaAdatName: "Banjar Uji Coba (Simulasi)",
	kabupaten: "Kota Denpasar",
	kecamatan: "Denpasar Utara",
	ceremonyTitle: "[SIMULATED] Pawai Ogoh-Ogoh & Pengerupukan Catur Muka Denpasar",
	yadnyaCategory: "pengerupukan",
	sacredCenterName: "Simpang Patung Catur Muka Denpasar",
	destinationName: "Simpang Patung Catur Muka Denpasar",
	participatingBanjars: ["Desa Simulasi"],
	scheduleDateLabel: "Kamis, 12 November 2026",
	scheduleWindowWita: "14.00–22.00 WITA",
	scheduleIso: {
		startsAt: "2026-11-12T06:00:00.000Z",
		endsAt: "2026-11-12T14:00:00.000Z",
	},
	coordinatorName: "Simulated Organizer",
	primaryStatus: "closed",
	overview: "Simulasi koordinasi pengalihan arus lalu lintas.",
	alternativeRouteSummary:
		"Pengendara dialihkan melalui Jl. Kartini - Jl. Pulau Sulawesi - Jl. Sumatra.",
	mapCenter: [115.2169, -8.6559],
	venueLocation: [115.2169, -8.6559],
	mapZoom: 14.2,
	puraPoint: {
		name: "Simpang Patung Catur Muka Denpasar",
		coordinates: [115.2169, -8.6559],
		description: "Simulasi",
	},
	destinationPoint: {
		name: "Simpang Patung Catur Muka Denpasar",
		coordinates: [115.2169, -8.6559],
		description: "Simulasi",
	},
	roadSegments: [
		{
			id: "road-gajah-mada",
			roadName: "[SIMULATED] Jl. Gajah Mada (Catur Muka - Pasar Badung)",
			corridorSection: "Denpasar Kota - Kawasan Catur Muka",
			roleInCeremony: "rute_utama",
			roleLabel: "Penutupan Penuh",
			status: "closed",
			windowWita: "14.00–22.00 WITA",
			pecalangPost: "Banjar Uji Coba",
			lastConfirmedLabel: "Baru saja",
			guidanceNote: "Dialihkan melalui Jl. Kartini - Jl. Pulau Sulawesi",
			coordinates: [
				[115.2167834, -8.6559512],
				[115.2107577, -8.6550978],
			],
			svgPath: "M 0 0 L 10 10",
			labelPoint: { x: 0, y: 0 },
		},
	],
	alternativeRoutes: [
		{
			id: "alt-kartini-sulawesi",
			name: "Jalur Pengalihan Jl. Kartini – Jl. Pulau Sulawesi – Jl. Sumatra",
			description: "Jalur alternatif terbuka mengitari Catur Muka",
			coordinates: [
				[115.2175116, -8.6491073],
				[115.2135509, -8.6474272],
				[115.2131184, -8.6553752],
				[115.2130287, -8.6563553],
				[115.2133182, -8.6585869],
			],
		},
	],
	parkingLots: [],
	pecalangPosts: [],
	communityNotices: [],
	mapGeometry: {
		riverPath: "",
		riverLabel: "",
		riverLabelPos: { x: 0, y: 0 },
		backgroundRoads: [],
		puraPoint: { x: 0, y: 0, label: "" },
		destinationPoint: { x: 0, y: 0, label: "" },
		banjarPoints: [],
		coordinatesLabel: "8.6559° S, 115.2169° E",
	},
};

describe("Routing Engine (Alternative Route & User Location Guidance)", () => {
	it("validates Bali coordinate bounds accurately", () => {
		expect(isWithinBaliBounds([115.2169, -8.6559])).toBe(true);
		expect(isWithinBaliBounds([106.8456, -6.2088])).toBe(false);
	});

	it("detects when a candidate route intersects a closed road corridor", () => {
		const closedCorridor: Array<[number, number]> = [
			[115.2167834, -8.6559512],
			[115.2107577, -8.6550978],
		];
		const intersectingPath: Array<[number, number]> = [
			[115.2138, -8.6555],
			[115.2139, -8.6556],
		];
		const safeDetourPath: Array<[number, number]> = [
			[115.2175, -8.6491],
			[115.2135, -8.6474],
		];

		expect(doesPathIntersectCorridor(intersectingPath, closedCorridor, 60)).toBe(
			true,
		);
		expect(doesPathIntersectCorridor(safeDetourPath, closedCorridor, 60)).toBe(
			false,
		);
	});

	it("generates road-following bypass waypoints around a closed road segment", () => {
		const closedCoords: Array<[number, number]> = [
			[115.2167834, -8.6559512],
			[115.2107577, -8.6550978],
		];
		const waypoints = generateBypassWaypointsForClosure(closedCoords);
		expect(waypoints.length).toBeGreaterThanOrEqual(4);
		for (const pt of waypoints) {
			expect(isWithinBaliBounds(pt)).toBe(true);
		}

		const fallbackGeom = buildFallbackRoadGeometry(waypoints);
		expect(fallbackGeom.coordinates.length).toBeGreaterThanOrEqual(4);
	});

	it("derives a simulated user origin inside Bali near the ceremony", () => {
		const origin = deriveDefaultSimulatedUserOrigin(mockCeremony);
		expect(isWithinBaliBounds(origin)).toBe(true);
	});

	it("calculates a green user bypass route that avoids closed roads and uses approved alternative routes", async () => {
		// Stub fetch to simulate offline/fallback deterministic routing without external network flakiness
		const fetchSpy = vi
			.spyOn(globalThis, "fetch")
			.mockRejectedValue(new Error("offline"));

		try {
			const userOrigin = deriveDefaultSimulatedUserOrigin(mockCeremony);
			const guidance = await calculateUserBypassRoute({
				userOrigin,
				ceremony: mockCeremony,
			});

			expect(guidance.coordinates.length).toBeGreaterThanOrEqual(3);
			expect(guidance.coordinates[0]).toEqual(userOrigin);
			expect(guidance.avoidedRoadNames).toContain(
				"[SIMULATED] Jl. Gajah Mada (Catur Muka - Pasar Badung)",
			);
			expect(guidance.routeName).toContain("Jalur Pengalihan");
			expect(guidance.distanceMeters).toBeGreaterThan(100);
			expect(guidance.estimatedMinutes).toBeGreaterThanOrEqual(1);
			expect(guidance.googleMapsUrl).toContain(
				"https://www.google.com/maps/dir/?api=1",
			);
		} finally {
			fetchSpy.mockRestore();
		}
	});

	it("snaps coordinates to road geometry with graceful fallback", async () => {
		const fetchSpy = vi
			.spyOn(globalThis, "fetch")
			.mockRejectedValue(new Error("offline"));

		try {
			const snapped = await snapCoordinatesToRoad([
				[115.2598, -8.5066],
				[115.2654, -8.5072],
			]);
			expect(snapped.source).toBe("fallback");
			expect(snapped.coordinates.length).toBeGreaterThanOrEqual(2);
			expect(snapped.distanceMeters).toBeGreaterThan(100);
		} finally {
			fetchSpy.mockRestore();
		}
	});

	it("builds a Google Maps turn-by-turn URL with origin, destination, and waypoints", () => {
		const url = buildGoogleMapsNavigationUrl(
			[115.218, -8.65],
			[115.213, -8.658],
			[[115.2135, -8.6474]],
		);
		expect(url).toContain("origin=-8.65%2C115.218");
		expect(url).toContain("destination=-8.658%2C115.213");
		expect(url).toContain("waypoints=-8.6474%2C115.2135");
	});
});
