import Database from 'better-sqlite3'
import { dbPath } from './paths'

let db: Database.Database | null = null

/** Append-only; `user_version` records how many ran. */
const MIGRATIONS: string[] = [
  `
  CREATE TABLE projects (
    id TEXT PRIMARY KEY,
    data_json TEXT NOT NULL,
    updated_at INTEGER NOT NULL
  );
  CREATE TABLE assets (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    kind TEXT NOT NULL,
    path TEXT NOT NULL,
    name TEXT NOT NULL,
    duration_ms INTEGER,
    width INTEGER,
    height INTEGER,
    source TEXT NOT NULL,
    meta_json TEXT NOT NULL DEFAULT '{}',
    created_at INTEGER NOT NULL
  );
  CREATE INDEX assets_project ON assets(project_id);
  CREATE TABLE jobs (
    id TEXT PRIMARY KEY,
    project_id TEXT REFERENCES projects(id) ON DELETE CASCADE,
    kind TEXT NOT NULL,
    status TEXT NOT NULL,
    progress REAL NOT NULL DEFAULT 0,
    message TEXT,
    error TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );
  CREATE INDEX jobs_project ON jobs(project_id);
  CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
  CREATE TABLE secrets (name TEXT PRIMARY KEY, value BLOB NOT NULL);
  CREATE TABLE cache (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at INTEGER NOT NULL);
  CREATE TABLE editions (
    id TEXT PRIMARY KEY,
    language TEXT NOT NULL,
    name TEXT NOT NULL,
    author TEXT NOT NULL DEFAULT ''
  );
  CREATE TABLE edition_text (
    edition TEXT NOT NULL REFERENCES editions(id) ON DELETE CASCADE,
    surah INTEGER NOT NULL,
    ayah INTEGER NOT NULL,
    text TEXT NOT NULL,
    PRIMARY KEY (edition, surah, ayah)
  );
  `
]

export function getDb(): Database.Database {
  if (db) return db
  db = new Database(dbPath())
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')
  const version = db.pragma('user_version', { simple: true }) as number
  for (let v = version; v < MIGRATIONS.length; v++) {
    db.transaction(() => {
      db!.exec(MIGRATIONS[v])
      db!.pragma(`user_version = ${v + 1}`)
    })()
  }
  return db
}

export function closeDb(): void {
  db?.close()
  db = null
}

/** Small JSON cache for network data (Quran.com texts, reciter lists). */
export function cacheGet<T>(key: string, maxAgeMs = Infinity): T | null {
  const row = getDb().prepare('SELECT value, updated_at FROM cache WHERE key = ?').get(key) as
    | { value: string; updated_at: number }
    | undefined
  if (!row || Date.now() - row.updated_at > maxAgeMs) return null
  return JSON.parse(row.value) as T
}

export function cacheSet(key: string, value: unknown): void {
  getDb()
    .prepare('INSERT INTO cache (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at')
    .run(key, JSON.stringify(value), Date.now())
}
