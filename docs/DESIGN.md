---
name: Rangkai
description: Acuan target UI publik dan koordinasi kegiatan Rangkai
colors:
  primary: "#4D702F"
  primary-hover: "#405E28"
  canvas: "#FFFFFF"
  surface: "#FFFFFF"
  neutral-hover: "#F3F4F6"
  text-primary: "#181B20"
  text-secondary: "#545B67"
  border: "#D1D5DB"
  success: "#4D702F"
  warning: "#92400E"
  danger: "#B91C1C"
  unknown: "#545B67"
typography:
  display-large:
    fontFamily: "'Lora', Georgia, serif"
    fontSize: "4.25rem"
    fontWeight: 400
    lineHeight: 1.1
    letterSpacing: "-0.015em"
  display:
    fontFamily: "'Lora', Georgia, serif"
    fontSize: "2.625rem"
    fontWeight: 400
    lineHeight: 1.15
    letterSpacing: "-0.015em"
  heading:
    fontFamily: "'Plus Jakarta Sans', system-ui, sans-serif"
    fontSize: "1.625rem"
    fontWeight: 600
    lineHeight: 1.3
    letterSpacing: "-0.01em"
  body:
    fontFamily: "'Plus Jakarta Sans', system-ui, sans-serif"
    fontSize: "1rem"
    fontWeight: 400
    lineHeight: 1.5
    letterSpacing: "0em"
  label:
    fontFamily: "'Plus Jakarta Sans', system-ui, sans-serif"
    fontSize: "1rem"
    fontWeight: 600
    lineHeight: 1.5
    letterSpacing: "0em"
  code:
    fontFamily: "'Plus Jakarta Sans', system-ui, sans-serif"
    fontSize: "1rem"
    fontWeight: 400
    lineHeight: 1.5
    letterSpacing: "0em"
rounded:
  none: "0px"
  control: "4px"
  overlay: "8px"
spacing:
  compact: "8px"
  control: "16px"
  section: "24px"
  page: "32px"
components:
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.surface}"
    rounded: "{rounded.control}"
    typography: "{typography.label}"
    padding: "8px 16px"
    height: "48px"
  button-primary-hover:
    backgroundColor: "{colors.primary-hover}"
  button-secondary:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.text-primary}"
    rounded: "{rounded.control}"
    typography: "{typography.label}"
    padding: "8px 16px"
    height: "48px"
  button-destructive:
    backgroundColor: "{colors.danger}"
    textColor: "{colors.surface}"
    rounded: "{rounded.control}"
    typography: "{typography.label}"
    padding: "8px 16px"
    height: "48px"
  input:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.text-primary}"
    rounded: "{rounded.control}"
    typography: "{typography.body}"
    padding: "8px 16px"
    height: "48px"
  panel:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.text-primary}"
    rounded: "{rounded.control}"
    padding: "24px"
  dialog:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.text-primary}"
    rounded: "{rounded.overlay}"
    padding: "24px"
---

# Design System: Rangkai

## Overview

**Status: DECISION / acuan target, 12 November 2026.** Dokumen ini menggantikan
panduan visual lama. Nilai di frontmatter bersifat normatif untuk perubahan
berikutnya; bukan laporan bahwa seluruh token sudah diterapkan. Baseline kode
yang diperiksa adalah merge `71392b1`. Penulisan dokumen ini tidak mengubah UI,
route, dependency, atau database.

Rangkai membantu masyarakat membaca informasi kegiatan serta membantu organizer
dan officer menyelesaikan pekerjaan. Identitas logo dipertahankan; tipografi
ditetapkan menjadi Lora dan Plus Jakarta Sans. Penyederhanaan berfokus pada keterbacaan, konsistensi komponen,
dan tujuan navigasi yang jelas.

- Permukaan putih bersih, satu aksen hijau, warna status seperlunya.
- Bentuk tegas dengan sudut kecil; panel tidak menyerupai kapsul.
- Satu sumber token dan satu implementasi untuk setiap komponen umum.
- Ringkasan, daftar kegiatan, dan tugas lapangan memiliki tujuan berbeda.
- Status simulasi, izin, loading, error, dan kedaluwarsa tetap terlihat.

Mode permukaan: workspace organizer/officer adalah **Operate**, informasi publik
adalah **Read**, dan landing page adalah **Persuade**. Landing mempertahankan
identitas editorial; formulir dan pekerjaan operasional memakai bahasa visual
utilitas yang sama.

Batas produk mengikuti PRD/SRS dan keamanan mengikuti `08-SECURITY-OPS.md`.
Panduan ini tidak memberi kewenangan publikasi jalan atau mengubah izin server.

## Colors

Empat keluarga warna: **netral, hijau utama, amber peringatan, merah bahaya**.
Variasi hover/focus adalah state dari keluarga tersebut, bukan aksen dekoratif
baru. Gunakan nama token frontmatter, bukan nilai warna per halaman.

### Primary

`primary` untuk tindakan utama, link penting, dan penanda navigasi aktif.
`primary-hover` untuk hover/pressed. Hijau mengikuti arah UI branch venue,
dengan warna tombol gelap yang sudah ada sebagai nilai target tunggal.
Logo dan foto asli mempertahankan warnanya; warna gambar bukan token UI.

### Neutral

`canvas` dan `surface` putih untuk body, sidebar, navbar, panel, input, dropdown,
dan dialog. `neutral-hover` hanya abu-abu netral untuk hover atau selected row.
Teks utama memakai `text-primary`; metadata pendukung memakai `text-secondary`.
`border` dipakai ketika batas komponen diperlukan untuk mengenalinya.

**Permukaan putih.** Tidak ada latar krem, ivory, beige, mint, pastel, gradient,
atau tint berwarna pada kartu, sidebar, formulir, dan badge. Kelompokkan dengan
ruang, judul, dan alignment. Hilangkan garis pemisah dekoratif antar-section.
Border input dan batas tabel yang membantu pembacaan tetap diperbolehkan.

### Semantic

- OPEN / Terbuka: `success`; tidak menjanjikan bebas kemacetan.
- INTERMITTENT / Buka-tutup: `warning`.
- CLOSED / Ditutup dan tindakan destruktif: `danger`.
- UNKNOWN / Kedaluwarsa / Belum dikonfirmasi: `unknown`.
- Simulasi dan hasil AI belum diperiksa: label teks eksplisit pada surface putih.
- Organik, daur ulang, dan residu dibedakan dengan label/ikon; tidak memerlukan
  tiga aksen tambahan pada setiap kartu.

Status memakai teks dan ikon/garis bermakna pada latar putih. Lapisan peta boleh
menggunakan warna semantik dan pola garis; legenda teks wajib tersedia.
Uji kontras pada pasangan aktual; target WCAG 2.2 AA bukan klaim sertifikasi.

## Typography

**Workspace:** Plus Jakarta Sans untuk heading, navigasi, input, tombol, body,
dan metadata. **Publik:** Lora untuk hero dan heading editorial;
isi, kontrol, dan daftar tetap Plus Jakarta Sans. Hanya dua keluarga font ini
yang dipakai pada UI; ID dan nilai teknis tetap Plus Jakarta Sans dengan angka
tabular bila relevan. Role code tidak menambah font ketiga. Lora menggantikan
Fraunces pada penerapan berikutnya; perubahan font belum dilakukan di kode.

Empat ukuran, pada root pengguna standar 16px:

| Role ukuran | Nilai | Penggunaan |
|---|---|---|
| Dasar | 1rem / 16px | Body, label, metadata, tombol, input, judul section kecil |
| Heading | 1.625rem / 26px | Judul halaman dan heading utama workspace |
| Display | 2.625rem / 42px | Judul editorial publik bila ruang memadai |
| Display besar | 4.25rem / 68px | Hero desktop; bukan dashboard |

Rasio 16/26/42/68 mendekati 1.618. Role body, label, dan code berbagi ukuran,
bukan menambah tingkat baru. Pada layar sempit hero turun ke role yang lebih
kecil dari skala ini. Gunakan rem, dukung pembesaran teks dan reflow.

- Dashboard memakai terutama role dasar dan heading. Bedakan subjudul melalui
  bobot 600 dan jarak, bukan menambah variasi ukuran.
- Body bobot 400; navigasi/tombol/label 600. Hindari variasi bobot lokal.
- Informasi penting tidak dikecilkan menjadi 11–14px demi memuat lebih banyak.
- Judul sentence case. Tidak ada heading full caps atau tracking lebar.
- Jadwal/berat memakai angka tabular. Waktu ditampilkan dalam WITA; penyimpanan
  UTC tetap mengikuti kontrak backend.
- Prosa dibatasi sekitar 65–75 karakter per baris. Nama kegiatan/organisasi
  panjang dapat membungkus; truncation bukan pengganti akses ke nama lengkap.

## Layout

Empat jarak utama adalah token `compact`, `control`, `section`, dan `page`.
Border 1px, outline fokus, dan ukuran ikon adalah detail geometris, bukan tingkat
spacing tambahan. Padding mobile memakai `control`, desktop memakai `page`;
jarak antar-section memakai `section`. Form dan panel menggunakan jarak yang sama.

Workspace desktop menggunakan sidebar sekitar 260px, topbar sekitar 68px,
dan area konten maksimum sekitar 1240px sesuai kerangka yang sudah ada.
Konten memakai kolom fleksibel; tidak ada lebar minimum yang menyebabkan halaman
meluber. Daftar data memakai row/list/table; card dipakai untuk kelompok kerja
mandiri, bukan untuk membungkus setiap label, metrik, atau baris.

### Navbar dan profil

Navbar publik dan workspace memiliki dua komponen utama: **logo dan tombol
profil**. Role, nama organisasi, nama pengguna, Portal Publik, pengaturan akun,
dan Keluar ditempatkan di menu profil. Pengunjung anonim mendapat akses Masuk
atau Daftar dari tombol profil. Link publik penting tetap tersedia melalui CTA
landing dan footer, bukan hilang karena navbar disederhanakan.

Konteks organisasi yang menentukan data/aksi tetap jelas dalam area konten.
Label simulasi tetap melekat pada data terkait walaupun ringkasan profil ditutup.

### Sidebar dan tujuan route

Satu shell sidebar per role; membuka detail, tugas lapangan, atau pengaturan
mempertahankan menu utama, urutan, dan posisi Pengaturan di paling bawah.
Bagian kontekstual berada di bawah Kegiatan/Tugas Saya, bukan mengganti sidebar.

| Menu organizer | Route | Isi |
|---|---|---|
| Ringkasan | `/dashboard` | Pekerjaan yang perlu ditindaklanjuti, kegiatan terdekat, aksi berikutnya |
| Kegiatan | `/dashboard/events` | Daftar, pencarian, filter, dan buat kegiatan |
| Operasional Lapangan | `/field` | Penugasan yang boleh diakses pengguna |
| Pengaturan | `/settings` | Preferensi/akun/organisasi yang dapat dikelola |

Ringkasan tidak menyalin daftar kegiatan dan tidak memerlukan deretan KPI
penghias. Officer memiliki Tugas Saya (`/field`) dan Pengaturan; tautan organizer
tidak ditampilkan sebagai jalan buntu. Satu akun dapat memiliki kedua izin
lapangan. Sidebar bukan sumber otorisasi; server tetap memeriksa penugasan.

Saat kegiatan tersimpan dibuka, submenu organizer adalah:

| Bagian | URL kanonik |
|---|---|
| Detail kegiatan | `/dashboard/events/:id` |
| Dokumen & AI | `/dashboard/events/:id/document` |
| Dampak jalan | `/dashboard/events/:id/roads` |
| Kebersihan | `/dashboard/events/:id/cleanup` |
| Tim & Petugas | `/dashboard/events/:id/team` |

Route `/dashboard/events/:id/review` yang sudah ada tetap memiliki tujuan review
hasil AI dalam kelompok Dokumen & AI; tidak menjadi menu global tambahan dan
tidak dialihkan sebelum konteks review-nya dipertahankan. Pratinjau/publikasi
adalah aksi organizer dalam konteks kegiatan. Link tersimpan dan browser Back
harus tetap bekerja; route aktif ditandai secara spesifik, bukan semua menu
Kegiatan sekaligus.

Officer membuka `/field/events/:id` dengan submenu sesuai `traffic:update` dan
`cleanup:update`. Detail traffic/cleanup memakai shell yang sama, termasuk saat
membuka `/field/events/:id/cleanup/:taskId` atau kembali ke Pengaturan.

### Wizard baru dan pengelolaan kegiatan

**DECISION:** wizard hanya untuk pembuatan kegiatan baru (`/dashboard/events/new`),
bukan halaman pengelolaan default setiap kegiatan tersimpan. Pembuatan ID draft
di server tidak berarti pengguna otomatis keluar dari proses pembuatan; mode
wizard berakhir ketika pengguna menyelesaikan atau meninggalkan proses secara
sadar. Kelanjutan draft tidak boleh kehilangan isian.

Empat tahap tetap: Dokumen & AI; Detail & Jadwal; Peta & Ruas Jalan; Tinjau &
Publikasi. Di atas formulir cukup teks “Langkah 1 dari 4 — Dokumen & AI”.
Navigasi Kembali/Lanjutkan berada di bawah formulir; tahap akhir menawarkan
Simpan draf atau publikasi sesuai izin dan kelengkapan review. Manual fallback
memungkinkan kelanjutan ketika dokumen/AI tidak tersedia.

Hapus deretan pill “Ringkasan/Wizard · Dokumen & AI · ...”, kartu empat langkah
besar, serta tombol Tim yang menduplikasi sidebar. Di halaman kegiatan tersimpan,
konten mengikuti bagian yang dipilih dari sidebar. Sebelum navigasi, simpan atau
minta keputusan tentang isian yang belum tersimpan; jangan menjanjikan autosave
bila belum ada konfirmasi server.

### Responsif

Pada lebar 960px ke bawah, sidebar dapat menjadi drawer dengan hierarki sama.
Kontrol pembuka berada di tepi navigasi/area konten, sehingga navbar tetap berisi
logo dan profil. Sediakan label aksesibel “Buka navigasi”; jangan sembunyikan
navigasi seluruh aplikasi di dalam menu akun. Konten satu kolom di ponsel;
review dokumen boleh dua kolom jika masing-masing tetap terbaca.

Periksa 320/390/768/1440px serta zoom 200%. Tidak ada overlap, scroll horizontal
halaman, atau aksi sticky yang menutupi isian/fokus. Tabel lebar dapat memiliki
scroll lokal dengan label yang jelas. Target sentuh minimum 44px, default 48px;
ikon umumnya 20px di dalam area sentuh, bukan tombol 20px.

**Mobile lebih dahulu.** Alur officer dirancang dari layar ponsel: daftar tugas,
detail penugasan, pembaruan jalan, unggah bukti, dan catatan sampah. Satu aksi
utama terlihat pada tiap tahap; kegiatan dan tugas yang sedang dikerjakan jelas.
Gunakan label langsung, bukan ikon tanpa arti atau tooltip sebagai satu-satunya
petunjuk. Data tambahan dibuka saat dibutuhkan, bukan mengisi viewport awal.

- Kontrol lapangan memiliki target sentuh minimal 48px dan jarak antar-aksi 8px.
- Form satu kolom, input minimal 16px, label di atas field, dan tipe keyboard
  sesuai data. Numeric keyboard hanya untuk nilai numerik; jangan memaksa ID
  atau kode alfanumerik menjadi angka.
- Sticky action mengikuti safe area, tidak tertutup keyboard virtual, dan tidak
  menghalangi field/error. Aksi tetap dapat dijangkau tanpa sticky bila diperlukan.
- Nama panjang, metadata, dan status membungkus ke baris berikutnya; susun daftar
  menjadi baris bertingkat pada mobile, bukan tabel desktop yang diperkecil.
- Koneksi lambat/putus menampilkan status dan retry, menjaga isian lokal selama
  aman, dan tidak mengaku tersimpan sebelum server mengonfirmasi. Ini bukan
  janji dukungan pengiriman offline atau sinkronisasi otomatis.
- Peta memiliki alternatif daftar teks. Status, sumber, dan waktu pembaruan tetap
  dapat dipahami ketika peta gagal; interaksi utama tidak bergantung pada hover.

## Elevation & Depth

Permukaan normal flat. Gunakan jarak dan alignment untuk membentuk kelompok;
input dan panel yang memerlukan batas memakai border netral tipis.

Bayangan hanya untuk dropdown, popover, dan dialog yang melayang:
`0 2px 8px rgba(24, 27, 32, 0.06)`. Ini batas bayangan standar: tipis, satu lapis,
tanpa outline bayangan gelap, glow, atau bayangan menyebar besar. Kartu, tombol,
sidebar, dan navbar normal tanpa shadow; saat batas overlay kurang jelas,
perkuat border atau posisi, bukan menebalkan bayangan.
Backdrop modal menggunakan hitam transparan
sekitar 40%, bukan blur atau gradient dekoratif. Tidak ada shadow bertumpuk pada
setiap kartu atau efek kartu melayang saat hover.

Motion menyampaikan perubahan state, durasi sekitar 180ms untuk hover/menu;
workspace tidak memakai koreografi masuk halaman atau parallax. Hormati
`prefers-reduced-motion` dan tampilkan konten langsung ketika pengurangan gerak
aktif. Animasi landing tidak boleh menghalangi membaca atau berinteraksi.

## Shapes

- Sudut lurus untuk struktur halaman, tabel, divider fungsional, dan drawer.
- Radius `control` untuk tombol, input, panel, dan label status.
- Radius `overlay` adalah maksimum untuk dialog dan popover.
- Lingkaran hanya untuk avatar, radio, dan penanda titik peta. Bentuk ini bukan
  alasan menjadikan tombol/filter/status sebagai pill.

Tidak ada radius20–28px pada kartu, tombol kapsul, atau kartu di dalam kartu
berulang. Gunakan komponen yang sama untuk semua halaman dan role; ukuran ikon,
spacing, dan state tidak disetel ulang di setiap pemanggil.

## Components

### Sumber komponen

Frontend hasil merge memakai komponen sendiri. Perubahan berikutnya menggunakan
primitive bersama untuk Button, Field/Input/Select/Textarea, ProfileMenu,
Dialog/Drawer, Feedback/Toast, dan List/Table sesuai kebutuhan yang sudah ada.
Ini kontrak target, bukan klaim semua primitive sudah diekstrak. Hindari menyalin
seluruh API Astryx atau membuat framework UI baru. Dependency/aturan Astryx yang
masih tertinggal memerlukan pekerjaan penyelarasan terpisah; dokumen ini tidak
mengubah AGENTS atau menghapus package secara otomatis.

### Button

Satu keluarga bentuk/ukuran, dengan primary, secondary, ghost, dan destructive.
Primary hanya untuk tindakan terpenting dalam satu kelompok kerja. Secondary
memakai putih dengan border netral; ghost untuk aksi tambahan. Tindakan yang
menghapus/membatalkan data memakai destructive dengan konsekuensi yang jelas.

Tinggi default mengikuti token komponen, minimum 44px untuk kontrol ringkas;
label panjang boleh membungkus dan memperbesar tinggi. Icon-only memiliki nama
aksesibel. Loading menonaktifkan pengiriman ganda dan menyebut proses nyata.
Disabled memiliki alasan yang dapat dipahami; fokus keyboard tetap terlihat.
Navigasi memakai link, mutasi memakai button. Selalu set type pada tombol form.

### Ikon

Teks adalah default untuk tombol dan navigasi yang sudah jelas. Ikon dipakai
ketika mempercepat pengenalan tindakan, menjelaskan status, atau menjadi kontrol
ringkas dengan nama aksesibel; tidak ditambahkan otomatis di samping tiap label.
Gunakan ikon fungsional seperlunya seperti tutup, profil, atau navigasi mobile.
Hindari spark/sparkles, bintang AI dekoratif, dan ikon yang mengulang arti teks.
Identitas fitur AI dijelaskan dengan nama dan state, bukan ornamen.

### Form, panel, dan feedback

Label selalu terlihat. Placeholder hanya contoh. Input putih, border netral,
radius kecil; focus-visible memakai outline primary 2px dengan offset 2px.
Pesan error spesifik ditempatkan dekat field dan ditautkan secara aksesibel.
Label wajib/opsional konsisten. Textarea menyesuaikan isi tanpa tinggi kaku 48px.

Panel normal menggunakan surface putih; gunakan satu heading untuk satu bagian.
Hilangkan subjudul yang hanya mengulang heading. Error, empty, permission-denied,
loading, dan no-results adalah state berbeda dengan tindakan pemulihan nyata.
Toast tidak menggantikan error formulir atau informasi penting yang persisten.

### Status dan kepadatan informasi

Gunakan teks status biasa sebagai default. Badge hanya untuk status penting
yang perlu segera dibedakan atau jumlah, bukan untuk setiap metadata. Satu item
memiliki paling banyak satu badge status utama; jika ada kondisi tambahan,
jelaskan sebagai teks di baris metadata. SIMULASI wajib terlihat sebagai label
teks eksplisit, tidak harus menjadi badge kedua. Jika data kedaluwarsa, tampilkan
"Belum dikonfirmasi" sebagai status utama dan status terakhir sebagai konteks.

Susunan item: judul; status dan konteks singkat; metadata; tindakan. Hindari
susunan horizontal badge–teks–badge, kumpulan chip berwarna, dan status ganda
seperti "DRAF (DRAFT)". Label teks tambahan tetap boleh ketika bermakna.
Pada mobile, tiap kelompok membungkus secara alami. Informasi simulasi, expiry,
dan penugasan tidak boleh dihapus semata-mata untuk memenuhi batas visual.

### Menu profil, drawer, dan logout

Menu profil dapat dibuka dengan keyboard; Escape menutup dan mengembalikan fokus.
Dialog/drawer mengelola fokus, mengisolasi background, dan tidak menyisakan target
fokus di luar layar ketika tertutup. Dropdown tidak terpotong container.

Keluar berada di menu profil. Setelah server mengonfirmasi sign-out, hapus sesi
serta cache privat, lalu arahkan ke `/`. Jika gagal, tampilkan pesan dan retry;
jangan mengaku berhasil atau membiarkan data privat tampil setelah logout.

### Informasi operasional dan copy

Status jalan selalu memiliki teks; expiry tidak pernah berubah menjadi OPEN
secara diam-diam. Review AI dan estimasi tetap dibedakan dari fakta terverifikasi.
Jumlah sampah terukur, estimasi, dan jumlah karung tetap terpisah. Selesainya
kebersihan tidak membuka jalan secara otomatis.

Hapus blok teknologi “Standar Operasional & Integrasi Sistem” dari Pengaturan:
Neon/PostGIS, R2, dan arsitektur Gemini tetap di dokumentasi teknis. Instruksi
pemrosesan AI/privasi tetap dekat unggahan atau pertanyaan; bukan dihilangkan.
WITA cukup melekat pada jadwal. Penjelasan kewenangan ditempatkan singkat dekat
publikasi/status jalan yang relevan; penyederhanaan tidak mengubah makna hukum.
Gunakan “Draf”, bukan “DRAF (DRAFT)”, serta satu istilah Tim & Petugas di navigasi.

### Asisten global, hanya baca

**DECISION:** asisten hadir sebagai widget di seluruh halaman, termasuk landing,
workspace, dan peta. Tombol teks “Asisten” berada di kiri bawah, tanpa spark atau
animasi penarik perhatian. Saat tertutup tombol tidak menutupi navigasi mobile,
safe area, kontrol peta, dan aksi formulir; tempatkan kontrol yang bersaing di
area lain saat implementasi, bukan menumpuknya. Desktop memakai panel ringkas;
mobile memakai bottom sheet yang dapat diperluas dan tetap ramah keyboard.
Panel hanya terbuka atas tindakan pengguna. Escape/tutup mengembalikan fokus.

Pengunjung membaca informasi publik dan panduan penggunaan. Pengguna login juga
dapat membaca data organisasi/tugas yang boleh diakses: organizer pada organisasi
yang dipilih dan officer pada event/jenis tugas sesuai izin. Pemilihan organisasi
di UI bukan bukti izin. Server memvalidasi sesi, membership, penugasan, dan izin
untuk setiap permintaan dan sumber. Jika sesi gagal diperiksa, data privat
tidak boleh diambil atau ditampilkan.

Gunakan proyeksi field minimum: judul, jadwal, status draft/review/publikasi,
status jalan/freshness, tugas dan ringkasan kebersihan, serta link sumber yang
dapat diakses pengguna. Dokumen/foto privat, token undangan, kontak anggota,
secret, dan isi audit mentah tidak masuk cakupan awal. Jangan mengirim data
tersebut ke provider; minimalkan konteks Gemini dan beri pemberitahuan singkat
tentang pemrosesan eksternal. Tidak ada arbitrary SQL, URL fetching, atau tools
mutasi yang dipilih model.

Asisten boleh menunjukkan langkah dan link halaman yang benar; tidak boleh
menyimpan/mengubah kegiatan, mengirim undangan, mempublikasikan informasi,
mengubah status jalan, memverifikasi kebersihan, atau mengaku sudah melakukannya.
Jawaban faktual memakai sumber berizin beserta jadwal/status/simulasi/expiry.
Panduan aplikasi berasal dari katalog bantuan yang ditinjau, dengan label
“Panduan penggunaan”; tidak disamarkan sebagai data kegiatan atau hasil AI live.

Percakapan hanya disimpan dalam memori sesi tab untuk cakupan awal. Pisahkan
konteks publik dan internal. Logout, pergantian akun/organisasi, dan hilangnya
izin menghapus konteks internal, membatalkan permintaan, serta membuang respons
lama yang datang terlambat. Perubahan route tidak menghapus percakapan selama
identitas/cakupan izin tetap sama. Role/izin tetap diperiksa ulang server.

Route `/tanya` dipertahankan sebagai akses kompatibilitas yang membuka widget;
parameter konteks kegiatan tetap dibaca setelah pemeriksaan izin. Aplikasi
tetap dapat digunakan bila asisten dinonaktifkan, timeout, atau Gemini gagal.
Tampilkan error/retry dan link alur manual, bukan jawaban sukses buatan.
Fitur AI lain tetap mengikuti review manusia dan batas enablement masing-masing;
permintaan membuat widget tidak otomatis mengaktifkan penilaian foto produksi.

## Do's and Don'ts

### Do

- Pakai token normatif; perbaiki sumber komponen, bukan override per halaman.
- Tampilkan satu navigasi bagian kegiatan di sidebar, dengan tujuan route jelas.
- Pertahankan label simulasi, freshness, sumber, izin, dan fallback manual.
- Gunakan surface putih, radius kecil, dan hierarki yang dapat dipindai.
- Verifikasi teks panjang, keyboard, error/loading/empty, reflow, dan logout.

### Don't

- Menambah pastel/krem, tint berwarna, pill dekoratif, KPI penghias, atau menu duplikat.
- Membuat sidebar baru setiap kali pengguna membuka detail atau Pengaturan.
- Mengubah semua halaman menjadi wizard atau menamai menu “Wizard lengkap”.
- Mempersempit font agar komponen muat atau menyembunyikan overflow halaman.
- Mengklaim aturan target sudah diterapkan hanya karena DESIGN.md diperbarui.

### Pemeriksaan penerapan berikutnya

Selesai ketika seluruh permukaan yang diubah menggunakan token yang sama;
Ringkasan berbeda fungsi dari daftar; navbar hanya logo/profil; Pengaturan tetap
di bawah; semua link menuju konteks/izin yang benar; wizard hanya untuk proses
baru; sign-out terkonfirmasi menuju publik; dan pemeriksaan browser relevan
lulus pada ukuran/zoom di atas. Kontras dan WCAG tetap target sampai dinilai.
Pengujian tersebut belum dijalankan untuk desain baru ini karena perubahan
saat ini hanya dokumentasi. Kualitas AI, izin publikasi, dan kesiapan produksi
memerlukan bukti tersendiri.
