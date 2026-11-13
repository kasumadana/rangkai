import { describe, expect, it, vi } from "vitest";
import type { BaliVillageCeremonyProfile } from "../../src/react-app/lib/bali-villages";
import {
	buildFallbackRoadGeometry,
	buildGoogleMapsNavigationUrl,
	calculateUserBypassRoute,
	deriveDefaultSimulatedUserOrigin,
	doesPathIntersectCorridor,
	generateBypassWaypointsForClosure,
	isActiveRoadClosure,
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

function guidanceResponse(
	coordinates: Array<[number, number]>,
	distanceMeters = 500,
	durationSeconds = 90,
): Response {
	return new Response(
		JSON.stringify({ coordinates, distanceMeters, durationSeconds }),
		{ status: 200, headers: { "Content-Type": "application/json" } },
	);
}

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

	it("treats confirmed open status as authoritative over planned closure impact", () => {
		expect(
			isActiveRoadClosure({ status: "open", impactType: "full_closure" }),
		).toBe(false);
		expect(
			isActiveRoadClosure({ status: "unknown", impactType: "full_closure" }),
		).toBe(true);
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

	it("does not present fallback guidance when ORS is unavailable", async () => {
		const fetchSpy = vi
			.spyOn(globalThis, "fetch")
			.mockRejectedValue(new Error("offline"));

		try {
			const userOrigin = deriveDefaultSimulatedUserOrigin(mockCeremony);
			const guidance = await calculateUserBypassRoute({
				userOrigin,
				ceremony: {
					...mockCeremony,
					alternativeRoutes: [
						{
							id: "approved-route-for-outage-test",
							name: "Jalur terverifikasi",
							coordinates: [
								[115.219, -8.65],
								[115.218, -8.647],
								[115.212, -8.647],
							] as Array<[number, number]>,
						},
					],
				},
			});

			expect(guidance).toBeNull();
			expect(fetchSpy).toHaveBeenCalledTimes(1);
			expect(fetchSpy.mock.calls[0]?.[0]).toBe("/api/public/routes/guidance");
		} finally {
			fetchSpy.mockRestore();
		}
	});

	it("rejects a candidate that crosses a second closed road", async () => {
		const userLocation: [number, number] = [115.214, -8.65];
		const primaryClosed = {
			...mockCeremony.roadSegments[0],
			id: "road-primary-far",
			coordinates: [
				[115.25, -8.65],
				[115.251, -8.65],
			] as Array<[number, number]>,
		};
		const secondClosed = {
			...mockCeremony.roadSegments[0],
			id: "road-second-crossing",
			roadName: "Jl. Penutup Kedua",
			coordinates: [
				[115.3, -8.7],
				[115.31, -8.7],
			] as Array<[number, number]>,
			coordinateParts: [
				[
					[115.3, -8.7],
					[115.31, -8.7],
				],
				[
					[115.216, -8.6495],
					[115.216, -8.6525],
				],
			] as Array<Array<[number, number]>>,
		};
		const candidateCoordinates: Array<[number, number]> = [
			userLocation,
			[115.215, -8.651],
			[115.218, -8.652],
		];
		const fetchSpy = vi
			.spyOn(globalThis, "fetch")
			.mockResolvedValue(guidanceResponse(candidateCoordinates));

		try {
			const guidance = await calculateUserBypassRoute({
				userLocation,
				ceremony: {
					...mockCeremony,
					roadSegments: [primaryClosed, secondClosed],
				},
			});

			expect(guidance).toBeNull();
		} finally {
			fetchSpy.mockRestore();
		}
	});

	it("does not provide guidance when the approved detour itself crosses a closure", async () => {
		const closedRoad = mockCeremony.roadSegments[0];
		const unsafeAlternative = {
			id: "alt-crosses-closed-road",
			name: "Jalur yang melintasi penutupan",
			coordinates: closedRoad.coordinates,
		};
		const fetchSpy = vi
			.spyOn(globalThis, "fetch")
			.mockResolvedValue(guidanceResponse(closedRoad.coordinates));

		try {
			const guidance = await calculateUserBypassRoute({
				userLocation: deriveDefaultSimulatedUserOrigin(mockCeremony),
				ceremony: {
					...mockCeremony,
					alternativeRoutes: [unsafeAlternative],
				},
			});

			expect(guidance).toBeNull();
		} finally {
			fetchSpy.mockRestore();
		}
	});

	it("chooses the shortest safe approved bypass instead of the first listed route", async () => {
		const longRoute = {
			id: "alt-long",
			name: "Jalur memutar",
			coordinates: [
				[115.221, -8.64],
				[115.219, -8.638],
				[115.214, -8.639],
				[115.21, -8.643],
				[115.21, -8.65],
			] as Array<[number, number]>,
		};
		const shortRoute = {
			id: "alt-short",
			name: "Jalur pintas",
			coordinates: [
				[115.217, -8.6542],
				[115.214, -8.6537],
				[115.211, -8.6533],
			] as Array<[number, number]>,
		};
		const fetchSpy = vi
			.spyOn(globalThis, "fetch")
			.mockImplementation(async (_input, init) => {
				const payload = JSON.parse(String(init?.body)) as {
					coordinates: Array<[number, number]>;
				};
				return guidanceResponse(payload.coordinates);
			});

		try {
			const guidance = await calculateUserBypassRoute({
				userLocation: deriveDefaultSimulatedUserOrigin(mockCeremony),
				ceremony: {
					...mockCeremony,
					alternativeRoutes: [longRoute, shortRoute],
				},
			});

			expect(guidance?.routeName).toBe(shortRoute.name);
		} finally {
			fetchSpy.mockRestore();
		}
	});

	it("returns a network route along the nearest approved bypass and beyond the closure", async () => {
		const userLocation: [number, number] = [115.205, -8.652];
		const closedRoad = {
			...mockCeremony.roadSegments[0],
			coordinates: [
				[115.21, -8.65],
				[115.22, -8.65],
			] as Array<[number, number]>,
		};
		const bypass = {
			id: "alt-north-bypass",
			name: "Jalur pintas sisi utara",
			coordinates: [
				[115.21, -8.648],
				[115.215, -8.6475],
				[115.22, -8.648],
			] as Array<[number, number]>,
		};
		const networkCoordinates: Array<[number, number]> = [
			userLocation,
			[115.207, -8.651],
			...bypass.coordinates,
			[115.2208, -8.65],
		];
		const fetchSpy = vi
			.spyOn(globalThis, "fetch")
			.mockImplementation(async () =>
				guidanceResponse(networkCoordinates, 2200, 270),
			);

		try {
			const guidance = await calculateUserBypassRoute({
				userLocation,
				ceremony: {
					...mockCeremony,
					roadSegments: [closedRoad],
					alternativeRoutes: [bypass],
				},
			});
			const repeatedGuidance = await calculateUserBypassRoute({
				userLocation,
				ceremony: {
					...mockCeremony,
					roadSegments: [closedRoad],
					alternativeRoutes: [bypass],
				},
			});

			expect(guidance).not.toBeNull();
			expect(repeatedGuidance).not.toBeNull();
			expect(fetchSpy).toHaveBeenCalledTimes(2);
			expect(
				fetchSpy.mock.calls.every(
					([input]) => String(input) === "/api/public/routes/guidance",
				),
			).toBe(true);
			const [, requestInit] = fetchSpy.mock.calls[0] ?? [];
			const requestBody = JSON.parse(String(requestInit?.body)) as {
				coordinates: Array<[number, number]>;
			};
			expect(requestInit?.method).toBe("POST");
			expect(requestBody.coordinates[0]).toEqual(userLocation);
			expect(requestBody.coordinates.length).toBeLessThanOrEqual(50);
			expect(requestBody.coordinates).toEqual(
				expect.arrayContaining(bypass.coordinates),
			);
			expect(guidance?.origin).toEqual(userLocation);
			expect(guidance?.routeName).toBe(bypass.name);
			expect(guidance?.isSimulation).toBe(true);
			expect(guidance?.destination[0]).toBeGreaterThan(115.22);
			expect(guidance?.source).toBe("ors");
			expect(
				doesPathIntersectCorridor(
					guidance?.coordinates ?? [],
					closedRoad.coordinates,
					22,
				),
			).toBe(false);
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
