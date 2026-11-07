/**
 * Canonical Empty and Error State copy & operational disclaimers (docs/07-UX-FLOW.md §7, AGENTS.md §1, §13).
 *
 * Every data view and async operation across Rangkai uses these constants
 * to guarantee consistent, honest Bahasa Indonesia messaging.
 */

export const UX_EMPTY_COPY = {
	NO_PUBLISHED_EVENTS: "Belum ada kegiatan yang dipublikasikan.",
	NO_MATCHING_ROAD: "Ruas jalan belum ditemukan. Pilih secara manual.",
	AI_UNAVAILABLE: "Ekstraksi otomatis belum tersedia. Isi data secara manual.",
	STALE_STATUS: "Status terakhir belum dikonfirmasi ulang.",
	MAP_UNAVAILABLE: "Peta tidak tersedia. Informasi jalan tetap dapat dibaca.",
	UPLOAD_FAILED: "Dokumen belum tersimpan. Coba unggah kembali.",
	NO_ORG_EVENTS: "Belum ada draf atau kegiatan di organisasi ini.",
	NO_ASSIGNED_EVENTS: "Belum ada kegiatan yang ditugaskan kepada Anda.",
	NO_CLEANUP_TASKS: "Belum ada tugas kebersihan yang terdaftar untuk kegiatan ini.",
	NO_WASTE_RECORDS: "Belum ada catatan volume sampah untuk kegiatan ini.",
} as const;

export const OPERATIONAL_DISCLAIMERS = {
	PUBLIC_LIMITATION:
		"Rangkai adalah sarana koordinasi informasi operasional kegiatan budaya, bukan izin penutupan jalan resmi dan tidak menggantikan kewenangan kepolisian, Dishub, atau pecalang di lapangan.",
	OPEN_ROAD_NOTE:
		"Status DIBUKA menunjukkan tidak ada penutupan aktif yang tercatat dari kegiatan ini, namun tidak menjamin jalan bebas hambatan atau kemacetan.",
	CLEANUP_INDEPENDENCE_NOTE:
		"Verifikasi kebersihan pasca-kegiatan bersifat independen dan tidak membuka kembali ruas jalan secara otomatis.",
	AI_REVIEW_REQUIRED:
		"Hasil ekstraksi AI merupakan draf awal yang belum terverifikasi. Panitia wajib memeriksa dan mengonfirmasi setiap kolom sebelum dipublikasikan.",
} as const;
