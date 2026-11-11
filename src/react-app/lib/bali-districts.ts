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
 * 14 Territorial Sub-districts and Regional Zones of Bali
 * Each area has distinct territorial polygon boundaries, individual vibrant colors,
 * and associated cultural ceremonies with exact location coordinates, road corridors, and detour routes.
 */
export const BALI_DISTRICTS_DATA: BaliDistrictFeatureCollection = {
	type: "FeatureCollection",
	features: [
		// 1. KECAMATAN UBUD (KABUPATEN GIANYAR) — Balinese Terracotta Crimson
		{
			type: "Feature",
			id: "kec-ubud",
			properties: {
				id: "kec-ubud",
				name: "Kecamatan Ubud",
				kabupaten: "Kabupaten Gianyar",
				center: [115.2625, -8.5069],
				hasCeremony: true,
				ceremonyCount: 2,
				borderColor: "#9E2A2B",
				fillColor: "rgba(158, 42, 43, 0.28)",
				colorName: "Merah Terakota",
				description:
					"Pusat kebudayaan Bali dengan prosesi adat sakral di koridor Jl. Raya Ubud dan Hutan Monyet Padangtegal.",
				ceremonies: [
					{
						id: "desa-adat-ubud",
						title: "Karya Pujawali & Prosesi Melasti Pura Dalem Ubud",
						desaAdatName: "Desa Adat Ubud",
						slug: "pujawali-melasti-desa-adat-ubud",
						status: "closed",
						dateLabel: "Sabtu, 14 November 2026",
						windowWita: "08.00–13.30 WITA",
						sacredCenterName: "Pura Dalem Ubud",
						roadName: "Jl. Raya Ubud - Catus Pata",
						detourRoute: "Jl. Suweta & Jl. Bisma",
						coordinates: [115.2625, -8.5069],
					},
					{
						id: "desa-adat-padangtegal",
						title: "Upacara Ngaben Massal & Atma Wedana",
						desaAdatName: "Desa Adat Padangtegal",
						slug: "ngaben-massal-desa-adat-padangtegal",
						status: "intermittent",
						dateLabel: "Minggu, 15 November 2026",
						windowWita: "09.00–15.00 WITA",
						sacredCenterName: "Pura Dalem Padangtegal",
						roadName: "Jl. Monkey Forest Ubud",
						detourRoute: "Jl. Raya Pengosekan",
						coordinates: [115.2605, -8.5186],
					},
				],
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

		// 2. KECAMATAN DENPASAR SELATAN / SANUR (KOTA DENPASAR) — Teal Coastal
		{
			type: "Feature",
			id: "kec-denpasar-selatan",
			properties: {
				id: "kec-denpasar-selatan",
				name: "Kecamatan Denpasar Selatan",
				kabupaten: "Kota Denpasar",
				center: [115.252, -8.695],
				hasCeremony: true,
				ceremonyCount: 1,
				borderColor: "#0D9488",
				fillColor: "rgba(13, 148, 136, 0.28)",
				colorName: "Toska Pesisir",
				description:
					"Kawasan pesisir Sanur tempat prosesi penyucian Melasti Segara menuju Pantai Mertasari.",
				ceremonies: [
					{
						id: "desa-adat-intaran-sanur",
						title: "Upacara Melasti Segara Sanur Pantai Mertasari",
						desaAdatName: "Desa Adat Intaran Sanur",
						slug: "upacara-melasti-segara-sanur-pantai-mertasari",
						status: "closed",
						dateLabel: "Selasa, 17 November 2026",
						windowWita: "06.00–11.30 WITA",
						sacredCenterName: "Pura Dalem Mimba Sanur",
						roadName: "Jl. Danau Tamblingan - Pantai Mertasari",
						detourRoute: "Jl. Bypass Ngurah Rai Sanur",
						coordinates: [115.258, -8.705],
					},
				],
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

		// 3. KECAMATAN KUTA (KABUPATEN BADUNG) — Sunset Coral
		{
			type: "Feature",
			id: "kec-kuta",
			properties: {
				id: "kec-kuta",
				name: "Kecamatan Kuta",
				kabupaten: "Kabupaten Badung",
				center: [115.1746, -8.7224],
				hasCeremony: true,
				ceremonyCount: 1,
				borderColor: "#EA580C",
				fillColor: "rgba(234, 88, 12, 0.28)",
				colorName: "Koral Jingga",
				description:
					"Kawasan pariwisata utama dengan pawai Ogoh-Ogoh dan ritual Tawur Kesanga di Catus Pata Kuta.",
				ceremonies: [
					{
						id: "desa-adat-kuta",
						title: "Tawur Kesanga & Pawai Ogoh-Ogoh Desa Adat Kuta",
						desaAdatName: "Desa Adat Kuta",
						slug: "tawur-kesanga-pawai-ogoh-ogoh-kuta",
						status: "closed",
						dateLabel: "Rabu, 18 November 2026",
						windowWita: "16.00–23.30 WITA",
						sacredCenterName: "Pura Desa & Puseh Kuta",
						roadName: "Jl. Pantai Kuta & Jl. Bakung Sari",
						detourRoute: "Jl. Raya Kuta - Jl. Majapahit",
						coordinates: [115.1746, -8.7224],
					},
				],
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

		// 4. KECAMATAN BATURITI (KABUPATEN TABANAN) — Highland Forest Emerald
		{
			type: "Feature",
			id: "kec-baturiti",
			properties: {
				id: "kec-baturiti",
				name: "Kecamatan Baturiti",
				kabupaten: "Kabupaten Tabanan",
				center: [115.175, -8.285],
				hasCeremony: true,
				ceremonyCount: 1,
				borderColor: "#059669",
				fillColor: "rgba(5, 150, 105, 0.28)",
				colorName: "Zamrud Pegunungan",
				description:
					"Kawasan dataran tinggi Bedugul dengan ritual Piodalan Danu Beratan & Labuh Gentuh.",
				ceremonies: [
					{
						id: "desa-adat-baturiti",
						title: "Piodalan Danu Beratan & Labuh Gentuh Danau Beratan",
						desaAdatName: "Desa Adat Baturiti",
						slug: "piodalan-danu-beratan-desa-adat-baturiti",
						status: "intermittent",
						dateLabel: "Kamis, 19 November 2026",
						windowWita: "08.00–14.00 WITA",
						sacredCenterName: "Pura Ulun Danu Beratan",
						roadName: "Jl. Raya Denpasar-Singaraja Km 52",
						detourRoute: "Jalur Alternatif Lingkar Danau",
						coordinates: [115.1667, -8.275],
					},
				],
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

		// 5. KECAMATAN RENDANG (KABUPATEN KARANGASEM) — Royal Besakih Fuchsia
		{
			type: "Feature",
			id: "kec-rendang",
			properties: {
				id: "kec-rendang",
				name: "Kecamatan Rendang",
				kabupaten: "Kabupaten Karangasem",
				center: [115.445, -8.385],
				hasCeremony: true,
				ceremonyCount: 1,
				borderColor: "#C026D3",
				fillColor: "rgba(192, 38, 211, 0.28)",
				colorName: "Ungu Sakral",
				description:
					"Lereng Gunung Agung tempat berdirinya Pura Agung Besakih dengan karya tahunan Ida Bhatara Turun Kabeh.",
				ceremonies: [
					{
						id: "desa-adat-besakih",
						title: "Karya Ida Bhatara Turun Kabeh Pura Agung Besakih",
						desaAdatName: "Desa Adat Besakih",
						slug: "karya-ida-bhatara-turun-kabeh-besakih",
						status: "closed",
						dateLabel: "Jumat, 20 November 2026",
						windowWita: "07.00–18.00 WITA",
						sacredCenterName: "Pura Penataran Agung Besakih",
						roadName: "Jl. Raya Besakih - Manik Sawangan",
						detourRoute: "Jalur Kedundung - Batusesa",
						coordinates: [115.4508, -8.3739],
					},
				],
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

		// 6. KECAMATAN SUKAWATI & BLAHBATUH (GIANYAR SELATAN) — Warm Amber Gold
		{
			type: "Feature",
			id: "kec-sukawati",
			properties: {
				id: "kec-sukawati",
				name: "Kecamatan Sukawati & Blahbatuh",
				kabupaten: "Kabupaten Gianyar",
				center: [115.285, -8.585],
				hasCeremony: true,
				ceremonyCount: 1,
				borderColor: "#D97706",
				fillColor: "rgba(217, 119, 6, 0.28)",
				colorName: "Kuning Kunyit",
				description:
					"Kawasan penyangga jalur seni & budaya pesisir selatan Gianyar penghubung Denpasar dan Ubud.",
				ceremonies: [
					{
						id: "desa-adat-batuan",
						title: "Pujawali & Sasih Kapat Pura Puseh Batuan",
						desaAdatName: "Desa Adat Batuan",
						slug: "pujawali-pura-puseh-batuan",
						status: "intermittent",
						dateLabel: "Senin, 16 November 2026",
						windowWita: "08.30–14.00 WITA",
						sacredCenterName: "Pura Puseh Batuan Sukawati",
						roadName: "Jl. Raya Batuan - Simpang Seni Sukawati",
						detourRoute: "Jl. Bypass Ida Bagus Mantra",
						coordinates: [115.275, -8.583],
					},
				],
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

		// 7. KECAMATAN MENGWI & ABIANSEMAL (BADUNG TENGAH) — Vibrant Tangerine
		{
			type: "Feature",
			id: "kec-mengwi",
			properties: {
				id: "kec-mengwi",
				name: "Kecamatan Mengwi & Abiansemal",
				kabupaten: "Kabupaten Badung",
				center: [115.175, -8.54],
				hasCeremony: true,
				ceremonyCount: 1,
				borderColor: "#F97316",
				fillColor: "rgba(249, 115, 22, 0.28)",
				colorName: "Oranye Badung",
				description:
					"Kawasan penyangga utama penghubung Badung Tengah, Tabanan, dan koridor barat menuju Ubud.",
				ceremonies: [
					{
						id: "desa-adat-mengwi",
						title: "Piodalan Agung Pura Ayun & Taman Kerajaan Mengwi",
						desaAdatName: "Desa Adat Mengwi",
						slug: "piodalan-pura-taman-ayun-mengwi",
						status: "intermittent",
						dateLabel: "Rabu, 18 November 2026",
						windowWita: "09.00–16.00 WITA",
						sacredCenterName: "Pura Taman Ayun Mengwi",
						roadName: "Jl. I Gusti Ngurah Rai Mengwi",
						detourRoute: "Jalur Bypass Mengwitani - Beringkit",
						coordinates: [115.172, -8.543],
					},
				],
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

		// 8. KECAMATAN KUTA SELATAN (SEMENANJUNG BUKIT BADUNG) — Deep Indigo
		{
			type: "Feature",
			id: "kec-kuta-selatan",
			properties: {
				id: "kec-kuta-selatan",
				name: "Kecamatan Kuta Selatan",
				kabupaten: "Kabupaten Badung",
				center: [115.165, -8.81],
				hasCeremony: true,
				ceremonyCount: 1,
				borderColor: "#4F46E5",
				fillColor: "rgba(79, 70, 229, 0.28)",
				colorName: "Nila Samudera",
				description:
					"Kawasan perbukitan dan tebing pesisir Jimbaran, Nusa Dua, dan Pura Luhur Uluwatu di semenanjung selatan.",
				ceremonies: [
					{
						id: "desa-adat-pecatu",
						title: "Piodalan Pujawali Pura Luhur Uluwatu Pecatu",
						desaAdatName: "Desa Adat Pecatu",
						slug: "piodalan-pura-luhur-uluwatu",
						status: "closed",
						dateLabel: "Selasa, 17 November 2026",
						windowWita: "14.00–21.00 WITA",
						sacredCenterName: "Pura Luhur Uluwatu",
						roadName: "Jl. Raya Uluwatu Pecatu",
						detourRoute: "Jalur Lingkar Labuan Sait - Padang Padang",
						coordinates: [115.084, -8.829],
					},
				],
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

		// 9. KOTA DENPASAR UTARA, BARAT & TIMUR — Cerulean Blue
		{
			type: "Feature",
			id: "kec-denpasar-kota",
			properties: {
				id: "kec-denpasar-kota",
				name: "Denpasar Utara, Barat & Timur",
				kabupaten: "Kota Denpasar",
				center: [115.225, -8.635],
				hasCeremony: true,
				ceremonyCount: 1,
				borderColor: "#0284C7",
				fillColor: "rgba(2, 132, 199, 0.28)",
				colorName: "Biru Ibukota",
				description:
					"Pusat pemerintahan dan perniagaan Kota Denpasar meliputi Lapangan Puputan dan koridor Catur Muka.",
				ceremonies: [
					{
						id: "desa-adat-denpasar-caturmuka",
						title: "Prosesi Tawur Kasanga & Pengelukatan Catur Muka",
						desaAdatName: "Desa Adat Denpasar",
						slug: "upacara-melasti-segara-sanur-pantai-mertasari",
						status: "intermittent",
						dateLabel: "Selasa, 17 November 2026",
						windowWita: "07.00–12.00 WITA",
						sacredCenterName: "Catur Muka & Pura Jagatnatha",
						roadName: "Jl. Surapati & Titik Nol Catur Muka",
						detourRoute: "Jl. Udayana & Jl. Veteran Denpasar",
						coordinates: [115.2185, -8.6575],
					},
				],
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

		// 10. KABUPATEN TABANAN SELATAN & KEDIRI — Forest Grass
		{
			type: "Feature",
			id: "kab-tabanan-selatan",
			properties: {
				id: "kab-tabanan-selatan",
				name: "Tabanan Selatan & Kediri",
				kabupaten: "Kabupaten Tabanan",
				center: [115.115, -8.555],
				hasCeremony: true,
				ceremonyCount: 1,
				borderColor: "#16A34A",
				fillColor: "rgba(22, 163, 74, 0.28)",
				colorName: "Hijau Lumbung",
				description:
					"Lumbung beras Bali dengan persawahan subak abadi dan pesisir Pura Tanah Lot.",
				ceremonies: [
					{
						id: "desa-adat-beraban",
						title: "Pujawali Luhur Pura Tanah Lot Beraban",
						desaAdatName: "Desa Adat Beraban",
						slug: "pujawali-pura-tanah-lot-beraban",
						status: "intermittent",
						dateLabel: "Rabu, 18 November 2026",
						windowWita: "10.00–18.00 WITA",
						sacredCenterName: "Pura Luhur Tanah Lot",
						roadName: "Jl. Raya Tanah Lot Beraban Kediri",
						detourRoute: "Jalur Nyanyi - Pandak Bandung",
						coordinates: [115.0864, -8.6212],
					},
				],
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

		// 11. KABUPATEN BANGLI & KINTAMANI — Volcanic Purple
		{
			type: "Feature",
			id: "kab-bangli-kintamani",
			properties: {
				id: "kab-bangli-kintamani",
				name: "Kawasan Bangli & Kintamani",
				kabupaten: "Kabupaten Bangli",
				center: [115.345, -8.31],
				hasCeremony: true,
				ceremonyCount: 1,
				borderColor: "#7C3AED",
				fillColor: "rgba(124, 58, 237, 0.28)",
				colorName: "Ungu Kaldera",
				description:
					"Kawasan dataran tinggi Gunung & Danau Batur serta Pura Ulun Danu Batur di kaldera Kintamani.",
				ceremonies: [
					{
						id: "desa-adat-batur",
						title: "Pujawali Ngusaba Kedasa Pura Ulun Danu Batur",
						desaAdatName: "Desa Adat Batur",
						slug: "ngusaba-kedasa-pura-ulun-danu-batur",
						status: "closed",
						dateLabel: "Sabtu, 21 November 2026",
						windowWita: "07.00–17.00 WITA",
						sacredCenterName: "Pura Ulun Danu Batur Kaldera",
						roadName: "Jl. Raya Kintamani - Penelokan",
						detourRoute: "Jalur Manikliyu - Sekardadi",
						coordinates: [115.353, -8.256],
					},
				],
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

		// 12. KABUPATEN KLUNGKUNG & NUSA PENIDA — Ocean Cyan
		{
			type: "Feature",
			id: "kab-klungkung",
			properties: {
				id: "kab-klungkung",
				name: "Kabupaten Klungkung & Nusa Penida",
				kabupaten: "Kabupaten Klungkung",
				center: [115.415, -8.545],
				hasCeremony: true,
				ceremonyCount: 1,
				borderColor: "#0891B2",
				fillColor: "rgba(8, 145, 178, 0.28)",
				colorName: "Sian Selat",
				description:
					"Kota pusaka Kertagosa, pesisir Kusamba, serta gugusan kepulauan sakral Nusa Penida.",
				ceremonies: [
					{
						id: "desa-adat-pesinggahan",
						title: "Piodalan Agung Pura Goa Lawah & Segara Kusamba",
						desaAdatName: "Desa Adat Pesinggahan",
						slug: "piodalan-pura-goa-lawah-klungkung",
						status: "intermittent",
						dateLabel: "Kamis, 19 November 2026",
						windowWita: "08.00–14.30 WITA",
						sacredCenterName: "Pura Goa Lawah",
						roadName: "Jl. Raya Pesinggahan - Kusamba",
						detourRoute: "Jl. Bypass Ida Bagus Mantra Klungkung",
						coordinates: [115.467, -8.551],
					},
				],
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

		// 13. KABUPATEN BULELENG (BALI UTARA) — Bronze Gold
		{
			type: "Feature",
			id: "kab-buleleng",
			properties: {
				id: "kab-buleleng",
				name: "Kabupaten Buleleng (Singaraja)",
				kabupaten: "Kabupaten Buleleng",
				center: [115.08, -8.15],
				hasCeremony: true,
				ceremonyCount: 1,
				borderColor: "#CA8A04",
				fillColor: "rgba(202, 138, 4, 0.28)",
				colorName: "Perunggu Utara",
				description:
					"Pesisir panjang Bali Utara membentang dari Lovina hingga Tejakula berhadapan langsung dengan Laut Bali.",
				ceremonies: [
					{
						id: "desa-adat-kubutambahan",
						title: "Pujawali Agung Pura Meduwe Karang",
						desaAdatName: "Desa Adat Kubutambahan",
						slug: "pujawali-pura-meduwe-karang-buleleng",
						status: "intermittent",
						dateLabel: "Jumat, 20 November 2026",
						windowWita: "09.00–15.00 WITA",
						sacredCenterName: "Pura Meduwe Karang",
						roadName: "Jl. Raya Kubutambahan Singaraja",
						detourRoute: "Jalur Alternatif Lingkar Pantai Utara",
						coordinates: [115.176, -8.081],
					},
				],
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

		// 14. KABUPATEN JEMBRANA (BALI BARAT) — Lime Chartreuse
		{
			type: "Feature",
			id: "kab-jembrana",
			properties: {
				id: "kab-jembrana",
				name: "Kabupaten Jembrana (Bali Barat)",
				kabupaten: "Kabupaten Jembrana",
				center: [114.65, -8.32],
				hasCeremony: true,
				ceremonyCount: 1,
				borderColor: "#65A30D",
				fillColor: "rgba(101, 163, 13, 0.28)",
				colorName: "Hijau Barat",
				description:
					"Pintu gerbang barat Pulau Bali meliputi pelabuhan Gilimanuk, Negara, dan kawasan Hutan Lindung Bali Barat.",
				ceremonies: [
					{
						id: "desa-adat-yehembang",
						title: "Pujawali Piodalan Pura Luhur Rambut Siwi",
						desaAdatName: "Desa Adat Yeh Embang",
						slug: "pujawali-pura-rambut-siwi-jembrana",
						status: "intermittent",
						dateLabel: "Minggu, 22 November 2026",
						windowWita: "08.00–16.00 WITA",
						sacredCenterName: "Pura Luhur Rambut Siwi",
						roadName: "Jl. Raya Denpasar-Gilimanuk Km 82",
						detourRoute: "Jalur Lingkar Pesisir Yeh Embang Kangin",
						coordinates: [114.764, -8.405],
					},
				],
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
