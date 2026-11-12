/** Reviewed guidance. Answers and links are authored by the application, not the model. */
export const assistantHelp = {
 platform: { title: "Tentang Rangkai", answer: "Rangkai membantu melihat informasi kegiatan dan dampaknya pada jalan. Status jalan berasal dari laporan petugas dan dapat kedaluwarsa.", url: "/events" },
 find: { title: "Mencari kegiatan", answer: "Buka daftar kegiatan, lalu pilih kegiatan untuk melihat jadwal, lokasi, dan informasi jalan yang tersedia.", url: "/events" },
 map: { title: "Menggunakan peta", answer: "Buka peta untuk melihat kegiatan dan ruas terdampak. Pilih ruas untuk membaca status dan waktu laporannya. Status yang belum terkonfirmasi bukan berarti jalan terbuka.", url: "/peta" },
 location: { title: "Melihat lokasi Anda", answer: "Pada peta, tekan tombol lokasi dan izinkan akses lokasi di peramban. Tekan kembali untuk menghentikan pelacakan.", url: "/peta" },
 event: { title: "Mengelola kegiatan", answer: "Masuk dan buka kegiatan untuk membuat atau meninjau informasi sebelum publikasi.", url: "/dashboard/events" },
 traffic: { title: "Melaporkan status jalan", answer: "Petugas yang ditugaskan dapat membuka penugasan untuk mencatat pengamatan status jalan sesuai izin.", url: "/field" },
 cleanup: { title: "Mencatat kebersihan", answer: "Petugas yang ditugaskan dapat membuka penugasan untuk mencatat tugas kebersihan sesuai izin. Verifikasi kebersihan tidak membuka jalan.", url: "/field" },
} as const;

export type AssistantHelpTopic = keyof typeof assistantHelp;
