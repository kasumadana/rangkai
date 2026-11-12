import type { OperationalRoadStatus } from "./road-status";

export const MAPTILER_API_KEY =
	(typeof import.meta !== "undefined" &&
		(import.meta as unknown as { env?: { VITE_MAPTILER_KEY?: string } }).env
			?.VITE_MAPTILER_KEY) ||
	"";
export const MAPTILER_STYLE_URL = MAPTILER_API_KEY
	? `https://api.maptiler.com/maps/streets-v2/style.json?key=${MAPTILER_API_KEY}`
	: "";
export const BALI_ISLAND_CENTER: [number, number] = [115.1889, -8.4095];
export const BALI_ISLAND_ZOOM = 9.7;
export const BALI_MAP_BOUNDS: [[number, number], [number, number]] = [
	[114.20, -8.95], // Southwest [lng, lat]
	[115.85, -8.00], // Northeast [lng, lat]
];
export const BALI_MAP_MIN_ZOOM = 8.8;
export const BALI_MAP_MAX_ZOOM = 18;

export interface VillageRoadRouteSegment {
	id: string;
	roadName: string;
	corridorSection: string;
	roleInCeremony: "rute_utama" | "akses_penyangga" | "jalur_pengalihan";
	roleLabel: string;
	status: OperationalRoadStatus;
	plannedFrom?: string | null;
	plannedTo?: string | null;
	observedAt?: string | null;
	expiresAt?: string | null;
	impactType?: string | null;
	windowWita: string;
	pecalangPost: string;
	lastConfirmedLabel: string;
	guidanceNote: string;
	/** GeoJSON LineString coordinates [lng, lat] */
	coordinates: Array<[number, number]>;
	/** Disconnected line parts, when supplied as GeoJSON MultiLineString. */
	coordinateParts?: Array<Array<[number, number]>>;
	/** SVG path coordinates in 960x540 viewBox for instant vector fallback */
	svgPath: string;
	labelPoint: { x: number; y: number };
}

export interface VillageParkingLot {
	id: string;
	name: string;
	vehicleTypes: string;
	capacity: string;
	walkingTime: string;
	coordinates: [number, number];
	notes: string;
}

export interface VillagePecalangPost {
	id: string;
	name: string;
	officerInCharge: string;
	phone: string;
	assignedRole: string;
	coordinates: [number, number];
}

export interface VillageCommunityNotice {
	id: string;
	title: string;
	category: "lalu_lintas" | "tata_tertib" | "kebersihan" | "darurat";
	categoryLabel: string;
	content: string;
	effectiveTime: string;
}

export interface BaliVillageCeremonyProfile {
	id: string;
	isSimulation?: boolean;
	slug: string;
	desaAdatName: string;
	kabupaten: string;
	kecamatan: string;
	ceremonyTitle: string;
	yadnyaCategory: string;
	sacredCenterName: string;
	destinationName: string;
	participatingBanjars: string[];
	scheduleDateLabel: string;
	scheduleWindowWita: string;
	coordinatorName: string;
	primaryStatus: OperationalRoadStatus;
	overview: string;
	alternativeRouteSummary: string;
	/** Geographic center [lng, lat] and zoom level for MapLibre / MapTiler */
	mapCenter: [number, number];
	venueLocation?: [number, number] | null;
	mapZoom: number;
	puraPoint: {
		name: string;
		coordinates: [number, number];
		description: string;
	};
	destinationPoint: {
		name: string;
		coordinates: [number, number];
		description: string;
	};
	roadSegments: VillageRoadRouteSegment[];
	parkingLots: VillageParkingLot[];
	pecalangPosts: VillagePecalangPost[];
	communityNotices: VillageCommunityNotice[];
	scheduleIso?: {
		startsAt?: string | null;
		endsAt?: string | null;
	};
	alternativeRoutes?: Array<{
		id: string;
		name: string;
		description?: string;
		coordinates: Array<[number, number]>;
	}>;
	/** SVG metadata for instant fallback */
	mapGeometry: {
		riverPath: string;
		riverLabel: string;
		riverLabelPos: { x: number; y: number };
		backgroundRoads: string[];
		puraPoint: { x: number; y: number; label: string };
		destinationPoint: { x: number; y: number; label: string };
		banjarPoints: Array<{ x: number; y: number; label: string }>;
		coordinatesLabel: string;
	};
}
