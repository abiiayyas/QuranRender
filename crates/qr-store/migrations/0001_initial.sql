-- 0001_initial.sql — Migrasi awal app.db (state aplikasi)
-- Mengacu ke docs/engineering/02_DATABASE_SPECIFICATION.md §5

CREATE TABLE project_index (
  id               TEXT PRIMARY KEY,
  path             TEXT NOT NULL UNIQUE,
  name             TEXT NOT NULL,
  reciter          TEXT,
  category         TEXT,
  status           TEXT NOT NULL CHECK (status IN ('draft','ready','published')),
  aspect           TEXT NOT NULL,
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
  id               TEXT PRIMARY KEY,
  kind             TEXT NOT NULL CHECK (kind IN ('render','align','batch_split','download_edition','download_model')),
  project_id       TEXT REFERENCES project_index(id) ON DELETE SET NULL,
  batch_id         TEXT,
  payload          TEXT NOT NULL,
  state            TEXT NOT NULL CHECK (state IN ('queued','running','paused','succeeded','failed','canceled')),
  priority         INTEGER NOT NULL DEFAULT 0,
  position         INTEGER NOT NULL,
  attempts         INTEGER NOT NULL DEFAULT 0,
  progress         REAL    NOT NULL DEFAULT 0 CHECK (progress BETWEEN 0 AND 1),
  progress_label   TEXT,
  resume_token     TEXT,
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
  path         TEXT NOT NULL,
  family       TEXT NOT NULL,
  style        TEXT NOT NULL,
  sha256       BLOB NOT NULL UNIQUE,
  imported_at  INTEGER NOT NULL
) STRICT;

CREATE TABLE template_index (
  id           TEXT PRIMARY KEY,
  path         TEXT NOT NULL,
  name         TEXT NOT NULL,
  aspects      TEXT NOT NULL,
  builtin      INTEGER NOT NULL CHECK (builtin IN (0,1)),
  sha256       BLOB NOT NULL,
  updated_at   INTEGER NOT NULL
) STRICT;

CREATE TABLE encoder_probe (
  encoder        TEXT NOT NULL,
  driver_sig     TEXT NOT NULL,
  ok             INTEGER NOT NULL CHECK (ok IN (0,1)),
  detail         TEXT,
  probed_at      INTEGER NOT NULL,
  PRIMARY KEY (encoder, driver_sig)
) STRICT;

CREATE TABLE setting (
  key    TEXT PRIMARY KEY,
  value  TEXT NOT NULL
) STRICT;
