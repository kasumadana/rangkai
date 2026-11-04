# Quality Assurance and Validation Plan — Rangkai

Version: 0.1.0
Status: Planned, not executed

## 1. Testing Objectives

Verify that Rangkai:

- Works end-to-end.
- Handles unseen documents.
- Enforces permissions.
- Does not publish guessed information.
- Recovers from external service failures.
- Remains usable on mobile devices.

## 2. Test Layers

Unit:

- Zod schemas.
- Date/time normalization.
- State transitions.
- Permission helpers.
- Road-status expiry logic.
- Waste quantity validation.

Integration:

- Hono endpoints.
- Deterministic health check endpoint (/api/health).
- Neon database queries and PostGIS verification (tests/integration/db.test.ts).
- Better Auth session and authentication endpoints (tests/integration/auth-events.test.ts).
- Origin and CSRF defense on application mutating requests (rejection of untrusted origins and simple form types).
- Fail-closed authentication configuration (high-entropy secrets, HTTPS URL requirement in production, 503 dependency errors).
- Strict ISO 8601 timestamp parsing with explicit timezone offset verification.
- Organization membership and RBAC authorization.
- Event assignment scoping and revocation (officers only receive assigned events in detail and listings).
- Event CRUD, bounded pagination, review state transition, road-impact publication gating (verified road segments requirement), and lifecycle cancellation with reason.
- Stale verification reset to draft on core field modification during review.
- Terminal state modification prevention (completed/cancelled).
- Idempotent publication retries without duplicate slug creation or audit duplication.
- Atomic database mutation + audit log batching with rollback verification.
- R2 upload lifecycle, stream-bounded size limits (8 MB documents, 5 MB photos), and rollback compensation.
- A05-A08 operational implementation integration suite (tests/integration/operations-a05-a08.test.ts) covering preflight Neon dev branch guard (`br-wandering-paper-aogdxs48`), synthetic fixture loaders (strictly unverified synthetic test data), document uploads, Gemini AI extraction with schema validation and rate limits, human field corrections, live road status idempotency and future timestamp rejection, cleanup lifecycle with officer task ownership and evidence prerequisites, and public API waste separation (`weighedKg` vs `estimatedKg`).

E2E:

- Playwright browser flows.
- Organizer workflow.
- Officer workflow.
- Anonymous public workflow.

AI evaluation:

- Unseen document dataset.
- Field-level metrics.
- Error categorization.

## 3. Critical Test Cases

Setiap skenario uji di bawah ini dirancang terstruktur (*reproducible & actionable*) agar dapat dijalankan secara konsisten oleh QA manual maupun diotomasi dengan Playwright (C05). Label pesan mengacu pada standar `src/react-app/lib/constants/labels.ts` dan cetak biru wireframe.

---

### TC-000: Health Check Endpoint Liveness
- **Prasyarat:** Layanan backend Cloudflare Worker dan API aktif.
- **Langkah Uji:**
  1. Kirim request `GET /api/health` dengan header `Accept: application/json`.
  2. Buka URL `/api/health` langsung via peramban web (navigasi langsung).
- **Data Uji:** Header standar HTTP.
- **Hasil yang Diharapkan:**
  - Status HTTP `200 OK`.
  - Payload JSON: `{ "status": "ok", "service": "rangkai-api", "timestamp": "<ISO-8601-UTC>" }`.
  - Tidak memicu error perutean aset statis Vite/workerd.

---

### TC-001: Pembuatan dan Penyimpanan Draf Kegiatan (Create Draft Event)
- **Layar / Alur:** `B4-Step1` (`/dashboard/events/new`)
- **Prasyarat:** Login sebagai Panitia (`organizer`) Banjar Sari.
- **Langkah Uji:**
  1. Buka halaman pembuatan kegiatan baru.
  2. Masukkan Judul Kegiatan, Kategori, Tempat/Pura, dan Tanggal & Jam Mulai (WITA).
  3. Klik tombol aksi *"Simpan Draf"*.
  4. Lakukan penyegaran halaman (*refresh* peramban).
- **Data Uji:**
  - Judul: `"Piodalan Pura Desa Banjar Sari"`
  - Kategori: `"Upacara Keagamaan"`
  - Waktu Mulai: `"2026-11-05T08:00:00+08:00"`
- **Hasil yang Diharapkan:**
  - Data tersimpan di tabel `events` dengan status `draft`.
  - Waktu tersimpan dalam format UTC di database, ditampilkan dalam WITA di UI.
  - Muncul notifikasi draf tersimpan dan URL dialihkan ke `/dashboard/events/:id`.
  - Data formulir tidak hilang saat halaman di-refresh.
  - Catatan audit log terbuat di tabel `audit_logs`.

---

### TC-002: Unggah Berkas Pengumuman Valid (Upload Valid Document)
- **Layar / Alur:** `B4-Step2` (`/dashboard/events/:id/document`)
- **Prasyarat:** Draf kegiatan telah dibuat (TC-001), peran `organizer`.
- **Langkah Uji:**
  1. Tarik-dan-lepas (*drag & drop*) berkas scan surat pengumuman berukuran <= 8 MB.
  2. Amati indikator proses pengunggahan.
- **Data Uji:** Berkas PDF/JPEG valid ukuran 2.4 MB (`surat-pengumuman-piodalan.pdf`).
- **Hasil yang Diharapkan:**
  - Tampil indikator loading `D11-Upload` (*"Ngiring antos ajebos... Sedang mengunggah berkas ke penyimpanan privat Cloudflare R2..."*).
  - Berkas tersimpan di *bucket* privat R2.
  - Rekaman dokumen dibuat di tabel `documents` dengan relasi `eventId`.
  - Pratinjau berkas dapat dibuka di panel kiri (desktop) atau laci/drawer (mobile).

---

### TC-003: Penolakan Berkas Unggahan Melebihi Batas (Reject Oversized File)
- **Layar / Alur:** `B4-Step2` (`/dashboard/events/:id/document`)
- **Prasyarat:** Peran `organizer`, form upload Step 2 aktif.
- **Langkah Uji:**
  1. Pilih berkas pengumuman berukuran `> 8 MB` (misal 10.5 MB).
  2. Klik tombol unggah atau lepaskan berkas ke dropzone.
- **Data Uji:** Berkas gambar/PDF resolusi tinggi ukuran 10.5 MB.
- **Hasil yang Diharapkan:**
  - Berkas ditolak oleh validasi sisi-klien sebelum diunggah / ditolak API dengan status `413 Payload Too Large`.
  - Tampil kartu error state **D4**:
    - Judul: **"Ampura, berkas durung prasida kasimpen"**
    - Deskripsi: Memberitahu batasan ukuran maksimal 8 MB dan format yang diizinkan.
    - Tombol Aksi: *"Coba Unggah Kembali"* dan *"Pilih Berkas Lain"*.
  - Tidak ada data sampah yang tersimpan ke R2.

---

### TC-004: Ekstraksi Terstruktur Informasi Surat dengan AI (AI Extraction)
- **Layar / Alur:** `B4-Step3` & `B7` (`/dashboard/events/:id/review`)
- **Prasyarat:** Dokumen surat pengumuman berhasil diunggah (TC-002).
- **Langkah Uji:**
  1. Klik tombol *"Ekstrak dengan AI"*.
  2. Amati proses pembacaan dan hasil formulir terstruktur.
- **Data Uji:** Surat pengumuman resmi memuat tanggal, jam, rute prosesi adat, dan lokasi pura.
- **Hasil yang Diharapkan:**
  - Menampilkan loading state `D11-AI` (*"Ngiring antos ajebos... Gemini AI sedang membaca dan mengekstrak rincian surat..."*).
  - Backend memanggil Gemini API secara server-side dan memvalidasi output dengan Zod.
  - Kolom form terisi otomatis dan diberi lencana (*badge*) **`EXTRACTED`** (*Hasil Ekstraksi AI*).
  - Panel kiri menampilkan surat asli untuk memudahkan perbandingan mata manusia (*human-in-the-loop*).
  - Kunci API Gemini tidak bocor ke jaringan sisi-klien (*browser network tab*).

---

### TC-005: Penanganan Jam Selesai yang Tidak Tercantum (Handle Missing End Time)
- **Layar / Alur:** `B4-Step4` & `B7` (Review Panel)
- **Prasyarat:** Surat pengumuman hanya mencantumkan jam mulai (contoh: *"Mulai pukul 09:00 WITA s/d selesai"*).
- **Langkah Uji:**
  1. Lakukan ekstraksi AI pada dokumen tersebut.
  2. Periksa isian kolom *Jam Selesai*.
- **Data Uji:** Dokumen sampel C02 dengan jam penutupan tidak spesifik.
- **Hasil yang Diharapkan:**
  - Sistem **TIDAK MENGARANG** jam selesai fiktif. Nilai `endsAt` tetap `null`.
  - Kolom jam selesai ditandai badge **`MISSING`** (*Data Tidak Ditemukan*).
  - Tampil catatan panduan agar panitia menentukan estimasi jam penutupan secara manual.

---

### TC-006: Penanganan Nama Jalan Ambigu (Handle Ambiguous Road Name)
- **Layar / Alur:** `B4-Step4` / `B8` (Ruas Jalan)
- **Prasyarat:** Surat pengumuman menyebutkan nama jalan lokal/tidak baku (misal: *"Jalan dekat catus pata banjar"*).
- **Langkah Uji:**
  1. Ekstrak dokumen dan tinjau bagian ruas jalan terdampak.
- **Data Uji:** Dokumen sampel C02 dengan rute prosesi adat berbasis patokan lokal.
- **Hasil yang Diharapkan:**
  - Sistem **TIDAK MEMBUAT** koordinat geometri jalan karangan.
  - Bidang jalan ditandai badge **`NEEDS_REVIEW`** (*Perlu Tinjauan*).
  - Jika dicari pada daftar dan tidak cocok, muncul fallback state **D2**:
    - Judul: **"Margi durung kapanggih"**
    - Deskripsi: *"Sistem tidak menebak rute secara otomatis, silakan tandai segmen jalan terverifikasi langsung pada peta."*
    - Tombol Aksi: *"Pilih Segmen di Peta"*.

---

### TC-007: Koreksi Manual Hasil Ekstraksi AI (Human Correction)
- **Layar / Alur:** `B7` (`/dashboard/events/:id/review`)
- **Prasyarat:** Kolom form hasil ekstraksi AI tampil di layar review.
- **Langkah Uji:**
  1. Klik kolom teks nama jalan atau jam acara.
  2. Ubah nilainya secara manual sesuai surat asli.
  3. Klik tombol *"Simpan Koreksi"*.
- **Data Uji:** Mengubah jam mulai dari `08:00` menjadi `09:30 WITA`.
- **Hasil yang Diharapkan:**
  - Lencana kolom berubah dari `EXTRACTED` / `NEEDS_REVIEW` menjadi **`CORRECTED`** (*Telah Dikoreksi Manual*).
  - Riwayat koreksi (nilai sebelum dan sesudah) tercatat di tabel `audit_logs`.
  - Status event tetap aman di tahap `review` dan belum terpublikasi.

---

### TC-008: Pencegahan Publikasi Tanpa Tinjauan Lengkap (Gating Publication)
- **Layar / Alur:** `B4-Step7` (`/dashboard/events/:id/publish`)
- **Prasyarat:** Event masih berstatus `draft` murni, belum melalui tahap review, atau belum memilih segmen jalan terverifikasi.
- **Langkah Uji:**
  1. Coba panggil langsung mutasi API publikasi `POST /api/events/:id/publish` melalui klien atau pintasan tombol.
- **Data Uji:** ID Event berstatus draft tanpa entri `road_impacts` terverifikasi.
- **Hasil yang Diharapkan:**
  - Permintaan ditolak server dengan kode status `409 Conflict`.
  - Muncul pesan peringatan bahwa kegiatan wajib memiliki verifikasi manusia dan minimal 1 ruas jalan resmi sebelum dipublikasikan.
  - Event tetap berstatus `draft`.

---

### TC-009: Publikasi Kegiatan dan Verifikasi Tampilan Publik (Publish & Public View)
- **Layar / Alur:** `B4-Step7` -> `A3` (`/events/:slug`)
- **Prasyarat:** Seluruh tahapan 1–6 wizard Create Event telah lengkap & diverifikasi.
- **Langkah Uji:**
  1. Klik tombol *"Publikasikan Informasi Kegiatan"*.
  2. Verifikasi konfirmasi sukses dan salin tautan publik.
  3. Buka jendela penyamaran (*Incognito/Private Window*) tanpa login.
  4. Akses URL publik `/events/:slug` tersebut.
- **Data Uji:** Slug event: `/events/piodalan-pura-desa-banjar-sari`.
- **Hasil yang Diharapkan:**
  - Status event di database berubah menjadi `published` dengan `publishedAt` terisi waktu UTC saat ini.
  - Muncul modal sukses **D9**:
    - Judul: **"Matur suksma, parikrama sampun memargi antar"**
    - Deskripsi: Tautan publik resmi aktif dan tercatat di audit log.
  - Halaman publik dapat diakses masyarakat umum tanpa harus login.
  - Menampilkan waktu pelaksanaan dalam format WITA dan status ruas jalan terverifikasi.

---

### TC-010: Pencegahan Akses Publik ke Dokumen Privat (Block Anonymous Document Access)
- **Layar / Alur:** Akses langsung URL dokumen R2 / API dokumen.
- **Prasyarat:** Berkas pengumuman tersimpan di storage privat R2 (dari TC-002).
- **Langkah Uji:**
  1. Salin endpoint dokumen `/api/events/:id/documents/:docId`.
  2. Buka URL tersebut di browser tanpa cookie sesi login (mode anonim).
- **Data Uji:** ID dokumen privat milik Banjar Sari.
- **Hasil yang Diharapkan:**
  - Server mengembalikan status `401 Unauthorized` atau `403 Forbidden`.
  - Berkas dokumen tidak pernah dapat diunduh tanpa kredensial keanggotaan panitia yang sah.

---

### TC-011: Pembaruan Status Jalan oleh Petugas Berwenang (Officer Traffic Update)
- **Layar / Alur:** `C3` & `C4` (`/field/events/:id`)
- **Prasyarat:** Login sebagai Petugas Lalu Lintas (`officer` Pecalang/Dishub) yang ditugaskan resmi ke event tersebut (`canUpdateTraffic = true`).
- **Langkah Uji:**
  1. Buka layar tugas ruas jalan di ponsel.
  2. Pilih tombol status `CLOSED` (Ditutup) dengan target sentuh >= 48px.
  3. Konfirmasi pada modal dialog C4.
  4. Kirim pembaruan status.
- **Data Uji:** Status `closed`, catatan: *"Iring-iringan melasti melintasi jalan raya"*.
- **Hasil yang Diharapkan:**
  - Mutasi dikirim dengan `mutationId` unik (idempoten).
  - Status tersimpan di tabel `road_status_updates` dengan waktu kedaluwarsa (`expiresAt`) default 2 jam.
  - Tampil layar sukses `C5-S` (*"Pembaruan status sampun kasimpen"*).
  - Halaman publik `/events/:slug` seketika memperbarui status ruas jalan menjadi `Ditutup` (latar merah `#FEF2F2`, teks merah `#B91C1C`).

---

### TC-012: Penolakan Pembaruan Status oleh Petugas Tidak Ditugaskan (Unauthorized Officer)
- **Layar / Alur:** API `POST /api/roads/:id/status`
- **Prasyarat:** Login sebagai petugas yang **TIDAK DITUGASKAN** pada event terkait atau `canUpdateTraffic = false`.
- **Langkah Uji:**
  1. Coba kirim payload perubahan status ruas jalan ke event tersebut.
- **Data Uji:** Kredensial Officer Banjar Kaja mencoba mengubah event Banjar Sari.
- **Hasil yang Diharapkan:**
  - Permintaan ditolak server dengan kode status `403 Forbidden`.
  - Status ruas jalan tidak berubah sama sekali di database maupun tampilan publik.

---

### TC-013: Penandaan Status Jalan Kedaluwarsa / Stale (Stale-Is-Never-Green Rule)
- **Layar / Alur:** `A3` & `A4` (Halaman Publik & Peta)
- **Prasyarat:** Status ruas jalan terakhir diperbarui > 2 jam yang lalu (`expiresAt < NOW()`).
- **Langkah Uji:**
  1. Buka halaman detail kegiatan publik `/events/:slug` atau peta `/map`.
  2. Periksa kartu status jalan dan indikator ruas di peta.
- **Data Uji:** Waktu pembaruan terakhir tercatat 140 menit yang lalu.
- **Hasil yang Diharapkan:**
  - Status ruas jalan **DILARANG OTOMATIS BERUBAH JADI HIJAU / LANCAR**.
  - Badge status berubah menjadi abu-abu dengan label `unknown`: **"Butuh Konfirmasi"**.
  - Muncul penanda warning state **D5**:
    - Judul: **"Kasinahang durung pasti"**
    - Deskripsi: *"Status terakhir belum dikonfirmasi ulang oleh petugas lapangan lebih dari 2 jam. Sesuai aturan operasional, kondisi jalan tidak otomatis dianggap lancar."*

---

### TC-014: Pengunggahan Bukti & Data Kebersihan (Submit Cleanup Evidence)
- **Layar / Alur:** `C7`, `C8`, & `C9` (`/field/events/:id/cleanup/:taskId`)
- **Prasyarat:** Login sebagai Petugas Kebersihan yang ditugaskan (`canUpdateCleanup = true`).
- **Langkah Uji:**
  1. Unggah foto kondisi sebelum pembersihan (*before photo*).
  2. Unggah foto kondisi setelah pembersihan (*after photo*).
  3. Isi formulir timbangan sampah: Organik (45 kg, ditimbang), Daur Ulang (2 karung).
  4. Klik *"Kirim Laporan Kebersihan"*.
- **Data Uji:** Foto valid, Kategori Organik (45 kg, `weighed`), Daur Ulang (2 karung, `estimated`).
- **Hasil yang Diharapkan:**
  - Foto tersimpan di R2 dan tercatat di `cleanup_evidence`.
  - Data timbangan tersimpan di `waste_records` dengan pemisahan jujur antara berat terukur dan estimasi karung.
  - Status tugas berubah menjadi `submitted` (*Menunggu Verifikasi*).
  - Tampil layar konfirmasi `C10`.

---

### TC-015: Verifikasi dan Pembukaan Ulang Tugas Kebersihan (Verify or Reopen Cleanup)
- **Layar / Alur:** `B11` (`/dashboard/events/:id/cleanup`)
- **Prasyarat:** Login sebagai Panitia/Prajuru, terdapat tugas kebersihan berstatus `submitted`.
- **Langkah Uji:**
  - **Skenario A (Verifikasi Sukses):** Tinjau foto dan klik *"Verifikasi Penyelesaian"*.
  - **Skenario B (Buka Ulang):** Foto bukti tidak jelas, klik *"Buka Ulang Tugas"* disertai catatan revisi.
- **Data Uji:** ID tugas kebersihan berstatus `submitted`.
- **Hasil yang Diharapkan:**
  - Pada Skenario A: Status tugas berubah menjadi `verified`, kolom `verifiedBy` dan `verifiedAt` terisi waktu saat ini.
  - Pada Skenario B: Status tugas kembali menjadi `reopened`, petugas kebersihan menerima instruksi perbaikan.

---

### TC-016: Independensi Status Kebersihan dan Status Jalan (Cleanup Road Invariant)
- **Layar / Alur:** `B11` -> `A3` & `C3`
- **Prasyarat:** Ruas jalan di lokasi acara sedang berstatus `CLOSED` (Ditutup).
- **Langkah Uji:**
  1. Petugas menyelesaikan seluruh tugas kebersihan dan Prajuru memverifikasinya (`verified`).
  2. Periksa status operasional ruas jalan terkait di halaman publik dan dashboard.
- **Hasil yang Diharapkan:**
  - **INVARIAN MUTLAK:** Status jalan **TETAP DITUTUP (`CLOSED`)** dan **TIDAK TERBUKA OTOMATIS**.
  - Jalan hanya boleh dibuka kembali melalui tindakan pembaruan eksplisit oleh petugas lalu lintas berwenang.

---

### TC-017: Penanganan Kegagalan Layanan Ekstraksi AI (Gemini Timeout / Fallback)
- **Layar / Alur:** `B4-Step3` / `B7`
- **Prasyarat:** Terjadi timeout pada koneksi Gemini API (> 30 detik) atau kuota API habis.
- **Langkah Uji:**
  1. Jalankan proses ekstraksi AI pada dokumen yang diunggah.
- **Data Uji:** Simulasi kegagalan jaringan eksternal AI.
- **Hasil yang Diharapkan:**
  - Aplikasi tidak mengalami layar putih (*crash / blank screen*).
  - Tampil fallback state **D3**:
    - Judul: **"Ampura, ekstraksi AI durung prasida memargi"**
    - Deskripsi: Memberitahu bahwa dokumen sumber tetap aman dan pengguna diarahkan mengisi formulir manual.
    - Tombol Aksi: *"Isi Formulir Manual"* dan *"Coba Ekstraksi Ulang"*.
  - Pengguna dapat menyelesaikan pembuatan kegiatan tanpa terblokir kegagalan AI.

---

### TC-018: Penanganan Kegagalan Peta Digital (Map Tile Failure Fallback)
- **Layar / Alur:** `A3`, `A4`, dan `B8`
- **Prasyarat:** Server tile MapLibre gagal dimuat (koneksi lambat atau server peta offline).
- **Langkah Uji:**
  1. Buka halaman detail kegiatan publik atau peta dampak jalan saat tile peta gagal diunduh.
- **Data Uji:** Simulasi pemblokiran domain tile peta.
- **Hasil yang Diharapkan:**
  - Kontainer peta menampilkan fallback state **D6**:
    - Judul: **"Peta durung prasida kacingak"**
    - Deskripsi: Menjelaskan peta gagal dimuat namun informasi penutupan jalan tetap tersedia.
  - Daftar teks ruas jalan di bawah peta tetap menampilkan nama ruas jalan, jam penutupan, dan status jalur secara lengkap dan mudah dibaca.

---

### TC-019: Pencegahan Hilangnya Data Saat Gagal Kirim Form (Optimistic Retain Form Values)
- **Layar / Alur:** `C3` / `C9` (Layar Petugas Lapangan)
- **Prasyarat:** Koneksi internet terputus sesaat saat petugas mengirim pembaruan status atau data sampah.
- **Langkah Uji:**
  1. Masukkan status jalan baru dan catatan lapangan.
  2. Kirim form saat internet mati.
- **Data Uji:** Catatan lapangan sepanjang 2 paragraf.
- **Hasil yang Diharapkan:**
  - Tampil error state **D7**:
    - Judul: **"Ampura, pembaruan status durung kintun"**
    - Deskripsi: *"Laporan status belum berhasil diterima oleh server. Pilihan status dan catatan yang sudah Anda ketik tetap tersimpan aman di layar ini."*
  - Nilai yang telah diketik petugas **TIDAK HILANG / TIDAK TER-RESET**.
  - Tersedia tombol *"Kirim Ulang Sekarang"* untuk mencoba kembali saat jaringan pulih.

---

### TC-020: Pencegahan Akses Antar-Organisasi (Cross-Organization Data Isolation)
- **Layar / Alur:** Endpoint API dan Dashboard Event.
- **Prasyarat:** Pengguna terotentikasi sebagai Panitia Organisasi A (Banjar Sari).
- **Langkah Uji:**
  1. Coba akses draf kegiatan atau lakukan mutasi data milik Organisasi B (Banjar Kaja) menggunakan ID event Organisasi B.
- **Data Uji:** UUID event milik organisasi lain.
- **Hasil yang Diharapkan:**
  - Server mengembalikan respon `403 Forbidden` atau `404 Not Found`.
  - Sistem tidak membocorkan data draf maupun dokumen privat antar-organisasi.
  - Percobaan akses tercatat di log keamanan.

## 4. AI Evaluation Protocol

Prepare an initial target of at least 20 permitted
documents with manually reviewed ground truth.

Include:

- Clean scans.
- Blurry photos.
- Missing dates.
- Multiple roads.
- Multiple event times.
- Similar road names.
- Conflicting or incomplete announcements.

Do not use all evaluation samples in prompt examples.

For each field, record:

- Ground truth.
- AI output.
- Exact match or error.
- Human correction.
- Error category.

For road names, calculate precision, recall, and F1.
For dates, evaluate exact normalized datetime match.

Do not claim a performance threshold is achieved
before measuring it.

## 5. Usability Validation

Target participants:

- 2 organizers or committee members.
- 2 field officers.
- 2 public road users.
- Additional participants if available.

Tasks:

- Create an event.
- Correct an AI field.
- Select an affected road.
- Update road status.
- Find a road closure.
- Complete a cleanup task.

Measure:

- Task completion.
- Time on task.
- Errors.
- Clarification requests.
- Observed usability problems.

These are recruitment targets, not completed interviews.

## 6. Performance Testing

Initial targets:

- Public page initial load < 3 seconds.
- Non-AI API p95 < 800 ms.
- Public status polling <= 30 seconds.
- No blocking UI during extraction.
- No unhandled errors on low-end mobile devices.

Test using realistic network throttling.
Report actual results separately from targets.

## 7. Security Testing

- Authentication bypass.
- Cross-tenant access.
- Unauthorized role escalation.
- Direct access to private R2 objects.
- Invalid MIME upload.
- Oversized upload.
- Duplicate status mutation.
- CSRF protection.
- Injection and malformed input.
- Sensitive data leakage in public APIs.

## 8. Accessibility Testing

- Keyboard-only navigation.
- Screen-reader labels.
- Focus visibility.
- Color contrast.
- Mobile zoom.
- Error-message association.
- Map alternatives.
- Status text without color dependence.

Target: WCAG 2.2 AA.

## 9. Field Pilot

Use one real event only with appropriate permission.

Before:

- Observe announcement preparation.
- Record baseline process and time.
- Verify road and cleanup responsibilities.

During:

- Record actual status updates.
- Compare system status with field observations.

After:

- Verify task completion.
- Record measured waste quantities if available.
- Interview operators.

Do not use a simulated event to claim real impact.

## 10. Release Gate

PASS requires:

- All P0 user journeys complete.
- All critical authorization tests pass.
- No public exposure of private documents.
- Manual fallback works when AI fails.
- Status expiry works.
- No false success after failed writes.
- Production URL loads.
- Test evidence is documented.

Any failed critical security or integrity test blocks release.
