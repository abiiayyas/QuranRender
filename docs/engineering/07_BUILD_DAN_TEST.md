# 07 — Build dan Test (lokal)

Panduan membangun dan menguji Quran Render di macOS. Windows dan Linux belum didukung.

## 1. Prasyarat

| Kebutuhan | Catatan |
|---|---|
| macOS | Build menghasilkan DMG untuk arsitektur mesin build (ffmpeg-static dan compositor Remotion mengunduh biner arsitektur itu) |
| Node.js | 22 atau lebih baru, dengan npm |

FFmpeg, ffprobe, dan Chrome Headless Shell (untuk Remotion) ikut terpasang lewat npm atau `npm run prepare:remotion`.
yt-dlp diunduh aplikasi saat fitur YouTube pertama dipakai.

## 2. Menyiapkan repositori

```bash
npm install          # juga membangun ulang better-sqlite3 untuk Electron (postinstall)
```

Kalau Electron belum terunduh (`Electron failed to install correctly`), jalankan `node node_modules/electron/install.js`.

## 3. Menjalankan

```bash
npm run dev
QR_USER_DATA=/tmp/qr-dev npm run dev   # data terpisah: database, proyek, cache
```

Data pengguna: `~/Library/Application Support/Quran Render/`:

```
studio.db                 SQLite: proyek (JSON), aset, job, pengaturan, kunci AI terenkripsi, cache, edisi terjemahan
projects/<id>/            audio/, media/ — berkas proyek; path di database relatif ke folder ini
cache/qpc/                font QPC per halaman dan font Uthmani (diunduh saat dipakai)
tools/yt-dlp              diunduh saat fitur YouTube pertama dipakai
tmp/                      berkas sementara
```

## 4. Pemeriksaan

| Perintah | Isi |
|---|---|
| `npm run typecheck` | TypeScript strict untuk main/preload/shared dan renderer/remotion |
| `npm test` | Vitest untuk `src/shared/*.test.ts` (aturan murni: segmen, peta kata, terjemahan, subtitle, kebijakan ekspor, preset) |
| `npm run lint:design` | Kelas `qr-*` dan `var(--token)` di renderer harus terdefinisi |
| `npm run lint:a11y` | Nama aksesibel, label, dan kontras token terang/gelap |
| `npm run build` | Build electron-vite ke `out/` |

Tampilan, unduhan, sinkron AI, dan ekspor diuji di aplikasi yang berjalan (`npm run dev`).

## 5. Bundel Remotion

Ekspor merender komposisi `src/remotion` lewat Chrome Headless Shell. Saat pengembangan, main process membangun ulang
bundel di `resources-gen/remotion-bundle` bila `src/remotion` atau `src/shared` lebih baru. Untuk membangunnya manual:

```bash
npm run prepare:remotion            # bundel + unduh Chrome Headless Shell
node scripts/prepare-remotion.mjs --bundle   # bundel saja
```

## 6. Membuat DMG

```bash
npm run dist:mac
```

Hasilnya `dist/QuranRender-<versi>-mac-<arch>.dmg`, tanpa tanda tangan (`identity: null`). Saat pertama dibuka, macOS
meminta izin lewat klik kanan › Open.

## 7. Dataset Al-Qur'an

`resources/quran.db` adalah hasil build dataset terakhir (Kemenag: 114 surah, 6.236 ayat, terjemahan `id.kemenag`) dan
di-commit apa adanya. Builder Rust `qr-dataset` dihapus pada versi 0.2.0; skema dan aturannya tetap terdokumentasi di
[02_DATABASE_SPECIFICATION.md](02_DATABASE_SPECIFICATION.md) §3 dan [03_DATASET_PIPELINE.md](03_DATASET_PIPELINE.md).
Untuk membangun ulang, pakai builder dari riwayat git (commit `c541f04`).
