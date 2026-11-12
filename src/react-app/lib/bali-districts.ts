import type { OperationalRoadStatus } from "./road-status";

export interface GeoJsonPolygon {
	type: "Polygon";
	coordinates: number[][][];
}

export interface GeoJsonFeature<G, P> {
	type: "Feature";
	id: string;
	properties: P;
	geometry: G;
}

export interface GeoJsonFeatureCollection<G, P> {
	type: "FeatureCollection";
	features: Array<GeoJsonFeature<G, P>>;
}

export interface DistrictCeremonySummary {
	id: string;
	title: string;
	desaAdatName: string;
	slug: string;
	status: OperationalRoadStatus;
	dateLabel: string;
	windowWita: string;
	sacredCenterName: string;
	coordinates: [number, number]; // [lng, lat]
	hasVenueLocation?: boolean;
	roadName?: string;
	detourRoute?: string;
	isSimulation?: boolean;
}

export interface BaliDistrictProperties {
	id: string;
	name: string;
	kabupaten: string;
	center: [number, number];
	hasCeremony: boolean;
	ceremonyCount: number;
	ceremonies: DistrictCeremonySummary[];
	description: string;
	borderColor: string;
	fillColor: string;
	colorName: string;
}

export type BaliDistrictFeatureCollection = GeoJsonFeatureCollection<
	GeoJsonPolygon,
	BaliDistrictProperties
>;

/**
 * 14 Territorial Sub-districts and Regional Zones of Bali.
 * Static ceremonies are empty by default — all ceremony records are populated
 * strictly from the backend API via `buildDistrictFeaturesFromEvents`.
 */
export const BALI_DISTRICTS_DATA: BaliDistrictFeatureCollection = {
	type: "FeatureCollection",
	features: [
		// 1. KECAMATAN UBUD (KABUPATEN GIANYAR)
		{
			type: "Feature",
			id: "kec-ubud",
			properties: {
				id: "kec-ubud",
				name: "Kecamatan Ubud",
				kabupaten: "Kabupaten Gianyar",
				center: [115.2625, -8.5069],
				hasCeremony: false,
				ceremonyCount: 0,
				borderColor: "#B91C1C",
				fillColor: "rgba(158, 42, 43, 0.28)",
				colorName: "Merah Terakota",
				description:
					"Pusat kebudayaan Bali dengan prosesi adat sakral di koridor Jl. Raya Ubud dan Hutan Monyet Padangtegal.",
				ceremonies: [],
			},
			geometry: {
				type: "Polygon",
				coordinates: [
					[
						[115.235, -8.475],
						[115.285, -8.47],
						[115.295, -8.53],
						[115.28, -8.545],
						[115.24, -8.54],
						[115.235, -8.475],
					],
				],
			},
		},

		// 2. KECAMATAN DENPASAR SELATAN / SANUR (KOTA DENPASAR)
		{
			type: "Feature",
			id: "kec-denpasar-selatan",
			properties: {
				id: "kec-denpasar-selatan",
				name: "Kecamatan Denpasar Selatan",
				kabupaten: "Kota Denpasar",
				center: [115.252, -8.695],
				hasCeremony: false,
				ceremonyCount: 0,
				borderColor: "#0D9488",
				fillColor: "rgba(13, 148, 136, 0.28)",
				colorName: "Toska Pesisir",
				description:
					"Kawasan pesisir Sanur tempat prosesi penyucian Melasti Segara menuju Pantai Mertasari.",
				ceremonies: [],
			},
			geometry: {
				type: "Polygon",
				coordinates: [
					[
						[115.205, -8.665],
						[115.275, -8.665],
						[115.285, -8.715],
						[115.26, -8.74],
						[115.21, -8.73],
						[115.205, -8.665],
					],
				],
			},
		},

		// 3. KECAMATAN KUTA (KABUPATEN BADUNG)
		{
			type: "Feature",
			id: "kec-kuta",
			properties: {
				id: "kec-kuta",
				name: "Kecamatan Kuta",
				kabupaten: "Kabupaten Badung",
				center: [115.1746, -8.7224],
				hasCeremony: false,
				ceremonyCount: 0,
				borderColor: "#EA580C",
				fillColor: "rgba(234, 88, 12, 0.28)",
				colorName: "Koral Jingga",
				description:
					"Kawasan pariwisata utama dengan pawai Ogoh-Ogoh dan ritual Tawur Kesanga di Catus Pata Kuta.",
				ceremonies: [],
			},
			geometry: {
				type: "Polygon",
				coordinates: [
					[
						[115.145, -8.685],
						[115.185, -8.685],
						[115.195, -8.745],
						[115.165, -8.765],
						[115.15, -8.735],
						[115.145, -8.685],
					],
				],
			},
		},

		// 4. KECAMATAN BATURITI (KABUPATEN TABANAN)
		{
			type: "Feature",
			id: "kec-baturiti",
			properties: {
				id: "kec-baturiti",
				name: "Kecamatan Baturiti",
				kabupaten: "Kabupaten Tabanan",
				center: [115.175, -8.285],
				hasCeremony: false,
				ceremonyCount: 0,
				borderColor: "#4D702F",
				fillColor: "rgba(92, 132, 55, 0.28)",
				colorName: "Zamrud Pegunungan",
				description:
					"Kawasan dataran tinggi Bedugul dengan ritual Piodalan Danu Beratan & Labuh Gentuh.",
				ceremonies: [],
			},
			geometry: {
				type: "Polygon",
				coordinates: [
					[
						[115.135, -8.24],
						[115.215, -8.24],
						[115.22, -8.33],
						[115.14, -8.335],
						[115.135, -8.24],
					],
				],
			},
		},

		// 5. KECAMATAN RENDANG (KABUPATEN KARANGASEM)
		{
			type: "Feature",
			id: "kec-rendang",
			properties: {
				id: "kec-rendang",
				name: "Kecamatan Rendang",
				kabupaten: "Kabupaten Karangasem",
				center: [115.445, -8.385],
				hasCeremony: false,
				ceremonyCount: 0,
				borderColor: "#C026D3",
				fillColor: "rgba(192, 38, 211, 0.28)",
				colorName: "Ungu Sakral",
				description:
					"Lereng Gunung Agung tempat berdirinya Pura Agung Besakih dengan karya tahunan Ida Bhatara Turun Kabeh.",
				ceremonies: [],
			},
			geometry: {
				type: "Polygon",
				coordinates: [
					[
						[115.4, -8.34],
						[115.495, -8.34],
						[115.49, -8.445],
						[115.405, -8.44],
						[115.4, -8.34],
					],
				],
			},
		},

		// 6. KECAMATAN SUKAWATI & BLAHBATUH (GIANYAR SELATAN)
		{
			type: "Feature",
			id: "kec-sukawati",
			properties: {
				id: "kec-sukawati",
				name: "Kecamatan Sukawati & Blahbatuh",
				kabupaten: "Kabupaten Gianyar",
				center: [115.285, -8.585],
				hasCeremony: false,
				ceremonyCount: 0,
				borderColor: "#D97706",
				fillColor: "rgba(217, 119, 6, 0.28)",
				colorName: "Kuning Kunyit",
				description:
					"Kawasan penyangga jalur seni & budaya pesisir selatan Gianyar penghubung Denpasar dan Ubud.",
				ceremonies: [],
			},
			geometry: {
				type: "Polygon",
				coordinates: [
					[
						[115.24, -8.54],
						[115.33, -8.54],
						[115.34, -8.625],
						[115.27, -8.635],
						[115.24, -8.54],
					],
				],
			},
		},

		// 7. KECAMATAN MENGWI & ABIANSEMAL (BADUNG TENGAH)
		{
			type: "Feature",
			id: "kec-mengwi",
			properties: {
				id: "kec-mengwi",
				name: "Kecamatan Mengwi & Abiansemal",
				kabupaten: "Kabupaten Badung",
				center: [115.175, -8.54],
				hasCeremony: false,
				ceremonyCount: 0,
				borderColor: "#F97316",
				fillColor: "rgba(249, 115, 22, 0.28)",
				colorName: "Oranye Badung",
				description:
					"Kawasan penyangga utama penghubung Badung Tengah, Tabanan, dan koridor barat menuju Ubud.",
				ceremonies: [],
			},
			geometry: {
				type: "Polygon",
				coordinates: [
					[
						[115.15, -8.48],
						[115.235, -8.475],
						[115.24, -8.54],
						[115.205, -8.665],
						[115.15, -8.62],
						[115.15, -8.48],
					],
				],
			},
		},

		// 8. KECAMATAN KUTA SELATAN (SEMENANJUNG BUKIT BADUNG)
		{
			type: "Feature",
			id: "kec-kuta-selatan",
			properties: {
				id: "kec-kuta-selatan",
				name: "Kecamatan Kuta Selatan",
				kabupaten: "Kabupaten Badung",
				center: [115.165, -8.81],
				hasCeremony: false,
				ceremonyCount: 0,
				borderColor: "#4F46E5",
				fillColor: "rgba(79, 70, 229, 0.28)",
				colorName: "Nila Samudera",
				description:
					"Kawasan perbukitan dan tebing pesisir Jimbaran, Nusa Dua, dan Pura Luhur Uluwatu di semenanjung selatan.",
				ceremonies: [],
			},
			geometry: {
				type: "Polygon",
				coordinates: [
					[
						[115.115, -8.765],
						[115.165, -8.765],
						[115.235, -8.775],
						[115.225, -8.845],
						[115.15, -8.85],
						[115.115, -8.8],
						[115.115, -8.765],
					],
				],
			},
		},

		// 9. KOTA DENPASAR UTARA, BARAT & TIMUR
		{
			type: "Feature",
			id: "kec-denpasar-kota",
			properties: {
				id: "kec-denpasar-kota",
				name: "Denpasar Utara, Barat & Timur",
				kabupaten: "Kota Denpasar",
				center: [115.225, -8.635],
				hasCeremony: false,
				ceremonyCount: 0,
				borderColor: "#0284C7",
				fillColor: "rgba(2, 132, 199, 0.28)",
				colorName: "Biru Ibukota",
				description:
					"Pusat pemerintahan dan perniagaan Kota Denpasar meliputi Lapangan Puputan dan koridor Catur Muka.",
				ceremonies: [],
			},
			geometry: {
				type: "Polygon",
				coordinates: [
					[
						[115.185, -8.61],
						[115.265, -8.61],
						[115.275, -8.665],
						[115.205, -8.665],
						[115.185, -8.61],
					],
				],
			},
		},

		// 10. KABUPATEN TABANAN SELATAN & KEDIRI
		{
			type: "Feature",
			id: "kab-tabanan-selatan",
			properties: {
				id: "kab-tabanan-selatan",
				name: "Tabanan Selatan & Kediri",
				kabupaten: "Kabupaten Tabanan",
				center: [115.115, -8.555],
				hasCeremony: false,
				ceremonyCount: 0,
				borderColor: "#4D702F",
				fillColor: "rgba(92, 132, 55, 0.28)",
				colorName: "Hijau Lumbung",
				description:
					"Lumbung beras Bali dengan persawahan subak abadi dan pesisir Pura Tanah Lot.",
				ceremonies: [],
			},
			geometry: {
				type: "Polygon",
				coordinates: [
					[
						[115.02, -8.47],
						[115.15, -8.47],
						[115.15, -8.62],
						[115.08, -8.64],
						[115.02, -8.47],
					],
				],
			},
		},

		// 11. KABUPATEN BANGLI & KINTAMANI
		{
			type: "Feature",
			id: "kab-bangli-kintamani",
			properties: {
				id: "kab-bangli-kintamani",
				name: "Kawasan Bangli & Kintamani",
				kabupaten: "Kabupaten Bangli",
				center: [115.345, -8.31],
				hasCeremony: false,
				ceremonyCount: 0,
				borderColor: "#7C3AED",
				fillColor: "rgba(124, 58, 237, 0.28)",
				colorName: "Ungu Kaldera",
				description:
					"Kawasan dataran tinggi Gunung & Danau Batur serta Pura Ulun Danu Batur di kaldera Kintamani.",
				ceremonies: [],
			},
			geometry: {
				type: "Polygon",
				coordinates: [
					[
						[115.28, -8.22],
						[115.41, -8.22],
						[115.42, -8.43],
						[115.31, -8.43],
						[115.28, -8.22],
					],
				],
			},
		},

		// 12. KABUPATEN KLUNGKUNG & NUSA PENIDA
		{
			type: "Feature",
			id: "kab-klungkung",
			properties: {
				id: "kab-klungkung",
				name: "Kabupaten Klungkung & Nusa Penida",
				kabupaten: "Kabupaten Klungkung",
				center: [115.415, -8.545],
				hasCeremony: false,
				ceremonyCount: 0,
				borderColor: "#0891B2",
				fillColor: "rgba(8, 145, 178, 0.28)",
				colorName: "Sian Selat",
				description:
					"Kota pusaka Kertagosa, pesisir Kusamba, serta gugusan kepulauan sakral Nusa Penida.",
				ceremonies: [],
			},
			geometry: {
				type: "Polygon",
				coordinates: [
					[
						[115.35, -8.51],
						[115.47, -8.51],
						[115.48, -8.58],
						[115.36, -8.58],
						[115.35, -8.51],
					],
				],
			},
		},

		// 13. KABUPATEN BULELENG (BALI UTARA)
		{
			type: "Feature",
			id: "kab-buleleng",
			properties: {
				id: "kab-buleleng",
				name: "Kabupaten Buleleng (Singaraja)",
				kabupaten: "Kabupaten Buleleng",
				center: [115.08, -8.15],
				hasCeremony: false,
				ceremonyCount: 0,
				borderColor: "#CA8A04",
				fillColor: "rgba(202, 138, 4, 0.28)",
				colorName: "Perunggu Utara",
				description:
					"Pesisir panjang Bali Utara membentang dari Lovina hingga Tejakula berhadapan langsung dengan Laut Bali.",
				ceremonies: [],
			},
			geometry: {
				type: "Polygon",
				coordinates: [
					[
						[114.75, -8.12],
						[115.38, -8.12],
						[115.38, -8.23],
						[114.85, -8.26],
						[114.75, -8.12],
					],
				],
			},
		},

		// 14. KABUPATEN JEMBRANA (BALI BARAT)
		{
			type: "Feature",
			id: "kab-jembrana",
			properties: {
				id: "kab-jembrana",
				name: "Kabupaten Jembrana (Bali Barat)",
				kabupaten: "Kabupaten Jembrana",
				center: [114.65, -8.32],
				hasCeremony: false,
				ceremonyCount: 0,
				borderColor: "#65A30D",
				fillColor: "rgba(101, 163, 13, 0.28)",
				colorName: "Hijau Barat",
				description:
					"Pintu gerbang barat Pulau Bali meliputi pelabuhan Gilimanuk, Negara, dan kawasan Hutan Lindung Bali Barat.",
				ceremonies: [],
			},
			geometry: {
				type: "Polygon",
				coordinates: [
					[
						[114.43, -8.18],
						[114.95, -8.26],
						[114.95, -8.42],
						[114.52, -8.38],
						[114.43, -8.18],
					],
				],
			},
		},
	],
};
