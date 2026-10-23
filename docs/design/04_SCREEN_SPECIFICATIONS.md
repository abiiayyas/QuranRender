# 04 — Spesifikasi Layar dan Prototipe

> **Status:** tahap 4, menunggu persetujuan pemilik. Dasar: [01 Identitas](01_BRAND_IDENTITY.md), [02 Sistem desain](02_DESIGN_SYSTEM.md), [03 Arsitektur informasi](03_INFORMATION_ARCHITECTURE.md), PRD v1.0.
> **Prototipe:** `design/prototype/index.html` (klik-tembus, data contoh, tanpa jaringan). Dokumen ini adalah kontrak untuk implementasi React/Tauri; prototipe adalah acuan visual dan perilakunya.

## 1. Cara memakai prototipe

```sh
cd design/tools && npm i && npm run prototype   # menyusun prototype/index.html
python3 -m http.server 8731 --bind 127.0.0.1    # dari akar repo
# buka http://127.0.0.1:8731/design/prototype/index.html#studio-review
```

- Bilah hitam di atas adalah **alat prototipe**, bukan bagian aplikasi: pemilih skenario, tema (Sistem/Terang/Gelap).
- Skenario bisa dibuka langsung lewat hash URL (`#export-blocked`). Semua teks ayat dan terjemahan diambil dari dataset Kemenag secara verbatim (`design/prototype/data.js`). Nama qari, durasi, ukuran berkas, dan ukuran unduhan adalah **contoh** dan tidak boleh disalin sebagai fakta produk.
- Sumber: `index.src.html` (kerangka), `app.js` (keadaan dan render, tanpa framework), `prototype.css` (tata letak aplikasi), `design/system/{tokens,components}.css` (sistem desain). `build-prototype.mjs` menyuntikkan sprite ikon Lucide dan menolak build bila ada nama ikon yang tidak ada.
- Tidak ada warna, radius, bayangan, atau durasi di luar token. Hanya satu aksen (nila).

### 1.1 Skenario

| Hash | Layar | Yang diperagakan |
|---|---|---|
| `home` | S1 Beranda (kisi) | 7 proyek, filter status dan kategori, menu kartu, kartu folder hilang |
| `home-empty` | S1 keadaan kosong | Zona seret dan satu aksi utama |
| `home-list` | S1 daftar | Tampilan baris |
| `first-run` | S0 | Dua langkah di atas Beranda kosong; tawaran Saheeh dengan sumber dan atribusi |
| `new` | S2 Proyek baru | Satu lembar, semua isian punya default |
| `studio-source` | S3 langkah Sumber | Belum sinkron: panduan bergelembung, tombol Sinkronkan |
| `studio-missing` | S3 + S12 awal | Aset hilang: peringatan, Sinkronkan nonaktif dengan alasan |
| `relink` | S12 | Cocokkan lewat hash; hasil "Cocok" dan "Isi berbeda" |
| `studio-syncing` | S3 langkah Sinkron, berjalan | Bilah sinkron nonblokir, trek Ayat berstatus "Mengenali ayat…" |
| `studio-review` | S3/S4 | Daftar segmen, 3 dari 7 perlu ditinjau, N dan Enter |
| `studio-style` | S3 langkah Tampilan | Templat, lapisan, inspector gaya, asal gaya, keyframe |
| `studio-export` | S3 langkah Ekspor | Preset dan ringkasan keluaran |
| `export-pass` | S5 lolos | Semua pemeriksaan hijau |
| `export-blocked` | S5 ditolak | CNT-1 menghalangi; **Perbaiki masalah** melompat ke segmen |
| `upload` | S6 Siap unggah | Judul, deskripsi, tagar, bab, tombol Salin |
| `batch` | S7 Pecah menjadi klip | Empat langkah; 5 metode; pratinjau pembagian |
| `queue` | S8 Antrean | Panel geser, 6 keadaan job |
| `templates` | S9 Galeri | Kartu templat, lencana "Font hilang" |
| `settings-data` | S10/S11 | Edisi terjemahan, unduh Saheeh, penyimpanan |
| `settings-fonts` | S10 Font | Cakupan glyph nyata per font |
| `history` | S13 | Snapshot dan Pulihkan |
| `diagnostics` | S15 | Kode galat, langkah, diagnostik yang aman dibagikan |
| `cmdk` | S14 | Pencarian perintah, langkah, ayat (`1:3`) |

Interaksi yang bisa dicoba selain skenario: sinkron simulasi (8 dtk) dari **Buat dan sinkronkan**, ekspor simulasi yang masuk antrean dan memunculkan toast selesai, putar dengan sorotan kata, perbaikan pelanggaran CNT-1, unduh Saheeh simulasi, pemecahan klip dengan satu klip yang dilewati.

## 2. Pola lintas layar

| # | Pola | Aturan |
|---|---|---|
| P1 | **Satu aksi primer per layar** | Studio: **Ekspor** (header). Beranda: **Buat proyek**. Lembar: satu tombol primer di kanan footer, selalu tombol yang akan dipicu **Enter**. Lembar yang hanya memberi informasi (Siap unggah, Pengaturan) menutup dengan **Selesai** sebagai primer. Langkah alur (Sinkronkan, Terima, Berikutnya) memakai tombol sekunder, supaya satu layar tidak punya dua tombol penuh. **Ekspor** di header Studio tampil nonaktif (dengan alasan di tooltip dan toast saat ditekan) selama ayat belum tersinkron atau ada aset hilang. Ini perluasan dari 02 §1 dan tercatat di DESIGN.md. |
| P2 | **Lembar vs panel geser** | Keputusan yang menahan alur (proyek baru, ekspor, pecah klip, pengaturan, templat) = lembar modal dengan scrim. Memantau atau melihat (antrean, riwayat) = panel geser tanpa scrim penghalang interaksi di Studio. |
| P3 | **Pekerjaan lama tidak memblokir** | Sinkron dan ekspor berjalan di latar. Bilah sinkron memberi progres dan "Anda tetap bisa bekerja." Selesai/gagal dilaporkan lewat toast, tidak lewat dialog. |
| P4 | **Galat bernada tenang** | Masalah + jalan keluar, tanpa seru dan tanpa kata "gagal total". Pelanggaran kebijakan teks memakai ikon dan kata, bukan warna saja. |
| P5 | **Teks Arab tidak bisa diketik** | Teks ayat selalu tampil read-only dengan catatan kunci. Pengguna mengganti ayat lewat pemilih, bukan mengetik. (QRN-8) |
| P6 | **Konten hidup berpindah, kerangka tetap** | Header, kanvas, dan timeline tetap di tempat saat berganti langkah. Hanya panel kiri, inspector, dan fokus timeline yang berubah. Tidak ada tab editor terpisah (A2). |
| P7 | **Lembar tidak memutar ulang animasi** | Perubahan di dalam lembar (ganti langkah, tab, centang) tidak memutar animasi masuk lagi. |
| P8 | **Panduan bergelembung** | Muncul sekali per konteks, dengan "Matikan panduan". Tidak menutupi aksi yang dijelaskan. Ditampilkan untuk 3 proyek pertama (T2). |
| P9 | **Lencana pratinjau** | "Preview ½" hanya muncul saat kualitas turun otomatis (T3). Ditentukan, belum diperagakan di prototipe karena tidak ada mesin render. |

## 3. Spesifikasi per layar

Notasi: ukuran dalam piksel CSS pada jendela 1440 × 900 kecuali disebut lain. Komponen mengacu ke [02 §4](02_DESIGN_SYSTEM.md#4-spesifikasi-komponen) dan tambahan di §4 dokumen ini.

### S0 — Pertama kali jalan
- Lembar 520, **maksimal dua langkah**, keduanya bisa dilewati. Tidak ada akun.
- Langkah 1: bahasa (otomatis dari sistem), dua pemberitahuan sukses (model Standar terbundel; data Kemenag terverifikasi). Langkah 2: tawaran Saheeh dengan sumber (Quran.com) dan atribusi **sebelum** tombol Unduh.
- Unduh berjalan di latar dan dilaporkan lewat toast. Offline: langkah 2 tidak ditampilkan dan tidak ada pesan galat.
- Footer: "Langkah n dari 2" (catatan), **Lewati**, primer (Lanjut / Unduh).

### S1 — Beranda
- Header 48: lockup logo, pencarian (⌘F), spacer, **Antrean** (lencana jumlah job berjalan/antre), Pengaturan.
- Badan: rel 220 (Semua proyek, Draf, Siap, Terbit; Kategori; Templat) + area utama.
- Bilah aksi: judul bagian, **Buat proyek** (primer), **Buka…**, urutan, kisi/daftar (`qr-seg`).
- Kisi: `repeat(auto-fill, minmax(236px, 1fr))`, jarak 16. Kartu: thumbnail 9:16 dipangkas, durasi, nama, qari · rentang, lencana status + tanggal, tombol menu (⋯) muncul di sudut.
- Kartu **folder hilang** menonjolkan masalah, bukan menyembunyikan: ikon peringatan, "Temukan…", "Hapus dari daftar".
- Kosong: satu zona seret dan satu tombol primer. Hasil cari kosong: pesan dengan saran.
- Menu kartu: Buka, Duplikat, Ganti nama, Pindahkan ke kategori, Tampilkan di Finder, pemisah, **Hapus** (bahaya, di bawah pemisah, dengan konfirmasi saat diimplementasikan).

### S2 — Proyek baru
- Lembar 560. Isian berurutan: berkas (chip dengan info terdeteksi), Nama, Qari (untuk atribusi), Rentang ayat (Deteksi otomatis / Kunci rentang), Rasio, Templat, Terjemahan (Kemenag tercentang; Saheeh nonaktif bila belum terpasang dengan keterangan), Folder.
- Footer: **Batal**, **Buat tanpa sinkron**, **Buat dan sinkronkan** (primer, fokus awal).
- "Buat dan sinkronkan" membuka Studio langsung di langkah Sinkron dengan bilah sinkron berjalan.

### S3 — Studio (kerangka)

```text
┌ Header 48: [‹ Beranda] Nama·qari ✓Tersimpan │ ①Sumber ›②Sinkron ›③Tampilan ›④Ekspor │ [Antrean][Riwayat][⌕][Ekspor] ┐
├ Bilah sinkron 32 (hanya saat berjalan)                                                                         ┤
├ Panel kiri 232 │ Viewer (kanvas 9:16 pas layar, area aman, transport)            │ Inspector 272                ┤
├ Timeline: alat · zoom · penggaris · Latar · Audio · Ayat · Terjemahan · (Overlay di Tampilan) · playhead        ┘
```

- Alur 4 langkah memakai `qr-flow` dengan `aria-current="step"`. Langkah selesai berikon centang, langkah dengan masalah (Ekspor saat CNT-1) berlabel "!".
- Tinggi timeline **tetap** di semua langkah (lima trek: Latar, Audio, Ayat, Terjemahan, Overlay) supaya kanvas dan transport tidak melompat saat pindah langkah. Trek Latar menampilkan filmstrip, trek Ayat pada segmen terpilih menampilkan pembagi kata. Aset hilang tampil sebagai klip putus-putus berikon peringatan, dan kanvas kehilangan latarnya.
- Kanvas menampilkan segmen **di posisi playhead**, bukan segmen terpilih. Sorotan kata mengikuti waktu kata (tokenizer v1, waktu kata dibagi rata di prototipe; di produk dari model).
- Memilih segmen memindahkan playhead ke awalnya. Menyeret playhead di penggaris memilih segmen di bawahnya.
- Klip segmen: `is-review` (titik amber + persen keyakinan) bila < 80% dan belum diterima; `is-danger` bila melanggar CNT-1; `is-locked` saat sinkron berjalan.
- Spasi memutar/menjeda dari mana pun selain saat fokus pada tombol.

| Langkah | Panel kiri | Inspector | Fokus timeline |
|---|---|---|---|
| ① Sumber | Daftar aset, zona seret, footer **Sinkronkan / Sinkronkan ulang…** (nonaktif + alasan bila aset hilang) | Potong (masuk/keluar), Suara (penguatan dengan titik override, normalisasi, target LUFS, fade) | Latar, Audio |
| ② Sinkron | "n dari N perlu ditinjau" + progres, daftar segmen, Pengaturan deteksi; footer **Terima ↵** dan **Berikutnya N** | Waktu, Ayat (surah, kata, jenis segmen, kotak ayat read-only, Ganti ayat…, Belah S); peringatan CNT-1 bila ada | Ayat, Terjemahan |
| ③ Tampilan | Templat (mini grid), Lihat semua…, Lapisan (ayat, terjemahan, nama surah, nama qari) dengan mata, **Terapkan ke semua klip** | Gaya segmen: font, ukuran (override + keyframe), sorotan kata, animasi, area aman, peredup, **Asal gaya** (Templat › Proyek › Klip) | Ayat, Terjemahan, Overlay |
| ④ Ekspor | Preset platform, paket unggah | Ringkasan keluaran, atribusi otomatis, **Buka lembar ekspor** | semua |

- Keadaan belum sinkron: trek Ayat menampilkan petunjuk "Belum disinkron. Tekan Sinkronkan di langkah Sumber."; kanvas menampilkan "Ayat tampil setelah sinkron".
- Keadaan sinkron berjalan: bilah 32 dengan spinner, tahap (Mengubah audio / Mengenali ayat / Menyelaraskan kata), persen, **Batal**. Selesai: toast "Ayat sudah tersinkron. Silakan periksa n bagian yang ditandai." dengan aksi **Tinjau**.
- Peninjauan: **N** lompat ke segmen perlu tinjau berikutnya (berputar), **Enter** menerima dan lanjut. Selesai semua: pemberitahuan sukses, tombol dinonaktifkan.
- Lebar < 1100: panel kiri menyempit ke 184 dan inspector ke 232 (tetap terlihat, karena panel kiri memuat aksi tinjau); chip pintasan di tombol Terima/Berikutnya disembunyikan; gelembung panduan menjadi satu baris judul di dalam footer panel (isi lengkap tampil di lebar ≥ 1100) supaya tidak menutupi daftar segmen; label langkah hanya untuk langkah aktif. Lebar < 960 tidak didukung.
- Teks kanvas selalu berada di dalam kotak **area aman** (inset 10% kiri-kanan, 8% atas, 14% bawah); lapisan nama qari memakai pil gelap agar terbaca di atas latar apa pun.

### S5 — Validasi dan ekspor
- Lembar **600** (03 menyebut 560; dinaikkan karena baris pemeriksaan dan dua kolom preset muat tanpa gulir berlebih).
- Bagian: **Pemeriksaan** (`qr-check-row`: ok / peringatan / gagal; kode kebijakan hanya di tooltip, tidak ditampilkan sebagai teks), **Keluaran** (preset sebagai pilihan tunggal, resolusi, fps, encoder otomatis dengan cadangan, nama berkas, folder, SRT/VTT/latar transparan), **Ringkasan**.
- Pelanggaran memblokir: baris gagal dengan tombol **Tampilkan segmen**, footer mengganti **Ekspor** dengan **Perbaiki masalah** yang menutup lembar, ke langkah Sinkron, memilih segmen pelanggar. Peringatan (segmen belum ditinjau) tidak memblokir.
- Teks catatan footer menjelaskan kenapa tombol berubah. Atribusi tidak bisa dimatikan.
- Ekspor: lembar tertutup, job masuk antrean, toast "Ekspor ditambahkan ke antrean" dengan **Lihat antrean**.

### S6 — Siap unggah
- Lembar 620. Chip berkas (nama, durasi, ukuran, **Buka folder**, **Putar**), pemberitahuan sukses bila durasi sesuai batas preset (atau peringatan bila melewati), empat kotak salin (Judul, Deskripsi dengan atribusi, Tagar, Bab YouTube) masing-masing dengan **Salin** yang berubah jadi "Tersalin" 1,5 dtk. Tidak ada tombol unggah: aplikasi tidak terhubung ke platform mana pun (keputusan PRD: tanpa integrasi publikasi).

### S7 — Pecah menjadi klip
- Lembar 640 dengan stepper 4 langkah: **Cara memecah** (per jumlah ayat, per durasi maksimum, per penanda, pilih manual) dengan pratinjau pembagian; **Daftar klip** (pola judul dengan variabel + tabel nomor/judul/rentang/durasi/lencana); **Keluaran**; **Mulai** (ringkasan dan jumlah klip).
- Klip yang melanggar CNT-1 dilewati dan diberi tahu; **tidak membatalkan klip lain**.

### S8 — Antrean
- Panel geser kanan 400, mulai di bawah header. Grup: Berjalan, Menunggu, Selesai, Gagal dan dibatalkan. `qr-job` dengan lencana, progres, aksi ikon per keadaan (Batalkan, Jeda, Lanjutkan, Siap unggah, Buka folder, Coba lagi, Jalankan ulang).
- Footer: "Antrean tetap tersimpan bila aplikasi ditutup." + **Hapus yang selesai**. Studio tetap bisa dipakai saat panel terbuka.

### S9 — Galeri templat
- Lembar 880 dengan rel kiri (rasio, Milik saya) dan kartu 9:16 berisi Al-Fatihah 1:5. Templat aktif `aria-pressed`. Templat dengan font hilang diberi lencana peringatan dan tidak bisa diterapkan.
- Footer: catatan, **Duplikat**, **Ekspor…**, **Terapkan** (primer). Kartu putus-putus **Impor .qrtemplate**.

### S10/S11 — Pengaturan
- Lembar 820, tinggi isi tetap 460, rel 9 bagian: Umum, Pintasan, Sinkron, Ekspor, **Data dan model**, **Font**, Kunci dan layanan, Privasi, Tentang.
- Data dan model: data Qur'an (versi, jumlah, checksum), edisi terjemahan (Kemenag terbundel + izin; Saheeh: Unduh → progres → "6.236 ayat · 1.903 catatan kaki" + Hapus), penyimpanan.
- Font: cakupan nyata terhadap 74 karakter dataset: LPMQ lulus (satu-satunya yang boleh untuk ayat), Amiri 1 hilang (U+08D6), me_quran 5 hilang, IndoPak 3 hilang. Peran tiap font disebut.
- Kunci disimpan di keychain sistem dan tidak pernah ditampilkan. Privasi: semua mati secara default; telemetri jarak jauh nonaktif "belum tersedia".

### S12 — Hubungkan ulang aset
- Lembar 600. Tabel aset (nama, hash pendek, lokasi terakhir, hasil). **Cari di folder…** mencocokkan lewat hash; hasil Cocok (sukses) atau Isi berbeda (peringatan: waktu sinkron mungkin tidak berlaku). **Terapkan** menutup dan melaporkan lewat toast.

### S13 — Riwayat versi
- Panel geser 360. Baris snapshot (waktu, ringkasan), versi sekarang diberi lencana. **Pulihkan** membuat snapshot baru dulu; ada catatan ini di footer.

### S14 — Palet perintah
- `qr-cmdk` berjangkar 14vh dari atas. Grup: Alur, Perintah, Ayat. Mencocokkan potongan teks dengan sorotan; `n:m` menghasilkan "Lompat ke ayat n:m". ↑↓ pilih, ↵ jalankan, Esc tutup. Kosong: "Tidak ada hasil untuk “…”."

### S15 — Diagnostik
- Lembar 560. Pemberitahuan bahaya dengan kode (`E-ENC-104`) dan jaminan proyek aman, daftar langkah, kotak diagnostik yang **tidak berisi teks ayat maupun rahasia**, **Buka halaman isu**, **Salin diagnostik** (primer).

## 4. Komponen layar yang ditambahkan ke sistem desain

Semua di `design/system/components.css` (bagian "Tingkat layar") dan hanya memakai token yang sudah ada.

| Komponen | Kelas | Dipakai di |
|---|---|---|
| Scrim tetap | `.qr-scrim-fixed` | semua lembar |
| Lembar | `.qr-sheet`, `__head/__title/__body/__foot/__note` | S0, S2, S5–S7, S9, S10, S12, S15 |
| Bagian lembar | `.qr-section`, `__title` | lembar |
| Pembagi rel + isi | `.qr-split` | S9, S10 |
| Panel geser | `.qr-drawer`, `__head/__title/__body/__foot` | S8, S13 |
| Label grup | `.qr-group-label` | S8 |
| Rel navigasi | `.qr-rail`, `__item/__label/__sep` | S1, S9, S10 |
| Kartu proyek | `.qr-card`, `__thumb/__dur/__body/__title/__meta/__foot`, `.is-missing` | S1 |
| Gelembung panduan | `.qr-guide`, `__title/__actions` | Studio |
| Baris pemeriksaan | `.qr-check-row`, `.is-ok/.is-warn/.is-fail` | S5 |
| Pilihan berbingkai | `.qr-opt` | S5, S7, S10 |
| Kotak salin | `.qr-copy`, `__box/__text` | S6, S15 |
| Tabel | `.qr-tbl` | S7, S10, S12 |
| Kartu templat | `.qr-tpl`, `__name/__meta` | S9, Studio ③ |
| Klip berbahaya | `.qr-clip.is-danger`, `button.qr-clip` | timeline |

Khusus prototipe (tidak masuk sistem desain, akan jadi komponen aplikasi): kanvas templat `.cv.tpl-subuh/hening/terang/besar` dan `.cv-in`. Ukuran teks kanvas memakai `cqw` agar identik di semua ukuran viewer. **Catatan penting:** `padding` berunit `cqw` pada kontainer yang sama dihitung dari viewport, jadi padding harus pada elemen anak (`.cv-in`). Renderer wgpu memakai skala yang sama (lebar bingkai = 100 satuan).

## 5. Papan ketik dan aksesibilitas

- Lembar: `role="dialog"`, `aria-modal`, `aria-labelledby`; fokus awal ke aksi utama; Tab terkurung; Esc menutup; klik scrim menutup. Panel geser tidak mengurung fokus.
- Pintasan yang dijalankan prototipe: Spasi, N, Enter (langkah Sinkron), ⌘/Ctrl+1–4, ⌘/Ctrl+K, ⌘/Ctrl+, , ⇧⌘/Ctrl+E, Esc. Selebihnya mengikuti 03 §5.2.
- Setiap tombol ikon punya `aria-label`. Status tidak hanya warna: keyakinan rendah = titik + persen, pelanggaran = ikon + kata + kode.
- Kontras diperiksa di dua tema lewat token semantik; tema gelap mengikuti `prefers-color-scheme` atau pilihan manual.
- `prefers-reduced-motion` mematikan animasi lembar, panel, dan toast.

## 6. Temuan selama membangun (sudah dibereskan)

| Temuan | Dampak | Perbaikan |
|---|---|---|
| `padding: 8cqw` pada kontainer kanvas | Teks kanvas 58% terlalu kecil | Padding dipindah ke `.cv-in` |
| Kelas `is-focus` dipakai juga untuk "trek aktif" | Cincin fokus palsu di timeline | Trek aktif memakai `is-hot` |
| Lembar memutar animasi tiap isi diganti | Berkedip di S0, S7, S10 | Kelas `no-anim` pada render ulang di tempat |
| Preset 4 baris vertikal di S5 | Ringkasan terdorong keluar layar, dan dua kelompok radio untuk satu pengaturan | Pilihan tunggal di lembar |
| Pembulatan 47,5 dtk jadi 00:48 | Berbeda dari kartu proyek (00:47) | Durasi dipotong, bukan dibulatkan |
| Glow hover pada thumb slider | Melanggar kebijakan tanpa glow | Dihapus dari `components.css` |
| Teks kanvas menyentuh tepi area aman | Pratinjau tidak sama dengan ekspor | Padding kanvas mengikuti kotak area aman |
| Skenario tidak konsisten (aset hilang tapi timeline normal, Ekspor aktif tanpa sinkron, Beranda penuh di balik S0) | Prototipe berbohong tentang keadaan | Keadaan diturunkan dari satu sumber; Ekspor dinonaktifkan dengan alasan |
| Tinggi timeline berubah antar langkah (+33 px) | Kanvas melompat | Lima trek tetap |
| Kode CNT-n tampil sebagai teks, kata "pelanggaran", "Lulus", "terbundel" | Istilah internal dan dingin | Teks diganti ("masalah", "Lengkap", "bawaan"), kode tinggal di tooltip |
| Panel kiri Tampilan terpotong di 900 px | Lapisan keempat tak terjangkau | Templat mini satu baris |

**Catatan komponen:** "Asal gaya" memakai `qr-ply` (02 §4.13) yang menandai lapisan teratas dengan aksen. Itu penanda sumber nilai, bukan kontrol pilihan, jadi tidak melanggar aturan "segmen terpilih tetap netral".

## 7. Keputusan terbuka dan batas prototipe

| ID | Isi | Default yang dipakai |
|---|---|---|
| T1 | Beranda kisi atau daftar | Kisi; daftar tersedia lewat toggle |
| T2 | Panduan bergelembung | Dipertahankan, 3 proyek pertama |
| T3 | Lencana "Preview ½" | Hanya saat penurunan otomatis |
| Q5, Q8, Q9 | Karakter janggal, lisensi font, izin Saheeh | Ditunda pemilik; gerbang build tetap menolak entri `PERLU DIISI` |

Batas: tidak ada render video nyata (kanvas adalah CSS), sinkron dan ekspor adalah simulasi waktu, tombol yang belum dirancang menampilkan toast "Belum dibuat di prototipe ini", tidak ada drag-and-drop dan penyuntingan batas segmen dengan mouse. Hal-hal itu dispesifikasikan di 03 dan akan diuji di build nyata.

## 8. Tahap berikutnya

Tahap 5 selesai di [`05_VIDEO_TEMPLATES.md`](05_VIDEO_TEMPLATES.md). Spesifikasi format paket `.qrtemplate`, sistem koordinat kanvas bernormalisasi, batas area aman lintas platform, algoritma auto-fit, dan katalog lengkap 12 templat video bawaan telah dikunci sebagai kontrak untuk renderer Rust di Fase 1 (tugas A1-06 dan A1-15).
