# AGENTS.md

Quran Render: aplikasi Electron untuk membuat video tilawah berteks. Baca [README.md](README.md) dan
[docs/engineering/01_TECHNICAL_HANDOFF.md](docs/engineering/01_TECHNICAL_HANDOFF.md) dulu.

## Perintah

```bash
npm run dev          # aplikasi dengan hot reload
npm run typecheck    # wajib bersih
npm test             # Vitest, hanya src/shared/*.test.ts
npm run build
npm run lint:design  # kelas qr-* dan token CSS harus terdefinisi
npm run lint:a11y    # nama aksesibel, label, kontras token
npm run dist:mac     # DMG
```

Data uji terpisah dari data asli: `QR_USER_DATA=/tmp/qr-dev npm run dev`.

## Peta kode

| Tempat | Isi |
|---|---|
| `src/shared/types.ts` | Model: Project, Segment, Verse, Asset, Job |
| `src/shared/api.ts` | Kontrak `window.api`; tiap metode = kanal IPC `group:method`, daftar di `CHANNELS` |
| `src/shared/video.ts` | `VideoProps`, props komposisi Remotion untuk pratinjau dan ekspor |
| `src/shared/*.ts` | Aturan murni yang dipakai dua sisi: segmen, terjemahan, subtitle, kebijakan ekspor, preset, peta kata |
| `src/main/ipc.ts` | `handle(group, method, fn)` bertipe; tiap modul mendaftar handler-nya sendiri |
| `src/main/repo.ts` | Proyek (JSON di tabel `projects`), aset, job; `patchProject` menulis lalu mengirim `event:project` |
| `src/main/jobs.ts` | Antrean `net` (3), `cpu` (1), `align` (1); `startJob` |
| `src/main/quran.ts` | `quran.db` bawaan, teks Uthmani/QPC dari Quran.com, font QPC |
| `src/main/sources/` | Impor, MP3Quran, QDC, yt-dlp, potong, waveform |
| `src/main/sync.ts` | Aligner AI cloud |
| `src/main/text.ts` | Edisi terjemahan dan AI trim |
| `src/main/exporter.ts` | Render Remotion + subtitle |
| `src/main/cli.ts`, `ai.ts` | AI CLI dan `chat()` (API atau CLI), satu pintu untuk AI trim dan Publikasi |
| `src/main/imagegen.ts`, `stock.ts` | Gambar latar dari AI dan dari Pexels/Unsplash/Pixabay |
| `src/shared/spectrum.ts`, `src/main/spectrum.ts`, `src/remotion/Visualizer.tsx` | Overlay gelombang suara: tabel level 32 pita per 1/30 dtk dihitung sekali dari audio sumber (cache `cache/spectrum-*.bin`), digambar murni terhadap waktu |
| `src/main/publish.ts` | Thumbnail (JPG dari komposisi `quran-thumbnail`), bingkai video, teks publikasi per platform |
| `src/renderer/src/store/project.ts` | State proyek, autosave 1,2 dtk, undo/redo |
| `src/renderer/src/pages/project/` | Stepper dan keempat langkah, dialog ekspor |
| `src/remotion/` | Komposisi `quran-video` dan `quran-thumbnail`; `fit.ts` menghitung tata letak teks (dipakai komposisi dan peringatan editor), `motion/` latar gerak |

## Aturan yang tidak boleh dilanggar

1. **Clean-room.** Jangan membuka atau menyalin kode, aset, string UI, atau desain Quran Caption (CC BY-NC 4.0).
2. **Teks Al-Qur'an tidak pernah diubah.** AI hanya menentukan *waktu* dan potongan *terjemahan*, tidak pernah teks Arab.
3. **Nomor kata kanonis:** posisi kata Quran.com (1-based, tanpa penanda akhir ayat). `Verse.words` setiap jenis teks
   punya jumlah entri yang sama; string kosong berarti kata itu menyatu dengan kata sebelumnya di teks tersebut.
4. **Yang terlihat adalah yang diekspor.** Pratinjau dan ekspor memakai komposisi Remotion yang sama dengan props yang
   sama; yang berbeda hanya `baseUrl`. Komposisi harus murni terhadap nomor frame.
5. **Renderer tanpa akses Node** (`sandbox`, `contextIsolation`). Semua disk, jaringan, dan FFmpeg lewat `window.api`.
   Path dari renderer diperiksa ulang di main.
6. **Kolom milik main** (`sourceAssetId`, `segments` hasil job) diubah lewat `patchProject`; renderer menggabungkannya
   dengan `applyPatch`. Panggil `flush()` sebelum IPC yang membaca proyek dari database.
7. **Migrasi database hanya ditambah** di akhir `MIGRATIONS` (`src/main/db.ts`).
8. **UI berbahasa Indonesia**, hangat dan sopan. Kode dan komentar berbahasa Inggris; komentar menjelaskan *alasan*.
9. **Desain:** hanya kelas dan token dari `design/system/` serta `styles.css`. Tanpa gambar makhluk bernyawa, tanpa ikon
   musik, teks Arab tidak pernah dipakai sebagai hiasan.
10. Setiap perubahan dicatat di [CHANGELOG.md](CHANGELOG.md).
11. **Setiap perubahan selesai: commit, push ke `origin/main`, naikkan versi (`package.json`, `package-lock.json`, `CHANGELOG.md`; patch
    untuk perbaikan, minor untuk fitur), lalu bangun ulang DMG dengan `npm run dist:mac`.**
