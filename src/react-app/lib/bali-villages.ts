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
	windowWita: string;
	pecalangPost: string;
	lastConfirmedLabel: string;
	guidanceNote: string;
	/** GeoJSON LineString coordinates [lng, lat] */
	coordinates: Array<[number, number]>;
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

export const BALI_VILLAGE_CEREMONIES: BaliVillageCeremonyProfile[] = [
	{
		id: "desa-adat-ubud",
		slug: "pujawali-melasti-desa-adat-ubud",
		desaAdatName: "Desa Adat Ubud",
		kabupaten: "Kabupaten Gianyar",
		kecamatan: "Kecamatan Ubud",
		ceremonyTitle: "Karya Pujawali & Prosesi Melasti Pura Dalem Ubud",
		yadnyaCategory: "Dewa Yadnya • Pujawali & Melasti",
		sacredCenterName: "Pura Dalem Ubud",
		destinationName: "Catus Pata Ubud & Beji Campuhan",
		participatingBanjars: [
			"Banjar Ubud Kelod",
			"Banjar Ubud Tengah",
			"Banjar Ubud Kaja",
			"Banjar Sambahan",
		],
		scheduleDateLabel: "Sabtu, 14 November 2026",
		scheduleWindowWita: "08.00–13.30 WITA",
		coordinatorName: "Pecalang Desa Adat Ubud (Pos Komando Catus Pata)",
		primaryStatus: "closed",
		overview:
			"Iring-iringan krama adat, pratima, dan barisan beleganjur bergerak dari Pura Dalem Ubud melintasi Catus Pata Puri Saren menuju Beji. Koridor utama Jalan Raya Ubud ditutup sementara selama prosesi berjalan.",
		alternativeRouteSummary:
			"Kendaraan dari arah Tebongkang/Denpasar menuju Gianyar dialihkan melalui Jl. Raya Pengosekan – Jl. Sugriwa – Jl. Raya Peliatan.",
		mapCenter: [115.2625, -8.5069],
		mapZoom: 15.4,
		puraPoint: {
			name: "Pura Dalem Ubud",
			coordinates: [115.2578, -8.5042],
			description: "Pusat prosesi upacara & titik kumpul krama adat",
		},
		destinationPoint: {
			name: "Catus Pata Puri Saren Ubud",
			coordinates: [115.2625, -8.5069],
			description: "Titik temu prosesi sakral & perempatan agung Ubud",
		},
		roadSegments: [
			{
				id: "ubud-raya-utama",
				roadName: "Jl. Raya Ubud",
				corridorSection: "Pura Dalem Ubud – Catus Pata Puri Saren",
				roleInCeremony: "rute_utama",
				roleLabel: "Rute Utama Prosesi Upacara",
				status: "closed",
				windowWita: "08.00–12.00 WITA",
				pecalangPost: "Pos Pecalang Catus Pata Ubud",
				lastConfirmedLabel: "Dikonfirmasi Pecalang • 10 menit lalu",
				guidanceNote:
					"Ditutup penuh untuk kendaraan bermotor selama iring-iringan krama desa adat dan gamelan melintas di badan jalan.",
				coordinates: [
					[115.2575, -8.5041],
					[115.2598, -8.5055],
					[115.2625, -8.5069],
				],
				svgPath: "M 230,255 L 555,255",
				labelPoint: { x: 392, y: 222 },
			},
			{
				id: "ubud-monkey-forest",
				roadName: "Jl. Monkey Forest",
				corridorSection: "Simpang Catus Pata – Banjar Ubud Kelod",
				roleInCeremony: "akses_penyangga",
				roleLabel: "Jalur Penyangga Banjar",
				status: "intermittent",
				windowWita: "08.00–13.30 WITA",
				pecalangPost: "Pos Pecalang Ubud Kelod",
				lastConfirmedLabel: "Dikonfirmasi Pecalang • 14 menit lalu",
				guidanceNote:
					"Sistem buka-tutup bergantian setiap 15 menit. Akses diprioritaskan bagi warga penghuni dan pengantar sarana upakara.",
				coordinates: [
					[115.2625, -8.5069],
					[115.2621, -8.5115],
					[115.2618, -8.515],
				],
				svgPath: "M 470,255 L 470,425",
				labelPoint: { x: 545, y: 342 },
			},
			{
				id: "ubud-sugriwa-hanoman",
				roadName: "Jl. Sugriwa – Jl. Raya Pengosekan",
				corridorSection: "Simpang Sugriwa – Lingkar Selatan Pengosekan",
				roleInCeremony: "jalur_pengalihan",
				roleLabel: "Rute Alternatif Pengendara",
				status: "open",
				windowWita: "06.00–18.00 WITA",
				pecalangPost: "Pos Simpang Sugriwa",
				lastConfirmedLabel: "Dikonfirmasi Pecalang • 8 menit lalu",
				guidanceNote:
					"Jalur terbuka dua arah sebagai rute pengalihan dari Ubud Barat menuju Peliatan dan Gianyar.",
				coordinates: [
					[115.2625, -8.515],
					[115.2655, -8.5148],
					[115.2662, -8.5075],
					[115.271, -8.5072],
				],
				svgPath: "M 470,425 L 690,425 L 690,255 L 850,255",
				labelPoint: { x: 705, y: 456 },
			},
		],
		parkingLots: [
			{
				id: "parkir-astina-ubud",
				name: "Sentral Parkir Lapangan Astina Ubud",
				vehicleTypes: "Roda 2 & Roda 4 (Mobil Pribadi)",
				capacity: "Kapasitas ~300 Motor, 90 Mobil",
				walkingTime: "± 3 menit jalan kaki ke Catus Pata",
				coordinates: [115.2638, -8.5065],
				notes: "Disediakan gratis oleh Desa Adat untuk krama dan pemedek.",
			},
			{
				id: "parkir-monkey-forest",
				name: "Kantong Parkir Sentral Wenara Wana",
				vehicleTypes: "Roda 4 & Bus Pariwisata Sedang",
				capacity: "Kapasitas ~150 Mobil / Bus",
				walkingTime: "± 7 menit dengan shuttle pecalang",
				coordinates: [115.2588, -8.5188],
				notes: "Titik parkir pengendara luar daerah sebelum area pengalihan.",
			},
		],
		pecalangPosts: [
			{
				id: "pos-catus-pata",
				name: "Pos Komando 1 • Catus Pata Puri Saren",
				officerInCharge: "I Wayan Sudarma (Manggala Pecalang)",
				phone: "+62 812-3844-0911",
				assignedRole: "Pusat komando sterilisasi rute utama upacara",
				coordinates: [115.2625, -8.5069],
			},
			{
				id: "pos-tebongkang",
				name: "Pos Pengalihan 2 • Simpang Tebongkang",
				officerInCharge: "I Made Wirawan",
				phone: "+62 813-3791-5522",
				assignedRole: "Pengalihan arus kendaraan dari arah Denpasar",
				coordinates: [115.253, -8.518],
			},
		],
		communityNotices: [
			{
				id: "notice-truk-ubud",
				title: "Pembatasan Kendaraan Barang & Truk Ekspedisi",
				category: "lalu_lintas",
				categoryLabel: "Lalu Lintas Adat",
				content:
					"Truk pengangkut barang dan bus besar dilarang melintasi koridor Jl. Raya Ubud mulai pukul 07.00 hingga 14.00 WITA.",
				effectiveTime: "Sabtu, 14 Nov 2026 • 07.00–14.00 WITA",
			},
			{
				id: "notice-pemedek-ubud",
				title: "Imbauan Ketertiban Pemedek & Busana Adat",
				category: "tata_tertib",
				categoryLabel: "Tata Tertib Upacara",
				content:
					"Krama dan pemedek yang tangkil wajib berbusana adat madya/agung serta mematuhi arahan pecalang di pintu masuk Pura Dalem.",
				effectiveTime: "Selama karya berlangsung",
			},
			{
				id: "notice-mareresik-ubud",
				title: "Gotong Royong Mareresik (Kebersihan Pasca-Karya)",
				category: "kebersihan",
				categoryLabel: "Kebersihan Desa",
				content:
					"Regu kebersihan banjar dan sukarelawan krama melakukan pembersihan serentak sisa sarana upakara begitu barisan prosesi tiba di Beji.",
				effectiveTime: "Pukul 13.00 WITA s.d selesai",
			},
		],
		mapGeometry: {
			riverPath: "M 140,0 C 175,160 155,330 210,540",
			riverLabel: "Tukad Campuhan",
			riverLabelPos: { x: 118, y: 465 },
			backgroundRoads: [
				"M 60,255 L 900,255",
				"M 470,40 L 470,500",
				"M 690,65 L 690,490",
				"M 260,120 L 820,120",
				"M 230,425 L 860,425",
			],
			puraPoint: { x: 310, y: 255, label: "Pura Dalem Ubud" },
			destinationPoint: { x: 470, y: 255, label: "Catus Pata Ubud" },
			banjarPoints: [
				{ x: 470, y: 155, label: "Br. Ubud Kaja" },
				{ x: 470, y: 350, label: "Br. Ubud Kelod" },
				{ x: 690, y: 255, label: "Simpang Sugriwa" },
			],
			coordinatesLabel: "8.5069° LS, 115.2625° BT • Koridor Ubud Tengah",
		},
	},
	{
		id: "desa-adat-padangtegal",
		slug: "ngaben-massal-desa-adat-padangtegal",
		desaAdatName: "Desa Adat Padangtegal",
		kabupaten: "Kabupaten Gianyar",
		kecamatan: "Kecamatan Ubud",
		ceremonyTitle: "Upacara Pitra Yadnya (Ngaben Massal) Desa Adat Padangtegal",
		yadnyaCategory: "Pitra Yadnya • Prosesi Bade & Lembu",
		sacredCenterName: "Bale Banjar Padangtegal Kelod",
		destinationName: "Setra Agung Padangtegal",
		participatingBanjars: [
			"Banjar Padangtegal Kaja",
			"Banjar Padangtegal Tengah",
			"Banjar Padangtegal Kelod",
			"Banjar Padangtegal Mekarsari",
		],
		scheduleDateLabel: "Minggu, 15 November 2026",
		scheduleWindowWita: "11.00–16.00 WITA",
		coordinatorName: "Pecalang Desa Adat Padangtegal",
		primaryStatus: "closed",
		overview:
			"Pengusungan Bade dan Lembu Cemeng oleh ratusan krama banjar dari Bale Banjar menuju Setra Agung Padangtegal di sisi Mandala Suci Wenara Wana.",
		alternativeRouteSummary:
			"Arus kendaraan dari arah Sukawati/Tebongkang diarahkan lurus menuju Jl. Raya Pengosekan Timur dan Jl. Raya Peliatan.",
		mapCenter: [115.2604, -8.5192],
		mapZoom: 15.6,
		puraPoint: {
			name: "Bale Banjar Padangtegal Kelod",
			coordinates: [115.2618, -8.5152],
			description: "Titik perakitan & pengangkatan Bade",
		},
		destinationPoint: {
			name: "Setra Agung Padangtegal",
			coordinates: [115.2604, -8.5192],
			description: "Kawasan pembakaran & upacara Pitra Yadnya",
		},
		roadSegments: [
			{
				id: "padangtegal-monkey-forest-selatan",
				roadName: "Jl. Monkey Forest Selatan",
				corridorSection: "Bale Banjar Padangtegal – Setra Agung",
				roleInCeremony: "rute_utama",
				roleLabel: "Rute Pengusungan Bade & Lembu",
				status: "closed",
				windowWita: "11.00–15.30 WITA",
				pecalangPost: "Pos Pecalang Mandala Wenara Wana",
				lastConfirmedLabel: "Dikonfirmasi Pecalang • 6 menit lalu",
				guidanceNote:
					"Jalan ditutup total karena lebar iring-iringan pengusung Bade menggunakan seluruh badan jalan.",
				coordinates: [
					[115.2618, -8.5152],
					[115.2609, -8.5175],
					[115.2604, -8.5192],
				],
				svgPath: "M 430,145 L 430,405",
				labelPoint: { x: 325, y: 278 },
			},
			{
				id: "padangtegal-hanoman-selatan",
				roadName: "Jl. Hanoman Selatan",
				corridorSection: "Simpang Padangtegal Tengah – Simpang Pengosekan",
				roleInCeremony: "akses_penyangga",
				roleLabel: "Jalur Penyangga Krama Adat",
				status: "intermittent",
				windowWita: "10.30–16.00 WITA",
				pecalangPost: "Pos Simpang Hanoman",
				lastConfirmedLabel: "Dikonfirmasi Pecalang • 12 menit lalu",
				guidanceNote:
					"Arus kendaraan melambat dan diberlakukan buka-tutup saat barisan pengiring masuk ke koridor utama.",
				coordinates: [
					[115.2642, -8.5135],
					[115.2655, -8.5178],
					[115.2658, -8.521],
				],
				svgPath: "M 430,260 L 680,260 L 680,430",
				labelPoint: { x: 565, y: 235 },
			},
			{
				id: "padangtegal-raya-pengosekan",
				roadName: "Jl. Raya Pengosekan – Jl. Tebongkang",
				corridorSection: "Simpang Tebongkang – Simpang Peliatan",
				roleInCeremony: "jalur_pengalihan",
				roleLabel: "Jalur Alternatif Utama",
				status: "open",
				windowWita: "06.00–22.00 WITA",
				pecalangPost: "Pos Koordinasi Pengosekan",
				lastConfirmedLabel: "Dikonfirmasi Pecalang • 5 menit lalu",
				guidanceNote:
					"Terbuka lancar untuk kendaraan roda dua dan roda empat yang melintas menuju Ubud Timur.",
				coordinates: [
					[115.253, -8.522],
					[115.2658, -8.521],
					[115.274, -8.5205],
				],
				svgPath: "M 180,430 L 850,430",
				labelPoint: { x: 560, y: 465 },
			},
		],
		parkingLots: [
			{
				id: "parkir-lapangan-pengosekan",
				name: "Sentral Parkir Lapangan Padangtegal",
				vehicleTypes: "Roda 2 & Roda 4",
				capacity: "Kapasitas ~200 Motor, 60 Mobil",
				walkingTime: "± 4 menit ke Bale Banjar",
				coordinates: [115.2635, -8.5165],
				notes: "Dikhususkan untuk keluarga krama pengiring upacara ngaben.",
			},
			{
				id: "parkir-wenara-wana-utara",
				name: "Kantong Parkir Mandala Wenara Wana Utara",
				vehicleTypes: "Roda 2 & Roda 4",
				capacity: "Kapasitas ~150 Motor, 40 Mobil",
				walkingTime: "± 6 menit ke Setra Agung",
				coordinates: [115.2615, -8.518],
				notes: "Titik kumpul kendaraan pengiring lembu dan bade.",
			},
		],
		pecalangPosts: [
			{
				id: "pos-padangtegal-setra",
				name: "Pos Pecalang Wenara Wana",
				officerInCharge: "I Ketut Sujana",
				phone: "+62 819-9921-8833",
				assignedRole: "Pengamanan rute pengarakan Bade di Setra Agung",
				coordinates: [115.2604, -8.5192],
			},
			{
				id: "pos-simpang-pengosekan",
				name: "Pos Pengalihan Simpang Pengosekan",
				officerInCharge: "I Nyoman Kariada",
				phone: "+62 812-4663-1122",
				assignedRole: "Penyaringan kendaraan luar dan pengalihan ke Peliatan",
				coordinates: [115.2658, -8.521],
			},
		],
		communityNotices: [
			{
				id: "notice-padangtegal-listrik",
				title: "Pengamanan Kabel Listrik & Telepon Rute Bade",
				category: "darurat",
				categoryLabel: "Keselamatan & Darurat",
				content:
					"Tim PLN dan petugas pecalang bersiaga mengangkat kabel melintang di sepanjang Jl. Monkey Forest selama prosesi pengusungan Bade setinggi 18 meter.",
				effectiveTime: "Minggu, 15 Nov 2026 • 11.30–14.30 WITA",
			},
			{
				id: "notice-padangtegal-mareresik",
				title: "Mareresik & Pengangkutan Abu Pitra Yadnya",
				category: "kebersihan",
				categoryLabel: "Kebersihan Pasca-Upacara",
				content:
					"Regu kebersihan desa bersama pecalang melakukan sterilisasi area Setra Agung dan pemilahan sisa abu kayu pembakaran pasca prosesi.",
				effectiveTime: "Minggu, 15 Nov 2026 • 16.00 WITA s.d selesai",
			},
		],
		mapGeometry: {
			riverPath: "M 260,0 C 245,190 275,360 235,540",
			riverLabel: "Tukadindu Padangtegal",
			riverLabelPos: { x: 182, y: 485 },
			backgroundRoads: [
				"M 120,115 L 860,115",
				"M 430,60 L 430,480",
				"M 680,90 L 680,480",
				"M 150,430 L 880,430",
			],
			puraPoint: { x: 430, y: 175, label: "Bale Br. Padangtegal" },
			destinationPoint: { x: 430, y: 385, label: "Setra Agung Padangtegal" },
			banjarPoints: [
				{ x: 430, y: 115, label: "Br. Padangtegal Kaja" },
				{ x: 680, y: 260, label: "Br. Mekarsari" },
				{ x: 680, y: 430, label: "Simpang Pengosekan" },
			],
			coordinatesLabel: "8.5192° LS, 115.2604° BT • Koridor Padangtegal",
		},
	},
	{
		id: "desa-adat-intaran-sanur",
		slug: "melasti-desa-adat-intaran-sanur",
		desaAdatName: "Desa Adat Intaran Sanur",
		kabupaten: "Kota Denpasar",
		kecamatan: "Kecamatan Denpasar Selatan",
		ceremonyTitle: "Prosesi Melasti Pura Kahyangan Tiga Desa Adat Intaran",
		yadnyaCategory: "Dewa Yadnya • Prosesi Melasti Segara",
		sacredCenterName: "Pura Desa Bale Agung Intaran",
		destinationName: "Pantai Segara Sanur",
		participatingBanjars: [
			"Banjar Intaran",
			"Banjar Sindu Kaja",
			"Banjar Sindu Kelod",
			"Banjar Semawang",
		],
		scheduleDateLabel: "Senin, 16 November 2026",
		scheduleWindowWita: "06.30–11.00 WITA",
		coordinatorName: "Pecalang Desa Adat Intaran Sanur",
		primaryStatus: "intermittent",
		overview:
			"Prosesi Melasti berjalan kaki dari Pura Desa Bale Agung Intaran menyusuri koridor Jalan Danau Tamblingan menuju pesisir Pantai Segara Sanur pada pagi hari.",
		alternativeRouteSummary:
			"Pengendara menuju kawasan pelabuhan atau Renon disarankan tetap berada di jalur utama Jl. Bypass Ngurah Rai.",
		mapCenter: [115.2628, -8.6914],
		mapZoom: 15.2,
		puraPoint: {
			name: "Pura Desa Bale Agung Intaran",
			coordinates: [115.2585, -8.6918],
			description: "Titik awal keberangkatan iring-iringan krama",
		},
		destinationPoint: {
			name: "Pantai Segara Sanur",
			coordinates: [115.2668, -8.6912],
			description: "Lokasi penyucian sarana upakara di tepi segara",
		},
		roadSegments: [
			{
				id: "sanur-danau-tamblingan",
				roadName: "Jl. Danau Tamblingan – Akses Pantai Segara",
				corridorSection: "Simpang Intaran – Pantai Segara Sanur",
				roleInCeremony: "rute_utama",
				roleLabel: "Rute Prosesi Melasti",
				status: "closed",
				windowWita: "06.30–10.30 WITA",
				pecalangPost: "Pos Pecalang Pasar Sindu",
				lastConfirmedLabel: "Dikonfirmasi Pecalang • 9 menit lalu",
				guidanceNote:
					"Ditutup sementara pada jam keberangkatan dan kepulangan iring-iringan Melasti dari pantai.",
				coordinates: [
					[115.2585, -8.6918],
					[115.2625, -8.6915],
					[115.2668, -8.6912],
				],
				svgPath: "M 365,285 L 785,285",
				labelPoint: { x: 585, y: 252 },
			},
			{
				id: "sanur-danau-buyan",
				roadName: "Jl. Danau Buyan – Jl. Danau Toba",
				corridorSection: "Simpang Sindu – Koridor Hotel Sanur",
				roleInCeremony: "akses_penyangga",
				roleLabel: "Jalur Penyangga Kawasan",
				status: "intermittent",
				windowWita: "06.30–11.00 WITA",
				pecalangPost: "Pos Pecalang Br. Sindu",
				lastConfirmedLabel: "Dikonfirmasi Pecalang • 11 menit lalu",
				guidanceNote:
					"Buka-tutup menyesuaikan penyeberangan barisan krama banjar menuju titik kumpul utama.",
				coordinates: [
					[115.2625, -8.685],
					[115.2625, -8.6915],
					[115.263, -8.698],
				],
				svgPath: "M 540,120 L 540,435",
				labelPoint: { x: 625, y: 195 },
			},
			{
				id: "sanur-bypass-ngurah-rai",
				roadName: "Jl. Bypass Ngurah Rai (Koridor Sanur)",
				corridorSection: "Simpang Padanggalak – Simpang Blanjong",
				roleInCeremony: "jalur_pengalihan",
				roleLabel: "Jalur Arteri Bebas Hambatan",
				status: "open",
				windowWita: "Berlaku Normal",
				pecalangPost: "Pos Pantau Simpang Intaran",
				lastConfirmedLabel: "Dikonfirmasi Pecalang • 4 menit lalu",
				guidanceNote:
					"Jalur arteri Bypass Ngurah Rai tetap beroperasi normal dua arah tanpa penutupan.",
				coordinates: [
					[115.252, -8.682],
					[115.252, -8.692],
					[115.2515, -8.705],
				],
				svgPath: "M 210,65 L 210,480",
				labelPoint: { x: 135, y: 215 },
			},
		],
		parkingLots: [
			{
				id: "parkir-pantai-segara-sanur",
				name: "Area Parkir Wisata Pantai Segara Sanur",
				vehicleTypes: "Roda 2 & Roda 4",
				capacity: "Kapasitas ~350 Motor, 120 Mobil",
				walkingTime: "± 2 menit ke pesisir pantai",
				coordinates: [115.2672, -8.692],
				notes: "Area parkir utama bagi pemedek dan penonton prosesi melasti.",
			},
			{
				id: "parkir-lapangan-intaran",
				name: "Kantong Parkir Lapangan Wantilan Intaran",
				vehicleTypes: "Roda 2 & Bus Sedang",
				capacity: "Kapasitas ~250 Motor, 20 Bus",
				walkingTime: "± 4 menit ke Pura Desa Bale Agung",
				coordinates: [115.257, -8.6925],
				notes: "Titik kumpul rombongan sekaa baleganjur dan pemedek banjar.",
			},
		],
		pecalangPosts: [
			{
				id: "pos-sindu-sanur",
				name: "Pos Pecalang Simpang Danau Tamblingan",
				officerInCharge: "I Made Suwena",
				phone: "+62 811-3990-211",
				assignedRole: "Pengaturan buka-tutup akses hotel & wisatawan",
				coordinates: [115.2625, -8.6915],
			},
			{
				id: "pos-segara-sanur",
				name: "Pos Pecalang Pesisir Pantai Segara",
				officerInCharge: "I Gusti Bagus Alit",
				phone: "+62 813-3882-9011",
				assignedRole: "Penataan barisan krama pemedek di bibir pantai",
				coordinates: [115.2668, -8.6912],
			},
		],
		communityNotices: [
			{
				id: "notice-sanur-pagi",
				title: "Informasi Arus Pagi Wisatawan Sanur",
				category: "lalu_lintas",
				categoryLabel: "Lalu Lintas Kawasan Wisata",
				content:
					"Tamu hotel di sepanjang koridor Danau Tamblingan disarankan menggunakan akses jalan lingkar Bypass sebelum pukul 06.30 WITA.",
				effectiveTime: "Senin, 16 Nov 2026 • 06.00–10.00 WITA",
			},
			{
				id: "notice-sanur-kebersihan-pantai",
				title: "Gerakan Bebas Sampah Plastik di Pesisir Segara",
				category: "kebersihan",
				categoryLabel: "Kebersihan Pesisir Adat",
				content:
					"Prajuru melarang penggunaan kantong plastik sekali pakai untuk pembungkus canang. Sisa canang pasca labuhan segera dibersihkan oleh tim mareresik desa.",
				effectiveTime: "Senin, 16 Nov 2026 • 09.30 WITA s.d selesai",
			},
		],
		mapGeometry: {
			riverPath: "M 835,0 C 815,180 845,350 820,540",
			riverLabel: "Pesisir Pantai Sanur",
			riverLabelPos: { x: 845, y: 485 },
			backgroundRoads: [
				"M 210,50 L 210,495",
				"M 540,55 L 540,495",
				"M 210,165 L 780,165",
				"M 210,285 L 810,285",
				"M 210,415 L 770,415",
			],
			puraPoint: { x: 365, y: 285, label: "Pura Desa Intaran" },
			destinationPoint: { x: 785, y: 285, label: "Pantai Segara Sanur" },
			banjarPoints: [
				{ x: 540, y: 165, label: "Br. Sindu Kaja" },
				{ x: 540, y: 415, label: "Br. Semawang" },
				{ x: 210, y: 285, label: "Simpang Bypass" },
			],
			coordinatesLabel: "8.6914° LS, 115.2628° BT • Koridor Sanur Tengah",
		},
	},
	{
		id: "desa-adat-kuta",
		slug: "tawur-kesanga-desa-adat-kuta",
		desaAdatName: "Desa Adat Kuta",
		kabupaten: "Kabupaten Badung",
		kecamatan: "Kecamatan Kuta",
		ceremonyTitle: "Upacara Tawur Agung Kesanga & Pawai Ogoh-Ogoh Kuta",
		yadnyaCategory: "Bhuta Yadnya • Tawur Kesanga & Pengrupukan",
		sacredCenterName: "Pura Desa Adat Kuta",
		destinationName: "Catus Pata Bemo Corner Kuta",
		participatingBanjars: [
			"Banjar Pande Mas",
			"Banjar Pelasa",
			"Banjar Pengabetan",
			"Banjar Temacun",
			"Banjar Buni",
		],
		scheduleDateLabel: "Selasa, 17 November 2026",
		scheduleWindowWita: "15.00–22.00 WITA",
		coordinatorName: "Pecalang Desa Adat Kuta (Pos Catus Pata)",
		primaryStatus: "closed",
		overview:
			"Pelaksanaan Pecaruan Tawur Kesanga di Catus Pata Kuta dilanjutkan pengarakan Ogoh-Ogoh dari 13 banjar adat melintasi Jalan Pantai Kuta dan Jalan Legian.",
		alternativeRouteSummary:
			"Seluruh arus kendaraan menuju Seminyak dan Bandara Ngurah Rai dialihkan melalui koridor timur Jl. Sunset Road.",
		mapCenter: [115.1746, -8.7224],
		mapZoom: 15.3,
		puraPoint: {
			name: "Pura Desa Adat Kuta",
			coordinates: [115.1765, -8.722],
			description: "Titik awal ritual Tawur Kesanga",
		},
		destinationPoint: {
			name: "Catus Pata Bemo Corner Kuta",
			coordinates: [115.1746, -8.7224],
			description: "Titik temu atraksi ogoh-ogoh 13 banjar",
		},
		roadSegments: [
			{
				id: "kuta-pantai-legian",
				roadName: "Jl. Pantai Kuta – Catus Pata – Jl. Legian",
				corridorSection: "Simpang Pantai Kuta – Bemo Corner – Legian Selatan",
				roleInCeremony: "rute_utama",
				roleLabel: "Rute Utama Tawur & Ogoh-Ogoh",
				status: "closed",
				windowWita: "15.00–22.00 WITA",
				pecalangPost: "Pos Utama Catus Pata Bemo Corner",
				lastConfirmedLabel: "Dikonfirmasi Pecalang • 7 menit lalu",
				guidanceNote:
					"Sterilisasi penuh kendaraan bermotor di sepanjang koridor Pantai Kuta hingga Legian Selatan.",
				coordinates: [
					[115.1695, -8.7226],
					[115.1746, -8.7224],
					[115.1748, -8.7135],
				],
				svgPath: "M 235,280 L 475,280 L 475,110",
				labelPoint: { x: 355, y: 248 },
			},
			{
				id: "kuta-raya-bakung-sari",
				roadName: "Jl. Raya Kuta – Jl. Bakung Sari",
				corridorSection: "Pura Desa Kuta – Simpang Temacun",
				roleInCeremony: "akses_penyangga",
				roleLabel: "Akses Terbatas Warga & Darurat",
				status: "intermittent",
				windowWita: "14.30–22.00 WITA",
				pecalangPost: "Pos Pecalang Br. Temacun",
				lastConfirmedLabel: "Dikonfirmasi Pecalang • 15 menit lalu",
				guidanceNote:
					"Buka-tutup terbatas untuk warga lokal dan keadaan darurat dengan pengawalan Pecalang.",
				coordinates: [
					[115.1746, -8.7224],
					[115.1802, -8.7225],
					[115.1805, -8.728],
				],
				svgPath: "M 475,280 L 660,280 L 660,410 L 475,410",
				labelPoint: { x: 575, y: 440 },
			},
			{
				id: "kuta-sunset-road",
				roadName: "Jl. Sunset Road (Koridor Timur)",
				corridorSection: "Simpang Dewa Ruci – Simpang Imam Bonjol",
				roleInCeremony: "jalur_pengalihan",
				roleLabel: "Jalur Pengalihan Arteri",
				status: "open",
				windowWita: "Berlaku Normal",
				pecalangPost: "Pos Koordinasi Simpang Timur",
				lastConfirmedLabel: "Dikonfirmasi Pecalang • 5 menit lalu",
				guidanceNote:
					"Jalur utama yang direkomendasikan bagi pengendara dari arah Bandara menuju Denpasar dan Seminyak.",
				coordinates: [
					[115.187, -8.712],
					[115.1865, -8.722],
					[115.1862, -8.735],
				],
				svgPath: "M 760,65 L 760,480",
				labelPoint: { x: 842, y: 215 },
			},
		],
		parkingLots: [
			{
				id: "parkir-sentral-kuta",
				name: "Sentral Parkir Kuta (Jl. Raya Kuta)",
				vehicleTypes: "Roda 2, Roda 4, Bus Besar",
				capacity: "Kapasitas ~800 Motor, 350 Mobil",
				walkingTime: "± 10 menit ke Catus Pata Kuta",
				coordinates: [115.1825, -8.718],
				notes: "Kawasan parkir terluas untuk penonton pawai ogoh-ogoh.",
			},
			{
				id: "parkir-lapangan-tri-sakti",
				name: "Kantong Parkir Lapangan Tri Sakti Kuta",
				vehicleTypes: "Khusus Roda 2 (Motor Krama)",
				capacity: "Kapasitas ~500 Motor",
				walkingTime: "± 5 menit ke Catus Pata",
				coordinates: [115.178, -8.723],
				notes: "Dikhususkan untuk krama banjar yang bertugas membawa ogoh-ogoh.",
			},
		],
		pecalangPosts: [
			{
				id: "pos-bemo-corner",
				name: "Pos Komando Catus Pata Bemo Corner",
				officerInCharge: "I Gusti Ngurah Anom",
				phone: "+62 812-4600-1122",
				assignedRole: "Pusat kendali sterilisasi iring-iringan 13 ogoh-ogoh",
				coordinates: [115.1746, -8.7224],
			},
			{
				id: "pos-simpang-pantai-kuta",
				name: "Pos Pecalang Simpang Pantai Kuta",
				officerInCharge: "I Wayan Suweta",
				phone: "+62 817-4402-9911",
				assignedRole: "Penyaringan akses pejalan kaki & pos medis darurat",
				coordinates: [115.1695, -8.7226],
			},
		],
		communityNotices: [
			{
				id: "notice-kuta-ogoh",
				title: "Batas Waktu Masuk Kendaraan Kawasan Kuta",
				category: "lalu_lintas",
				categoryLabel: "Lalu Lintas Pawai Ogoh-Ogoh",
				content:
					"Seluruh akses menuju Jalan Pantai Kuta ditutup untuk kendaraan bermotor mulai pukul 15.00 WITA. Pengunjung wajib berjalan kaki dari sentral parkir.",
				effectiveTime: "Selasa, 17 Nov 2026 • 15.00–23.00 WITA",
			},
			{
				id: "notice-kuta-kebersihan-malam",
				title: "Operasi Mareresik Serentak Pasca Pawai Ogoh-Ogoh",
				category: "kebersihan",
				categoryLabel: "Kebersihan Kota Adat",
				content:
					"Pecalang dan Dinas Lingkungan Hidup melakukan penyisiran sampah dan pembersihan jalan raya tepat setelah parade ogoh-ogoh berakhir pukul 22.30 WITA.",
				effectiveTime: "Selasa, 17 Nov 2026 • 22.30 WITA s.d selesai",
			},
		],
		mapGeometry: {
			riverPath: "M 130,0 C 145,190 120,370 140,540",
			riverLabel: "Garis Pantai Kuta",
			riverLabelPos: { x: 92, y: 475 },
			backgroundRoads: [
				"M 235,55 L 235,490",
				"M 475,55 L 475,490",
				"M 760,50 L 760,495",
				"M 235,280 L 760,280",
				"M 235,410 L 760,410",
			],
			puraPoint: { x: 560, y: 280, label: "Pura Desa Adat Kuta" },
			destinationPoint: { x: 475, y: 280, label: "Catus Pata Kuta" },
			banjarPoints: [
				{ x: 235, y: 280, label: "Simpang Pantai Kuta" },
				{ x: 475, y: 155, label: "Koridor Legian" },
				{ x: 760, y: 280, label: "Simpang Sunset Road" },
			],
			coordinatesLabel: "8.7224° LS, 115.1746° BT • Koridor Catus Pata Kuta",
		},
	},
	{
		id: "desa-adat-baturiti",
		slug: "piodalan-pura-ulun-danu-beratan",
		desaAdatName: "Desa Adat Baturiti",
		kabupaten: "Kabupaten Tabanan",
		kecamatan: "Kecamatan Baturiti",
		ceremonyTitle: "Pujawali Pura Ulun Danu Beratan Bedugul",
		yadnyaCategory: "Dewa Yadnya • Pujawali Danu",
		sacredCenterName: "Pura Ulun Danu Beratan",
		destinationName: "Pesisir Danau Beratan",
		participatingBanjars: [
			"Banjar Baturiti Kaja",
			"Banjar Baturiti Kelod",
			"Banjar Candikuning",
			"Banjar Bukit Catu",
		],
		scheduleDateLabel: "Kamis, 19 November 2026",
		scheduleWindowWita: "09.00–15.00 WITA",
		coordinatorName: "Pecalang Desa Adat Baturiti & Pos Candikuning",
		primaryStatus: "intermittent",
		overview:
			"Iring-iringan krama adat dan pemedek melintasi koridor utama Denpasar-Singaraja di kawasan wisata Danau Beratan Bedugul.",
		alternativeRouteSummary:
			"Jalur arteri tetap dibuka dengan sistem buka-tutup saat iring-iringan menyeberang. Jalur alternatif via Wanagiri-Munduk.",
		mapCenter: [115.1664, -8.2753],
		mapZoom: 15.0,
		puraPoint: {
			name: "Pura Ulun Danu Beratan",
			coordinates: [115.1664, -8.2753],
			description: "Pusat persembahyangan dan upacara yadnya",
		},
		destinationPoint: {
			name: "Pesisir Danau Beratan",
			coordinates: [115.169, -8.274],
			description: "Titik ritual penyucian di tepi danau",
		},
		roadSegments: [
			{
				id: "baturiti-raya-bedugul",
				roadName: "Jl. Raya Denpasar-Singaraja (Depan Danau)",
				corridorSection: "Pasar Candikuning – Pintu Masuk Ulun Danu",
				roleInCeremony: "rute_utama",
				roleLabel: "Akses Utama Kawasan Pura",
				status: "intermittent",
				windowWita: "09.00–15.00 WITA",
				pecalangPost: "Pos Pecalang Gerbang Ulun Danu",
				lastConfirmedLabel: "Dikonfirmasi Pecalang • 10 menit lalu",
				guidanceNote: "Buka-tutup saat rombongan pemedek menyeberang jalan raya.",
				coordinates: [
					[115.161, -8.281],
					[115.166, -8.276],
					[115.171, -8.271],
				],
				svgPath: "M 200,400 L 500,250 L 800,100",
				labelPoint: { x: 500, y: 230 },
			},
			{
				id: "baturiti-kebun-raya",
				roadName: "Jl. Kebun Raya Bedugul",
				corridorSection: "Simpang Patung Jagung – Pintu Kebun Raya",
				roleInCeremony: "jalur_pengalihan",
				roleLabel: "Kantong Parkir & Jalur Pengalihan",
				status: "open",
				windowWita: "Berlaku Normal",
				pecalangPost: "Pos Pecalang Simpang Patung Jagung",
				lastConfirmedLabel: "Dikonfirmasi Pecalang • 5 menit lalu",
				guidanceNote: "Akses terbuka lancar untuk parkir cadangan.",
				coordinates: [
					[115.158, -8.283],
					[115.155, -8.286],
					[115.152, -8.288],
				],
				svgPath: "M 200,400 L 150,450 L 100,500",
				labelPoint: { x: 180, y: 440 },
			},
		],
		parkingLots: [
			{
				id: "parkir-ulun-danu",
				name: "Sentral Parkir Kawasan Danau Beratan",
				vehicleTypes: "Roda 2, Roda 4, Bus",
				capacity: "Kapasitas ~400 Motor, 180 Mobil",
				walkingTime: "± 2 menit ke pelataran pura",
				coordinates: [115.165, -8.277],
				notes: "Area parkir beraspal luas untuk pemedek umum.",
			},
			{
				id: "parkir-kebun-raya-baturiti",
				name: "Kantong Parkir Cadangan Kebun Raya",
				vehicleTypes: "Roda 4 & Bus",
				capacity: "Kapasitas ~80 Mobil, 20 Bus",
				walkingTime: "± 8 menit ke Pura Ulun Danu",
				coordinates: [115.158, -8.283],
				notes: "Parkir penyangga bila sentral parkir utama penuh.",
			},
		],
		pecalangPosts: [
			{
				id: "pos-baturiti-ulun-danu",
				name: "Pos Pecalang Gerbang Ulun Danu",
				officerInCharge: "I Wayan Suartama",
				phone: "+62 813-3829-4411",
				assignedRole: "Penyeberangan krama & penguraian antrean kendaraan",
				coordinates: [115.1664, -8.2753],
			},
			{
				id: "pos-patung-jagung-baturiti",
				name: "Pos Pecalang Simpang Patung Jagung",
				officerInCharge: "I Made Sukadana",
				phone: "+62 812-4665-2299",
				assignedRole: "Pengalihan arus dari arah Singaraja menuju Denpasar",
				coordinates: [115.169, -8.272],
			},
		],
		communityNotices: [
			{
				id: "notice-baturiti-kabut",
				title: "Peringatan Cuaca Kabut & Kecepatan Kendaraan",
				category: "lalu_lintas",
				categoryLabel: "Kondisi Jalan",
				content: "Pengendara dihimbau menyalakan lampu utama di jalur Bedugul saat kabut turun.",
				effectiveTime: "Kamis, 19 Nov 2026 • Siang–Sore WITA",
			},
			{
				id: "notice-baturiti-mareresik",
				title: "Pembersihan Area Danau Pasca Pujawali",
				category: "kebersihan",
				categoryLabel: "Kebersihan Pura",
				content: "Seluruh sarana upakara di tepian Danau Beratan dikumpulkan dan dipilah oleh regu kebersihan desa.",
				effectiveTime: "Kamis, 19 Nov 2026 • 17.00 WITA",
			},
		],
		mapGeometry: {
			riverPath: "M 600,0 C 580,200 620,380 600,540",
			riverLabel: "Danau Beratan",
			riverLabelPos: { x: 680, y: 260 },
			backgroundRoads: ["M 100,450 L 850,80"],
			puraPoint: { x: 500, y: 250, label: "Pura Ulun Danu" },
			destinationPoint: { x: 620, y: 240, label: "Tepian Danau" },
			banjarPoints: [{ x: 300, y: 350, label: "Br. Candikuning" }],
			coordinatesLabel: "8.2753° LS, 115.1664° BT • Koridor Bedugul",
		},
	},
	{
		id: "desa-adat-besakih",
		slug: "karya-ida-bhatara-turun-kabeh-besakih",
		desaAdatName: "Desa Adat Besakih",
		kabupaten: "Kabupaten Karangasem",
		kecamatan: "Kecamatan Rendang",
		ceremonyTitle: "Karya Ida Bhatara Turun Kabeh Pura Agung Besakih",
		yadnyaCategory: "Dewa Yadnya • Karya Agung Besakih",
		sacredCenterName: "Pura Penataran Agung Besakih",
		destinationName: "Pelataran Suci Manik Mas",
		participatingBanjars: [
			"Banjar Besakih Kawan",
			"Banjar Besakih Kangin",
			"Banjar Angsoka",
			"Banjar Batumadeg",
		],
		scheduleDateLabel: "Jumat, 20 November 2026",
		scheduleWindowWita: "07.00–18.00 WITA",
		coordinatorName: "Pecalang Desa Adat Besakih & Dishub Karangasem",
		primaryStatus: "closed",
		overview:
			"Upacara besar tahunan di Pura Terbesar di Bali. Seluruh jalur utama Manik Mas disterilkan dari kendaraan roda empat pribadi.",
		alternativeRouteSummary:
			"Kendaraan roda 4 wajib parkir di Sentral Parkir Kedundung. Akses ke pura dilayani kendaraan shuttle ramah lingkungan.",
		mapCenter: [115.4509, -8.374],
		mapZoom: 15.2,
		puraPoint: {
			name: "Pura Penataran Agung Besakih",
			coordinates: [115.4509, -8.374],
			description: "Ibu dari seluruh pura di Pulau Bali",
		},
		destinationPoint: {
			name: "Pelataran Suci Manik Mas",
			coordinates: [115.446, -8.378],
			description: "Kawasan penerimaan pemedek dan alur jalan kaki",
		},
		roadSegments: [
			{
				id: "besakih-jalur-utama",
				roadName: "Koridor Suci Manik Mas – Penataran Agung",
				corridorSection: "Gerbang Kedundung – Candi Bentar Besakih",
				roleInCeremony: "rute_utama",
				roleLabel: "Zona Steril Kendaraan",
				status: "closed",
				windowWita: "06.00–18.00 WITA",
				pecalangPost: "Pos Komando Candi Bentar Besakih",
				lastConfirmedLabel: "Dikonfirmasi Pecalang • 8 menit lalu",
				guidanceNote: "Khusus pejalan kaki dan kendaraan pengangkut sarana upakara suci.",
				coordinates: [
					[115.444, -8.382],
					[115.448, -8.377],
					[115.4509, -8.374],
				],
				svgPath: "M 200,450 L 500,260 L 700,120",
				labelPoint: { x: 450, y: 240 },
			},
			{
				id: "besakih-jalur-rendang",
				roadName: "Jl. Raya Rendang-Besakih",
				corridorSection: "Simpang Rendang – Sentral Parkir Kedundung",
				roleInCeremony: "akses_penyangga",
				roleLabel: "Jalur Akses Antrean Kendaraan",
				status: "intermittent",
				windowWita: "07.00–17.00 WITA",
				pecalangPost: "Pos Pantau Simpang Menanga",
				lastConfirmedLabel: "Dikonfirmasi Pecalang • 12 menit lalu",
				guidanceNote: "Buka-tutup bertahap untuk mengatur masuknya kendaraan ke kantong parkir.",
				coordinates: [
					[115.435, -8.41],
					[115.44, -8.395],
					[115.444, -8.382],
				],
				svgPath: "M 200,450 L 100,520",
				labelPoint: { x: 140, y: 490 },
			},
		],
		parkingLots: [
			{
				id: "parkir-kedundung-besakih",
				name: "Sentral Parkir Terpadu Kedundung Besakih",
				vehicleTypes: "Roda 2, Roda 4, Bus Besar",
				capacity: "Kapasitas ~2.000 Motor, 1.200 Mobil, 100 Bus",
				walkingTime: "Tersedia mobil buggy shuttle ke pura",
				coordinates: [115.443, -8.383],
				notes: "Sentral parkir utama termegah di Bali dengan fasilitas gedung bertingkat.",
			},
			{
				id: "parkir-manik-mas-vip",
				name: "Kantong Parkir Pelataran Manik Mas",
				vehicleTypes: "Kendaraan Upakara & Dinas",
				capacity: "Kapasitas Khusus Pengiring Sarana Yadnya",
				walkingTime: "± 1 menit ke Candi Bentar",
				coordinates: [115.446, -8.378],
				notes: "Hanya untuk kendaraan berstiker khusus panitia karya agung.",
			},
		],
		pecalangPosts: [
			{
				id: "pos-candi-bentar-besakih",
				name: "Pos Komando Utama Besakih",
				officerInCharge: "I Gusti Mangku Karang",
				phone: "+62 812-3991-8844",
				assignedRole: "Pusat sterilisasi dan penataan barisan krama se-Bali",
				coordinates: [115.4509, -8.374],
			},
			{
				id: "pos-pantau-menanga",
				name: "Pos Pantau Arus Simpang Menanga",
				officerInCharge: "I Made Giri Suputra",
				phone: "+62 813-3774-1100",
				assignedRole: "Penyaringan awal kendaraan pemedek dari arah Klungkung/Denpasar",
				coordinates: [115.435, -8.41],
			},
		],
		communityNotices: [
			{
				id: "notice-besakih-pemedek",
				title: "Kewajiban Penggunaan Shuttle & Tata Tertib Manik Mas",
				category: "tata_tertib",
				categoryLabel: "Tata Tertib Karya Agung",
				content: "Seluruh pemedek wajib menggunakan busana adat madya/agung dan mematuhi panduan Pecalang di pos Kedundung.",
				effectiveTime: "Sepanjang pelaksanaan karya",
			},
			{
				id: "notice-besakih-kebersihan",
				title: "Larangan Kantong Plastik Sekali Pakai di Area Suci",
				category: "kebersihan",
				categoryLabel: "Kebersihan Pura Mandiri",
				content: "Pemedek dihimbau membawa tas kain keben ramah lingkungan untuk canang dan dupa.",
				effectiveTime: "Setiap hari selama karya agung",
			},
		],
		mapGeometry: {
			riverPath: "M 300,0 C 280,220 320,380 290,540",
			riverLabel: "Lembah Gunung Agung",
			riverLabelPos: { x: 380, y: 150 },
			backgroundRoads: ["M 100,520 L 700,120"],
			puraPoint: { x: 700, y: 120, label: "Pura Penataran Agung" },
			destinationPoint: { x: 450, y: 260, label: "Sentral Manik Mas" },
			banjarPoints: [{ x: 200, y: 450, label: "Sentral Kedundung" }],
			coordinatesLabel: "8.3740° LS, 115.4509° BT • Koridor Agung Besakih",
		},
	},
];

function escapeXml(input: string): string {
	return input
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;")
		.replace(/'/g, "&apos;");
}

function getStatusStrokeColors(status: OperationalRoadStatus): {
	stroke: string;
	halo: string;
	badgeBg: string;
	badgeBorder: string;
	badgeText: string;
	shortLabel: string;
} {
	switch (status) {
		case "closed":
			return {
				stroke: "#C8322B",
				halo: "rgba(200, 50, 43, 0.22)",
				badgeBg: "#FEF2F2",
				badgeBorder: "#FCA5A5",
				badgeText: "#991B1B",
				shortLabel: "DITUTUP SEMENTARA",
			};
		case "intermittent":
			return {
				stroke: "#D97706",
				halo: "rgba(217, 119, 6, 0.22)",
				badgeBg: "#FFFBEB",
				badgeBorder: "#FCD34D",
				badgeText: "#92400E",
				shortLabel: "BUKA-TUTUP PECALANG",
			};
		case "open":
			return {
				stroke: "#15803D",
				halo: "rgba(21, 128, 61, 0.20)",
				badgeBg: "#F0FDF4",
				badgeBorder: "#86EFAC",
				badgeText: "#166534",
				shortLabel: "JALUR ALTERNATIF BUKA",
			};
		default:
			return {
				stroke: "#57534E",
				halo: "rgba(87, 83, 78, 0.18)",
				badgeBg: "#F5F5F4",
				badgeBorder: "#D6D3D1",
				badgeText: "#44403C",
				shortLabel: "BELUM DIKONFIRMASI",
			};
	}
}

/**
 * Architectural SVG generator fallback for instant rendering when MapLibre is initializing
 */
export function buildBaliVillageMapSvgDataUri(
	village: BaliVillageCeremonyProfile,
	selectedSegmentId?: string,
): string {
	const { mapGeometry, roadSegments } = village;
	const activeSegment =
		roadSegments.find((s) => s.id === selectedSegmentId) ?? roadSegments[0];

	const bgRoadsSvg = mapGeometry.backgroundRoads
		.map(
			(d) =>
				`<path d="${d}" fill="none" stroke="#E2DDD3" stroke-width="12" stroke-linecap="round" stroke-linejoin="round"/>` +
				`<path d="${d}" fill="none" stroke="#FAF8F5" stroke-width="8" stroke-linecap="round" stroke-linejoin="round"/>`,
		)
		.join("");

	const segmentsSvg = roadSegments
		.map((segment) => {
			const isSelected = activeSegment?.id === segment.id;
			const palette = getStatusStrokeColors(segment.status);
			const haloWidth = isSelected ? 26 : 16;
			const strokeWidth = isSelected ? 10 : 7;
			const dashAttr =
				segment.status === "intermittent"
					? 'stroke-dasharray="14 8"'
					: segment.status === "open"
						? 'stroke-dasharray="6 8"'
						: "";

			return `
				<g>
					<path d="${segment.svgPath}" fill="none" stroke="${palette.halo}" stroke-width="${haloWidth}" stroke-linecap="round" stroke-linejoin="round"/>
					<path d="${segment.svgPath}" fill="none" stroke="${palette.stroke}" stroke-width="${strokeWidth}" stroke-linecap="round" stroke-linejoin="round" ${dashAttr}/>
					<g transform="translate(${segment.labelPoint.x}, ${segment.labelPoint.y})">
						<rect x="-88" y="-15" width="176" height="30" rx="8" fill="${isSelected ? palette.badgeBg : "#FFFFFF"}" stroke="${isSelected ? palette.stroke : palette.badgeBorder}" stroke-width="${isSelected ? "2" : "1.2"}"/>
						<text x="0" y="4" text-anchor="middle" font-family="Figtree, system-ui, sans-serif" font-size="11.5" font-weight="700" fill="${palette.badgeText}">
							${escapeXml(segment.roadName)}
						</text>
					</g>
				</g>
			`;
		})
		.join("");

	const banjarNodesSvg = mapGeometry.banjarPoints
		.map(
			(pt) => `
			<g transform="translate(${pt.x}, ${pt.y})">
				<circle r="6" fill="#FFFFFF" stroke="#57534E" stroke-width="2.5"/>
				<rect x="-58" y="10" width="116" height="22" rx="6" fill="rgba(255,255,255,0.92)" stroke="#D6D0C4" stroke-width="1"/>
				<text x="0" y="25" text-anchor="middle" font-family="Figtree, system-ui, sans-serif" font-size="10.5" font-weight="600" fill="#44403C">
					${escapeXml(pt.label)}
				</text>
			</g>
		`,
		)
		.join("");

	const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 960 540" width="960" height="540">
		<defs>
			<pattern id="grid" width="48" height="48" patternUnits="userSpaceOnUse">
				<path d="M 48 0 L 0 0 0 48" fill="none" stroke="#EAE5DC" stroke-width="1"/>
			</pattern>
			<radialGradient id="warmGlow" cx="50%" cy="50%" r="55%">
				<stop offset="0%" stop-color="#FDFBF7"/>
				<stop offset="100%" stop-color="#F2EDE4"/>
			</radialGradient>
		</defs>

		<rect width="960" height="540" fill="url(#warmGlow)"/>
		<rect width="960" height="540" fill="url(#grid)" opacity="0.75"/>
		<ellipse cx="485" cy="275" rx="340" ry="195" fill="#EDE7DC" opacity="0.45" stroke="#D5CBB8" stroke-width="1.5" stroke-dasharray="8 6"/>

		<path d="${mapGeometry.riverPath}" fill="none" stroke="#CBDCEB" stroke-width="26" stroke-linecap="round"/>
		<path d="${mapGeometry.riverPath}" fill="none" stroke="#93B8D8" stroke-width="14" stroke-linecap="round"/>
		<text x="${mapGeometry.riverLabelPos.x}" y="${mapGeometry.riverLabelPos.y}" text-anchor="middle" font-family="Figtree, system-ui, sans-serif" font-size="11" font-weight="600" fill="#3B6998" letter-spacing="0.04em">
			${escapeXml(mapGeometry.riverLabel)}
		</text>

		${bgRoadsSvg}
		${segmentsSvg}
		${banjarNodesSvg}

		<g transform="translate(${mapGeometry.puraPoint.x}, ${mapGeometry.puraPoint.y})">
			<circle r="18" fill="rgba(180, 83, 9, 0.16)"/>
			<circle r="10" fill="#B45309" stroke="#FFFFFF" stroke-width="3"/>
			<rect x="-82" y="-42" width="164" height="26" rx="7" fill="#292524" stroke="#B45309" stroke-width="1.5"/>
			<text x="0" y="-25" text-anchor="middle" font-family="Montserrat, system-ui, sans-serif" font-size="11" font-weight="700" fill="#FAFAF9">
				${escapeXml(mapGeometry.puraPoint.label)}
			</text>
		</g>

		<g transform="translate(${mapGeometry.destinationPoint.x}, ${mapGeometry.destinationPoint.y})">
			<circle r="18" fill="rgba(200, 50, 43, 0.18)"/>
			<circle r="9" fill="#C8322B" stroke="#FFFFFF" stroke-width="3"/>
			<rect x="-84" y="16" width="168" height="26" rx="7" fill="#FFFFFF" stroke="#C8322B" stroke-width="1.5"/>
			<text x="0" y="33" text-anchor="middle" font-family="Montserrat, system-ui, sans-serif" font-size="11" font-weight="700" fill="#7F1D1D">
				${escapeXml(mapGeometry.destinationPoint.label)}
			</text>
		</g>

		<g transform="translate(24, 22)">
			<rect width="348" height="64" rx="10" fill="rgba(255, 255, 255, 0.94)" stroke="#DCD6CA" stroke-width="1.2"/>
			<text x="16" y="25" font-family="Montserrat, system-ui, sans-serif" font-size="14" font-weight="700" fill="#1C1917">
				${escapeXml(village.desaAdatName.toUpperCase())} • ${escapeXml(village.kabupaten)}
			</text>
			<text x="16" y="46" font-family="Figtree, system-ui, sans-serif" font-size="11.5" font-weight="500" fill="#57534E">
				${escapeXml(mapGeometry.coordinatesLabel)}
			</text>
		</g>

		<g transform="translate(888, 48)">
			<circle r="24" fill="rgba(255, 255, 255, 0.94)" stroke="#DCD6CA" stroke-width="1.2"/>
			<path d="M 0,-14 L 5,4 L 0,0 L -5,4 Z" fill="#B45309"/>
			<text x="0" y="16" text-anchor="middle" font-family="Montserrat, system-ui, sans-serif" font-size="10" font-weight="700" fill="#44403C">U</text>
		</g>

		<g transform="translate(24, 478)">
			<rect width="612" height="40" rx="8" fill="rgba(255, 255, 255, 0.94)" stroke="#DCD6CA" stroke-width="1.2"/>
			<line x1="18" y1="20" x2="44" y2="20" stroke="#C8322B" stroke-width="6" stroke-linecap="round"/>
			<text x="52" y="24" font-family="Figtree, system-ui, sans-serif" font-size="11.5" font-weight="600" fill="#292524">Rute Upacara (Ditutup)</text>

			<line x1="212" y1="20" x2="238" y2="20" stroke="#D97706" stroke-width="6" stroke-dasharray="6 4" stroke-linecap="round"/>
			<text x="246" y="24" font-family="Figtree, system-ui, sans-serif" font-size="11.5" font-weight="600" fill="#292524">Buka-Tutup Pecalang</text>

			<line x1="408" y1="20" x2="434" y2="20" stroke="#15803D" stroke-width="6" stroke-dasharray="4 5" stroke-linecap="round"/>
			<text x="442" y="24" font-family="Figtree, system-ui, sans-serif" font-size="11.5" font-weight="600" fill="#292524">Jalur Alternatif Terbuka</text>
		</g>
	</svg>`;

	return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}
