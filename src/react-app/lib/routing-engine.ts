import type {
	BaliVillageCeremonyProfile,
	VillageRoadRouteSegment,
} from "./bali-villages";

export interface RoadRouteResult {
	coordinates: Array<[number, number]>;
	distanceMeters: number;
	durationSeconds: number;
	source: "osrm" | "fallback";
}

export interface UserGuidanceRoute {
	origin: [number, number];
	destination: [number, number];
	isSimulation: boolean;
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
		const curr = valid[i];
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
	options: { cache?: boolean } = {},
): Promise<RoadRouteResult> {
	const useCache = options.cache !== false;
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
	if (useCache) {
		const cached = routeCache.get(cacheKey);
		if (cached) return cached;
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
				if (useCache) routeCache.set(cacheKey, result);
				return result;
			}
		}
	} catch {
		// Fall through to deterministic road geometry fallback
	} finally {
		clearTimeout(timeoutId);
		signal?.removeEventListener("abort", onExternalAbort);
	}

	return buildFallbackRoadGeometry(sampled);
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

type ClosedRoadSegment = BaliVillageCeremonyProfile["roadSegments"][number];

export function getRoadCoordinateParts(
	segment: Pick<VillageRoadRouteSegment, "coordinates" | "coordinateParts">,
): Array<Array<[number, number]>> {
	const parts = (segment.coordinateParts ?? []).filter((part) => part.length >= 2);
	if (parts.length > 0) return parts;
	return segment.coordinates.length >= 2 ? [segment.coordinates] : [];
}

export function isActiveRoadClosure(segment: {
	status: string;
	impactType?: string | null;
}): boolean {
	const status = segment.status.toLowerCase();
	if (status === "open") return false;
	return (
		status === "closed" ||
		status === "intermittent" ||
		(segment.impactType ?? "").toLowerCase().includes("closure")
	);
}

function getActiveClosedRoads(
	ceremony: BaliVillageCeremonyProfile,
): ClosedRoadSegment[] {
	return (ceremony.roadSegments ?? []).filter(
		(segment) =>
			getRoadCoordinateParts(segment).length > 0 &&
			isActiveRoadClosure(segment),
	);
}

function distanceToPolylineMeters(
	point: [number, number],
	line: Array<[number, number]>,
): number {
	let distance = Number.POSITIVE_INFINITY;
	for (let index = 1; index < line.length; index++) {
		distance = Math.min(
			distance,
			pointToSegmentDistanceMeters(point, line[index - 1], line[index]),
		);
	}
	return distance;
}

function distanceToRoadMeters(
	point: [number, number],
	road: ClosedRoadSegment,
): number {
	return Math.min(
		...getRoadCoordinateParts(road).map((part) =>
			distanceToPolylineMeters(point, part),
		),
	);
}

function isClearOfClosedRoads(
	path: Array<[number, number]>,
	closedRoads: ClosedRoadSegment[],
): boolean {
	return closedRoads.every(
		(road) =>
			getRoadCoordinateParts(road).every(
				(part) => !doesPathIntersectCorridor(path, part, 22),
			),
	);
}

function pointBeyondClosedRoad(
	origin: [number, number],
	closedRoad: ClosedRoadSegment,
): { nearEnd: [number, number]; farEnd: [number, number]; destination: [number, number] } {
	const roadPart = getRoadCoordinateParts(closedRoad).sort(
		(a, b) =>
			distanceToPolylineMeters(origin, a) - distanceToPolylineMeters(origin, b),
	)[0];
	if (!roadPart) {
		const originFallback: [number, number] = [...origin];
		return {
			nearEnd: originFallback,
			farEnd: originFallback,
			destination: originFallback,
		};
	}
	const first = roadPart[0];
	const last = roadPart[roadPart.length - 1];
	const firstIsNear =
		haversineDistanceMeters(origin, first) <=
		haversineDistanceMeters(origin, last);
	const nearEnd = firstIsNear ? first : last;
	const farEnd = firstIsNear ? last : first;
	const metersPerDegreeLat = 111_320;
	const metersPerDegreeLng =
		metersPerDegreeLat * Math.cos((farEnd[1] * Math.PI) / 180);
	const dx = (farEnd[0] - nearEnd[0]) * metersPerDegreeLng;
	const dy = (farEnd[1] - nearEnd[1]) * metersPerDegreeLat;
	const length = Math.hypot(dx, dy);
	if (length < 1) {
		return { nearEnd, farEnd, destination: farEnd };
	}

	const extensionMeters = 80;
	const destination: [number, number] = [
		Number(
			(farEnd[0] + (dx / length) * (extensionMeters / metersPerDegreeLng)).toFixed(6),
		),
		Number(
			(farEnd[1] + (dy / length) * (extensionMeters / metersPerDegreeLat)).toFixed(6),
		),
	];
	return {
		nearEnd,
		farEnd,
		destination: isWithinBaliBounds(destination) ? destination : farEnd,
	};
}

function orientAlternativeRoute(
	coordinates: Array<[number, number]>,
	origin: [number, number],
	nearClosureEnd: [number, number],
	farClosureEnd: [number, number],
): { coordinates: Array<[number, number]>; score: number } {
	const forward = coordinates;
	const reverse = [...coordinates].reverse();
	const score = (line: Array<[number, number]>) =>
		haversineDistanceMeters(origin, line[0]) +
		polylineLengthMeters(line) +
		haversineDistanceMeters(line[0], nearClosureEnd) +
		haversineDistanceMeters(line[line.length - 1], farClosureEnd);
	const forwardScore = score(forward);
	const reverseScore = score(reverse);
	return reverseScore < forwardScore
		? { coordinates: reverse, score: reverseScore }
		: { coordinates: forward, score: forwardScore };
}

/**
 * Builds guidance only from an organizer-approved corridor and a road-network
 * route that has been checked against every active closure. Returns null when
 * no route can be verified; it never draws guessed fallback geometry.
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
}): Promise<UserGuidanceRoute | null> {
	const { ceremony, alternativeRoutes = [], signal } = params;
	const userLocation = params.userLocation ?? params.userOrigin;
	if (!userLocation || !isWithinBaliBounds(userLocation)) return null;

	const closedSegments = getActiveClosedRoads(ceremony);
	if (closedSegments.length === 0) return null;

	const primaryClosed = [...closedSegments].sort(
		(a, b) => distanceToRoadMeters(userLocation, a) - distanceToRoadMeters(userLocation, b),
	)[0];
	const { nearEnd, farEnd, destination } = pointBeyondClosedRoad(
		userLocation,
		primaryClosed,
	);
	const avoidedRoadNames = closedSegments.map((segment) => segment.roadName);
	const avoidedRoadName = primaryClosed.roadName;

	const seenRouteIds = new Set<string>();
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
	].filter((route) => {
		if (route.coords.length < 2 || seenRouteIds.has(route.id)) return false;
		seenRouteIds.add(route.id);
		return isClearOfClosedRoads(route.coords, closedSegments);
	});

	if (combinedAltRoutes.length === 0) return null;

	const candidates = combinedAltRoutes
		.map((route) => ({
			route,
			...orientAlternativeRoute(route.coords, userLocation, nearEnd, farEnd),
		}))
		.sort((a, b) => a.score - b.score);
	const candidate = candidates[0];
	if (!candidate) return null;

	const fullChain = [userLocation, ...candidate.coordinates, destination];
	const snapped = await snapCoordinatesToRoad(fullChain, signal, { cache: false });
	if (
		snapped.source !== "osrm" ||
		snapped.coordinates.length < 2 ||
		!isClearOfClosedRoads(snapped.coordinates, closedSegments)
	) {
		return null;
	}

	return {
		origin: userLocation,
		destination,
		isSimulation: ceremony.isSimulation !== false,
		waypoints: candidate.coordinates,
		coordinates: snapped.coordinates,
		distanceMeters: snapped.distanceMeters,
		durationSeconds: snapped.durationSeconds,
		estimatedMinutes: Math.max(1, Math.round(snapped.durationSeconds / 60)),
		avoidedRoadName,
		avoidedRoadNames,
		routeName: candidate.route.name,
		viaRouteName: candidate.route.name,
		googleMapsUrl: buildGoogleMapsNavigationUrl(
			userLocation,
			destination,
			candidate.coordinates,
		),
		source: snapped.source,
	};
}
