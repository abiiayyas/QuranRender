# Roadmap dan Catatan Keputusan

| Item | Nilai |
|---|---|
| Status | Catatan perencanaan. Belum ada yang dikerjakan di bagian 1 sampai 4 |
| Disusun | Setelah 0.7.0, atas diskusi dengan pemilik produk |
| Terkait | [`PRD.md`](PRD.md) §15.2, [`08_MIGRASI_ELECTRON.md`](../engineering/08_MIGRASI_ELECTRON.md) |

Dokumen ini memuat apa yang direncanakan setelah 0.7.0, urutannya, dan keputusan yang masih menunggu pemilik produk. Angka dan
batas layanan pihak ketiga ditulis dari ingatan dan **harus dicek ke dokumentasi terbaru** sebelum dipakai memutuskan.

## 1. Keadaan saat ini (0.7.0)

- Repositori `abiiayyas/QuranRender` masih **privat**, tanpa topik atau homepage.
- Tidak ada berkas `LICENSE`; GPL-3.0 hanya tertulis di `package.json`.
- Rilis hanya **macOS x64**, DMG sekitar 377 MB, **tanpa tanda tangan** (`identity: null` di `electron-builder.yml`). Mac Apple Silicon
  memakainya lewat Rosetta. Tidak ada Windows atau Linux.
- CI (`.github/workflows/ci.yml`) hanya memeriksa typecheck, tes, lint, dan build. Belum membuat rilis.
- Belum ada telemetri, halaman unduh, atau pemberitahuan pembaruan.

## 2. Keputusan yang ditunggu dari pemilik produk

| ID | Keputusan | Mengapa penting |
|---|---|---|
| K1 | Apakah lisensi Remotion cocok dengan GPL-3.0? Remotion berlisensi sendiri (gratis untuk individu dan organisasi sampai 3 karyawan), sedangkan GPL melarang pembatasan tambahan. **Tebakan, bukan kesimpulan hukum**; perlu pendapat ahli lisensi | Menentukan boleh tidaknya repositori dan rilis dibuka sebagai GPL |
| K2 | Q5, Q8, Q9 di PRD §15.2 (anomali codepoint, sumber dan lisensi font, izin Saheeh International). PRD menyebut ketiganya wajib selesai sebelum beta publik | Gerbang beta publik |
| K3 | Membeli Apple Developer Program (sekitar US$99 per tahun) untuk tanda tangan dan notarisasi | Tanpa itu pengguna baru melihat peringatan Gatekeeper dan pembaruan otomatis penuh tidak bisa dibuat |
| K4 | Apakah Windows jadi prioritas untuk pengguna luar | Mayoritas calon pengguna luar memakai Windows; kode belum pernah dicoba di sana |

## 3. Distribusi dan rilis (urutan kerja)

1. **Putuskan K1 dan K2, lalu jadikan repositori publik.** Sebelum itu: berkas `LICENSE`, README dengan tangkapan layar dan versi
   English, topik dan deskripsi, `SECURITY.md`, `CONTRIBUTING.md`, templat issue, dan dokumen arsip Tauri (04, 05, 06) dipindah ke
   `docs/archive`.
2. **CI rilis.** Bangun arm64 dan x64 (runner `macos-latest` berarsitektur arm64; FFmpeg dan Remotion compositor diunduh per arsitektur
   host), unggah ke GitHub Releases dengan checksum SHA-256 dan catatan dari `CHANGELOG.md`. Windows menyusul bila K4 ya.
3. **Tanda tangan dan notarisasi** (K3).
4. **Halaman unduh di Cloudflare Pages.**
   - Pages untuk halamannya saja. Setahu saya Pages membatasi 25 MiB per berkas, jadi DMG tetap di GitHub Releases (batas 2 GB per
     aset). Alternatif: Cloudflare R2 bila ingin domain dan hitungan sendiri.
   - Isi: deteksi OS, tombol ke rilis terbaru, versi, checksum, cara membuka aplikasi tanpa tanda tangan (selama K3 belum), dua
     bahasa, tautan donasi.
5. **Pemberitahuan pembaruan.** Aplikasi memeriksa versi terbaru (rilis GitHub) dan menawarkan tombol ke halaman unduh. Tidak butuh
   tanda tangan.
6. **Analitik** (bagian 4).
7. **Unduh dan pasang otomatis** (electron-updater atau setara). Syarat: aplikasi ditandatangani dan dinotarisasi, rilis publik, dan
   ukuran pembaruan dikurangi (tiap rilis 377 MB; berkas blockmap sudah dihasilkan tetapi diff hanya berguna dengan alur bertanda tangan).
   Tinjau juga mengecilkan paket (Chrome headless, FFmpeg, `quran.db`).

## 4. Analitik

Tiga angka berbeda, dan hanya satu yang butuh pelacakan:

| Angka | Cara | Pelacakan |
|---|---|---|
| Kunjungan halaman | Cloudflare Web Analytics | Tanpa cookie |
| Unduhan | Hitungan unduhan aset rilis GitHub (API), atau pencatat pada pengalihan unduhan | Tidak melacak orang |
| Instalasi aktif | Ping dari aplikasi | **Opt-in** (PRD SET-5), dengan pratinjau data yang dikirim |

Aturan ping: hanya ID acak (bukan ID perangkat), versi, OS dan arsitektur, serta bahasa. Tidak pernah isi proyek, path, nama
berkas, atau teks. Endpoint bisa diganti atau dimatikan (PRD SET-5). Penyimpanan: Cloudflare Worker dan D1, dengan dashboard sederhana.

Konsekuensi yang diterima: angka opt-in lebih rendah dari kenyataan, jadi dibaca sebagai **batas bawah**, bukan jumlah instalasi.
Unduhan bukan instalasi. Jangan mempublikasikan angka ini sebagai jumlah pengguna.

## 5. Pengembangan produk

Dari backlog `08_MIGRASI_ELECTRON.md` (tidak dikerjakan): segmentasi dan aligner lokal, batch CSV, audio hafalan, unggah ke
YouTube, IndoPak, riwayat non-Hafs, Windows dan Linux, pembaruan otomatis, analitik. Pexels dan Pixabay yang tertulis di sana
sudah dikerjakan di 0.5.0.

Usulan, dengan alasan:

- **Aligner yang tidak bergantung pada satu layanan.** Sinkron AI memanggil Space publik Hugging Face secara anonim: gratis, tanpa
  jaminan, tanpa kuota tertulis, dan audio dikirim ke pihak ketiga. Pilihan: alamat Space bisa diganti di Pengaturan, atau aligner
  lokal (butuh model dan Python di komputer pengguna). Ini risiko terbesar karena fitur inti bergantung padanya.
- **Brand kit per channel**: logo, warna, qari bawaan, dan ajakan yang tersimpan dan dipakai proyek baru.
- **Antrean ekspor batch.**
- Basmalah yang terlalu panjang belum bisa dibelah (batas yang diketahui).
- **Terjemahan kedua di video** sengaja tidak dibuat: hanya terjemahan paling atas yang tampil (keputusan pemilik produk).

### 5.1 Sudah dikerjakan di 0.9.0
Render per potongan yang bisa dilanjutkan, pilihan fps, perkiraan waktu, tahan tidur, aksi setelah selesai, dan bagian Penyimpanan (lihat
`CHANGELOG.md`). Belum diukur: render nyata pada rekaman 118 menit, jadi perkiraan untuk video sangat panjang masih ekstrapolasi dari klip 40 detik.

## 6. Yang belum pernah diuji

- Foto dan video stok dengan kunci nyata (Pexels, Unsplash, Pixabay).
- AI CLI Claude Code dan OpenCode (belum pernah membalas); Codex diuji.
- DMG hasil build belum pernah dibuka.
- Gaya Gelombang pada visualizer; tombol donasi; ekspor dalam mode English; tata letak daftar proyek di jendela sempit; pesan
  galat dari proses utama dalam English.
- Uji otomatis hanya mencakup `src/shared`; tidak ada uji ujung ke ujung. Belum terbukti bahwa CI hijau di GitHub.

## 7. Utang dokumentasi

- `01_TECHNICAL_HANDOFF.md` belum memuat i18n, visualizer (tabel spektrum), overlay Subscribe/Follow, pengaturan bahasa, dan Dukungan.
  Petanya baru ada di `AGENTS.md`.
- Belum ada ADR untuk (a) i18n dengan kunci berupa teks Indonesia dan jatuh ke Indonesia bila entri Inggris tak ada, (b) visualizer
  yang menghitung spektrum di proses utama alih-alih memakai `useAudioData`.
- Backlog di `08_MIGRASI_ELECTRON.md` usang (Pexels/Pixabay dan drag overlay sudah dikerjakan).
- PRD belum mencatat fitur sejak 0.5.0 sebagai Change Request.
