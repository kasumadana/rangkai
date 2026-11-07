---
name: Rangkai
description: AI-Assisted Cultural Event Coordination for Bali
colors:
  primary: "#9e2a2b"
  primary-hover: "#832223"
  secondary: "#c25e24"
  neutral-canvas: "#fbfbfa"
  neutral-surface: "#ffffff"
  text-primary: "#181b20"
  text-secondary: "#545b67"
  border-subtle: "#e2e4e8"
  border-strong: "#cbd5e1"
  status-open: "#15803d"
  status-open-bg: "#f0fdf4"
  status-intermittent: "#d97706"
  status-intermittent-bg: "#fffbeb"
  status-closed: "#b91c1c"
  status-closed-bg: "#fef2f2"
  status-unknown: "#64748b"
  status-unknown-bg: "#f8fafc"
  waste-organic: "#166534"
  waste-recyclable: "#0284c7"
  waste-residual: "#78716c"
typography:
  display:
    fontFamily: "'Plus Jakarta Sans', system-ui, -apple-system, sans-serif"
    fontSize: "1.875rem"
    fontWeight: 700
    lineHeight: "1.25"
    letterSpacing: "-0.02em"
  headline:
    fontFamily: "'Plus Jakarta Sans', system-ui, -apple-system, sans-serif"
    fontSize: "1.5rem"
    fontWeight: 600
    lineHeight: "1.3"
    letterSpacing: "-0.015em"
  title:
    fontFamily: "'Plus Jakarta Sans', system-ui, -apple-system, sans-serif"
    fontSize: "1.125rem"
    fontWeight: 600
    lineHeight: "1.35"
    letterSpacing: "-0.01em"
  body:
    fontFamily: "'Plus Jakarta Sans', system-ui, -apple-system, sans-serif"
    fontSize: "0.9375rem"
    fontWeight: 400
    lineHeight: "1.55"
    letterSpacing: "0em"
  label:
    fontFamily: "'Plus Jakarta Sans', system-ui, -apple-system, sans-serif"
    fontSize: "0.75rem"
    fontWeight: 600
    lineHeight: "1.2"
    letterSpacing: "0.025em"
rounded:
  sm: "4px"
  md: "8px"
  lg: "12px"
  full: "9999px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "16px"
  lg: "24px"
  xl: "32px"
components:
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.neutral-surface}"
    rounded: "{rounded.md}"
    padding: "10px 20px"
  button-primary-hover:
    backgroundColor: "{colors.primary-hover}"
  card-surface:
    backgroundColor: "{colors.neutral-surface}"
    rounded: "{rounded.md}"
    padding: "16px"
  badge-status-open:
    backgroundColor: "{colors.status-open-bg}"
    textColor: "{colors.status-open}"
    rounded: "{rounded.full}"
    padding: "4px 10px"
  badge-status-closed:
    backgroundColor: "{colors.status-closed-bg}"
    textColor: "{colors.status-closed}"
    rounded: "{rounded.full}"
    padding: "4px 10px"
---

# Design System: Rangkai

## Overview

**Creative North Star: "Tri Datu Civic Utility"**

Rangkai adalah instrumen koordinasi operasional publik untuk mengelola dampak ruang jalan dan kebersihan acara adat/budaya di Bali. Desain visual Rangkai mengadopsi ketegasan dan kedalaman filosofis benang Tri Datu (Merah/Brahma, Hitam/Wisnu, Putih/Siwa) yang dipadukan ke dalam arsitektur utilitas sipil modern. Desain ini dirancang berakar pada budaya lokal Bali tanpa terjebak dalam ornamen seremonial pura yang dekoratif dan memberatkan performa web.

Sistem visual berada dalam mode **Operate** untuk pengguna lapangan (Pecalang, Dishub, Petugas Kebersihan) dan panitia (Prajuru Banjar), serta mode **Read/Scanability** untuk masyarakat pengguna jalan. Prinsip utamanya berlandaskan etika *Pramana*: menghadirkan status sistem yang jujur (*honest system states*), tidak merekayasa kepastian jika data kadaluwarsa, mengutamakan ergonomi penggunaan satu tangan di bawah terik matahari Bali, dan memastikan keterbacaan data tanpa bergantung pada warna semata.

**Key Characteristics:**
- **Civic Restraint:** Antarmuka tenang, fungsional, dan bersih; warna aksen hanya hadir pada titik aksi atau penanda status krusial.
- **Outdoor High Contrast:** Memenuhi standar aksesibilitas WCAG 2.2 AA dengan kontras teks tinggi di atas kanvas hangat yang tidak menyilaukan mata saat dipakai di jalan raya.
- **Honest System Signals:** Ketidakpastian data, status kadaluwarsa (*stale*), dan saran AI yang belum diverifikasi memiliki penanda visual yang eksplisit dan tidak ambigu.
- **Mobile Ergonomics:** Target sentuh besar (minimal 48px), navigasi satu tangan, dan form yang ramah perangkat mobile berspesifikasi menengah ke bawah.

*File blueprint wireframe low-fidelity native FigCraft tersedia di [`design/rangkai-wireframe.figcraft`](file:///home/okuta/Documents/Lomba/rangkai/design/rangkai-wireframe.figcraft). Layar wireframe modular dan hasil render PNG dipisahkan ke dalam folder [`halaman-public/`](file:///home/okuta/Documents/Lomba/rangkai/halaman-public), [`halaman-dashboard/`](file:///home/okuta/Documents/Lomba/rangkai/halaman-dashboard), serta [`halaman-petugas/`](file:///home/okuta/Documents/Lomba/rangkai/halaman-petugas) ([`petugas-jalan/`](file:///home/okuta/Documents/Lomba/rangkai/halaman-petugas/petugas-jalan) & [`petugas-kebersihan/`](file:///home/okuta/Documents/Lomba/rangkai/halaman-petugas/petugas-kebersihan)).*

---

## Colors

Palet warna menggunakan fondasi Tri Datu yang ditransformasikan menjadi sistem warna sipil yang terukur, stabil, dan berdisiplin tinggi.

### Primary
- **Deep Pine / Forest Green** (`#264D3B` / `oklch(38% 0.08 155)`): Warna jangkar identitas institusi sipil (*Civic Anchor*) & logo resmi platform. Digunakan pada bilah navigasi utama, ikon tab peramban (`/public/favicon.ico`), master app icon (`/public/logo-icon.png`), dan mark brand Rangkai.
- **Terracotta Crimson** (`#BA694E` / `#9E2A2B` / `oklch(45% 0.16 28)`): Warna aksi utama (*Brahma*). Digunakan untuk aksen interlocking monogram 'R', tombol tindakan primer (seperti "Publikasikan Kegiatan", "Simpan Verifikasi"), dan aksi penentu.

### Secondary
- **Saffron Ochre** (`#C25E24` / `oklch(56% 0.15 48)`): Aksen sekunder bernuansa tembaga hangat. Digunakan untuk indikator transisi, penanda kegiatan aktif, dan sorotan kategori acara.

### Neutral
- **Volcanic Charcoal** (`#181B20` / `oklch(22% 0.01 260)`): Hitam arang batu vulkanik (*Wisnu*). Teks primer dengan tingkat kontras tajam (14.2:1 terhadap kanvas putih) tanpa kekerasan warna `#000000` murni.
- **Weathered Slate** (`#545B67` / `oklch(48% 0.02 260)`): Teks sekunder untuk timestamp, penanggung jawab banjar, dan metadata teknis.
- **Subtle Border** (`#E2E4E8` / `oklch(91% 0.005 260)`): Garis batas pemisah kolom review AI, kartu ruas jalan, dan pemisah form.
- **Surface White** (`#FFFFFF` / `oklch(100% 0 0)`): Latar belakang kartu dokumen, panel modal, dan pop-up peta (*Siwa*).
- **Chalk Canvas** (`#FBFBFA` / `oklch(98.5% 0.003 80)`): Latar belakang halaman aplikasi; warna putih gading hangat yang mencegah kelelahan mata di bawah sinar matahari.

### Semantic Roles

#### 1. Status Operasional Ruas Jalan (Map & Field)
- **OPEN / Lancar** (`#15803D` / bg: `#F0FDF4`): Ruas jalan dapat dilalui secara normal.
- **INTERMITTENT / Buka-Tutup** (`#D97706` / bg: `#FEF3C7`): Pengalihan berkala atau antrean prosesi adat.
- **CLOSED / Ditutup** (`#B91C1C` / bg: `#FEF2F2`): Penutupan penuh untuk iring-iringan atau pendirian sarana upacara.
- **UNKNOWN / STALE** (`#64748B` / bg: `#F1F5F9`): Data status melebihi batas waktu konfirmasi (> 2 jam tanpa pembaruan petugas). Tidak boleh disamarkan sebagai jalan lancar.

#### 2. Kategori Pengelolaan Sampah Pasca-Acara
- **Organik** (`#166534`): Canang sari, banten, daun pisang, janur, bunga sisa upakara.
- **Daur Ulang** (`#0284C7`): Botol plastik kemasan, cup minuman, kardus, kaleng.
- **Residu** (`#78716C`): Dupa, puntung rokok, plastik sobek tercemar, abu sarana persembahyangan.

#### 3. Status Verifikasi Data AI
- **Extracted / Draft** (`#0284C7`): Hasil pembacaan dokumen oleh Gemini, menunggu validasi manusia.
- **Needs Review** (`#D97706`): Entitas ambigu (nama jalan tidak cocok dengan koordinat resmi).
- **Confirmed** (`#15803D`): Telah diperiksa dan disetujui oleh Prajuru/Panitia berwenang.

### Named Rules
**The Rarity Accent Rule.** Warna merah Terracotta Crimson (`#9E2A2B`) tidak boleh menguasai lebih dari 10% luas tampilan visual halaman. Kekuatannya terletak pada kelangkaannya sebagai penunjuk aksi kritis.

**The Non-Color Redundancy Rule.** Dilarang menyampaikan status operasional (buka/tutup/sampah) hanya melalui warna. Setiap indikator visual wajib menyertakan ikon pembeda dan teks eksplisit (misal: Ikon centang + "OPEN", Ikon silang + "CLOSED").

**The Stale-Is-Never-Green Rule.** Status ruas jalan yang belum diperbarui petugas melewati batas kedaluwarsa dilarang otomatis dianggap OPEN. Sistem wajib menampilkannya dalam status abu-abu UNKNOWN / Butuh Konfirmasi.

---

## Typography

**Display & Headline Font:** 'Plus Jakarta Sans', system-ui, -apple-system, sans-serif (Heading weight normal 400, section title 32px)  
**Body & Data Font:** 'Plus Jakarta Sans', system-ui, -apple-system, sans-serif (Body base 16px)  
**Tabular/Numeric Modifier:** `font-variant-numeric: tabular-nums` (via CSS)

Kombinasi sans-serif geometris humanis dengan *x-height* besar memastikan teks terbaca jelas dalam resolusi layar rendah, ponsel murah, dan sudut pandang miring di lapangan.

### Hierarchy
- **Display** (Bold 700, 24px mobile / 30px desktop, line-height 1.25, tracking -0.02em): Nama acara utama pada tampilan publik dan judul layar dashboard ringkasan.
- **Headline / H2** (Semibold 600, 20px mobile / 24px desktop, line-height 1.3, tracking -0.015em): Judul seksi utama (Panel Review AI, Pemetaan Jalan Terkena Dampak, Verifikasi Kebersihan).
- **Title / H3** (Semibold 600, 17px mobile / 18px desktop, line-height 1.35, tracking -0.01em): Nama ruas jalan pada daftar, kartu tugas petugas, sub-bagian formulir.
- **Body Large** (Medium 500, 16px, line-height 1.5): Ringkasan status acara dan instruksi aksi bagi pengguna jalan.
- **Body Default** (Regular 400, 15px mobile / 15px desktop, line-height 1.55): Teks deskripsi pengumuman, paragraf penjelasan, nilai input form.
- **Body Small** (Regular 400, 13px, line-height 1.5, tracking +0.005em): Timestamp ("Diperbarui 12 mnt lalu oleh Pecalang Banjar"), catatan disclaimer hukum UU No. 22/2009.
- **Label / Badge** (Semibold 600, 12px, line-height 1.2, tracking +0.025em, uppercase): Pill status jalan (`OPEN`, `CLOSED`), tag kategori sampah, status verifikasi AI.

### Named Rules
**The Mobile 16px Floor Rule.** Ukuran font pada elemen `<input>`, `<select>`, dan `<textarea>` pada perangkat layar bergerak minimal 16px (1rem) guna mencegah peramban iOS Safari melakukan *auto-zoom* yang mengacaukan tata letak.

**The Tabular Numbers Rule.** Setiap tampilan jam pelaksanaan (`15:30 WITA`), koordinat titik rute, dan besaran berat sampah (`45.5 kg`) wajib menggunakan `tabular-nums` agar lebar karakter seragam dan tidak melompat ketika data diperbarui secara *live*.

**The Balanced Heading Rule.** Setiap judul kegiatan publik wajib menerapkan `text-wrap: balance`, dan blok deskripsi panjang menerapkan `text-wrap: pretty`.

---

## Layout

Tata letak memprioritaskan penyelesaian tugas (*Operate*) dengan kepadatan data terukur tanpa kesesakan visual.

- **Grid & Breakpoints:**
  - `Mobile (< 768px)`: Kolom tunggal, layout linier, aksi utama menempel di bagian bawah layar (*sticky bottom action bar*) agar mudah dijangkau ibu jari.
  - `Tablet / Desktop (≥ 768px)`: Kolom ganda untuk panel kerja. Pada layar Verifikasi AI: panel kiri menampilkan pratinjau dokumen surat asli, panel kanan menampilkan kolom form ekstraksi yang dapat diedit.
- **Spatial Rhythm:**
  - Menggunakan kelipatan 4px/8px: `xs (4px)`, `sm (8px)`, `md (16px)`, `lg (24px)`, `xl (32px)`.
  - Jarak tepi layar mobile minimal 16px; margin kontainer desktop maksimal `1200px` untuk menjaga batas keterbacaan teks (*reading measure* 50–70 karakter per baris).

---

## Elevation & Depth

Rangkai menggunakan pendekatan **Tonal Layering & Ghost Borders** alih-alih bayangan tebal. Lapisan kedalaman dibangun melalui perbedaan warna latar (*canvas* ke *surface*) dan garis batas subtil.

### Shadow Vocabulary
- **Flat at Rest:** Komponen kartu dan panel bertumpu rata di atas kanvas dengan batas border 1px `#E2E4E8`.
- **Card Ambient** (`box-shadow: 0 1px 3px 0 rgba(24, 27, 32, 0.05), 0 1px 2px -1px rgba(24, 27, 32, 0.05)`): Digunakan khusus pada kartu ruas jalan aktif dan kartu tugas lapangan agar terangkat lembut dari latar belakang.
- **Overlay Floating** (`box-shadow: 0 10px 15px -3px rgba(24, 27, 32, 0.1), 0 4px 6px -4px rgba(24, 27, 32, 0.05)`): Digunakan pada modal dialog konfirmasi, bottom sheet mobile, dan kartu informasi detail rute di atas peta MapLibre.

### Named Rules
**The Flat-By-Default Rule.** Tidak ada bayangan jatuh yang bersifat dekoratif murni. Elevasi hanya diizinkan untuk menandai elemen yang melayang di atas peta atau elemen modal dialog.

---

## Shapes

Bentuk geometris dirancang kokoh, bersih, dan berorientasi pada kemudahan sentuhan jari.

- **Radius Scale:**
  - `sm (4px)`: Checkbox, tag kecil, badge status internal.
  - `md (8px)`: Tombol utama, input form, kartu data, panel ringkasan.
  - `lg (12px)`: Kontainer modal dialog, pratinjau dokumen, kartu acara utama.
  - `full (9999px)`: Pill badge status ruas jalan (`OPEN`, `CLOSED`), avatar pengguna.
- **Touch Target Target:** Setiap tombol interaktif pada mode lapangan memiliki tinggi minimal `48px` dengan ruang sentuh yang aman bagi petugas yang mengenakan pakaian adat atau sarung tangan kebersihan.

---

## Components

### Buttons
- **Shape:** Radius 8px (`rounded-md`), tinggi standar 44px (desktop) / 48px (mobile).
- **Primary:** Background `#9E2A2B`, teks `#FFFFFF`, font-weight 600. Hover: `#832223`. Digunakan hanya untuk tindakan primer per layar.
- **Secondary / Outline:** Background transparan, border 1px `#CBD5E1`, teks `#181B20`. Hover: `#F1F5F9`.
- **Ghost:** Background transparan, teks `#545B67`. Hover: `#F1F5F9` teks `#181B20`.
- **Operational Status Buttons (Khusus Petugas):** Tombol pilihan status ruas jalan (OPEN / INTERMITTENT / CLOSED) berbentuk *segmented control* besar dengan label teks dan indikator warna aktif yang jelas.

### Status Badges (Pills)
- **OPEN:** Latar `#F0FDF4`, teks `#15803D`, border 1px `#BBF7D0`. Ikon centang hijau.
- **INTERMITTENT:** Latar `#FEF3C7`, teks `#B45309`, border 1px `#FDE68A`. Ikon peringatan kuning.
- **CLOSED:** Latar `#FEF2F2`, teks `#B91C1C`, border 1px `#FECACA`. Ikon stop merah.
- **STALE / UNKNOWN:** Latar `#F1F5F9`, teks `#64748B`, border 1px `#E2E8F0`. Ikon tanda tanya abu-abu.

### Cards / Containers
- **Latar:** `#FFFFFF`, radius 8px, border 1px `#E2E4E8`.
- **Padding:** 16px (mobile) / 20px (desktop).
- **Header Kartu:** Memiliki pemisah garis 1px halus jika memuat aksi sekunder.

### Inputs / Form Fields
- **Tampilan:** Latar `#FFFFFF`, border 1px `#CBD5E1`, radius 8px, padding 10px 14px.
- **Focus:** Border `#9E2A2B`, ring halus 2px `rgba(158, 42, 43, 0.15)`. Dilarang menggunakan outline peramban yang kasar.
- **Field Review AI (Dua Status):** Jika hasil pembacaan AI memerlukan perhatian khusus (*needs review*), kotak isian memiliki indikator garis kiri berwarna amber (`#D97706`, lebar 3px) disertai tautan "Lihat Bukti Sumber Dokumen".

### Signature Component: Split Review Panel & Road Segment Pill
- **Panel AI Review:** Menjajarkan visual dokumen asli di sebelah formulir terstruktur. Setiap kolom memiliki tombol "Bandingkan dengan Asli" yang menyorot potongan teks sumber.
- **Road Segment Operational Pill:** Menampilkan nama ruas jalan (misal: "Jl. Raya Ubud"), waktu mulai dan berakhir penutupan, status live terverifikasi, dan nama petugas/instansi penanggung jawab.

---

## Do's and Don'ts

### Do:
- **Do** gunakan kanvas hangat `#FBFBFA` untuk meminimalkan pantulan silau saat petugas mengakses aplikasi di luar ruangan.
- **Do** pasangkan setiap indikator status warna dengan teks dan simbol ikon yang berbeda untuk menjamin aksesibilitas tuna warna.
- **Do** tampilkan status "Belum Terkonfirmasi" jika pembaruan dari lapangan melewati ambang waktu kedaluwarsa.
- **Do** sediakan opsi input formulir manual jika proses ekstraksi AI dokumen pengumuman mengalami kegagalan.
- **Do** pastikan target sentuh tombol status di layar lapangan (*field officer*) memiliki tinggi minimal 48px.

### Don't:
- **Don't** menggunakan motif pura, ukiran barong, atau tekstur kain seremonial sebagai latar belakang layar aplikasi yang memperlambat pembacaan peta dan data.
- **Don't** menyamarkan rute jalan yang belum dikonfirmasi statusnya sebagai jalan hijau/lancar secara otomatis.
- **Don't** menggunakan ukuran font input di bawah 16px pada tampilan mobile yang memicu zoom otomatis di Safari.
- **Don't** menyajikan informasi estimasi kecerdasan buatan sebagai data fakta operasional tanpa tinjauan manusia.
- **Don't** menyembunyikan navigasi atau status penting di balik efek transisi animasi yang panjang (>200ms) pada antarmuka lapangan.
