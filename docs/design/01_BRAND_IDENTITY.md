# 01 — Identitas Visual QuranRender

| Item | Nilai |
|---|---|
| Status | Final tahap 1 (2026-10-23). Logo: **Playhead**. |
| Papan visual | [`design/brand/brand-board.html`](../../design/brand/brand-board.html) (buka lewat server lokal agar font termuat) |
| Token | [`design/system/tokens.css`](../../design/system/tokens.css) |
| Terkait | [`PRODUCT.md`](../product/PRODUCT.md), [`docs/product/PRD.md`](../product/PRD.md) |

---

## 1. Arah

| Keputusan | Nilai | Sumber |
|---|---|---|
| Arah rasa | Tenang dan editorial | Pemilik produk |
| Tema | Terang dan gelap setara, default mengikuti sistem | Pemilik produk |
| Dunia visual | Standar kategori editor video profesional, dengan acuan kerapian Final Cut Pro, DaVinci Resolve, CapCut Desktop, dan Adobe Premiere Pro | Pemilik produk (ronde arah) |
| Pembeda | Ayat di kanvas selalu menjadi elemen paling terang dan paling diam. UI netral, satu aksen. Tanpa tab editor terpisah seperti Quran Caption. | Turunan dari PRD §6 |

**Batas kepekaan konten (mengikat):**

- Tidak ada gambar makhluk bernyawa.
- Tidak ada ikonografi musik. Waveform hanya dipakai sebagai alat edit audio.
- Teks Arab dan ayat tidak pernah menjadi ornamen, tekstur, atau bagian logo.

---

## 2. Logo

**Playhead** dipilih pemilik produk (2026-10-23), dari tiga konsep yang disiapkan (Lengkung, Kata,
Playhead).

**Gagasan.** Mangkuk huruf q dengan playhead editor sebagai batangnya, sehingga Qur'an dan alat edit
hadir dalam satu bentuk. Celah tipis memisahkan mangkuk dari playhead supaya tetap terbaca di 16 px.
Kepala playhead berbentuk segi lima menunjuk ke bawah, seperti penanda playhead di timeline.

**Penyempurnaan dari konsep awal:**

- Bentuk berubah dari cincin "Q" menjadi mangkuk "q", dengan celah di antara mangkuk dan playhead
  supaya tidak menggumpal di ukuran kecil.
- Kepala persegi diganti segi lima, bentuk playhead yang dikenal pengguna editor.
- Tanda dipusatkan secara optik pada kisi 64 × 64, dan ketebalan garis menjadi 6,5/64.

**Wordmark:** "QuranRender" dalam Schibsted Grotesk SemiBold (OFL), dikonversi menjadi outline,
dengan tracking −1,5%.

**File** (dibuat oleh `design/tools/gen-logos.mjs`):

| Kebutuhan | File |
|---|---|
| Tanda | `logo/playhead-mark-{light,dark,mono-ink,mono-white}.svg` |
| Lockup horizontal | `logo/playhead-lockup-{light,dark,mono-ink,mono-white}.svg` |
| Wordmark saja | `logo/wordmark-{light,dark,mono-ink,mono-white}.svg` |
| Ikon aplikasi | `logo/appicon.svg` (resmi, ubin grafit gelap) dan `logo/appicon-light.svg` (alternatif) |
| Favicon | `logo/favicon.svg` (mengikuti tema browser) |
| Set ikon aplikasi (macOS `.icns`, Windows `.ico` + Square*Logo, PNG Linux 32–512, Android/iOS) | `icons/tauri/`, dibuat dengan `tauri icon` dari `icons/src/appicon-1024.png` |

**Aturan pakai:**

- Ruang kosong minimum di sekeliling tanda = lebar kepala playhead (9/64 dari tinggi tanda).
- Ukuran minimum tanda 16 px. Lockup minimum 96 px lebarnya.
- Versi satu warna dipakai di atas foto atau cetak satu tinta.
- Jangan memutar, memiringkan, mengganti warna di luar palet, atau menambah efek bayangan atau
  gradien.
- Ikon aplikasi memakai kotak bersudut 824 px pada kanvas 1024 px dengan radius 185 px.

---

## 3. Warna

**Strategi:** netral dengan satu aksen. Netralnya grafit dingin (bukan krem), sedangkan aksennya nila
dan hanya dipakai untuk seleksi, playhead, fokus, dan aksi utama. Warna status (selesai, perlu
ditinjau, ditolak) hanya muncul ketika ada status.

| Token | Terang | Gelap | Dipakai untuk |
|---|---|---|---|
| `--bg-app` | `#f2f3f5` | `#101114` | Latar aplikasi |
| `--bg-panel` | `#ffffff` | `#17191d` | Panel |
| `--bg-sunken` | `#f7f8fa` | `#0b0c0e` | Timeline, input |
| `--bg-hover` | `#e9ebef` | `#1e2126` | Hover |
| `--border` | `#e0e3e8` | `#2a2e35` | Garis panel |
| `--border-strong` | `#cbd0d7` | `#3a3f48` | Pemisah tegas (dekoratif) |
| `--border-control` | `#878e9a` | `#646b77` | Batas kontrol (≥ 3 : 1) |
| `--text` | `#15171c` | `#e9eaee` | Teks utama |
| `--text-2` | `#4a505c` | `#a9aeb8` | Teks sekunder |
| `--text-3` | `#646b77` | `#8a909b` | Teks redup, label |
| `--accent` | `#4652c8` | `#8e97f2` | Seleksi, playhead, fokus, aksi utama |
| `--accent-subtle` | `#edeffc` | `#232846` | Latar seleksi |
| `--success` | `#2a7f50` | `#5bc48a` | Selesai |
| `--warning` | `#8a5d0c` | `#e3b341` | Perlu ditinjau |
| `--danger` | `#b93535` | `#f07373` | Ditolak, error |

**Kontras terukur** (dihitung di papan visual):

| Pasangan | Rentang rasio (terang dan gelap) |
|---|---|
| Semua pasangan teks di panel | 4,94 – 17,93 : 1 (syarat ≥ 4,5 : 1) |
| Teks redup di area cekung | 5,05 dan 6,10 : 1 |
| Batas kontrol | 3,10 – 3,64 : 1 (syarat ≥ 3 : 1) |

---

## 4. Tipografi

| Peran | Font | Catatan |
|---|---|---|
| UI | Font sistem: SF Pro (macOS), Segoe UI Variable (Windows), Inter dibundel untuk Linux | Konvensi editor desktop profesional |
| Waktu & ukuran | Font UI dengan `font-variant-numeric: tabular-nums` | Tanpa font mono sebagai kostum |
| Kode/path | `ui-monospace` | Hanya untuk kode dan path berkas |
| Wordmark | Schibsted Grotesk SemiBold, berupa outline | Tidak dipakai di UI |
| Ayat | LPMQ (font Mushaf Standar Indonesia) | Satu-satunya font dengan cakupan glyph penuh untuk dataset |
| Nama surah & Arab non-ayat | Amiri | Mencakup semua karakter nama surah |

**Skala UI:**

| Langkah | Ukuran | Dipakai untuk |
|---|---|---|
| 11 | 11 px | Penggaris timeline |
| 12 | 12 px | Label panel, label track |
| 13 | 13 px | Isi panel, default UI |
| 14 | 14 px | Teks dokumen |
| 16 | 16 px | Paragraf pengantar |
| 20 | 20 px | Judul dialog |
| 28 | 28 px | Judul halaman |

Tidak ada teks fungsional di bawah 11 px.

---

## 5. Ikon

- **Sumber:** Lucide (lisensi ISC), garis 1,5 px pada kisi 24 px, ukuran tampil 16–20 px, mengikuti
  warna teks.
- **Dilarang:** ikon musik (not balok, equalizer musik, headphone sebagai simbol musik) dan ikon
  berbentuk makhluk bernyawa.
- **Daftar awal:** impor, sinkron (waveform), tinjau, teks, lapisan gaya, terjemahan, potong, putar,
  jeda, urungkan, ulangi, cari ayat, waktu, selesai, perhatian, ekspor, pintasan, pengaturan.

---

## 6. Suara & bahasa

Hangat dan sopan, dalam bahasa baku ringan. Setiap pesan menyebut **apa yang terjadi** dan **apa
langkah berikutnya**.

| Konteks | Kita menulis | Kita hindari |
|---|---|---|
| Sinkron selesai | Ayat sudah tersinkron. Silakan periksa 3 bagian yang ditandai. | Sukses!!! Semua beres 🎉 |
| Ekspor ditolak | Ekspor belum bisa dilanjutkan: segmen 2:255 memotong sebuah kata. Geser batas segmen ke batas kata terdekat. | Error: invalid word range |
| Glyph tidak lengkap | Font Amiri belum memiliki salah satu tanda waqaf yang dipakai di 554 ayat. Gunakan LPMQ untuk teks ayat. | Font tidak didukung. |
| Beranda kosong | Belum ada proyek. Mulai dengan menyeret file tilawah ke jendela ini. | Nothing here. |
| Konfirmasi hapus | Hapus proyek "Tarawih Malam 3"? File media di komputer Anda tidak ikut terhapus. | Yakin? Tindakan ini tidak bisa dibatalkan!! |

**Aturan istilah:**

- Pakai "ayat", "segmen", "tinjau", "ekspor", "paket unggah".
- Hindari jargon teknis di UI, misalnya "render pipeline", "token", atau "job ID". Istilah itu hanya
  boleh muncul di diagnostik.

---

## 7. Lisensi aset desain

| Aset | Lisensi | Lokasi |
|---|---|---|
| Inter | SIL OFL 1.1 | `design/system/fonts/Inter-OFL.txt` |
| Schibsted Grotesk (wordmark) | SIL OFL 1.1 | `design/system/fonts/SchibstedGrotesk-OFL.txt` |
| Lucide | ISC | Dicatat saat ikon dibundel ke aplikasi |
| LPMQ, Amiri | Lihat `content-manifest.json` (PRD Q8) | `assets/fonts/quran/` |

---

## 8. Tahap berikutnya

1. ~~Pemilihan dan penyempurnaan logo~~ selesai (Playhead).
2. **Tahap 2 — Design system:** lihat [`02_DESIGN_SYSTEM.md`](02_DESIGN_SYSTEM.md).
3. ~~Tahap 3~~ draf selesai: [`03_INFORMATION_ARCHITECTURE.md`](03_INFORMATION_ARCHITECTURE.md).
4. **Tahap 4:** mockup hi-fi semua layar utama.
5. **Tahap 5:** template video.
