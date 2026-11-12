import type { BaliVillageCeremonyProfile } from "./bali-villages";

export interface RoadRouteResult {
	coordinates: Array<[number, number]>;
	distanceMeters: number;
	durationSeconds: number;
	source: "osrm" | "fallback";
}

export interface UserGuidanceRoute {
	origin: [number, number];
	destination: [number, number];
	waypoints: Array<[number, number]>;
	coordinates: Array<[number, number]>;
	distanceMeters: number;
	durationSeconds: number;
	estimatedMinutes: number;
	avoidedRoadName: string;
	avoidedRoadNames: string[];
	routeName: string;
	viaRouteName: string;
	googleMapsUrl: string;
	source: "osrm" | "fallback";
}

const routeCache = new Map<string, RoadRouteResult>();

export function isWithinBaliBounds(coord: [number, number]): boolean {
	const [lng, lat] = coord;
	return (
		Number.isFinite(lng) &&
		Number.isFinite(lat) &&
		lng >= 114.2 &&
		lng <= 115.85 &&
		lat >= -8.95 &&
		lat <= -8.0
	);
}

export function haversineDistanceMeters(
	a: [number, number],
	b: [number, number],
): number {
	const R = 6371000;
	const toRad = (deg: number) => (deg * Math.PI) / 180;
	const dLat = toRad(b[1] - a[1]);
	const dLng = toRad(b[0] - a[0]);
	const lat1 = toRad(a[1]);
	const lat2 = toRad(b[1]);

	const sinLat = Math.sin(dLat / 2);
	const sinLng = Math.sin(dLng / 2);
	const h =
		sinLat * sinLat + Math.cos(lat1) * Math.cos(lat2) * sinLng * sinLng;
	return 2 * R * Math.atan2(Math.sqrt(h), Math.sqrt(Math.max(0, 1 - h)));
}

export function polylineLengthMeters(
	coords: Array<[number, number]>,
): number {
	let total = 0;
	for (let i = 1; i < coords.length; i++) {
		total += haversineDistanceMeters(coords[i - 1], coords[i]);
	}
	return total;
}

export function pointToSegmentDistanceMeters(
	pt: [number, number],
	a: [number, number],
	b: [number, number],
): number {
	const cosLat = Math.cos(((a[1] + b[1]) * 0.5 * Math.PI) / 180);
	const mPerDegLat = 111320;
	const mPerDegLng = 111320 * cosLat;

	const px = (pt[0] - a[0]) * mPerDegLng;
	const py = (pt[1] - a[1]) * mPerDegLat;
	const bx = (b[0] - a[0]) * mPerDegLng;
	const by = (b[1] - a[1]) * mPerDegLat;

	const lenSq = bx * bx + by * by;
	if (lenSq <= 1e-6) {
		return Math.hypot(px, py);
	}
	const t = Math.max(0, Math.min(1, (px * bx + py * by) / lenSq));
	const projX = t * bx;
	const projY = t * by;
	return Math.hypot(px - projX, py - projY);
}

function ccw(
	A: [number, number],
	B: [number, number],
	C: [number, number],
): boolean {
	return (C[1] - A[1]) * (B[0] - A[0]) > (B[1] - A[1]) * (C[0] - A[0]);
}

function segmentsIntersect(
	A: [number, number],
	B: [number, number],
	C: [number, number],
	D: [number, number],
): boolean {
	return (
		ccw(A, C, D) !== ccw(B, C, D) && ccw(A, B, C) !== ccw(A, B, D)
	);
}

export function doesPathIntersectCorridor(
	path: Array<[number, number]>,
	corridor: Array<[number, number]>,
	bufferMeters = 28,
): boolean {
	if (path.length < 2 || corridor.length < 2) return false;

	for (let i = 1; i < path.length; i++) {
		const p1 = path[i - 1];
		const p2 = path[i];
		for (let j = 1; j < corridor.length; j++) {
			const c1 = corridor[j - 1];
			const c2 = corridor[j];
			if (segmentsIntersect(p1, p2, c1, c2)) {
				return true;
			}
			if (
				pointToSegmentDistanceMeters(p1, c1, c2) <= bufferMeters ||
				pointToSegmentDistanceMeters(p2, c1, c2) <= bufferMeters ||
				pointToSegmentDistanceMeters(c1, p1, p2) <= bufferMeters ||
				pointToSegmentDistanceMeters(c2, p1, p2) <= bufferMeters
			) {
				return true;
			}
		}
	}
	return false;
}

/**
 * Generates a realistic street-grid detour corridor around a closed road segment
 * when an event does not yet have an explicit approved alternative route in DB.
 */
export function generateBypassWaypointsForClosure(
	closedCoords: Array<[number, number]>,
	preferSide: 1 | -1 = 1,
): Array<[number, number]> {
	const valid = closedCoords.filter(isWithinBaliBounds);
	if (valid.length < 2) return [];

	const start = valid[0];
	const end = valid[valid.length - 1];
	const dx = end[0] - start[0];
	const dy = end[1] - start[1];
	const len = Math.hypot(dx, dy);

	if (len < 0.0001) {
		return [
			[Number((start[0] - 0.0018).toFixed(6)), Number((start[1] + 0.0012).toFixed(6))],
			[Number((start[0] + 0.0018).toFixed(6)), Number((start[1] + 0.0012).toFixed(6))],
		];
	}

	const ux = dx / len;
	const uy = dy / len;
	// Perpendicular normal (~200m offset in degrees: ~0.0019 deg)
	const offsetDeg = Math.min(Math.max(len * 0.42, 0.0016), 0.0032);
	const nx = -uy * offsetDeg * preferSide;
	const ny = ux * offsetDeg * preferSide;

	const entryExtend = Math.min(len * 0.12, 0.0006);
	const entry: [number, number] = [
		Number((start[0] - ux * entryExtend).toFixed(6)),
		Number((start[1] - uy * entryExtend).toFixed(6)),
	];
	const corner1: [number, number] = [
		Number((entry[0] + nx).toFixed(6)),
		Number((entry[1] + ny).toFixed(6)),
	];
	const mid: [number, number] = [
		Number(((start[0] + end[0]) * 0.5 + nx * 1.08).toFixed(6)),
		Number(((start[1] + end[1]) * 0.5 + ny * 1.08).toFixed(6)),
	];
	const exit: [number, number] = [
		Number((end[0] + ux * entryExtend).toFixed(6)),
		Number((end[1] + uy * entryExtend).toFixed(6)),
	];
	const corner2: [number, number] = [
		Number((exit[0] + nx).toFixed(6)),
		Number((exit[1] + ny).toFixed(6)),
	];

	return [entry, corner1, mid, corner2, exit].filter(isWithinBaliBounds);
}

/**
 * Deterministic fallback road-grid interpolation when offline or OSRM is unavailable.
 */
export function buildFallbackRoadGeometry(
	waypoints: Array<[number, number]>,
): RoadRouteResult {
	const valid = waypoints.filter(isWithinBaliBounds);
	if (valid.length < 2) {
		return {
			coordinates: valid,
			distanceMeters: 0,
			durationSeconds: 0,
			source: "fallback",
		};
	}

	const detailed: Array<[number, number]> = [valid[0]];
	for (let i = 1; i < valid.length; i++) {
		const prev = valid[i - 1];
		const curr = valid[i];
		const dist = haversineDistanceMeters(prev, curr);
		if (dist > 140) {
			// Add smooth intermediate road-like turn points instead of a harsh diagonal
			const mid1: [number, number] = [
				Number((prev[0] + (curr[0] - prev[0]) * 0.35).toFixed(6)),
				Number((prev[1] + (curr[1] - prev[1]) * 0.25).toFixed(6)),
			];
			const mid2: [number, number] = [
				Number((prev[0] + (curr[0] - prev[0]) * 0.7).toFixed(6)),
				Number((prev[1] + (curr[1] - prev[1]) * 0.75).toFixed(6)),
			];
			detailed.push(mid1, mid2);
		}
		detailed.push([Number(curr[0].toFixed(6)), Number(curr[1].toFixed(6))]);
	}

	const distanceMeters = Math.round(polylineLengthMeters(detailed));
	// ~28 km/h (7.8 m/s) realistic Bali village road speed
	const durationSeconds = Math.max(30, Math.round(distanceMeters / 7.8));

	return {
		coordinates: detailed,
		distanceMeters,
		durationSeconds,
		source: "fallback",
	};
}

/**
 * Snaps 2 or more waypoints to the real Bali street network via OSRM Driving API,
 * falling back gracefully to deterministic street-corridor geometry if offline.
 */
export async function snapCoordinatesToRoad(
	waypoints: Array<[number, number]>,
	signal?: AbortSignal,
): Promise<RoadRouteResult> {
	const valid = waypoints.filter(isWithinBaliBounds);
	if (valid.length < 2) {
		return buildFallbackRoadGeometry(valid);
	}

	// Keep waypoint count bounded for OSRM URL
	const sampled =
		valid.length <= 12
			? valid
			: [
					valid[0],
					...valid
						.slice(1, -1)
						.filter((_, idx, arr) => idx % Math.ceil(arr.length / 10) === 0),
					valid[valid.length - 1],
				];

	const cacheKey = sampled
		.map(([lng, lat]) => `${lng.toFixed(5)},${lat.toFixed(5)}`)
		.join(";");
	const cached = routeCache.get(cacheKey);
	if (cached) {
		return cached;
	}

	const controller = new AbortController();
	const timeoutId = setTimeout(() => controller.abort(), 3200);
	const onExternalAbort = () => controller.abort();
	signal?.addEventListener("abort", onExternalAbort, { once: true });

	try {
		const url = `https://router.project-osrm.org/route/v1/driving/${cacheKey}?overview=full&geometries=geojson`;
		const response = await fetch(url, {
			method: "GET",
			signal: controller.signal,
		});
		if (response.ok) {
			const data = (await response.json()) as {
				code?: string;
				routes?: Array<{
					distance?: number;
					duration?: number;
					geometry?: {
						type?: string;
						coordinates?: Array<[number, number]>;
					};
				}>;
			};
			const route = data.routes?.[0];
			const coords = (route?.geometry?.coordinates ?? []).filter(
				isWithinBaliBounds,
			);
			if (coords.length >= 2) {
				const result: RoadRouteResult = {
					coordinates: coords.map(([lng, lat]) => [
						Number(lng.toFixed(6)),
						Number(lat.toFixed(6)),
					]),
					distanceMeters: Math.round(
						route?.distance ?? polylineLengthMeters(coords),
					),
					durationSeconds: Math.max(
						30,
						Math.round(
							route?.duration ?? polylineLengthMeters(coords) / 7.8,
						),
					),
					source: "osrm",
				};
				routeCache.set(cacheKey, result);
				return result;
			}
		}
	} catch {
		// Fall through to deterministic road geometry fallback
	} finally {
		clearTimeout(timeoutId);
		signal?.removeEventListener("abort", onExternalAbort);
	}

	const fallback = buildFallbackRoadGeometry(sampled);
	routeCache.set(cacheKey, fallback);
	return fallback;
}

/**
 * Computes a realistic default simulated user origin ~400m upstream of an active ceremony's
 * closed road segment or venueLocation so desktop users / testers outside Bali can immediately
 * see user location tracking and the green alternative route in action.
 */
export function deriveDefaultSimulatedUserOrigin(
	ceremony: BaliVillageCeremonyProfile | null | undefined,
): [number, number] {
	if (!ceremony) {
		// Default near Catur Muka Denpasar (West approach on Jl. Gajah Mada)
		return [115.2118, -8.6552];
	}

	const primaryRoad = ceremony.roadSegments?.[0];
	if (primaryRoad && primaryRoad.coordinates.length >= 2) {
		const start = primaryRoad.coordinates[0];
		const end = primaryRoad.coordinates[primaryRoad.coordinates.length - 1];
		const dx = end[0] - start[0];
		const dy = end[1] - start[1];
		const len = Math.hypot(dx, dy);
		if (len > 0.0001) {
			const ux = dx / len;
			const uy = dy / len;
			const candidate: [number, number] = [
				Number((start[0] - ux * 0.0028 - uy * 0.0008).toFixed(6)),
				Number((start[1] - uy * 0.0028 + ux * 0.0008).toFixed(6)),
			];
			if (isWithinBaliBounds(candidate)) {
				return candidate;
			}
		}
		const offsetCandidate: [number, number] = [
			Number((start[0] - 0.0032).toFixed(6)),
			Number((start[1] - 0.0015).toFixed(6)),
		];
		if (isWithinBaliBounds(offsetCandidate)) {
			return offsetCandidate;
		}
	}

	const base = ceremony.venueLocation ?? ceremony.mapCenter;
	const candidate: [number, number] = [
		Number((base[0] - 0.0035).toFixed(6)),
		Number((base[1] - 0.002).toFixed(6)),
	];
	return isWithinBaliBounds(candidate) ? candidate : [115.2118, -8.6552];
}

export function buildGoogleMapsNavigationUrl(
	origin: [number, number],
	destination: [number, number],
	waypoints: Array<[number, number]> = [],
): string {
	const params = new URLSearchParams({
		api: "1",
		origin: `${origin[1]},${origin[0]}`,
		destination: `${destination[1]},${destination[0]}`,
		travelmode: "driving",
	});
	if (waypoints.length > 0) {
		const sampled = waypoints.slice(0, 4);
		params.set(
			"waypoints",
			sampled.map(([lng, lat]) => `${lat},${lng}`).join("|"),
		);
	}
	return `https://www.google.com/maps/dir/?${params.toString()}`;
}

/**
 * Calculates a green recommended alternative route from `userLocation` that avoids
 * the ceremony's closed road segments and guides the user via an open alternative route.
 */
export async function calculateUserBypassRoute(params: {
	userLocation?: [number, number];
	userOrigin?: [number, number];
	ceremony: BaliVillageCeremonyProfile;
	alternativeRoutes?: Array<{
		id: string;
		name: string;
		description?: string | null;
		coordinates?: Array<[number, number]>;
		geometry?: {
			type?: string;
			coordinates?: Array<[number, number]>;
		};
	}>;
	signal?: AbortSignal;
}): Promise<UserGuidanceRoute> {
	const { ceremony, alternativeRoutes = [], signal } = params;
	const userLocation =
		params.userLocation ??
		params.userOrigin ??
		deriveDefaultSimulatedUserOrigin(ceremony);

	const closedSegments = (ceremony.roadSegments ?? []).filter(
		(seg) =>
			seg.coordinates.length >= 2 &&
			(seg.status === "closed" ||
				seg.status === "intermittent" ||
				(seg.impactType ?? "").toLowerCase().includes("closure")),
	);
	const primaryClosed = closedSegments[0] ?? ceremony.roadSegments?.[0];
	const avoidedRoadName =
		primaryClosed?.roadName ||
		ceremony.sacredCenterName ||
		"Ruas Jalan Upacara";
	const avoidedRoadNames =
		closedSegments.length > 0
			? closedSegments.map((seg) => seg.roadName)
			: [avoidedRoadName];

	// Collect candidate alternative routes (explicitly passed or attached to ceremony)
	const combinedAltRoutes = [
		...alternativeRoutes.map((r) => ({
			id: r.id,
			name: r.name,
			coords: (r.coordinates?.length
				? r.coordinates
				: r.geometry?.coordinates ?? []
			).filter(isWithinBaliBounds),
		})),
		...(ceremony.alternativeRoutes ?? []).map((r) => ({
			id: r.id,
			name: r.name,
			coords: (r.coordinates ?? []).filter(isWithinBaliBounds),
		})),
	].filter((r) => r.coords.length >= 2);

	let activeAltName =
		combinedAltRoutes[0]?.name ||
		primaryClosed?.guidanceNote ||
		ceremony.alternativeRouteSummary ||
		"Jalur Alternatif Terbuka";

	let altWaypoints: Array<[number, number]> =
		combinedAltRoutes[0]?.coords ?? [];

	if (altWaypoints.length < 2 && primaryClosed?.coordinates?.length >= 2) {
		altWaypoints = generateBypassWaypointsForClosure(
			primaryClosed.coordinates,
			1,
		);
		activeAltName =
			primaryClosed.guidanceNote ||
			`Jalur Pengalihan Menghindari ${primaryClosed.roadName}`;
	}

	// Orient alternative waypoints so they flow from the side closest to userLocation toward the far side
	if (altWaypoints.length >= 2) {
		const distToFirst = haversineDistanceMeters(
			userLocation,
			altWaypoints[0],
		);
		const distToLast = haversineDistanceMeters(
			userLocation,
			altWaypoints[altWaypoints.length - 1],
		);
		if (distToLast < distToFirst) {
			altWaypoints = [...altWaypoints].reverse();
		}
	}

	// Determine destination point past the closed road (or the end of the alternative route)
	let destination: [number, number] =
		ceremony.venueLocation ?? ceremony.mapCenter;
	if (altWaypoints.length >= 2) {
		const lastAlt = altWaypoints[altWaypoints.length - 1];
		if (primaryClosed?.coordinates?.length >= 2) {
			const cStart = primaryClosed.coordinates[0];
			const cEnd =
				primaryClosed.coordinates[primaryClosed.coordinates.length - 1];
			// Pick the far end of the closed road + slight continuation
			const farEnd =
				haversineDistanceMeters(userLocation, cEnd) >=
				haversineDistanceMeters(userLocation, cStart)
					? cEnd
					: cStart;
			const dx = farEnd[0] - userLocation[0];
			const dy = farEnd[1] - userLocation[1];
			const len = Math.hypot(dx, dy) || 1;
			const candidateDest: [number, number] = [
				Number((lastAlt[0] + (dx / len) * 0.0008).toFixed(6)),
				Number((lastAlt[1] + (dy / len) * 0.0008).toFixed(6)),
			];
			destination = isWithinBaliBounds(candidateDest)
				? candidateDest
				: lastAlt;
		} else {
			destination = lastAlt;
		}
	}

	// Build full waypoint chain: userLocation -> altWaypoints -> destination
	const fullChain: Array<[number, number]> = [
		userLocation,
		...altWaypoints,
		...(haversineDistanceMeters(
			altWaypoints[altWaypoints.length - 1] ?? userLocation,
			destination,
		) > 25
			? [destination]
			: []),
	];

	const snapped = await snapCoordinatesToRoad(fullChain, signal);

	// Safety check: if OSRM snapped route accidentally cuts across the closed segment,
	// stitch leg-by-leg so the middle strictly follows the open alternative route corridor
	const hitsClosed =
		primaryClosed?.coordinates?.length >= 2 &&
		doesPathIntersectCorridor(
			snapped.coordinates,
			primaryClosed.coordinates,
			22,
		);

	let finalCoords = snapped.coordinates;
	let finalDistance = snapped.distanceMeters;
	let finalDuration = snapped.durationSeconds;
	let finalSource = snapped.source;

	if (hitsClosed && altWaypoints.length >= 2) {
		const leg1 = await snapCoordinatesToRoad(
			[userLocation, altWaypoints[0]],
			signal,
		);
		const legMid = buildFallbackRoadGeometry(altWaypoints);
		const leg2 = await snapCoordinatesToRoad(
			[altWaypoints[altWaypoints.length - 1], destination],
			signal,
		);
		finalCoords = [
			...leg1.coordinates,
			...legMid.coordinates.slice(1),
			...leg2.coordinates.slice(1),
		];
		finalDistance = Math.round(polylineLengthMeters(finalCoords));
		finalDuration = Math.max(30, Math.round(finalDistance / 7.8));
		finalSource = leg1.source;
	}

	return {
		origin: userLocation,
		destination,
		waypoints: altWaypoints,
		coordinates: finalCoords,
		distanceMeters: finalDistance,
		durationSeconds: finalDuration,
		estimatedMinutes: Math.max(1, Math.round(finalDuration / 60)),
		avoidedRoadName,
		avoidedRoadNames,
		routeName: activeAltName,
		viaRouteName: activeAltName,
		googleMapsUrl: buildGoogleMapsNavigationUrl(
			userLocation,
			destination,
			altWaypoints,
		),
		source: finalSource,
	};
}
