# RANGKAI: FINAL QA FIX & RELEASE INSTRUCTIONS

Repository: https://github.com/kasumadana/rangkai

Deadline: 13 November 2026, 10.00 WITA

## Tujuan

Selesaikan seluruh bug kritis, pastikan fitur AI, peta, routing, dan Cloudflare R2 benar-benar berfungsi pada production. Jangan menambah fitur baru sebelum alur utama stabil.

Audit seluruh perubahan yang sudah tersedia pada branch `main`, `develop`, dan `feat/venue-location-map-audit`. Jangan menganggap fitur selesai hanya karena sudah ada source code atau unit test.

## P0. Perbaikan peta dan informasi ruas jalan

1. Ketika pengguna mengklik ruas jalan pada peta, tampilkan nama jalan, jenis dampak, status aktual, tanggal dan jam mulai penutupan, serta tanggal dan jam selesai dalam WITA.
2. Pastikan klik ruas katalog menampilkan data yang sama dengan form katalog. Jangan mengambil informasi dari data dummy.
3. Jika pengguna mengklik jalan pada basemap yang belum terdaftar, tampilkan informasi bahwa ruas belum tersedia dalam katalog. Jangan mengarang nama jalan.
4. Hilangkan garis katalog biru saat mode "Gambar Ruas" aktif. Garis katalog hanya muncul dalam mode "Pilih dari Katalog".
5. Pertahankan garis pratinjau yang sedang digambar agar pengguna mengetahui ruas yang dipilih.
6. Pastikan pemilihan ruas, penyimpanan, dan tampilan GeoJSON konsisten di Event Wizard, dashboard, detail kegiatan, landing, dan `/peta`.

File utama:

- `src/react-app/features/map/DashboardRoadMapInput.tsx`
- `src/react-app/pages/EventWizardPage.tsx`
- `src/react-app/pages/RouteViews.tsx`

## P0. Perbaikan Cloudflare R2 dan foto kebersihan

1. Audit seluruh workflow upload, penyimpanan, pembacaan, serta pengunduhan dokumen dan foto.
2. Periksa binding `rangkai_documents_dev` yang mengarah ke bucket production sesuai konfigurasi Wrangler.
3. Samakan validasi frontend dan backend. Backend bukti kebersihan saat ini hanya menerima JPEG/PNG maksimal 5 MB, sedangkan UI masih menerima WebP.
4. Periksa permission petugas. Officer wajib memiliki izin kebersihan dan penugasan pada tugas yang bersangkutan.
5. Audit kondisi query `cleanupTasksQuery`, termasuk petugas yang memiliki izin traffic sekaligus cleanup.
6. Tampilkan pesan error sesuai respons API, termasuk 403, 409, 413, 422, 500, dan 503.
7. Pastikan foto yang berhasil diunggah benar-benar tersimpan di R2, tercatat di database, dan dapat dilihat kembali melalui endpoint yang terotorisasi.

Acceptance test:
Organizer membuat tugas → menugaskan officer → officer login → upload foto before dan after → submit → organizer melihat bukti → verifikasi berhasil.

File utama:

- `src/worker/routes/cleanup.ts`
- `src/worker/routes/documents.ts`
- `src/react-app/pages/RouteViews.tsx`
- `src/react-app/lib/events-api.ts`
- `wrangler.json`

## P0. Pastikan semua layanan AI berfungsi

Audit dan uji langsung pada deployment:

1. Gemini Document Extraction dari PDF/JPEG/PNG.
2. AI Impact Planner, termasuk grounding, rekomendasi dan fallback.
3. Public AI Assistant dan Internal Assistant.
4. AI Photo Quality Assessment jika fitur sudah tersedia pada UI final.

Periksa konfigurasi environment, API key, model, feature flags, timeout, rate limit, parsing JSON, Zod validation, serta handling error.

Jangan menganggap fallback berbasis aturan sebagai keberhasilan inferensi Gemini. Jika provider gagal, tampilkan status dengan jujur dan sediakan retry atau input manual.

## P0. Chatbot harus menjawab berdasarkan data nyata

Contoh pertanyaan wajib:

"Saya mau ke Sanur, berangkat dari Ubung. Apakah ada jalan yang ditutup?"

Implementasikan alur:

1. Gemini mengenali intent `route_help`, asal Ubung, dan tujuan Sanur.
2. Backend mencocokkan lokasi dengan koordinat yang valid.
3. Ambil kegiatan, ruas terdampak, jadwal penutupan, dan status jalan dari database publik.
4. Gunakan routing engine untuk menghitung rute yang relevan.
5. Periksa apakah rute tersebut berpotongan dengan ruas terdampak menggunakan data geospasial.
6. Jawab menggunakan sumber yang dapat diklik, waktu pembaruan, dan tautan menuju peta.
7. Jika routing atau status jalan tidak tersedia, jelaskan ketidakpastian. Jangan menjamin jalan aman atau membuat rekomendasi tanpa dasar.

Pastikan data simulasi tetap diberi label SIMULASI. Jangan membocorkan dokumen privat, data internal organisasi, atau informasi akun.

File utama:

- `src/worker/routes/public-assistant.ts`
- `src/worker/services/public-assistant.ts`
- `src/react-app/features/assistant/AssistantWidget.tsx`

## P1. Integrasi routing

Audit `feat/venue-location-map-audit` sebelum merge.

Pastikan:

1. Rute mengikuti jaringan jalan.
2. Rute tidak melewati ruas yang diketahui ditutup pada waktu perjalanan.
3. Jalur alternatif yang sudah disetujui organizer dapat ditampilkan di peta.
4. Rute yang dicabut atau kedaluwarsa tidak ditampilkan sebagai aktif.
5. Jika OSRM gagal, jangan menampilkan geometri interpolasi sebagai navigasi terverifikasi.
6. Mode peta jalan/satelit, geolocation, dan interaksi marker tetap berfungsi.

## Quality Gate

Wajib sebelum merge dan deployment:

- Typecheck lulus.
- Lint lulus.
- Unit test lulus.
- Integration test lulus.
- Playwright E2E untuk seluruh fitur kritis lulus.
- Pengujian langsung production menggunakan akun organizer dan officer berhasil.
- Gemini API dan Cloudflare R2 berhasil diuji menggunakan layanan sebenarnya, bukan mock.
- Peta, chatbot, dan routing tidak memberikan informasi operasional palsu.
- Tidak ada regresi pada autentikasi, RBAC, geofencing, status jalan kedaluwarsa, atau verifikasi kebersihan.

## Release

1. Audit perubahan pada seluruh branch terkait.
2. Integrasikan hanya kode yang sudah teruji ke branch rilis.
3. Jalankan migrasi database yang diperlukan dan verifikasi hasilnya.
4. Deploy ke `https://rangkai.skensa.web.id/`.
5. Jalankan smoke test production.
6. Bekukan versi final.
7. Buat annotated Git tag `v2.0-final` pada commit yang benar-benar dideploy.

## Output wajib coding agent

Berikan laporan akhir berisi:

1. Daftar bug yang berhasil diperbaiki.
2. File dan perubahan utama.
3. Hasil pengujian beserta bukti.
4. Hasil tes Gemini dan R2 production.
5. Fitur yang masih terbatas atau gagal diuji.
6. Commit hash dan status deployment.

Prioritaskan P0. Jangan melakukan redesign besar atau menambah dependensi yang tidak diperlukan. Jika fitur tidak dapat diselesaikan dengan aman, pertahankan fallback yang jujur dan dokumentasikan keterbatasannya.

Target akhir: Rangkai dapat didemonstrasikan dari awal sampai akhir tanpa error kritis, terutama pada AI, peta jalan, chatbot, serta dokumentasi kebersihan.
