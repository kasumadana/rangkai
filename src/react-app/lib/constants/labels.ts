/**
 * Rangkai — UI Labels, Microcopy & System State Constants
 * 
 * Standar bahasa antarmuka pengguna untuk status operasional, siklus hidup data,
 * dan kondisi sistem (Empty, Loading, Error, Stale, Fallback) sesuai prinsip Pramana
 * (Honest System States) dan cetak biru wireframe D1-D12.
 * 
 * Judul state mengadopsi kesantunan bahasa Bali halus (basa alus), sedangkan
 * deskripsi dan tombol aksi menggunakan bahasa Indonesia fungsional yang lugas.
 */

// ============================================================================
// 1. STATUS RUAS JALAN (ROAD STATUSES)
// ============================================================================
export const ROAD_STATUS_LABELS = {
	open: {
		value: "open",
		label: "Lancar",
		fullLabel: "Lancar / Dibuka",
		description: "Ruas jalan dapat dilalui secara normal",
		badgeBg: "#EBF0E6",
		badgeText: "#4D702F",
		badgeBorder: "#C6D5B8",
	},
	intermittent: {
		value: "intermittent",
		label: "Buka-Tutup",
		fullLabel: "Buka-Tutup Berkala",
		description: "Pengalihan berkala atau antrean prosesi adat",
		badgeBg: "#FEF3C7",
		badgeText: "#B45309",
		badgeBorder: "#FDE68A",
	},
	closed: {
		value: "closed",
		label: "Ditutup",
		fullLabel: "Ditutup Penuh",
		description: "Penutupan penuh untuk upacara",
		badgeBg: "#FEF2F2",
		badgeText: "#B91C1C",
		badgeBorder: "#FECACA",
	},
	unknown: {
		value: "unknown",
		label: "Butuh Konfirmasi",
		fullLabel: "Butuh Konfirmasi / Kedaluwarsa",
		description: "Status belum diperbarui petugas lapangan (>30 menit)",
		badgeBg: "#F1F5F9",
		badgeText: "#64748B",
		badgeBorder: "#E2E8F0",
	},
	unconfirmed: {
		value: "unconfirmed",
		label: "Butuh Konfirmasi",
		fullLabel: "Butuh Konfirmasi / Kedaluwarsa",
		description: "Status belum diperbarui petugas lapangan (>30 menit)",
		badgeBg: "#F1F5F9",
		badgeText: "#64748B",
		badgeBorder: "#E2E8F0",
	},
} as const;

export type RoadStatusKey = keyof typeof ROAD_STATUS_LABELS;

// ============================================================================
// 2. STATUS SIKLUS HIDUP KEGIATAN (EVENT LIFECYCLE)
// ============================================================================
export const EVENT_STATUS_LABELS = {
	draft: {
		value: "draft",
		label: "Draf",
		description: "Formulir kegiatan belum lengkap atau belum dipublikasikan",
	},
	review: {
		value: "review",
		label: "Perlu Tinjauan",
		description: "Menunggu validasi hasil ekstraksi AI dan penentuan ruas jalan",
	},
	published: {
		value: "published",
		label: "Dipublikasikan",
		description: "Terbit dan dapat diakses masyarakat pada direktori publik",
	},
	active: {
		value: "active",
		label: "Sedang Berlangsung",
		description: "Kegiatan adat dan penutupan jalan sedang berlangsung",
	},
	completed: {
		value: "completed",
		label: "Selesai",
		description: "Kegiatan adat dan penanganan kebersihan telah tuntas",
	},
	cancelled: {
		value: "cancelled",
		label: "Dibatalkan",
		description: "Kegiatan adat atau koordinasi jalan dibatalkan secara eksplisit",
	},
	archived: {
		value: "archived",
		label: "Diarsipkan",
		description: "Kegiatan telah diarsipkan untuk arsip riwayat banjar",
	},
} as const;

export type EventStatusKey = keyof typeof EVENT_STATUS_LABELS;

// ============================================================================
// 3. STATUS VERIFIKASI EKSTRAKSI AI (AI REVIEW STATUSES)
// ============================================================================
export const AI_FIELD_STATUS_LABELS = {
	extracted: {
		value: "extracted",
		label: "Ekstraksi AI",
		description: "Hasil pembacaan otomatis dari dokumen pengumuman",
	},
	missing: {
		value: "missing",
		label: "Tidak Ditemukan",
		description: "Kolom data tidak tertera pada dokumen fisik",
	},
	needs_review: {
		value: "needs_review",
		label: "Perlu Tinjauan",
		description: "Entitas ambigu, memerlukan verifikasi panitia",
	},
	corrected: {
		value: "corrected",
		label: "Telah Dikoreksi",
		description: "Nilai telah disunting manual oleh panitia",
	},
	confirmed: {
		value: "confirmed",
		label: "Terkonfirmasi",
		description: "Telah disetujui untuk dimasukkan ke data publikasi",
	},
} as const;

export type AiFieldStatusKey = keyof typeof AI_FIELD_STATUS_LABELS;

// ============================================================================
// 4. STATUS TUGAS KEBERSIHAN (CLEANUP STATUSES)
// ============================================================================
export const CLEANUP_STATUS_LABELS = {
	todo: {
		value: "todo",
		label: "Belum Dimulai",
		description: "Tugas pembersihan belum dikerjakan oleh petugas",
	},
	in_progress: {
		value: "in_progress",
		label: "Sedang Dikerjakan",
		description: "Petugas sedang melakukan pembersihan di lokasi",
	},
	submitted: {
		value: "submitted",
		label: "Menunggu Verifikasi",
		description: "Bukti foto sebelum/sesudah dan timbangan sampah telah diunggah",
	},
	verified: {
		value: "verified",
		label: "Terverifikasi",
		description: "Telah diperiksa dan disetujui resmi oleh Prajuru Banjar",
	},
	reopened: {
		value: "reopened",
		label: "Perlu Diulang",
		description: "Bukti belum memadai, penanganan sampah diminta diulang",
	},
} as const;

export type CleanupStatusKey = keyof typeof CLEANUP_STATUS_LABELS;

// ============================================================================
// 5. KATEGORI SAMPAH & METODE PENGUKURAN (WASTE MANAGEMENT)
// ============================================================================
export const WASTE_CATEGORY_LABELS = {
	organic: {
		value: "organic",
		label: "Organik",
		description: "Canang sari, banten, daun pisang, janur, bunga sisa upakara",
		color: "#355024",
	},
	recyclable: {
		value: "recyclable",
		label: "Daur Ulang",
		description: "Botol plastik kemasan, cup minuman, kardus, kaleng",
		color: "#0284C7",
	},
	residual: {
		value: "residual",
		label: "Residu",
		description: "Dupa, puntung rokok, plastik tercemar, abu persembahyangan",
		color: "#78716C",
	},
} as const;

export const MEASUREMENT_METHOD_LABELS = {
	weighed: {
		value: "weighed",
		label: "Berat Terukur (kg)",
		description: "Ditimbang langsung menggunakan timbangan aktual",
	},
	estimated: {
		value: "estimated",
		label: "Estimasi Berat (kg)",
		description: "Perkiraan bobot berdasarkan perkiraan volume",
	},
} as const;

// ============================================================================
// 6. PESAN KONDISI SISTEM & SHARED STATES (D1 - D11)
// ============================================================================
export interface SystemStateMessage {
	code: string;
	title: string;       // Bahasa Bali Halus
	description: string; // Bahasa Indonesia Fungsional
	primaryAction?: string;
	secondaryAction?: string;
}

export const SYSTEM_STATE_MESSAGES: Record<string, SystemStateMessage> = {
	// D1: Direktori Kegiatan Publik / Dashboard Kosong
	noEvents: {
		code: "D1",
		title: "Durung wenten parikrama sane kasobyahang",
		description:
			"Saat ini belum ada kegiatan adat yang dipublikasikan berdampak pada ruas jalan umum pada filter waktu atau wilayah yang dipilih.",
		primaryAction: "Reset Filter Pencarian",
		secondaryAction: "Kembali ke Beranda",
	},

	// D2: Ruas Jalan Belum Dipilih / Ditemukan
	noMatchingRoad: {
		code: "D2",
		title: "Margi durung kapanggih",
		description:
			"Ruas jalan belum ditemukan atau belum dipilih. Sistem tidak menebak rute secara otomatis, silakan tandai segmen jalan terverifikasi langsung pada peta.",
		primaryAction: "Pilih Segmen di Peta",
		secondaryAction: "Ubah Kata Kunci",
	},

	// D3: Ekstraksi AI Terkendala / Timeout
	aiUnavailable: {
		code: "D3",
		title: "Ampura, ekstraksi AI durung prasida memargi",
		description:
			"Layanan pembacaan otomatis dokumen pengumuman sedang tidak dapat dijangkau. Berkas Anda tetap tersimpan dengan aman di penyimpanan privat.",
		primaryAction: "Isi Formulir Manual",
		secondaryAction: "Coba Ekstraksi Ulang",
	},

	// D4: Unggah Dokumen / Bukti Foto Gagal
	uploadFailed: {
		code: "D4",
		title: "Ampura, berkas durung prasida kasimpen",
		description:
			"Berkas belum berhasil tersimpan ke penyimpanan server. Pastikan ukuran file maksimal 8 MB dengan format PDF, JPG, atau PNG, lalu coba kembali.",
		primaryAction: "Coba Unggah Kembali",
		secondaryAction: "Pilih Berkas Lain",
	},

	// D5: Status Jalan Kedaluwarsa / Stale (>30 Menit)
	staleRoadStatus: {
		code: "D5",
		title: "Kasinahang durung pasti",
		description:
			"Status terakhir belum dikonfirmasi ulang oleh petugas lapangan lebih dari 30 menit. Sesuai aturan operasional, kondisi jalan tidak otomatis dianggap lancar.",
		primaryAction: "Lihat Waktu Pembaruan",
		secondaryAction: "Minta Konfirmasi Petugas",
	},

	// D6: Peta Gagal Dimuat
	mapUnavailable: {
		code: "D6",
		title: "Peta durung prasida kacingak",
		description:
			"Peta digital tidak dapat dimuat karena kendala koneksi. Informasi nama ruas jalan, jam penutupan, dan status jalur tetap dapat dibaca pada daftar teks di bawah.",
		primaryAction: "Muat Ulang Peta",
		secondaryAction: "Buka Daftar Ruas Jalan",
	},

	// D7: Pembaruan Lapangan Gagal Dikirim ke Server
	updateFailed: {
		code: "D7",
		title: "Ampura, pembaruan status durung kintun",
		description:
			"Laporan status belum berhasil diterima oleh server. Pilihan status dan catatan yang sudah Anda ketik tetap tersimpan aman di layar ini.",
		primaryAction: "Kirim Ulang Sekarang",
		secondaryAction: "Periksa Isian Form",
	},

	// D8: Tugas Kebersihan Menunggu Verifikasi Penyelenggara
	cleanupPendingVerification: {
		code: "D8",
		title: "Ngantos pamutus verifikasi saking Prajuru",
		description:
			"Foto bukti dan catatan timbangan sampah telah diterima. Menunggu pemeriksaan dan persetujuan verifikasi resmi dari pihak Prajuru Banjar.",
		primaryAction: "Tinjau Bukti Foto",
		secondaryAction: "Kembali ke Daftar Tugas",
	},

	// D9: Publikasi Kegiatan Berhasil
	publicationSuccess: {
		code: "D9",
		title: "Matur suksma, parikrama sampun memargi antar",
		description:
			"Informasi kegiatan adat berhasil dipublikasikan. Tautan publik telah aktif dan waktu rilis telah dicatat ke dalam audit log resmi.",
		primaryAction: "Salin Tautan Publik",
		secondaryAction: "Lihat Halaman Kegiatan",
	},

	// D10: Dialog Peringatan Perubahan Belum Disimpan
	unsavedChanges: {
		code: "D10",
		title: "Elingan, wenten parubahan sane durung kasimpen",
		description:
			"Koreksi data AI atau isian formulir yang belum disimpan sebagai draf akan hilang jika Anda berpindah ke halaman lain sekarang.",
		primaryAction: "Simpan Draf & Keluar",
		secondaryAction: "Tetap di Halaman Ini",
	},

	// D11: Loading States
	loadingData: {
		code: "D11",
		title: "Ngiring antos ajebos...",
		description:
			"Sedang memuat dan memvalidasi data terverifikasi dari server. Mohon tunggu sejenak dan jangan menutup peramban.",
	},
	loadingAiExtraction: {
		code: "D11-AI",
		title: "Ngiring antos ajebos...",
		description:
			"Gemini AI sedang membaca dan mengekstrak rincian surat pengumuman secara privat di server...",
	},
	loadingUpload: {
		code: "D11-Upload",
		title: "Ngiring antos ajebos...",
		description:
			"Sedang mengunggah berkas ke penyimpanan privat Cloudflare R2...",
	},
} as const;
