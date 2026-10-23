# 02 — Spesifikasi Database & Penyimpanan

| Item | Nilai |
|---|---|
| Status | v1.0, mengacu ke PRD baseline v1.0 |
| Cakupan | Semua data persisten QuranRender: database SQLite, paket proyek, template, cache, rahasia |
| Terkait | [`01_TECHNICAL_HANDOFF.md`](01_TECHNICAL_HANDOFF.md), [`03_DATASET_PIPELINE.md`](03_DATASET_PIPELINE.md) |

---

## 1. Peta penyimpanan

| Penyimpanan | Format | Mode | Pemilik crate | Isi |
|---|---|---|---|---|
| `quran.db` | SQLite | **Read-only**, dibundel di aplikasi, ditandatangani | `qr-quran` | Teks Arab, kata, metadata surah/juz, terjemahan terbundel (Kemenag), font & cakupan glyph, indeks pencarian |
| `content.db` | SQLite | Read-write, folder data pengguna | `qr-quran` | Edisi terjemahan yang diunduh pengguna (Saheeh via Quran.com) |
| `app.db` | SQLite | Read-write, folder data pengguna | `qr-store`, `qr-jobs` | Indeks proyek, antrean job, unduhan, model pack, font & template impor, pengaturan non-rahasia |
| Paket proyek `.qrproj` | Direktori: JSON + snapshot zstd | Read-write, lokasi pilihan pengguna | `qr-core` | Satu proyek (sumber kebenaran isi proyek) |
| Arsip proyek `.qrpack` | ZIP | Ekspor/impor | `qr-core` | Proyek + media + font, untuk pindah mesin (PRJ-5) |
| Template `.qrtemplate` | ZIP | Ekspor/impor | `qr-core` | Gaya per rasio + aset + manifest lisensi (STY-6) |
| Cache | File biner | Bisa dihapus kapan saja | `qr-media`, `qr-render` | Waveform, thumbnail, proxy video, cache layout |
| Rahasia | Keychain OS | — | `qr-store` | API key dan token (SET-2) |

**Prinsip pembagian:**

- Isi proyek **tidak** disimpan di SQLite. Proyek harus portabel, bisa disalin, di-backup, dan dibuka
  di mesin lain hanya dengan foldernya. `app.db` hanya menyimpan indeks proyek yang bisa dibangun ulang
  dengan memindai folder.
- Data Al-Qur'an **tidak** disimpan di proyek. Proyek hanya mereferensikan `ayah_id` dan indeks kata,
  ditambah versi dataset dan hash edisi terjemahan untuk penguncian (QRN-14).

---

## 2. Lokasi file

Identifier aplikasi: `app.quranrender.desktop`.

| OS | Data aplikasi (`app.db`, `content.db`, model, template, font impor) | Cache | Log |
|---|---|---|---|
| macOS | `~/Library/Application Support/app.quranrender.desktop/` | `~/Library/Caches/app.quranrender.desktop/` | `~/Library/Logs/app.quranrender.desktop/` |
| Windows | `%APPDATA%\app.quranrender.desktop\` | `%LOCALAPPDATA%\app.quranrender.desktop\cache\` | `%LOCALAPPDATA%\app.quranrender.desktop\logs\` |
| Linux | `$XDG_DATA_HOME/app.quranrender.desktop/` | `$XDG_CACHE_HOME/app.quranrender.desktop/` | `$XDG_STATE_HOME/app.quranrender.desktop/logs/` |

`quran.db` berada di resource bundle aplikasi (`Contents/Resources/` di macOS, folder instalasi di
Windows/Linux) dan dibuka langsung dari sana.

Folder proyek default adalah `~/QuranRender/Projects/`. Pengguna bisa mengubahnya di pengaturan.

---

## 3. `quran.db` (dataset, read-only)

### 3.1 Konfigurasi koneksi

- Dibuka dengan URI `file:<path>?mode=ro&immutable=1`.
- `PRAGMA query_only = ON`.
- Sebelum dibuka, hash SHA-256 file diverifikasi terhadap `dataset-manifest.json` yang ditandatangani
  (03 §8). Gagal verifikasi berarti aplikasi menolak menampilkan teks (QRN-1, CNT-2).
- `PRAGMA user_version` = versi skema dataset (mulai `1`).

### 3.2 Tabel `dataset_info`

```sql
CREATE TABLE dataset_info (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
) STRICT;
```

| key | Contoh nilai | Keterangan |
|---|---|---|
| `dataset_id` | `kemenag-msi-hafs` | Identitas dataset (Mushaf Standar Indonesia, Hafs) |
| `dataset_version` | `1.0.0` | SemVer. Mayor naik bila indeks kata berubah (03 §9). |
| `content_sha256` | hex | Hash kanonik isi (03 §7.3) |
| `tokenizer_version` | `1` | Versi aturan tokenisasi (03 §6) |
| `source_manifest_sha256` | hex | Hash `content-manifest.json` saat build |
| `schema_version` | `1` | Sama dengan `user_version` |

### 3.3 Surah, juz, ayat

```sql
CREATE TABLE surah (
  id             INTEGER PRIMARY KEY CHECK (id BETWEEN 1 AND 114),
  name_ar        TEXT    NOT NULL,           -- dari `nama`; dirender dengan Amiri (STY-3)
  name_latin     TEXT    NOT NULL,           -- `nama_latin`
  name_en        TEXT    NOT NULL,           -- `english_name`
  meaning_id     TEXT    NOT NULL,           -- `arti`
  meaning_en     TEXT    NOT NULL,           -- `english_meaning`
  revelation     TEXT    NOT NULL CHECK (revelation IN ('makkiyah','madaniyah')),
  ayah_count     INTEGER NOT NULL CHECK (ayah_count > 0),
  first_ayah_id  INTEGER NOT NULL,
  description_html TEXT  NOT NULL            -- disanitasi: hanya <i>, <br> (QRN-9)
) STRICT;

CREATE TABLE juz (
  id             INTEGER PRIMARY KEY CHECK (id BETWEEN 1 AND 30),
  label          TEXT    NOT NULL,           -- `nama_latin`, mis. "Juz 1"
  first_ayah_id  INTEGER NOT NULL,
  last_ayah_id   INTEGER NOT NULL,
  CHECK (first_ayah_id <= last_ayah_id)
) STRICT;

CREATE TABLE ayah (
  id           INTEGER PRIMARY KEY CHECK (id BETWEEN 1 AND 6236),  -- = aya_id sumber
  surah_id     INTEGER NOT NULL REFERENCES surah(id),
  number       INTEGER NOT NULL CHECK (number >= 1),
  juz_id       INTEGER NOT NULL REFERENCES juz(id),
  page         INTEGER NOT NULL CHECK (page BETWEEN 1 AND 604),
  text         TEXT    NOT NULL,             -- verbatim, hanya dipangkas spasi tepi (QRN-1)
  text_sha256  BLOB    NOT NULL CHECK (length(text_sha256) = 32),
  word_count   INTEGER NOT NULL CHECK (word_count >= 1),
  flags        INTEGER NOT NULL DEFAULT 0,
  UNIQUE (surah_id, number)
) STRICT;
```

Bit `ayah.flags`:

| Bit | Nama | Arti |
|---|---|---|
| 0 | `HAS_SAJDAH` | Memuat ۩ |
| 1 | `STARTS_RUB_EL_HIZB` | Diawali ۞ |
| 2 | `HAS_JUZ_END_MARK` | Memuat ۔ di akhir (penanda akhir juz) |
| 3 | `NEEDS_REVIEW` | Ada anomali berstatus `needs_review` (lihat `anomaly`) |

### 3.4 Kata

```sql
CREATE TABLE word (
  ayah_id      INTEGER NOT NULL REFERENCES ayah(id),
  idx          INTEGER NOT NULL CHECK (idx >= 0),   -- 0-based dalam ayat
  text         TEXT    NOT NULL,     -- tampilan kata termasuk tanda yang menempel (03 §6)
  span_start   INTEGER NOT NULL,     -- offset byte UTF-8 awal rentang kata di ayah.text
  span_end     INTEGER NOT NULL,     -- offset byte UTF-8 akhir (eksklusif)
  core_start   INTEGER NOT NULL,     -- offset byte token yang mengandung huruf
  core_end     INTEGER NOT NULL,
  search_form  TEXT    NOT NULL,     -- bentuk ternormalisasi, HANYA untuk pencarian/alignment
  flags        INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (ayah_id, idx),
  CHECK (span_start <= core_start AND core_start < core_end AND core_end <= span_end)
) STRICT, WITHOUT ROWID;
```

Bit `word.flags`:

| Bit | Nama | Arti |
|---|---|---|
| 0 | `HAS_WAQF` | Membawa tanda waqaf yang menempel |
| 1 | `HAS_SAJDAH` | Membawa ۩ |
| 2 | `HAS_RUB_EL_HIZB_PREFIX` | Diawali ۞ |
| 3 | `HAS_ANOMALY` | Rentangnya memuat codepoint anomali |

**Invarian (diuji saat build):**

- `text` sama dengan `substr(ayah.text, span_start, span_end)` setelah spasi tepi dipangkas.
- Urutan `idx` sama dengan urutan offset.
- Jumlah baris per ayat sama dengan `ayah.word_count`.
- Total jumlah kata sama dengan angka di `dataset_info` (77.511 pada dataset saat ini, 03 §6.3).

### 3.5 Anomali

```sql
CREATE TABLE anomaly (
  id          INTEGER PRIMARY KEY,
  ayah_id     INTEGER NOT NULL REFERENCES ayah(id),
  byte_offset INTEGER NOT NULL,
  codepoint   INTEGER NOT NULL,
  code        TEXT    NOT NULL CHECK (code IN ('unexpected_codepoint','word_joiner_suspect','trailing_symbol')),
  status      TEXT    NOT NULL CHECK (status IN ('needs_review','confirmed_intentional','corrected')),
  note        TEXT    NOT NULL
) STRICT;
```

Isinya berasal dari `data-anomalies.toml` (03 §5.3). Contoh saat ini (PRD Q5):

- 18:74: U+0608, `word_joiner_suspect`;
- 17:86: U+0609 ×2, `trailing_symbol`.

### 3.6 Terjemahan & catatan kaki

Skema berikut untuk edisi terbundel di `quran.db` (satu versi per edisi). `content.db` memakai kolom
yang sama ditambah `content_sha256` di primary key untuk menyimpan beberapa versi (§4).

```sql
CREATE TABLE translation_edition (
  key             TEXT PRIMARY KEY,          -- 'id.kemenag', 'en.saheeh.qdc20'
  language        TEXT NOT NULL,             -- BCP 47: 'id', 'en'
  direction       TEXT NOT NULL CHECK (direction IN ('ltr','rtl')),
  name            TEXT NOT NULL,             -- 'Terjemahan Kemenag RI'
  translator      TEXT NOT NULL,
  publisher       TEXT,
  source          TEXT NOT NULL,             -- 'data/ (Kemenag)', 'quran.com resource 20'
  source_url      TEXT,
  license         TEXT NOT NULL,
  permission      TEXT NOT NULL CHECK (permission IN ('granted','pending','user_download_only')),
  version         TEXT NOT NULL,             -- versi sumber atau tanggal unduh
  content_sha256  BLOB NOT NULL CHECK (length(content_sha256) = 32),
  attribution     TEXT NOT NULL CHECK (length(attribution) > 0)  -- dipakai CNT-3
) STRICT;

CREATE TABLE translation_text (
  edition_key  TEXT    NOT NULL REFERENCES translation_edition(key),
  ayah_id      INTEGER NOT NULL CHECK (ayah_id BETWEEN 1 AND 6236),
  text         TEXT    NOT NULL,             -- teks bersih: tanpa HTML, tanpa penanda catatan kaki
  PRIMARY KEY (edition_key, ayah_id)
) STRICT, WITHOUT ROWID;

CREATE TABLE footnote (
  edition_key  TEXT    NOT NULL REFERENCES translation_edition(key),
  ayah_id      INTEGER NOT NULL,
  ordinal      INTEGER NOT NULL,             -- urutan dalam ayat, mulai 1
  source_ref   TEXT    NOT NULL,             -- id catatan di sumber, mis. '195932'
  anchor       INTEGER NOT NULL,             -- offset byte di translation_text.text tempat penanda dibuang
  text         TEXT    NOT NULL,
  PRIMARY KEY (edition_key, ayah_id, ordinal)
) STRICT, WITHOUT ROWID;
```

- Isi `quran.db`: satu edisi `id.kemenag` dengan `permission = 'granted'` (PRD D1/D13), tanpa catatan
  kaki.
- Edisi `en.saheeh.qdc20` di `content.db` berstatus `user_download_only` sampai izin disetujui (Q9).
  Setelah izin ada, edisi ini dipindah ke `quran.db` dengan status `granted`.
- Pipeline build menolak edisi `pending` atau `user_download_only` di `quran.db` (03 §5.5).

### 3.7 Font & cakupan glyph

```sql
CREATE TABLE font (
  key           TEXT PRIMARY KEY,            -- 'lpmq', 'amiri-regular', 'amiri-bold', 'me-quran', 'indopak'
  file          TEXT NOT NULL,               -- path relatif di resource bundle
  family        TEXT NOT NULL,
  style         TEXT NOT NULL,
  sha256        BLOB NOT NULL CHECK (length(sha256) = 32),
  license       TEXT NOT NULL,
  source_url    TEXT NOT NULL,
  roles         TEXT NOT NULL                -- JSON array: ["ayah"], ["surah_name","ui_arabic"], ...
) STRICT;

CREATE TABLE font_coverage (
  font_key            TEXT NOT NULL REFERENCES font(key),
  dataset_id          TEXT NOT NULL,
  missing_codepoints  TEXT NOT NULL,         -- JSON array of integers
  passes_ayah         INTEGER NOT NULL CHECK (passes_ayah IN (0,1)),
  PRIMARY KEY (font_key, dataset_id)
) STRICT;
```

`font_coverage` dipakai CNT-5 untuk pengecekan cepat di tingkat dataset. Pemeriksaan per segmen saat
export tetap dijalankan, karena font pengguna dan override per klip bisa berbeda.

### 3.8 Pencarian

```sql
CREATE VIRTUAL TABLE ayah_search USING fts5(
  ar,            -- gabungan word.search_form
  id_text,       -- terjemahan Kemenag
  surah_name,    -- nama latin + arti
  content='',
  tokenize = 'unicode61 remove_diacritics 2'
);
-- rowid = ayah.id
```

Dipakai untuk "pilih ayat lewat pencarian" (SYN-6) dan pencarian proyek. `search_form` hanya untuk
pencarian dan tidak pernah ditampilkan.

---

## 4. `content.db` (edisi unduhan)

`content.db` menyimpan edisi yang diunduh pengguna. Setiap unduhan ulang bisa menghasilkan isi yang
berbeda. Karena proyek mengunci hash isi (QRN-14), **semua versi yang masih direferensikan proyek
disimpan**, sehingga primary key-nya menyertakan `content_sha256`.

Konfigurasi: WAL, `foreign_keys = ON`, `user_version` untuk migrasi.

```sql
CREATE TABLE translation_edition (
  key             TEXT NOT NULL,             -- 'en.saheeh.qdc20'
  content_sha256  BLOB NOT NULL CHECK (length(content_sha256) = 32),
  language        TEXT NOT NULL,
  direction       TEXT NOT NULL CHECK (direction IN ('ltr','rtl')),
  name            TEXT NOT NULL,
  translator      TEXT NOT NULL,
  publisher       TEXT,
  source          TEXT NOT NULL,
  source_url      TEXT,
  license         TEXT NOT NULL,
  permission      TEXT NOT NULL CHECK (permission IN ('granted','pending','user_download_only')),
  version         TEXT NOT NULL,             -- tanggal unduh ISO 8601
  attribution     TEXT NOT NULL CHECK (length(attribution) > 0),
  is_latest       INTEGER NOT NULL CHECK (is_latest IN (0,1)),
  PRIMARY KEY (key, content_sha256)
) STRICT;
CREATE UNIQUE INDEX edition_latest ON translation_edition(key) WHERE is_latest = 1;

CREATE TABLE translation_text (
  edition_key     TEXT    NOT NULL,
  content_sha256  BLOB    NOT NULL,
  ayah_id         INTEGER NOT NULL CHECK (ayah_id BETWEEN 1 AND 6236),
  text            TEXT    NOT NULL,
  PRIMARY KEY (edition_key, content_sha256, ayah_id),
  FOREIGN KEY (edition_key, content_sha256) REFERENCES translation_edition(key, content_sha256) ON DELETE CASCADE
) STRICT, WITHOUT ROWID;

CREATE TABLE footnote (
  edition_key     TEXT    NOT NULL,
  content_sha256  BLOB    NOT NULL,
  ayah_id         INTEGER NOT NULL,
  ordinal         INTEGER NOT NULL,
  source_ref      TEXT    NOT NULL,
  anchor          INTEGER NOT NULL,
  text            TEXT    NOT NULL,
  PRIMARY KEY (edition_key, content_sha256, ayah_id, ordinal),
  FOREIGN KEY (edition_key, content_sha256) REFERENCES translation_edition(key, content_sha256) ON DELETE CASCADE
) STRICT, WITHOUT ROWID;

CREATE TABLE download_record (
  edition_key     TEXT NOT NULL,
  content_sha256  BLOB NOT NULL,
  url             TEXT NOT NULL,     -- https://api.quran.com/api/v4/quran/translations/20?foot_notes=true&fields=verse_key
  fetched_at      INTEGER NOT NULL,  -- unix ms UTC
  http_status     INTEGER NOT NULL,
  raw_sha256      BLOB NOT NULL,     -- hash respons mentah
  adapter         TEXT NOT NULL,     -- 'qdc-legacy-v4'
  PRIMARY KEY (edition_key, content_sha256, fetched_at),
  FOREIGN KEY (edition_key, content_sha256) REFERENCES translation_edition(key, content_sha256) ON DELETE CASCADE
) STRICT;
```

**Aturan:**

- **Akses gabungan:** koneksi runtime melakukan `ATTACH 'content.db' AS user`. Lapisan `qr-quran`
  menyajikan satu API edisi yang menggabungkan `main` (quran.db, satu versi per edisi) dan `user`.
  Kunci edisi unik lintas keduanya; edisi unduhan memakai sufiks sumber (`.qdc20`).
- **Unduhan ulang:** bila hash isinya sama dengan versi yang ada, cukup tambahkan `download_record`.
  Bila berbeda, sisipkan versi baru dengan `is_latest = 1`, dan versi lama menjadi `is_latest = 0`.
- **Pembersihan:** "Bersihkan data" di pengaturan menghapus versi dengan `is_latest = 0` yang tidak
  direferensikan proyek mana pun. Referensi dibaca dari `translations[]` di setiap `project.json` yang
  terdaftar di `project_index`.

---

## 5. `app.db` (state aplikasi)

Konfigurasi: WAL, `foreign_keys = ON`, `busy_timeout = 5000`. Migrasi berurutan memakai
`PRAGMA user_version` dengan file SQL di `crates/qr-store/migrations/NNNN_nama.sql`, dijalankan di
dalam transaksi. Waktu disimpan sebagai unix ms UTC (`INTEGER`).

```sql
CREATE TABLE project_index (
  id               TEXT PRIMARY KEY,            -- ULID dari project.json
  path             TEXT NOT NULL UNIQUE,        -- path absolut folder .qrproj
  name             TEXT NOT NULL,
  reciter          TEXT,
  category         TEXT,
  status           TEXT NOT NULL CHECK (status IN ('draft','ready','published')),
  aspect           TEXT NOT NULL,               -- '16:9', '9:16', '1:1', '4:5'
  duration_ticks   INTEGER NOT NULL DEFAULT 0,
  dataset_version  TEXT NOT NULL,
  thumbnail_path   TEXT,
  missing          INTEGER NOT NULL DEFAULT 0 CHECK (missing IN (0,1)),
  created_at       INTEGER NOT NULL,
  updated_at       INTEGER NOT NULL,
  opened_at        INTEGER
) STRICT;
CREATE INDEX project_index_updated ON project_index(updated_at DESC);

CREATE TABLE job (
  id               TEXT PRIMARY KEY,            -- ULID
  kind             TEXT NOT NULL CHECK (kind IN ('render','align','batch_split','download_edition','download_model')),
  project_id       TEXT REFERENCES project_index(id) ON DELETE SET NULL,
  batch_id         TEXT,                        -- job turunan batch berbagi batch_id
  payload          TEXT NOT NULL,               -- JSON spesifikasi job (qr-jobs::protocol, berversi)
  state            TEXT NOT NULL CHECK (state IN ('queued','running','paused','succeeded','failed','canceled')),
  priority         INTEGER NOT NULL DEFAULT 0,
  position         INTEGER NOT NULL,            -- urutan dalam antrean (BAT-2)
  attempts         INTEGER NOT NULL DEFAULT 0,
  progress         REAL    NOT NULL DEFAULT 0 CHECK (progress BETWEEN 0 AND 1),
  progress_label   TEXT,
  resume_token     TEXT,                        -- JSON titik lanjut (mis. frame terakhir yang ter-flush)
  output_path      TEXT,
  error_code       TEXT,
  error_detail     TEXT,
  worker_pid       INTEGER,
  created_at       INTEGER NOT NULL,
  started_at       INTEGER,
  finished_at      INTEGER
) STRICT;
CREATE INDEX job_queue ON job(state, priority DESC, position);

CREATE TABLE job_event (
  id        INTEGER PRIMARY KEY,
  job_id    TEXT NOT NULL REFERENCES job(id) ON DELETE CASCADE,
  at        INTEGER NOT NULL,
  level     TEXT NOT NULL CHECK (level IN ('debug','info','warn','error')),
  code      TEXT,
  message   TEXT NOT NULL
) STRICT;

CREATE TABLE download (
  id               TEXT PRIMARY KEY,
  url              TEXT NOT NULL,
  dest_path        TEXT NOT NULL,
  expected_sha256  BLOB,
  bytes_total      INTEGER,
  bytes_done       INTEGER NOT NULL DEFAULT 0,
  state            TEXT NOT NULL CHECK (state IN ('queued','running','paused','verifying','done','failed')),
  signature_ok     INTEGER CHECK (signature_ok IN (0,1)),
  updated_at       INTEGER NOT NULL
) STRICT;

CREATE TABLE model_pack (
  key          TEXT NOT NULL,
  tier         TEXT NOT NULL CHECK (tier IN ('small','standard','accurate')),
  version      TEXT NOT NULL,
  path         TEXT NOT NULL,
  sha256       BLOB NOT NULL,
  bundled      INTEGER NOT NULL CHECK (bundled IN (0,1)),
  active       INTEGER NOT NULL DEFAULT 0 CHECK (active IN (0,1)),
  installed_at INTEGER NOT NULL,
  PRIMARY KEY (key, version)
) STRICT;

CREATE TABLE user_font (
  id           TEXT PRIMARY KEY,
  path         TEXT NOT NULL,                  -- salinan di folder data aplikasi
  family       TEXT NOT NULL,
  style        TEXT NOT NULL,
  sha256       BLOB NOT NULL UNIQUE,
  imported_at  INTEGER NOT NULL
) STRICT;

CREATE TABLE template_index (
  id           TEXT PRIMARY KEY,               -- dari template.json
  path         TEXT NOT NULL,
  name         TEXT NOT NULL,
  aspects      TEXT NOT NULL,                  -- JSON array
  builtin      INTEGER NOT NULL CHECK (builtin IN (0,1)),
  sha256       BLOB NOT NULL,
  updated_at   INTEGER NOT NULL
) STRICT;

CREATE TABLE encoder_probe (
  encoder        TEXT NOT NULL,                -- 'h264_videotoolbox', 'h264_nvenc', ...
  driver_sig     TEXT NOT NULL,                -- versi OS/driver/GPU
  ok             INTEGER NOT NULL CHECK (ok IN (0,1)),
  detail         TEXT,
  probed_at      INTEGER NOT NULL,
  PRIMARY KEY (encoder, driver_sig)
) STRICT;

CREATE TABLE setting (
  key    TEXT PRIMARY KEY,                     -- 'ui.language', 'export.default_folder', ...
  value  TEXT NOT NULL                         -- JSON
) STRICT;
```

**Aturan:**

- `setting` **tidak boleh** berisi rahasia. Uji unit memastikan kunci yang cocok dengan
  `/(key|token|secret|password)/i` ditolak di layer `qr-store`.
- **Saat aplikasi start:** job berstatus `running` tanpa proses hidup diubah ke `queued` dengan
  `resume_token` terakhir (BAT-2: antrean lanjut setelah aplikasi ditutup).
- **Retensi:** `job_event` untuk job selesai dipangkas setelah 30 hari. Job `succeeded` disembunyikan
  dari UI setelah 7 hari, tetapi tetap tersimpan.
- `project_index` bisa dibangun ulang penuh dengan memindai folder proyek (`missing = 1` bila
  foldernya hilang).

---

## 6. Paket proyek `.qrproj`

### 6.1 Struktur

```text
Nama Proyek.qrproj/
├─ project.json            dokumen proyek (normatif, §6.3)
├─ project.lock            kunci editor aktif: {"pid", "host", "app_version", "since"}
├─ snapshots/
│  ├─ 0000000042.json.zst  snapshot per revisi (maks. 20 terbaru + 1 per hari selama 7 hari)
│  └─ pre-migrate-v1.json.zst
├─ media/                  opsional: media yang disalin ke proyek ("simpan media di proyek")
└─ cache/                  boleh dihapus: waveform, thumbnail, proxy
```

- Di macOS, `.qrproj` didaftarkan sebagai *document package* (UTType conform ke
  `com.apple.package`), sehingga tampil sebagai satu berkas di Finder. Di Windows/Linux tampil
  sebagai folder.
- `project.lock` mencegah dua instance mengedit proyek yang sama. Lock yang basi (PID mati di host
  yang sama) diambil alih otomatis. Lock dari host lain memunculkan peringatan dan pilihan buka
  read-only.

### 6.2 Protokol tulis atomik (PRJ-3)

1. Serialisasi ke `project.json.tmp` di folder yang sama.
2. `fsync(file)`.
3. `rename(project.json.tmp → project.json)`. Atomik di filesystem yang sama.
4. `fsync(direktori)`.
5. Tulis snapshot `snapshots/<revisi>.json.zst` secara asinkron, lalu rotasi.

**Saat membuka proyek:**

- Bila `project.json` tidak valid (parse atau skema gagal), tampilkan pemulihan dari snapshot valid
  terbaru.
- Bila ada `project.json.tmp` sisa, abaikan dan hapus, karena rename belum terjadi berarti versi lama
  masih utuh.

Autosave: debounce 2 detik setelah perubahan terakhir dan paling lama setiap 30 detik saat ada
perubahan.

### 6.3 Skema `project.json` v1

Bentuk normatif ditulis sebagai tipe TypeScript. JSON Schema digenerate dari tipe Rust (`schemars`)
ke `crates/qr-core/schema/project.v1.json` dan dipublikasikan (PRJ-2).

```ts
type Tick = number;            // integer, sampel @48 kHz (§01-6), aman < 2^53
type Ulid = string;

interface ProjectV1 {
  schemaVersion: 1;
  id: Ulid;
  meta: {
    name: string;
    reciter?: string;
    category?: string;
    status: "draft" | "ready" | "published";
    createdAt: string;         // ISO 8601 UTC
    updatedAt: string;
    revision: number;          // naik setiap commit transaksi
  };
  dataset: {
    id: "kemenag-msi-hafs";
    version: string;           // SemVer dataset saat proyek dibuat/diperbarui
    contentSha256: string;     // dataset_info.content_sha256
  };
  output: {
    aspect: "16:9" | "9:16" | "1:1" | "4:5";
    width: number; height: number;
    fps: { num: number; den: number };
  };
  assets: Asset[];
  timeline: Timeline;
  translations: TranslationPin[];
  style: StyleStack;
  exportPresets: ExportPreset[];
}

interface Asset {
  id: Ulid;
  kind: "audio" | "video" | "image";
  path: string;                // relatif terhadap folder .qrproj bila di media/, selain itu absolut
  sha256: string;              // hash berkas, untuk relink (PRJ-5)
  durationTicks?: Tick;
  sampleRate?: number;
  loudnessLufs?: number;
}

interface Timeline {
  audio: AudioClip[];
  background: BackgroundClip[];
  verses: VerseSegment[];      // track ayat (urut berdasarkan start)
  overlays: OverlayClip[];
  markers: Marker[];
}

interface AudioClip {
  id: Ulid; assetId: Ulid;
  start: Tick;                 // posisi di timeline
  sourceIn: Tick; sourceOut: Tick;
  gainDb: number;              // -60..+12 (SRC-2)
  fadeIn: Tick; fadeOut: Tick;
}

interface BackgroundClip {
  id: Ulid;
  source: { assetId: Ulid } | { color: string } | { gradient: GradientSpec };
  start: Tick; end: Tick;
  sourceIn?: Tick;
  loop: boolean; reverse: boolean; speed: number;   // SRC-5
  fit: "contain" | "cover"; blurPx: number;
}

interface VerseSegment {
  id: Ulid;
  kind: "ayah" | "basmalah" | "istiadhah" | "takbir" | "sadaqallah" | "silence";
  ayahId?: number;             // 1..6236, wajib untuk kind "ayah"/"basmalah"
  wordFrom?: number;           // indeks kata inklusif (word.idx)
  wordTo?: number;             // indeks kata inklusif; CNT-1: wordFrom <= wordTo < word_count
  start: Tick; end: Tick;
  words?: { idx: number; start: Tick; end: Tick }[];  // timing WBW (SYN-4)
  confidence?: number;         // 0..1 (SYN-5)
  reviewed: boolean;
  mergeGroup?: Ulid;           // visual merge (TML-4)
  stackSlot?: number;          // subtitle bertumpuk (TML-5, P1)
  translationOverrides?: Record<string, { text: string; by: "user" | "ai" }>;  // per edition key (QRN-8, CNT-4)
}

interface TranslationPin {
  editionKey: string;          // 'id.kemenag', 'en.saheeh.qdc20'
  contentSha256: string;       // QRN-14
  visible: boolean;
}

interface StyleStack {
  templateRef?: { id: string; sha256: string };
  project: StyleProps;                         // override tingkat proyek
  clips: Record<Ulid, StyleProps>;             // override per klip/segmen
  keyframes: Record<Ulid, Keyframe[]>;         // TML-6 (P1)
}
```

`StyleProps`, `OverlayClip`, `Marker`, `ExportPreset`, `GradientSpec`, dan `Keyframe` didefinisikan di
`crates/qr-core/src/model/` dan masuk ke JSON Schema. Dokumen ini hanya mengikat aturan berikut:

- **Gaya:** semua properti gaya opsional di setiap lapisan. Nilai efektif adalah lapisan terdalam
  yang terdefinisi (klip > proyek > template > default sistem).
- **Teks Arab tidak pernah disimpan di proyek.** Segmen hanya berisi `ayahId` dan `wordFrom..wordTo`.
- **Terjemahan:** teks hanya disimpan sebagai override yang diubah pengguna atau AI.

### 6.4 Migrasi skema

- **Fungsi migrasi:** `qr-core::migrate::vN_to_vN1(serde_json::Value) -> Result<Value>` berupa rantai
  murni yang diuji dengan fixture setiap versi.
- **Sebelum migrasi:** salinan asli disimpan ke `snapshots/pre-migrate-vN.json.zst`.
- **Versi lebih baru:** aplikasi menolak membuka proyek dengan `schemaVersion` lebih tinggi dari yang
  dikenal dan meminta pengguna memperbarui aplikasi.
- **Migrasi dataset:** bila `dataset.version` mayor berbeda (indeks kata berubah, 03 §9), aplikasi
  menerapkan *word-index remap* dari `dataset-migrations/<from>-<to>.json`. Segmen yang tidak bisa
  dipetakan ditandai `reviewed = false`.

---

## 7. Rahasia (keychain)

Service: `app.quranrender.desktop`.

| Account | Isi | Requirement |
|---|---|---|
| `llm:<provider>` | API key LLM (OpenAI-compatible) | AIT-1 (P1) |
| `llm-endpoint:<id>` | Token untuk endpoint LLM kustom | AIT-1 |
| `stock:pexels`, `stock:pixabay` | API key stok media | SRC-5 |
| `hf:token` | Token Hugging Face (unduh model privat bila ada) | SYN-8 |
| `aligner:<id>` | Kredensial endpoint cloud aligner | SYN-7 (P1) |

Nilai rahasia tidak pernah dikirim ke webview. UI hanya menerima status ada/tidak ada.

---

## 8. Arsip `.qrpack` & template `.qrtemplate`

### 8.1 `.qrpack` (PRJ-5)

```text
proyek.qrpack (ZIP, deflate)
├─ manifest.json        {format: "qrpack", version: 1, app_version, dataset {id, version, contentSha256},
│                        files: [{path, sha256, role}]}
├─ project.json
├─ media/…              aset yang dipilih untuk dibawa
├─ fonts/…              font pengguna yang dipakai (hanya bila lisensinya mengizinkan; selain itu dicatat sebagai "hilang")
└─ translations/…       edisi unduhan yang dipin (JSONL), bila izinnya mengizinkan redistribusi
```

**Saat impor:**

- Hash setiap berkas diverifikasi.
- Path aset ditulis ulang ke folder proyek baru.
- Aset yang hilang ditampilkan dengan opsi relink berdasarkan SHA-256.

### 8.2 `.qrtemplate` (STY-6)

```text
nama.qrtemplate (ZIP)
├─ template.json        {id, name, version, aspects: {"9:16": StyleProps, ...}, animations, requiredFonts: [{family, sha256?}]}
├─ assets/…             gambar/ornamen
└─ LICENSES.json        lisensi per aset
```

Template tidak boleh membawa teks Qur'an atau terjemahan. Validator impor menolak template yang
memuat string Arab di luar properti gaya yang diizinkan.

---

## 9. Volume data & performa

| Data | Ukuran |
|---|---|
| Ayat | 6.236 baris |
| Kata | 77.511 baris (tokenizer v1) |
| Terjemahan Kemenag | 6.236 baris |
| Saheeh (unduhan) | 6.236 baris + 1.903 catatan kaki, respons mentah ±1,5 MB |
| Perkiraan `quran.db` | Puluhan MB termasuk FTS. Angka pasti dicatat di laporan build 03 §8. |

**Pola query panas:**

- *Kata dalam rentang ayat:* primary key `(ayah_id, idx)`, scan rentang.
- *Terjemahan untuk segmen:* primary key `(edition_key, ayah_id)`.
- *Antrean job:* indeks `job_queue`.

Preview tidak boleh melakukan query SQLite per frame. Scene builder memuat teks dan kata yang
dibutuhkan proyek ke memori saat proyek dibuka, lalu memperbaruinya saat segmen berubah.
