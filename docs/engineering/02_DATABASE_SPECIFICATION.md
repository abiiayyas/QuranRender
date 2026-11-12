# 02 — Spesifikasi Database & Penyimpanan

| Item | Nilai |
|---|---|
| Status | v0.2.0 (Electron) |
| Cakupan | Semua data persisten Quran Render: dataset bawaan, database pengguna, berkas proyek, cache, rahasia |
| Terkait | [`01_TECHNICAL_HANDOFF.md`](01_TECHNICAL_HANDOFF.md), [`03_DATASET_PIPELINE.md`](03_DATASET_PIPELINE.md) |

---

## 1. Peta penyimpanan

| Penyimpanan | Format | Mode | Pemilik | Isi |
|---|---|---|---|---|
| `quran.db` | SQLite | **Read-only**, dibundel | `src/main/quran.ts`, `src/main/text.ts` | Teks Arab Kemenag, kata, metadata surah/juz, terjemahan Kemenag |
| `studio.db` | SQLite (WAL) | Read-write, folder data pengguna | `src/main/db.ts` | Proyek (JSON), aset, job, pengaturan, kunci AI terenkripsi, cache API, edisi terjemahan terpasang |
| `projects/<id>/` | Berkas | Read-write | `src/main/sources/` | Audio sumber, hasil potong, latar, overlay |
| `cache/qpc/` | Berkas font | Bisa dihapus kapan saja | `src/main/quran.ts` | Font QPC per halaman dan font Uthmani, diunduh saat dipakai |
| `tools/` | Biner | Bisa dihapus kapan saja | `src/main/sources/` | yt-dlp |

Data Al-Qur'an tidak disimpan di proyek. Proyek hanya menyimpan nomor surah, ayat, dan kata kanonis.

---

## 2. Lokasi file

Data pengguna ada di `app.getPath('userData')`: `~/Library/Application Support/Quran Render/` di macOS. Saat
pengembangan, `QR_USER_DATA=<folder>` memakai folder lain.

---

## 3. `quran.db` (dataset, read-only)

### 3.1 Konfigurasi koneksi

- Dibuka read-only oleh better-sqlite3 (`readonly: true`) dari `resources/quran.db` (dev) atau
  `Contents/Resources/quran.db` (aplikasi terpasang).
- Berkas di-commit apa adanya; verifikasi tanda tangan minisign dihapus bersama builder Rust di 0.2.0.
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

Skema berikut untuk edisi terbundel di `quran.db` (satu versi per edisi). Edisi yang dipasang pengguna disimpan di
`studio.db` (§4).

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
- Edisi lain (termasuk Saheeh International) hanya dipasang oleh pengguna dari Quran.com dan disimpan di `studio.db`.
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

---

## 4. `studio.db` (data pengguna)

Migrasi ada di array `MIGRATIONS` (`src/main/db.ts`), dicatat lewat `PRAGMA user_version`, dan hanya boleh ditambah di akhir.

| Tabel | Isi |
|---|---|
| `projects(id, data_json, updated_at)` | Satu baris per proyek; `data_json` = `Project` (`src/shared/types.ts`) |
| `assets(id, project_id, kind, path, name, duration_ms, width, height, source, meta_json, created_at)` | Berkas proyek, path relatif ke `projects/<id>/`. Baris tidak dihapus selama proyeknya ada, supaya riwayat undo tetap valid |
| `jobs(id, project_id, kind, status, progress, message, error, created_at, updated_at)` | Riwayat job; yang `queued`/`running` saat aplikasi dibuka ditandai gagal |
| `settings(key, value)` | `Settings` sebagai JSON per kunci |
| `secrets(name, value)` | Kunci AI, dienkripsi `safeStorage` (Keychain) |
| `cache(key, value, updated_at)` | Respons API: teks Uthmani/QPC per surah (tanpa kedaluwarsa), daftar qari dan katalog terjemahan (sehari) |
| `editions(id, language, name, author)`, `edition_text(edition, surah, ayah, text)` | Terjemahan yang dipasang dari Quran.com, teks sudah dibersihkan dari catatan kaki |

Menghapus proyek menghapus barisnya (aset dan job ikut lewat `ON DELETE CASCADE`) dan foldernya. Menduplikasi proyek
menyalin folder dan baris aset dengan id baru.

## 5. Model proyek

`Project`, `Segment`, `Asset`, dan tipe lain didefinisikan di `src/shared/types.ts`; itulah skema `data_json`. Ringkasnya:

- Waktu dalam milidetik pada audio sumber (`sourceAssetId`), yang juga waktu video.
- `Segment`: jenis (`ayah`, `basmalah`, `istiadzah`), surah dan ayat, rentang kata kanonis inklusif, waktu awal/akhir,
  keyakinan, sumber (aligner, QDC, MP3Quran, manual), waktu per kata, dan terjemahan per edisi beserta statusnya
  (`full`, `auto`, `ai`, `manual`, `review`).
- `style` (`src/shared/style.ts`), `background`, dan `overlays` menentukan tampilan video.
