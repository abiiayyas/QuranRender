---
name: QuranRender
description: Editor video ayat yang tenang; konvensi editor profesional, ayat selalu paling terang dan paling diam.
colors:
  nila-accent: "#4652c8"
  nila-accent-hover: "#3a45b0"
  nila-accent-active: "#303a96"
  nila-subtle: "#edeffc"
  nila-focus: "#6772e0"
  nila-accent-dark: "#8e97f2"
  nila-accent-hover-dark: "#a9b0f5"
  nila-accent-active-dark: "#6772e0"
  nila-subtle-dark: "#232846"
  on-accent-dark: "#0f1230"
  bg-app: "#f2f3f5"
  bg-panel: "#ffffff"
  bg-sunken: "#f7f8fa"
  bg-hover: "#e9ebef"
  border: "#e0e3e8"
  border-strong: "#cbd0d7"
  border-control: "#878e9a"
  text: "#15171c"
  text-2: "#4a505c"
  text-3: "#646b77"
  viewer: "#e6e8ec"
  bg-app-dark: "#101114"
  bg-panel-dark: "#17191d"
  bg-sunken-dark: "#0b0c0e"
  bg-hover-dark: "#1e2126"
  bg-raised-dark: "#262a31"
  border-dark: "#2a2e35"
  border-strong-dark: "#3a3f48"
  border-control-dark: "#646b77"
  text-dark: "#e9eaee"
  text-2-dark: "#a9aeb8"
  text-3-dark: "#8a909b"
  viewer-dark: "#08090b"
  success: "#2a7f50"
  warning: "#8a5d0c"
  danger: "#b93535"
  success-dark: "#5bc48a"
  warning-dark: "#e3b341"
  danger-dark: "#f07373"
typography:
  headline:
    fontFamily: "system-ui, -apple-system, Segoe UI Variable Text, Segoe UI, Inter, sans-serif"
    fontSize: "1.75rem"
    fontWeight: 600
    lineHeight: 1.5
    letterSpacing: "-0.02em"
  title:
    fontFamily: "system-ui, -apple-system, Segoe UI Variable Text, Segoe UI, Inter, sans-serif"
    fontSize: "1.25rem"
    fontWeight: 600
    letterSpacing: "-0.01em"
  body:
    fontFamily: "system-ui, -apple-system, Segoe UI Variable Text, Segoe UI, Inter, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 400
    lineHeight: 1.5
  body-studio:
    fontFamily: "system-ui, -apple-system, Segoe UI Variable Text, Segoe UI, Inter, sans-serif"
    fontSize: "0.8125rem"
    fontWeight: 400
  label:
    fontFamily: "system-ui, -apple-system, Segoe UI Variable Text, Segoe UI, Inter, sans-serif"
    fontSize: "0.75rem"
    fontWeight: 600
  timecode:
    fontFamily: "system-ui, -apple-system, Segoe UI Variable Text, Segoe UI, Inter, sans-serif"
    fontSize: "0.75rem"
    fontFeature: "tnum"
  ayah:
    fontFamily: "LPMQ, serif"
    lineHeight: 2
  arabic-ui:
    fontFamily: "Amiri, serif"
    fontSize: "1.75rem"
  mono:
    fontFamily: "ui-monospace, SF Mono, Cascadia Mono, Consolas, monospace"
rounded:
  r-2xs: "2px"
  r-xs: "4px"
  r-ctl: "6px"
  r-seg: "8px"
  r-panel: "10px"
  r-overlay: "12px"
  r-pill: "999px"
spacing:
  sp-1: "4px"
  sp-2: "8px"
  sp-3: "12px"
  sp-4: "16px"
  sp-6: "24px"
  sp-8: "32px"
  sp-12: "48px"
components:
  button-primary:
    backgroundColor: "{colors.nila-accent}"
    textColor: "{colors.bg-panel}"
    rounded: "{rounded.r-ctl}"
    padding: "0 10px"
    height: "28px"
  button-primary-hover:
    backgroundColor: "{colors.nila-accent-hover}"
  button-primary-active:
    backgroundColor: "{colors.nila-accent-active}"
  button-secondary:
    backgroundColor: "{colors.bg-panel}"
    textColor: "{colors.text}"
    rounded: "{rounded.r-ctl}"
    height: "28px"
  button-secondary-hover:
    backgroundColor: "{colors.bg-hover}"
  button-ghost:
    textColor: "{colors.text-2}"
    rounded: "{rounded.r-ctl}"
    height: "28px"
  button-ghost-pressed:
    backgroundColor: "{colors.nila-subtle}"
    textColor: "{colors.nila-accent}"
  button-danger:
    backgroundColor: "{colors.bg-panel}"
    textColor: "{colors.danger}"
    rounded: "{rounded.r-ctl}"
  button-sm:
    height: "24px"
    padding: "0 8px"
  button-lg:
    height: "32px"
    padding: "0 14px"
  button-play:
    backgroundColor: "{colors.bg-panel}"
    textColor: "{colors.text}"
    size: "32px"
  segmented-control:
    backgroundColor: "{colors.bg-sunken}"
    rounded: "{rounded.r-seg}"
    padding: "2px"
  segmented-option:
    textColor: "{colors.text-2}"
    rounded: "{rounded.r-ctl}"
    padding: "0 12px"
    height: "22px"
  segmented-option-selected:
    backgroundColor: "{colors.bg-panel}"
    textColor: "{colors.text}"
  segmented-option-selected-dark:
    backgroundColor: "{colors.bg-raised-dark}"
    textColor: "{colors.text-dark}"
  field:
    backgroundColor: "{colors.bg-sunken}"
    textColor: "{colors.text}"
    rounded: "{rounded.r-ctl}"
    padding: "0 8px"
    height: "28px"
  field-inspector:
    height: "24px"
  checkbox:
    backgroundColor: "{colors.bg-sunken}"
    rounded: "{rounded.r-xs}"
    size: "16px"
  checkbox-checked:
    backgroundColor: "{colors.nila-accent}"
  switch:
    rounded: "{rounded.r-pill}"
    width: "30px"
    height: "18px"
  menu:
    backgroundColor: "{colors.bg-panel}"
    rounded: "{rounded.r-panel}"
    padding: "4px"
  menu-item:
    textColor: "{colors.text}"
    rounded: "{rounded.r-ctl}"
    height: "28px"
    padding: "0 8px"
  menu-item-hover:
    backgroundColor: "{colors.nila-subtle}"
  dialog:
    backgroundColor: "{colors.bg-panel}"
    rounded: "{rounded.r-overlay}"
    width: "440px"
  command-palette:
    backgroundColor: "{colors.bg-panel}"
    rounded: "{rounded.r-overlay}"
    width: "560px"
  toast:
    backgroundColor: "{colors.bg-panel}"
    rounded: "{rounded.r-panel}"
    width: "360px"
  tooltip:
    backgroundColor: "{colors.text}"
    textColor: "{colors.bg-panel}"
    rounded: "{rounded.r-ctl}"
    padding: "5px 8px"
  badge:
    backgroundColor: "{colors.bg-panel}"
    textColor: "{colors.text-2}"
    rounded: "{rounded.r-pill}"
    height: "20px"
    padding: "0 8px"
  kbd:
    backgroundColor: "{colors.bg-panel}"
    textColor: "{colors.text-2}"
    rounded: "{rounded.r-xs}"
    height: "20px"
  panel:
    backgroundColor: "{colors.bg-panel}"
    rounded: "{rounded.r-panel}"
  media-item:
    textColor: "{colors.text-2}"
    rounded: "{rounded.r-ctl}"
    padding: "4px 8px"
  media-item-selected:
    backgroundColor: "{colors.nila-subtle}"
    textColor: "{colors.text}"
  progress:
    backgroundColor: "{colors.border}"
    rounded: "{rounded.r-2xs}"
    height: "4px"
  timeline-track:
    height: "34px"
  timeline-clip:
    backgroundColor: "{colors.bg-panel}"
    textColor: "{colors.text-2}"
    typography: "{typography.timecode}"
    rounded: "{rounded.r-ctl}"
    height: "26px"
  timeline-clip-selected:
    backgroundColor: "{colors.nila-subtle}"
    textColor: "{colors.text}"
  playhead:
    backgroundColor: "{colors.nila-accent}"
    width: "2px"
---

# Design System: QuranRender

## Overview

**Creative North Star: "Ruang Sunting yang Hening"**

QuranRender adalah editor video profesional yang tenang. Konvensi Final Cut, Resolve, Premiere, dan CapCut dijalankan dengan rapi: header tipis berisi langkah Sumber → Sinkron → Tampilan → Ekspor, panel media di kiri, kanvas di tengah, inspector di kanan, timeline multi-track di bawah, tombol Ekspor di kanan atas. Antarmukanya sengaja menahan diri supaya ayat di kanvas selalu menjadi elemen paling terang dan paling diam di layar.

Status: tahap 4 (komponen dan pola tingkat layar) sudah masuk: lembar, panel geser, rel, kartu proyek/templat, baris pemeriksaan, tabel; aturan lintas layar tercatat di Named Rules bagian Components dan Do's and Don'ts.

Dunianya adalah grafit dingin yang netral, dengan mode terang dan gelap yang setara (keduanya dirancang penuh, bukan salah satu turunan). Hanya ada satu aksen, nila, dan ia hanya bekerja untuk seleksi, playhead, fokus, dan aksi utama. Struktur dibangun dari hairline 1px dan perbedaan tonal antarpanel, bukan dari bayangan atau warna. Kepadatannya kepadatan editor desktop: teks studio 13px, kontrol default 28px, baris inspector rapat, angka waktu tabular.

Sistem disusun tiga lapis di `design/system/tokens.css`: primitif (`--gray-*`, `--nila-*`, status, skala tipe/ruang/radius/gerak/z) → semantik per tema (`:root`/`.t-light`, `[data-theme="dark"]`/`.t-dark`, plus `prefers-color-scheme`) → token komponen (`--ctl-*`, `--btn-*`, `--field-*`, `--overlay-*`, timeline) yang dideklarasikan ulang di `:root, .t-light, .t-dark` agar `var()` dihitung ulang di dalam wadah bertema paksa. Komponen di `design/system/components.css` (awalan `qr-*`) hanya merujuk token semantik dan komponen; galeri lengkap di `design/system/gallery.html`. Logo Playhead sudah final.

Yang ditolak: panel gelap penuh warna-warni ala editor konsumen, dan tab editor terpisah yang memecah alur menjadi beberapa layar.

**Key Characteristics:**
- Netral grafit dingin, terang dan gelap setara.
- Satu aksen nila untuk seleksi, playhead, fokus, dan aksi utama.
- Hairline 1px dan lapisan tonal sebagai struktur; bayangan hanya untuk elemen yang mengapung.
- Font sistem dengan angka tabular untuk waktu; LPMQ untuk ayat, Amiri untuk Arab di UI.
- Tata letak editor standar dalam satu layar.

## Colors

Grafit dingin bertingkat dengan satu nada nila; warna status hanya muncul sebagai titik kecil, ikon, atau tepi tipis.

### Primary
- **Nila Seleksi** (`--accent`: `nila-accent`; gelap `nila-accent-dark`): tombol primer (Ekspor), playhead, segmen dan klip terpilih, kotak centang/sakelar aktif, langkah berjalan di header, isian slider dan progres, tautan. Hover `--accent-hover` (`nila-accent-hover` / `nila-accent-hover-dark`); tekan `--accent-active` (`nila-accent-active` #303a96 / gelap #6772e0).
- **Nila Redup** (`--accent-subtle`: `nila-subtle` / `nila-subtle-dark`): latar item, klip, opsi menu yang disorot, alat yang ditekan, area lepas saat diseret. Dipasangkan dengan teks utama; teks nila hanya untuk alat aktif dan lapisan teratas.
- **Nila Fokus** (`--focus`: `nila-focus`; gelap sama dengan aksen gelap): cincin fokus 2px.
- **Teks di Atas Nila** (`--on-accent`: putih / `on-accent-dark` #0f1230).

### Neutral
- **Lantai Aplikasi** (`bg-app` / `bg-app-dark`): latar terbawah, di belakang semua panel.
- **Panel** (`bg-panel` / `bg-panel-dark`): header, panel media, inspector, menu, dialog, toast.
- **Cekung** (`bg-sunken` / `bg-sunken-dark`): area timeline, kolom isian, wadah segmented control, area lepas.
- **Terangkat** (`--bg-raised`: putih / `bg-raised-dark` #262a31): permukaan yang naik dari cekung, yaitu opsi segmen terpilih. Di gelap ia sengaja lebih terang dari `bg-hover-dark`, sehingga opsi terpilih tetap terbaca di atas opsi yang sedang di-hover.
- **Hover** (`bg-hover` / `bg-hover-dark`): umpan balik pointer di atas kontrol.
- **Ruang Pratinjau** (`viewer` / `viewer-dark`): latar di sekitar kanvas; di gelap hampir hitam supaya bingkai video menonjol.
- **Hairline** (`border` / `border-dark`): pemisah panel, garis tabel, batas track, rel progres.
- **Hairline Tegas** (`border-strong` / `border-strong-dark`): rel slider, kepala tabel, klip terjemahan putus-putus, chip pintasan.
- **Batas Kontrol** (`border-control` / `border-control-dark`): batas semua kontrol interaktif (tombol sekunder, isian, segmen, klip, tombol putar, nomor langkah).
- **Teks** (`text`, `text-2`, `text-3` dan versi `-dark`): utama, sekunder, tersier (label, metadata, label track, placeholder).
- **Scrim** (`--scrim`: `rgb(21 23 28 / 0.32)`; gelap `rgb(0 0 0 / 0.55)`): tirai di belakang dialog.

### Status
- **Hijau Selesai** (`success` / `success-dark`): langkah selesai, toast/alert berhasil.
- **Amber Tinjau** (`warning` / `warning-dark`): titik 7px pada klip yang perlu ditinjau, langkah terhambat, alert peringatan.
- **Merah Bahaya** (`danger` / `danger-dark`): galat, isian tidak valid, tombol dan item menu destruktif. Latar bahaya hanya campuran 8–10% di atas panel.

### Named Rules
**The One Nila Rule.** Nila hanya berarti "terpilih, di sini, fokus, atau aksi utama". Tidak ada aksen kedua, tidak ada warna dekoratif per track. Seleksi di segmented control tetap netral.

**The Brightest Ayah Rule.** Tidak ada elemen UI yang lebih terang atau lebih jenuh daripada teks ayat di kanvas. Kata ayat yang aktif memakai putih penuh; kata lain diredam ke 74%.

## Typography

**Display Font:** tidak ada; UI tidak memakai fon display.
**Body Font:** fon sistem (`--font-ui`: SF Pro, Segoe UI Variable, dengan Inter dibundel untuk Linux)
**Label/Mono Font:** `--font-mono` hanya untuk kode dan path
**Ayat:** LPMQ (`--font-ayah`). **Arab di UI** (nama surah): Amiri (`--font-ar-ui`). **Wordmark:** Schibsted Grotesk, hanya di dalam aset logo.

**Character:** Fon sistem membuat QuranRender terasa seperti aplikasi asli di setiap OS, seperti editor desktop profesional; ekspresi diserahkan seluruhnya pada kaligrafi ayat.

### Hierarchy
Skala tetap `--fs-11` sampai `--fs-28` (11, 12, 13, 14, 16, 20, 28px).
- **Headline** (600, 1.75rem, tracking -0.02em): judul bagian dokumen/halaman; jarang di studio.
- **Title** (600, 1.25rem, tracking -0.01em): judul kelompok.
- **Body** (400, 0.875rem, 1.5): teks dasar; paragraf pengantar 1rem dengan maksimal 72ch. Judul keadaan kosong 16px tebal.
- **Body Studio** (400, 0.8125rem): teks default di dalam editor, menu, isian, item.
- **Label** (600, 0.75rem, teks sekunder/tersier, tanpa huruf kapital): judul panel, ringkasan inspector, label isian. Label grup menu 11px.
- **Timecode** (0.75rem, atau 0.6875rem untuk penggaris dan label playhead, angka tabular): waktu, durasi, klip, nomor langkah, lencana.

### Named Rules
**The Tabular Time Rule.** Setiap angka yang bergerak atau dibandingkan (waktu, durasi, penggaris, nilai stepper, progres) memakai `font-variant-numeric: tabular-nums` dengan fon UI, bukan fon mono.

**The Wordmark Only Rule.** Schibsted Grotesk hanya hidup di dalam SVG wordmark; tidak pernah dipakai untuk teks UI.

## Layout

Studio adalah satu layar dengan grid tiga baris: header tipis, badan, timeline. Badan memakai tiga kolom (media 232px, kanvas fleksibel ~60%, inspector 272px); panel samping dipisahkan dari kanvas dengan hairline 1px. Timeline memakai kolom label `--track-label-w` 132px, lajur `--track-h` 34px, dan klip `--seg-h` 26px. Kanvas pratinjau dipusatkan dalam ruang pratinjau dengan rasio bingkai video (9:16 untuk vertikal) dan garis area aman putus-putus.

**Bingkai Studio (prototipe tahap 4):** header 48px (tiga kolom: kiri, langkah alur di tengah, kanan), bilah sinkron opsional 32px di bawahnya, lalu badan tiga kolom (kiri 232px / kanvas fleksibel / inspector 272px) dan timeline lima trek (Latar, Audio, Ayat, Terjemahan, Overlay) dengan tinggi tetap di semua langkah. Di ≤1439px kolom 200/248; di ≤1099px 184/248 (label inspector 72px, header jadi `auto 1fr auto`, label langkah non-aktif disembunyikan). Lebar minimum aplikasi 960px. **Beranda:** rel 220px + area utama dengan grid kartu `repeat(auto-fill, minmax(236px, 1fr))`, celah 16px. **Lembar** 520–880px, **panel geser** 400px (antrean) atau 360px (riwayat versi).

Ritme ruang memakai skala 4px (`sp-1` sampai `sp-12`). Kontrol punya tiga tinggi: `--ctl-h-sm` 24px (baris inspector), `--ctl-h-md` 28px (default studio, juga `--menu-item-h`), `--ctl-h-lg` 32px; padding horizontal 8/10/14px, celah `--ctl-gap` 6px. Baris inspector minimal 30px dengan label 88px. Di halaman dokumen ritmenya lebih lapang (blok 48px, gutter 32px, lebar maksimal 1320px). Di bawah 1100px grid dua kolom runtuh menjadi satu; di bawah 700px header tidak lagi sticky dan tabel berubah menjadi kartu baris berlabel. Komponen yang lebarnya berubah (klip, antrean ekspor) memakai container query, bukan breakpoint layar.

Tumpukan lapisan tetap: `--z-sticky` 10, `--z-popover` 40, `--z-dialog` 60, `--z-toast` 80, `--z-tooltip` 90.

## Elevation & Depth

Sistemnya datar dan berlapis tonal: kedalaman datang dari urutan lantai aplikasi → cekung → panel → terangkat, ditambah hairline 1px. Bayangan hanya untuk elemen yang benar-benar mengapung atau menonjol dari bidang: menu, popover, dialog, palet perintah, toast, tooltip, opsi segmented terpilih, kenop slider, dan bingkai video di kanvas.

Setiap lapisan mengapung memakai satu deklarasi elevasi, `--overlay-shadow: 0 0 0 1px var(--overlay-ring), var(--shadow-pop)`: cincin 1px plus bayangan dalam satu `box-shadow`, tanpa `border`. Di terang `--overlay-ring` transparan karena bayangan sudah cukup memisahkan; di gelap cincin memakai `border-dark` karena bayangan hitam nyaris tak terlihat di atas grafit gelap.

### Shadow Vocabulary
- **Pop** (`--shadow-pop`: `0 8px 24px -8px rgb(21 23 28 / 0.18), 0 2px 6px -2px rgb(21 23 28 / 0.08)`; gelap `0 8px 24px -8px rgb(0 0 0 / 0.6), 0 2px 6px -2px rgb(0 0 0 / 0.4)`): bagian bayangan dari `--overlay-shadow`; tooltip memakainya langsung.
- **Angkat** (`--shadow-lift`: `0 1px 2px rgb(21 23 28 / 0.08)`; gelap `0 1px 2px rgb(0 0 0 / 0.4)`): opsi segmented terpilih, kenop slider dan sakelar.
- **Bingkai** (`box-shadow: 0 8px 24px -10px rgb(0 0 0 / 0.5)`): bingkai video di ruang pratinjau.

### Named Rules
**The Hairline First Rule.** Pisahkan dengan garis 1px atau perbedaan tonal dulu; bayangan hanya untuk benda yang mengapung.

## Shapes

Sudut kecil dan lembut, satu skala dengan alasan per langkah (arah awal "6–10px" kini diperluas oleh build):
- `--r-2xs` 2px: geometri tipis, yaitu rel slider, progres, pegangan trim, batang gelombang suara.
- `--r-xs` 4px: objek mungil 16–20px, yaitu kotak centang, chip pintasan `qr-kbd`, tombol keyframe, label playhead dan snap.
- `--r-ctl` 6px: semua kontrol 24–32px (tombol, isian, opsi segmen, item, menu item, klip, tooltip). Radius default.
- `--r-seg` 8px: wadah segmented = `r-ctl` + 2px padding, agar konsentris.
- `--r-panel` 10px: panel, timeline, alert, menu, toast, area lepas, scrim pratinjau.
- `--r-overlay` 12px: hanya dialog dan palet perintah, permukaan modal terbesar.
- `--r-pill` 999px: sakelar dan lencana. Lingkaran penuh (50%) untuk tombol putar, radio, nomor langkah, kenop, dan titik status.

Playhead adalah garis 2px nila dengan kepala yang sama dengan kepala logo Playhead: pentagon 12×14px bersudut 2px dan berujung runcing ke bawah, dibentuk dengan `clip-path: path('M0 2a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v7l-6 5-6-5z')`. Penanda timeline memakai bendera kecil netral. Ikon garis 1.5px dengan ujung membulat, 16px di studio (14px kecil, 20px besar/dokumen).

## Components

Sembilan belas kelompok komponen dasar `qr-*` plus komponen tingkat layar (tahap 4: lembar, panel geser, rel, kartu, panduan, baris pemeriksaan, opsi, kotak salin, tabel, kartu templat, keadaan klip), semuanya dengan state hover, fokus, tekan, nonaktif, dan (bila relevan) terpilih/tidak valid. Transisi state memakai `--dur-1` 120ms `--ease-out` `cubic-bezier(0.16, 1, 0.3, 1)`; pembukaan dan sorotan `--dur-2` 220ms; dialog, lembar, panel geser, dan masuknya toast `--dur-3` 320ms (toast naik 8px sambil memudar). `--ease-in-out` `cubic-bezier(0.65, 0, 0.35, 1)` untuk animasi berulang (progres tak tentu). Fokus keyboard selalu outline `--focus-ring-w` 2px `--focus` dengan offset 2px (0 di dalam segmented).

### Buttons (`qr-btn`)
- **Shape:** `--ctl-radius` 6px; tinggi 24/28/32 (`--sm`, default, `--lg`); varian ikon persegi.
- **Primary:** `--btn-primary-bg` nila, teks `--on-accent`, 600. Hover `--accent-hover`, tekan `--accent-active` dan turun 0.5px. Satu per layar (Ekspor, kanan atas).
- **Secondary:** latar panel, batas kontrol; hover latar hover; tekan batas `text-3`.
- **Ghost:** teks sekunder tanpa latar; `aria-pressed` = latar nila redup dan ikon nila (alat timeline aktif).
- **Danger:** seperti sekunder dengan teks merah; hover batas merah dan latar merah 8%.
- **Disabled / Loading:** latar cekung, hairline, teks tersier; pemutar `qr-spin` 14px.
- **Putar (`qr-play`):** lingkaran 32px, latar panel, batas kontrol; hover batas dan ikon nila.

### Segmented Control (`qr-seg`)
- **Style:** wadah cekung, batas kontrol, `--r-seg`, padding 2px; opsi 22px, 13px teks sekunder.
- **State:** hover latar hover; terpilih `--bg-raised` + teks utama + `--shadow-lift`. Seleksi di sini netral, bukan nila.

### Inputs / Fields (`qr-field`, `qr-stepper`, `qr-select`, `qr-choice`, `qr-switch`, `qr-slider`)
- **Style:** `--field-bg` cekung, `--field-border` batas kontrol, 6px, tinggi 28px (24px di baris inspector), label 12px tebal di atas, bantuan 12px tersier.
- **Hover / Focus:** batas `--field-border-hover` (`text-3`); fokus batas nila plus cincin dalam 1px nila. Select terbuka memakai perlakuan yang sama.
- **Error / Disabled:** `is-invalid` batas dan cincin merah dengan pesan galat ikon + teks merah; nonaktif latar panel, hairline, teks tersier.
- **Stepper:** 132px, angka tabular rata kanan, seret horizontal untuk mengubah nilai, tombol naik/turun 20px dipisah hairline.
- **Pilihan:** kotak centang 16px `r-xs`, radio lingkaran, keduanya terisi nila saat aktif; sakelar 30×18 pil, rel `border-strong`, aktif nila.
- **Slider:** rel 4px `border-strong` dengan isian nila, kenop berlatar panel dengan batas kontrol dan `--shadow-lift`.

### Overlays (`qr-menu`, `qr-tip`, `qr-dialog`, `qr-cmdk`, `qr-toast`)
- **Menu:** `--overlay-bg`, `--r-panel`, `--overlay-shadow`, padding 4px; item 28px, hover nila redup, centang nila, pemisah hairline, item bahaya merah dengan hover merah 10%.
- **Tooltip:** terbalik (latar `text`, teks `bg-panel`), 12px, 6px, `--shadow-pop`, boleh memuat `qr-kbd`.
- **Dialog:** 440px, `--r-overlay`, `--overlay-shadow`, di atas `--scrim`.
- **Palet perintah:** 560px, `--r-overlay`, kolom cari 44px dipisah hairline.
- **Toast:** 360px, `--r-panel`, `--overlay-shadow`, ikon status berwarna, masuk `--dur-3`; boleh memuat progres.

### Sheets & Drawers (`qr-sheet`, `qr-scrim-fixed`, `qr-section`, `qr-split`, `qr-drawer`)
- **Lembar (`qr-sheet`):** modal di atas `qr-scrim-fixed` (`position: fixed`, `--z-dialog`, `--scrim`, padding `clamp(12px, 3vw, 32px)`). Lebar `--sheet-w` (520–880px; Selamat datang 520, Diagnostik 560, Hubungkan ulang 600, Pecah menjadi klip 640, Pengaturan 820, default 560), tinggi maks `min(88vh, 880px)`, `--r-overlay`, `--overlay-shadow`. Kepala (judul 16px tebal + tombol tutup ghost) dan kaki (rata kanan, latar cekung, hairline atas, catatan `qr-sheet__note` di kiri) dipisah hairline; badan menggulir, jarak 16px. Masuk `qr-sheet-in` `--dur-3` (naik 8px, skala 0.985), dimatikan saat reduced-motion dan saat render ulang di tempat.
- **Bagian (`qr-section`):** judul 12px tebal tersier, jarak 8px. **Split (`qr-split`):** `qr-rail` 188px di kiri berhairline plus badan di kanan (Galeri templat, Pengaturan).
- **Panel geser (`qr-drawer`):** tidak memblokir, menempel kanan di bawah header (`--drawer-top`), lebar `--drawer-w` (400px antrean, 360px riwayat versi), latar panel, `--overlay-shadow`, `--z-popover`, masuk `qr-drawer-in` `--dur-3` (geser 16px). Kepala 44px, kaki cekung; `qr-group-label` 12px tebal tersier untuk kelompok.

### Cards / Containers (`qr-panel`, `qr-group`, `qr-alert`, `qr-empty`, `qr-drop`)
- **Corner Style:** `--r-panel` 10px.
- **Background:** panel di atas lantai aplikasi; timeline, isian, dan area lepas di atas cekung.
- **Shadow Strategy:** tanpa bayangan (lihat Elevation & Depth).
- **Border:** hairline 1px; alert peringatan/bahaya mencampur 45% warna status ke hairline; area lepas putus-putus batas kontrol, saat diseret nila + nila redup.
- **Internal Padding:** kepala panel 36px, isi 12px; grup inspector lipat dengan ringkasan 12px tebal, chevron berputar `--dur-2`.
- **Kartu proyek (`qr-card`):** `--r-panel`, latar panel, hairline; hover batas kontrol (`is-hover` setara). Thumb 16:9 gelap (`--thumb-bg`) dengan ayat LPMQ 22px dan lencana durasi tabular 11px di kanan bawah; isi: judul 13px tebal (elipsis), meta 12px tersier, kaki 12px. `is-missing`: tidak bisa dibuka, thumb cekung dengan ikon amber. Tanpa bayangan.
- **Kartu templat (`qr-tpl`):** padding 8px, `--r-panel`, hairline; hover batas kontrol; `aria-pressed="true"` = batas nila + cincin 1px nila. Nama 13px tebal, meta 12px tersier; versi mini di panel kiri (4 kolom, meta disembunyikan).
- **Gelembung panduan (`qr-guide`):** 244px, `--overlay-bg`, `--r-panel`, `--overlay-shadow`, ekor 10px diputar 45°, `--z-popover`; judul tebal, aksi rata kanan.
- **Baris pemeriksaan (`qr-check-row`):** grid ikon / isi / aksi, padding 8px, hairline bawah; ikon `is-ok` hijau, `is-warn` amber, `is-fail` merah; judul 500, rincian 12px tersier, kode 11px tabular tersier.
- **Opsi (`qr-opt`):** pilihan berbentuk baris (preset, cara memecah): `--r-ctl`, hairline, padding 8/10px; hover batas kontrol; terpilih (`:has(input:checked)`) batas nila + nila redup; meta 12px tabular.
- **Kotak salin (`qr-copy`):** `.qr-copy__box` memakai `--field-bg`, `--field-border`, `--ctl-radius`; teks 13px `pre-wrap` dan dapat diseleksi, tombol salin di kanan.

### Navigation (`qr-flow`)
Langkah Sumber → Sinkron → Tampilan → Ekspor di tengah header, dipisah chevron berwarna batas kontrol. Lingkaran nomor 20px (11px, tabular). Selesai: lingkaran hijau penuh, teks sekunder. Berjalan: lingkaran berbatas nila ganda, teks utama tebal. Terhambat: lingkaran amber. Belum: teks tersier.

### Rail (`qr-rail`)
Navigasi vertikal untuk filter dan bagian: item 30px, `--r-ctl`, 13px teks sekunder, ikon + label, hitungan `em` tabular rata kanan. Hover latar hover; `aria-current="true"` = `--accent-subtle` + teks utama (tanpa teks nila); fokus outline 2px ke dalam. Label grup 11px tebal tersier, pemisah hairline. Dipakai di Beranda (220px, filter proyek), Galeri templat dan Pengaturan (dalam `qr-split`, kolom 188px).

### Lists & Status (`qr-item`, `qr-badge`, `qr-kbd`, `qr-progress`, `qr-job`)
- **Item media:** min 30px, 6px; hover latar hover; terpilih nila redup + teks utama; seret-masuk outline putus-putus nila.
- **Lencana:** pil 20px, hairline, 12px tabular dengan titik status opsional.
- **Pintasan:** 20px, `r-xs`, `border-strong` dengan tepi bawah 2px.
- **Progres:** rel 4px hairline, isian nila (`scaleX`, `--dur-2`); tak tentu memakai `--ease-in-out`; dijeda menjadi `text-3`.
- **Antrean ekspor:** baris grid dengan hairline bawah; runtuh lewat container query di bawah 480px.

### Table (`qr-tbl`)
Lebar penuh, 13px. Kepala 12px tebal teks tersier dengan hairline tegas (`border-strong`) di bawah, padding 6/10px; sel padding 8/10px dengan hairline bawah (baris terakhir tanpa); kolom angka `.num` tabular.

### Timeline (`qr-tl`, `qr-track`, `qr-clip`, `qr-playhead`)
Area cekung `--r-panel` dengan penggaris 11px tabular. Klip ayat: `--seg-bg` panel, `--seg-border` batas kontrol, `--seg-radius` 6px, 12px tabular; kode ayat tidak pernah dipotong elipsis. Hover batas `text-3`; trim kursor ew-resize dengan pegangan 3px; terpilih `--seg-selected-bg` nila redup + `--seg-selected-border` nila + pegangan nila di kedua sisi; perlu ditinjau titik amber 7px; terkunci cekung dan teks tersier. Klip terjemahan transparan dengan batas putus-putus `border-strong` (padat setelah diedit). Playhead `--playhead` nila `--playhead-w` 2px dengan kepala pentagon logo dan label waktu nila; snap garis putus-putus nila; rentang terpilih nila 8%.

**Keadaan klip tingkat layar:** `is-review` (titik amber 7px di kiri, `padding-left` 20px); `is-danger` (batas `--danger`, titik merah) untuk segmen yang melanggar kebijakan ekspor; `is-missing` (batas putus-putus `--warning`, latar cekung, ikon peringatan amber) untuk aset hilang, dan kanvas kehilangan latarnya; `qr-clip--film` (filmstrip gambar latar berulang di trek Latar); `has-words` (pembagi kata `--border-control` sebanyak `--words`) pada segmen terpilih di trek Ayat. Klip bisa berupa `button.qr-clip` dengan fokus outline 2px offset 1px.

### Kanvas Ayat
Bingkai video dengan gradien gelap di atas gambar latar, area aman putus-putus, ayat LPMQ 30px dengan line-height 2, terjemahan 12px, sumber 11px. Sorotan per kata berpindah dengan transisi 260ms; dimatikan saat `prefers-reduced-motion`.

**Templat kanvas di prototipe** (`design/prototype/prototype.css`; pengganti visual untuk perender Rust, bukan komponen UI): empat templat `tpl-subuh`, `tpl-hening`, `tpl-terang`, `tpl-besar` di atas `.cv` (wadah, `container-type` untuk `cqw`) dan `.cv-in` (elemen dalam yang memegang padding `14.2cqw 10cqw 24.9cqw`). Kotak area aman `.safe` berinset 10% sisi, 8% atas, 14% bawah, garis putus-putus. Lapisan: ayat 9.4cqw (besar 12.5cqw), terjemahan 4cqw, sumber 3.4cqw, nama surah Amiri 7cqw, dan lencana qari berbentuk pil (latar `rgb(8 9 12 / 0.55)`, 3.4cqw) di atas bawah. Templat terang memakai teks gelap tanpa `text-shadow`; besar menyembunyikan terjemahan.

### Logo
Logo Playhead final: tanda, lockup, wordmark, dan versi satu warna di `design/brand/logo/`; ikon aplikasi di `design/brand/icons/tauri/`. Kepala playhead di timeline memakai bentuk yang sama.

### Named Rules
**The One Primary Rule.** Satu tombol primer per layar: Studio = Ekspor, Beranda = Buat proyek. Di lembar, satu primer di kanan footer yang menjadi aksi Enter; lembar info-saja (Pengaturan, Siap unggah) menutup dengan **Selesai** sebagai primer; aksi langkah (Sinkronkan, Terima, Berikutnya) sekunder. Primer nonaktif menampilkan alasannya sebagai tooltip.

**The Explained Disabled Rule.** Kontrol nonaktif selalu menjelaskan alasannya (tooltip); tidak ada kontrol mati tanpa penjelasan.

**The Quiet Sheet Rule.** Lembar memutar `qr-sheet-in` hanya saat dibuka; render ulang di tempat (ganti langkah, ubah isian) tidak memutar ulang animasi.

**The Constant Timeline Rule.** Tinggi timeline sama di semua langkah (lima trek: Latar, Audio, Ayat, Terjemahan, Overlay) supaya kanvas dan transport tidak melompat.

**The Safe Canvas Rule.** Teks kanvas tinggal di dalam kotak area aman. Tipe kanvas memakai `cqw` dan padding dipasang di elemen dalam `.cv-in`, tidak pernah padding `cqw` pada wadah `.cv` sendiri.

**The Code-in-Tooltip Rule.** Kode kebijakan internal (CNT-n) tidak pernah menjadi teks UI; hanya tooltip. Teks UI memakai bahasa manusia ("masalah", "Lengkap").

**The No Glow Rule.** Tidak ada glow pada kontrol apa pun; glow hover pada kenop slider sudah dihapus. Fokus = cincin 2px, hover = batas atau latar.

## Do's and Don'ts

### Do:
- **Do** pakai nila hanya untuk seleksi, playhead, fokus, dan aksi utama (The One Nila Rule).
- **Do** rancang setiap layar untuk terang dan gelap sekaligus melalui token semantik dan komponen (`--bg-*`, `--text-*`, `--border*`, `--accent*`, `--btn-*`, `--field-*`), bukan hex mentah.
- **Do** pakai angka tabular untuk setiap waktu dan angka yang berubah.
- **Do** pisahkan panel dengan hairline 1px dan lapisan tonal.
- **Do** pakai batas kontrol (`border-control`) untuk semua kontrol interaktif agar terlihat bisa disentuh.
- **Do** pakai `--overlay-shadow` sebagai satu-satunya deklarasi elevasi untuk lapisan mengapung, dan `--bg-raised` untuk permukaan terpilih di atas cekung.
- **Do** pilih radius dari skala `r-*` sesuai ukuran objek; 12px hanya untuk dialog dan palet perintah.
- **Do** pakai tinggi kontrol 24/28/32 dan durasi `dur-1/2/3`; jangan angka lepas.
- **Do** biarkan ayat menjadi elemen paling terang di layar; kata aktif putih penuh, kata lain 74%.
- **Do** pertahankan alur empat langkah dan tata letak editor standar dalam satu layar.
- **Do** pertahankan satu aksi primer per layar: Studio = Ekspor, Beranda = Buat proyek, lembar = satu primer di kanan footer (= Enter); lembar info-saja menutup dengan Selesai sebagai primer (The One Primary Rule).
- **Do** jelaskan alasan kontrol nonaktif lewat tooltip (termasuk primer yang nonaktif).
- **Do** pertahankan tinggi timeline tetap (lima trek) di semua langkah alur.
- **Do** jaga teks kanvas di dalam kotak area aman; tipe kanvas memakai `cqw`, padding di elemen dalam (`.cv-in`).

### Don't:
- **Don't** buat panel gelap penuh warna-warni atau warna berbeda per track.
- **Don't** pecah alur menjadi tab editor terpisah.
- **Don't** pakai Schibsted Grotesk atau fon display apa pun untuk teks UI.
- **Don't** pakai fon mono untuk waktu; mono hanya untuk kode dan path.
- **Don't** beri bayangan pada panel atau kartu yang duduk di bidang.
- **Don't** tambah `border` terpisah pada lapisan mengapung; cincinnya sudah ada di `--overlay-shadow`.
- **Don't** pakai nila untuk seleksi di segmented control.
- **Don't** ubah bentuk, warna, atau proporsi logo Playhead. Pakai hanya file dari `design/brand/logo/` (tanda, lockup, wordmark, versi satu warna) dan set ikon `design/brand/icons/tauri/`.
- **Don't** beri glow pada kontrol apa pun (kenop slider, tombol, kartu); fokus hanya cincin 2px, seleksi hanya batas dan nila redup.
- **Don't** tampilkan kode kebijakan internal (CNT-n) sebagai teks UI; kode hanya di tooltip.
- **Don't** nonaktifkan kontrol tanpa alasan; alasan tampil sebagai tooltip.
- **Don't** beri tombol primer kedua di satu layar atau lembar; aksi langkah di panel kiri berupa sekunder.
- **Don't** biarkan lembar memutar ulang animasi masuknya saat render ulang di tempat.
- **Don't** ubah tinggi timeline antar langkah, dan jangan beri `padding` berunit `cqw` pada wadah kanvas itu sendiri.
