import { t } from '@shared/i18n'
import { randomUUID } from 'node:crypto'
import { cpSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { DEFAULT_STYLE } from '@shared/style'
import type { Asset, Job, JobKind, Project, ProjectBundle, ProjectInit, ProjectSummary } from '@shared/types'
import { getDb } from './db'
import { emit } from './events'
import { assetUrl, projectDir, projectsRoot } from './paths'

export function newProject(init: ProjectInit): Project {
  const now = Date.now()
  return {
    ...init,
    id: randomUUID(),
    step: 1,
    status: 'draft',
    editions: ['id.kemenag'],
    sourceAssetId: null,
    segments: [],
    style: { ...DEFAULT_STYLE },
    background: { kind: 'color', color: '#101114', assetId: null, dim: 0.35, blur: 0 },
    overlays: [],
    createdAt: now,
    updatedAt: now
  }
}

export function getProject(id: string): Project {
  const row = getDb().prepare('SELECT data_json FROM projects WHERE id = ?').get(id) as { data_json: string } | undefined
  if (!row) throw new Error(t('Proyek tidak ditemukan. Mungkin sudah dihapus.'))
  return JSON.parse(row.data_json) as Project
}

export function putProject(p: Project): void {
  getDb()
    .prepare('INSERT INTO projects (id, data_json, updated_at) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET data_json = excluded.data_json, updated_at = excluded.updated_at')
    .run(p.id, JSON.stringify(p), p.updatedAt)
}

export function createProject(init: ProjectInit): Project {
  const p = newProject(init)
  putProject(p)
  projectDir(p.id)
  return p
}

export function saveProject(p: Project): void {
  getProject(p.id)
  putProject({ ...p, updatedAt: Date.now() })
}

/** Main-side change of project fields (job results): written, then sent so the open editor merges it. */
export function patchProject(id: string, patch: Partial<Project>): Project {
  const p = { ...getProject(id), ...patch, updatedAt: Date.now() }
  putProject(p)
  emit.project({ projectId: id, patch })
  return p
}

/**
 * The surah and verses a project really covers. The fields chosen when it was created can be stale: AI sync recognizes
 * what was recited, and a recording can run across surahs. Falls back to those fields while there are no verse segments.
 */
function coverage(p: Project): Pick<ProjectSummary, 'surah' | 'ayahFrom' | 'ayahTo' | 'surahTo' | 'surahCount'> {
  const verses = p.segments.filter((s) => s.kind === 'ayah' && s.surah > 0).sort((a, b) => a.startMs - b.startMs)
  if (verses.length === 0) return { surah: p.surah, ayahFrom: p.ayahFrom, ayahTo: p.ayahTo, surahTo: null, surahCount: 0 }
  const first = verses[0]
  const last = verses[verses.length - 1]
  const surahCount = new Set(verses.map((s) => s.surah)).size
  return { surah: first.surah, ayahFrom: first.ayah, ayahTo: last.ayah, surahTo: last.surah !== first.surah ? last.surah : null, surahCount }
}

function summary(p: Project): ProjectSummary {
  const src = p.sourceAssetId ? getAssetOrNull(p.sourceAssetId) : null
  return {
    id: p.id,
    title: p.title,
    step: p.step,
    status: p.status,
    aspect: p.aspect,
    ...coverage(p),
    reciter: p.reciter,
    durationMs: src?.durationMs ?? null,
    segmentCount: p.segments.length,
    style: p.style,
    backgroundColor: p.background.color,
    updatedAt: p.updatedAt
  }
}

export function listProjects(): ProjectSummary[] {
  const rows = getDb().prepare('SELECT data_json FROM projects ORDER BY updated_at DESC').all() as { data_json: string }[]
  return rows.map((r) => summary(JSON.parse(r.data_json) as Project))
}

export function removeProject(id: string): void {
  getDb().prepare('DELETE FROM projects WHERE id = ?').run(id)
  rmSync(join(projectsRoot(), id), { recursive: true, force: true })
}

/** Copies the folder and the asset rows under new ids (asset paths are relative, so the copy is self-contained). */
export function duplicateProject(id: string): ProjectSummary {
  const db = getDb()
  const rows = db.prepare('SELECT * FROM assets WHERE project_id = ?').all(id) as AssetRow[]
  const ids = new Map(rows.map((r) => [r.id, randomUUID()]))
  // Asset ids are UUIDs, so replacing them in the project JSON cannot hit anything else.
  let json = JSON.stringify(getProject(id))
  for (const [from, to] of ids) json = json.replaceAll(from, to)
  const src = JSON.parse(json) as Project
  const now = Date.now()
  const copy: Project = { ...src, id: randomUUID(), title: `${src.title} (salinan)`, createdAt: now, updatedAt: now }
  const insert = db.prepare(
    `INSERT INTO assets (id, project_id, kind, path, name, duration_ms, width, height, source, meta_json, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  )
  db.transaction(() => {
    putProject(copy)
    for (const r of rows)
      insert.run(ids.get(r.id), copy.id, r.kind, r.path, r.name, r.duration_ms, r.width, r.height, r.source, r.meta_json, r.created_at)
  })()
  cpSync(join(projectsRoot(), id), projectDir(copy.id), { recursive: true })
  return summary(copy)
}

// Assets ------------------------------------------------------------------------------------------------------

interface AssetRow {
  id: string
  project_id: string
  kind: Asset['kind']
  path: string
  name: string
  duration_ms: number | null
  width: number | null
  height: number | null
  source: Asset['source']
  meta_json: string
  created_at: number
}

const toAsset = (r: AssetRow): Asset => ({
  id: r.id,
  projectId: r.project_id,
  kind: r.kind,
  path: r.path,
  name: r.name,
  durationMs: r.duration_ms,
  width: r.width,
  height: r.height,
  source: r.source,
  meta: JSON.parse(r.meta_json) as Record<string, unknown>,
  createdAt: r.created_at,
  url: assetUrl(r.project_id, r.path)
})

/** Asset rows are never deleted while their project lives, so ids kept by undo history stay valid. */
export function insertAsset(a: Omit<Asset, 'id' | 'createdAt' | 'url'>): Asset {
  const id = randomUUID()
  const createdAt = Date.now()
  getDb()
    .prepare(
      `INSERT INTO assets (id, project_id, kind, path, name, duration_ms, width, height, source, meta_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(id, a.projectId, a.kind, a.path, a.name, a.durationMs, a.width, a.height, a.source, JSON.stringify(a.meta), createdAt)
  const asset = getAsset(id)
  emit.asset(asset)
  return asset
}

export function getAssetOrNull(id: string): Asset | null {
  const r = getDb().prepare('SELECT * FROM assets WHERE id = ?').get(id) as AssetRow | undefined
  return r ? toAsset(r) : null
}

export function getAsset(id: string): Asset {
  const a = getAssetOrNull(id)
  if (!a) throw new Error(t('Berkas proyek tidak ditemukan.'))
  return a
}

export function assetsOf(projectId: string): Asset[] {
  return (getDb().prepare('SELECT * FROM assets WHERE project_id = ? ORDER BY created_at').all(projectId) as AssetRow[]).map(toAsset)
}

// Jobs --------------------------------------------------------------------------------------------------------

interface JobRow {
  id: string
  project_id: string | null
  kind: JobKind
  status: Job['status']
  progress: number
  message: string | null
  error: string | null
  created_at: number
  updated_at: number
}

const toJob = (r: JobRow): Job => ({
  id: r.id,
  projectId: r.project_id,
  kind: r.kind,
  status: r.status,
  progress: r.progress,
  message: r.message,
  error: r.error,
  createdAt: r.created_at,
  updatedAt: r.updated_at
})

export function insertJob(projectId: string | null, kind: JobKind): Job {
  const id = randomUUID()
  const now = Date.now()
  getDb()
    .prepare('INSERT INTO jobs (id, project_id, kind, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run(id, projectId, kind, 'queued', now, now)
  return getJob(id)
}

export function getJob(id: string): Job {
  return toJob(getDb().prepare('SELECT * FROM jobs WHERE id = ?').get(id) as JobRow)
}

export function updateJob(id: string, patch: Partial<Pick<Job, 'status' | 'progress' | 'message' | 'error'>>): Job {
  const cur = getJob(id)
  const next = { ...cur, ...patch, updatedAt: Date.now() }
  getDb()
    .prepare('UPDATE jobs SET status = ?, progress = ?, message = ?, error = ?, updated_at = ? WHERE id = ?')
    .run(next.status, next.progress, next.message, next.error, next.updatedAt, id)
  return next
}

/** Jobs of the last day, so a reopened project still shows what finished or failed while it was closed. */
export function jobsOf(projectId: string): Job[] {
  return (
    getDb()
      .prepare('SELECT * FROM jobs WHERE project_id = ? AND updated_at > ? ORDER BY created_at')
      .all(projectId, Date.now() - 86_400_000) as JobRow[]
  ).map(toJob)
}

/** A job cannot survive a restart: whatever was queued or running is marked failed. */
export function failInterruptedJobs(): void {
  getDb()
    .prepare(`UPDATE jobs SET status = 'failed', error = ?, updated_at = ? WHERE status IN ('queued', 'running')`)
    .run(t('Terputus karena aplikasi ditutup.'), Date.now())
}

export function bundle(id: string): ProjectBundle {
  return { project: getProject(id), assets: assetsOf(id), jobs: jobsOf(id) }
}
