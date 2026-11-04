# UX and Information Architecture — Rangkai

Version: 0.1.0
Primary mode: Operate
Design principles: Pramana, progressive disclosure

## 1. Design Objective

Help users complete operational tasks with minimal
navigation, ambiguity, and unnecessary data entry.

Avoid decorative AI chatbots and unused dashboard widgets.

## 2. Information Architecture

Public:

- /
- /events
- /events/:slug
- /events/:slug/map

Authenticated:

- /dashboard
- /dashboard/events
- /dashboard/events/new
- /dashboard/events/:id
- /dashboard/events/:id/document
- /dashboard/events/:id/review
- /dashboard/events/:id/roads
- /dashboard/events/:id/cleanup
- /dashboard/events/:id/team
- /field/events/:id
- /settings

## 3. Main Screens

### A. Public Event List

Show:

- Event name
- Location
- Date and time
- Operational status
- Last update timestamp

Filters:

- Date
- Area
- Current/upcoming/completed

Do not show unpublished events.

### B. Public Event Detail

Top section:

- Event title
- Organizer attribution
- Time window
- Information verification label
- Last updated time

Middle:

- Road-impact map
- List of affected segments
- Current status for each segment

Bottom:

- Event context
- Public guidance
- Data limitation note

If map tiles fail, show the road list.

### C. Organizer Dashboard

Show:

- Draft events
- Upcoming published events
- Events requiring review
- Assigned field officers
- Unverified cleanup tasks

Primary CTA: Create Event.

### D. Create Event

Step 1: Basic details.
Step 2: Upload announcement.
Step 3: Extract with AI.
Step 4: Review and correct fields.
Step 5: Select road segments.
Step 6: Configure cleanup tasks.
Step 7: Review and publish.

Allow save as draft at every step.

### E. AI Review Screen

Two-panel layout on desktop:

- Left: original document preview.
- Right: extracted fields.

On mobile:

- Document preview collapses into a drawer.
- Fields remain editable.

Field indicators:

- Extracted
- Missing
- Needs review
- Corrected
- Confirmed

Never represent AI output as final before review.

### F. Field Officer Screen

Show only assigned events and allowed actions.

Traffic officer:

- Segment name
- Current effective status
- OPEN / INTERMITTENT / CLOSED buttons
- Last update
- Confirmation dialog
- Submission result

Cleanup officer:

- Assigned tasks
- Start task
- Upload before/after photo
- Submit for verification
- Record waste quantities

### G. Cleanup Review

Organizer sees:

- Task location
- Assigned officer
- Before/after evidence
- Status
- Verify or reopen action

Verification requires explicit human action.

## 4. User Journey: Organizer

1. Sign in.
2. Create event draft.
3. Upload announcement.
4. Review AI result.
5. Resolve ambiguous locations.
6. Add road impacts.
7. Add cleanup responsibilities.
8. Publish.
9. Monitor field updates.
10. Close event.

Success state:

- Public link is available.
- Publication time is recorded.

## 5. User Journey: Field Officer

1. Open assigned event.
2. Review authorized actions.
3. Select segment or cleanup task.
4. Submit update.
5. Wait for server confirmation.
6. See updated state and timestamp.

Failed update:

- Preserve form values.
- Show retry action.
- Do not display false success.

## 6. User Journey: Public

1. Open shared link or event directory.
2. Identify event time and location.
3. Inspect affected roads.
4. Read latest confirmed status.
5. See uncertainty if data is stale.

No login, account creation, or app download required.

## 7. Empty, Error, and Shared States (Microcopy Standards)

Standard microcopy adheres to Pramana ethics (Honest System States). Titles adopt polite Balinese phrasing (*basa alus*), while subtitles, messages, and action buttons remain clear and functional in Indonesian.

### D1: No Events (Empty State)
- Title: "Durung wenten parikrama sane kasobyahang"
- Subtitle: "Saat ini belum ada kegiatan adat yang dipublikasikan berdampak pada ruas jalan umum pada filter waktu atau wilayah yang dipilih."
- Actions: [Reset Filter Pencarian] [Kembali ke Beranda]

### D2: No Matching Road (Empty State)
- Title: "Margi durung kapanggih"
- Subtitle: "Ruas jalan belum ditemukan atau belum dipilih. Sistem tidak menebak rute secara otomatis, silakan tandai segmen jalan terverifikasi langsung pada peta."
- Actions: [Pilih Segmen di Peta] [Ubah Kata Kunci]

### D3: AI Unavailable (Fallback State)
- Title: "Ampura, ekstraksi AI durung prasida memargi"
- Subtitle: "Layanan pembacaan otomatis dokumen pengumuman sedang tidak dapat dijangkau. Berkas Anda tetap tersimpan dengan aman di penyimpanan privat."
- Actions: [Isi Formulir Manual] [Coba Ekstraksi Ulang]

### D4: Upload Failed (Error State)
- Title: "Ampura, berkas durung prasida kasimpen"
- Subtitle: "Berkas belum berhasil tersimpan ke penyimpanan server. Pastikan ukuran file maksimal 8 MB dengan format PDF, JPG, atau PNG, lalu coba kembali."
- Actions: [Coba Unggah Kembali] [Pilih Berkas Lain]

### D5: Stale Road Status (Warning State)
- Title: "Kasinahang durung pasti"
- Subtitle: "Status terakhir belum dikonfirmasi ulang oleh petugas lapangan lebih dari 2 jam. Sesuai aturan operasional, kondisi jalan tidak otomatis dianggap lancar."
- Actions: [Lihat Waktu Pembaruan] [Minta Konfirmasi Petugas]

### D6: Map Unavailable (Fallback State)
- Title: "Peta durung prasida kacingak"
- Subtitle: "Peta digital tidak dapat dimuat karena kendala koneksi. Informasi nama ruas jalan, jam penutupan, dan status jalur tetap dapat dibaca pada daftar teks di bawah."
- Actions: [Muat Ulang Peta] [Buka Daftar Ruas Jalan]

### D7: Update Failed (Field Error State)
- Title: "Ampura, pembaruan status durung kintun"
- Subtitle: "Laporan status belum berhasil diterima oleh server. Pilihan status dan catatan yang sudah Anda ketik tetap tersimpan aman di layar ini."
- Actions: [Kirim Ulang Sekarang] [Periksa Isian Form]

### D8: Cleanup Pending Verification (Pending State)
- Title: "Ngantos pamutus verifikasi saking Prajuru"
- Subtitle: "Foto bukti dan catatan timbangan sampah telah diterima. Menunggu pemeriksaan dan persetujuan verifikasi resmi dari pihak Prajuru Banjar."
- Actions: [Tinjau Bukti Foto] [Kembali ke Daftar Tugas]

### D9: Publication Successful (Success State)
- Title: "Matur suksma, parikrama sampun memargi antar"
- Subtitle: "Informasi kegiatan adat berhasil dipublikasikan. Tautan publik telah aktif dan waktu rilis telah dicatat ke dalam audit log resmi."
- Actions: [Salin Tautan Publik] [Lihat Halaman Kegiatan]

### D10: Unsaved Changes (Modal Confirmation)
- Title: "Elingan, wenten parubahan sane durung kasimpen"
- Subtitle: "Koreksi data AI atau isian formulir yang belum disimpan sebagai draf akan hilang jika Anda berpindah ke halaman lain sekarang."
- Actions: [Simpan Draf & Keluar] [Tetap di Halaman Ini]

### D11: Loading States (Asynchronous Progress)
- Title: "Ngiring antos ajebos..."
- Subtitle: "Sedang memuat dan memvalidasi data terverifikasi dari server. Mohon tunggu sejenak dan jangan menutup peramban."

## 8. Accessibility

- WCAG 2.2 AA target.
- Keyboard navigation.
- Visible focus indicators.
- Sufficient text contrast.
- Large touch targets.
- Labels on every input.
- Status text in addition to color.
- Screen-reader announcements for critical updates.
- Avoid map-only communication.

## 9. Visual Direction

Tone:

- Civic utility
- Calm and trustworthy
- Culturally respectful
- Mobile-first

Use a restrained visual system.
Prioritize readable typography and functional maps.

Do not add ceremonial imagery to every screen.
Cultural context belongs in event information,
not in decorative UI that slows task completion.
