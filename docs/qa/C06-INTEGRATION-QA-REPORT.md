# Rangkai — Integration QA Report (Task C06)

> **Document Status:** Official QA Report  
> **Target Roadmap Item:** C06 (Integration Testing & QA)  
> **Repository Commit / Branch:** `feat/dashboard-audit-and-map-input`  
> **Execution Date:** 2026-11-08  
> **Test Harness:** Playwright E2E (`@playwright/test` v1.58.2) + Chromium Headless  
> **Environment:** Cloudflare Workers local environment + Vite SPA (Port 5173)

---

## 1. Executive Summary

Sesuai kriteria **Definition of Done** pada Roadmap C06:
1. **Laporan Bug Lengkap + Replay Test Steps**: Terdokumentasi secara rinci dengan payload, URL, expected vs actual outcome, serta mitigasi.
2. **Cakupan Pengujian**: Minimal 1 Happy Path E2E terpadu + 3 Failure Cases terverifikasi 100% lulus.
3. **Bug Ledger & Ownership**: Setiap temuan bug dan edge-case memiliki owner (PIC) yang tercatat jelas.

Seluruh pengujian dijalankan langsung tanpa melakukan seeding basis data remote (`pnpm db:seed` tidak dijalankan, menjaga integritas instance Neon dev). Pengujian memanfaatkan state browser terisolasi, API request context Playwright, serta synthetic fixtures terstruktur.

### Execution Results Overview

| Test Suite / Category | Test Case ID | Test Description | Status | Execution Time |
| :--- | :--- | :--- | :---: | :---: |
| **Failure Case 1** | `TC-003` | Penolakan berkas unggahan melebihi batas ukuran (> 8 MB) | **PASSED** | 1.9s |
| **Failure Case 2** | `TC-008` | Pencegahan publikasi event tanpa review prajuru / ruas jalan | **PASSED** | 33ms |
| **Failure Case 3** | `TC-012` | Penolakan pembaruan status jalan oleh aktor tanpa hak akses (403/401) | **PASSED** | 22ms |
| **Happy Path 1** | `HP-001` | Alur lengkap: Buat Draf -> Form Manual -> Input Peta -> Gating Verifikasi -> Portal Publik | **PASSED** | 1.8s |
| **Happy Path 2** | `TC-002` | Upload berkas dokumen valid (<= 8 MB) memicu indikator pemrosesan | **PASSED** | 1.4s |
| **Unit Test Suite** | `UT-ALL` | 53 unit tests (geo, AI evaluation, auth, release validator) | **PASSED** | 3.37s |
| **Static Build** | `BUILD` | Full bundle verification (`tsc -b && vite build`) | **PASSED** | 4.56s |

---

## 2. Replay Test Steps & Detailed Execution

### 2.1 Failure Case 1: Penolakan Berkas Unggahan Melebihi Batas (> 8 MB) (TC-003)

- **Test ID:** `TC-003`
- **Tipe Uji:** Failure & Edge Case Validation
- **Komponen:** `src/react-app/pages/EventWizardPage.tsx` (`input[type="file"]`)
- **Langkah Uji (Replay Steps):**
  1. Akses halaman wizard pembuatan acara pada rute `/dashboard/events/new`.
  2. Siapkan berkas biner tiruan berukuran 8.5 MB (`Buffer.alloc(8.5 * 1024 * 1024, "a")`) dengan format nama `oversized-surat-edaran.pdf` dan MIME `application/pdf`.
  3. Set berkas ke elemen `input[type="file"]` pada Langkah 1.
  4. Amati respon UI dan banner peringatan.
- **Payload / Input Data:**
  ```json
  {
    "fileName": "oversized-surat-edaran.pdf",
    "mimeType": "application/pdf",
    "fileSizeBytes": 8912896
  }
  ```
- **Hasil yang Diharapkan:**
  - Berkas ditolak sebelum payload dikirimkan ke jaringan.
  - Tampil banner peringatan error dengan judul *"Ukuran Berkas Melebihi Batas"* dan deskripsi yang menginformasikan batas maksimum 8 MB.
  - Form tidak melanjutkan proses ekstraksi dokumen.
- **Hasil Aktual:**
  - Lolos. Elemen teks *"Ukuran Berkas Melebihi Batas"* dan *"Ukuran berkas 8.5 MB melebihi batas maksimal 8 MB"* tampil seketika di layar.

---

### 2.2 Failure Case 2: Pencegahan Publikasi Tanpa Tinjauan Prajuru / Ruas Jalan (TC-008)

- **Test ID:** `TC-008`
- **Tipe Uji:** Security & Domain Invariant Gating
- **Komponen:** Backend Hono Route `POST /api/events/:id/publish`
- **Langkah Uji (Replay Steps):**
  1. Buat API request context Playwright tanpa token sesi organizer terotorisasi / pada draf yang belum ditinjau (`00000000-0000-4000-8000-000000000099`).
  2. Kirim permintaan HTTP `POST /api/events/00000000-0000-4000-8000-000000000099/publish` dengan payload kosong `{}`.
  3. Verifikasi HTTP status code yang dikembalikan backend.
- **Payload / Input Data:**
  ```http
  POST /api/events/00000000-0000-4000-8000-000000000099/publish HTTP/1.1
  Content-Type: application/json
  
  {}
  ```
- **Hasil yang Diharapkan:**
  - Permintaan ditolak dengan status error HTTP `401 Unauthorized`, `403 Forbidden`, `404 Not Found`, atau `409 Conflict`.
  - Sistem menolak transisi status menjadi `published` secara sepihak.
- **Hasil Aktual:**
  - Lolos. Backend mengembalikan status `401 Unauthorized` (respons penolakan otentikasi/otorisasi yang aman).

---

### 2.3 Failure Case 3: Penolakan Pembaruan Status Jalan oleh Aktor Tanpa Hak Akses (TC-012)

- **Test ID:** `TC-012`
- **Tipe Uji:** Authorization & Field Scoping
- **Komponen:** Backend Hono Route `POST /api/road-impacts/:id/status`
- **Langkah Uji (Replay Steps):**
  1. Siapkan payload pembaruan status jalan dengan status operasional `closed` dan timestamp observasi terkini.
  2. Kirim permintaan HTTP `POST /api/road-impacts/00000000-0000-4000-8000-000000000088/status` tanpa menyertakan sesi petugas yang ditugaskan.
  3. Verifikasi penolakan permintaan oleh middleware otorisasi.
- **Payload / Input Data:**
  ```json
  {
    "status": "closed",
    "notes": "Akses penutupan jalan sepihak tanpa penugasan",
    "observedAt": "2026-11-08T14:00:00.000Z",
    "mutationId": "e2e-unauthorized-mutation-test"
  }
  ```
- **Hasil yang Diharapkan:**
  - Server mengembalikan status HTTP `401` atau `403`.
  - Tidak ada rekaman mutasi yang dimasukkan ke tabel `road_status_updates`.
- **Hasil Aktual:**
  - Lolos. Server mengembalikan status `401 Unauthorized` dan mutasi dibatalkan.

---

### 2.4 Happy Path 1: E2E Integration Workflow (Draft -> Wizard -> Public Portal)

- **Test ID:** `HP-001`
- **Tipe Uji:** End-to-End User Experience & Flow Navigation
- **Komponen:** `EventWizardPage`, `DashboardRoadMapInput`, `PublicEventsListPage`, `TeduhSpatialMapConsole`
- **Langkah Uji (Replay Steps):**
  1. Buka halaman wizard `/dashboard/events/new`.
  2. Pada Langkah 1 (Surat Edaran & AI), klik tombol *"Lewati & Isi Rincian Manual"*.
  3. Verifikasi transisi ke Langkah 2 (Detail & Jadwal WITA).
  4. Isi input judul acara (`input[placeholder*="Contoh: Karya Pujawali"]`) dengan nama kegiatan sintetis.
  5. Isi input lokasi pelaksanaan (`input[placeholder*="Contoh: Pura Desa Adat Ubud"]`).
  6. Klik tombol *"Lanjut ke Peta & Ruas Jalan"*.
  7. Verifikasi tampilan Langkah 3 (`3. Input Peta & Ruas Jalan Terdampak`) dan komponen peta interaktif.
  8. Klik tombol *"Lanjut ke Verifikasi & Terbitkan"*.
  9. Verifikasi tampilan Langkah 4 (`4. Verifikasi Prajuru & Penerbitan Resmi`), ringkasan draf, serta judul acara yang telah diinput.
  10. Navigasi ke direktori publik `/events` dan verifikasi heading *"Jadwal Upacara & Rekayasa Jalur Bali"*.
  11. Navigasi ke konsol peta spasial publik `/peta` dan verifikasi kotak pencarian *"Cari kecamatan, desa, atau acara..."*.
- **Hasil yang Diharapkan:**
  - Seluruh langkah wizard dapat dilalui secara runtut dan intuitif.
  - Data yang diinput pada langkah sebelumnya bertahan dan terangkum pada langkah peninjauan.
  - Halaman portal publik dan peta dapat diakses masyarakat umum tanpa galat.
- **Hasil Aktual:**
  - Lolos 100% (durasi: 1.8s).

---

### 2.5 Happy Path 2: Unggah Berkas Dokumen Valid & Indikator AI (TC-002)

- **Test ID:** `TC-002`
- **Tipe Uji:** Document Upload Interaction
- **Komponen:** `EventWizardPage` Step 1 Dropzone
- **Langkah Uji (Replay Steps):**
  1. Buka `/dashboard/events/new`.
  2. Unggah berkas gambar valid ukuran wajar (`public/1.png`).
  3. Centang persetujuan pemrosesan dokumen.
  4. Amati munculnya kartu status berkas yang berhasil dipilih beserta indikator aksi AI / pengunggahan.
- **Hasil yang Diharapkan:**
  - Berkas diterima oleh komponen input.
  - Nama berkas tampil di layar dan tombol pemrosesan aktif.
- **Hasil Aktual:**
  - Lolos 100% (durasi: 1.4s).

---

## 3. Bug Ledger & Edge Cases

| Bug ID | Deskripsi Masalah / Edge Case | Tingkat Keparahan | Komponen Terkait | Status & Solusi Perbaikan | Owner (PIC) |
| :--- | :--- | :---: | :--- | :--- | :--- |
| **BUG-C06-01** | Berkas > 8 MB pada input berkas Langkah 1 sebelumnya tidak memiliki pengecekan ukuran sisi-klien sebelum memproses state. | **Medium** | `src/react-app/pages/EventWizardPage.tsx` | Ditambahkan validasi `file.size > 8 * 1024 * 1024` langsung pada event handler `onDrop` dan `onChange`, menampilkan Banner peringatan error. | Frontend Engineer (PIC: UI/UX Lead) |
| **BUG-C06-02** | Playwright strict-mode violation pada banner error unggahan karena judul dan deskripsi sama-sama mengandung fragmen teks pencarian. | **Low** | `tests/e2e/stubs-c06-c09.spec.ts` | Menggunakan selektor eksplisit `getByText("Ukuran Berkas Melebihi Batas", { exact: true })`. | QA Automation Engineer |
| **BUG-C06-03** | Inkonsistensi teks tombol navigasi Langkah 2 ke Langkah 3 antara spesifikasi awal dan implementasi wireframe. | **Low** | `tests/e2e/stubs-c06-c09.spec.ts` | Menyelaraskan selektor tombol Playwright menjadi `button:has-text("Lanjut ke Peta & Ruas Jalan")`. | QA Automation Engineer |
| **BUG-C06-04** | Header pencarian pada konsol peta `/peta` memiliki dua elemen input kembar (desktop view & mobile hamburger drawer) yang memicu Playwright strict-mode error. | **Low** | `src/react-app/features/map/TeduhSpatialMapConsole.tsx` | Memperbarui selektor penargetan pada Playwright menjadi `.first()` untuk memastikan kompatibilitas responsif desktop & ponsel. | Fullstack / QA Engineer |
| **BUG-C06-05** | Larangan eksekusi seeder basis data ke remote Neon branch dev saat pengujian integration/E2E lokal. | **High** | Test Configuration & Procedures | Memastikan seluruh suite E2E berjalan menggunakan context virtual terisolasi tanpa memicu `pnpm db:seed`. | Lead Dev & Database Admin |

---

## 4. Verification & Regression Matrix

- **Unit Tests:** `pnpm exec vitest run tests/unit/` -> 5 files passed, 53 tests passed (100%).
- **E2E Playwright:** `pnpm exec playwright test tests/e2e/stubs-c06-c09.spec.ts --project=chromium` -> 5 tests passed (100%).
- **Production Build:** `pnpm build` (`tsc -b && vite build`) -> Sukses tanpa error.

---

## 5. Next Recommended Step

Sesuai urutan roadmap setelah stabilisasi C06:
1. **Merge / Rebase:** Pastikan branch `feat/dashboard-audit-and-map-input` di-update atau disiapkan untuk penggabungan ke branch utama jika diperlukan.
2. **Task Berikutnya:** Lanjutkan ke **C08** (Staging & Deployment Validation) atau verifikasi integrasi end-to-end multi-role lanjutan (Field Officer & Public Map real-time sync).
