import { t } from '@shared/i18n'
import type { CacheEntry, CacheId, StorageAsset, StorageProject, StorageUsage } from '@shared/storage'
import { assetUses, clearReferences, isIdle, isRemotionTemp } from '@shared/storageRules'
import type { Stats } from 'node:fs'
import { lstat, readdir, rm, unlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve, sep } from 'node:path'
import { handle } from './ipc'
import { activeJobs } from './jobs'
import { assetAbsPath, projectsRoot, qpcFontsDir, renderPartsDir, tmpDir } from './paths'
import { assetsOf, deleteAsset, getAssetOrNull, getProject, listProjects, patchProject } from './repo'
import { getSettings } from './settings'

const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR
/** Another Remotion app may be rendering into its folder in the system temp dir; leave anything touched this recently. */
const TEMP_IDLE_MANUAL = 10 * MINUTE
const TEMP_IDLE_AUTO = DAY
const PARTS_IDLE_AUTO = 7 * DAY

interface Walk {
  bytes: number
  files: number
  /** Newest modification time of anything in the tree, the entry itself included. */
  newest: number
}

const EMPTY: Walk = { bytes: 0, files: 0, newest: 0 }

async function statOrNull(path: string): Promise<Stats | null> {
  try {
    return await lstat(path)
  } catch {
    return null
  }
}

/** Sizes a file or folder with lstat so symlinks are never followed; only regular files count. Vanished entries count as nothing. */
async function walk(path: string): Promise<Walk> {
  const st = await statOrNull(path)
  if (!st) return EMPTY
  if (st.isFile()) return { bytes: st.size, files: 1, newest: st.mtimeMs }
  if (!st.isDirectory()) return { ...EMPTY, newest: st.mtimeMs }
  let names: string[]
  try {
    names = await readdir(path)
  } catch {
    return { ...EMPTY, newest: st.mtimeMs }
  }
  const total: Walk = { bytes: 0, files: 0, newest: st.mtimeMs }
  for (const child of await Promise.all(names.map((n) => walk(join(path, n))))) {
    total.bytes += child.bytes
    total.files += child.files
    total.newest = Math.max(total.newest, child.newest)
  }
  return total
}

async function childNames(dir: string): Promise<string[]> {
  try {
    return await readdir(dir)
  } catch {
    return []
  }
}

/** Removes one entry that sits directly inside a root; returns the bytes that are gone (a failure frees only what went). */
async function removeEntry(path: string): Promise<number> {
  const before = await walk(path)
  try {
    await rm(path, { recursive: true, force: true })
  } catch {
    // Permissions or a file in use: skip it, count what did go.
  }
  const after = await walk(path)
  return Math.max(0, before.bytes - after.bytes)
}

/** Empties a folder without removing it: other code expects the folder to exist. */
async function emptyDir(dir: string, keep: (name: string, path: string) => Promise<boolean> = async () => true): Promise<number> {
  let freed = 0
  for (const name of await childNames(dir)) {
    const path = join(dir, name)
    if (await keep(name, path)) freed += await removeEntry(path)
  }
  return freed
}

const sysTemp = (): string => tmpdir()

/** `remotion-v*` entries in the system temp dir that nothing touched for `minIdleMs`. */
async function remotionTemps(minIdleMs: number): Promise<{ path: string; walked: Walk }[]> {
  const now = Date.now()
  const out: { path: string; walked: Walk }[] = []
  for (const name of await childNames(sysTemp())) {
    if (!isRemotionTemp(name)) continue
    const path = join(sysTemp(), name)
    const walked = await walk(path)
    if (isIdle(walked.newest, now, minIdleMs)) out.push({ path, walked })
  }
  return out
}

/** Every spectrum table of every project, with the folder it lives in. */
async function spectrumFiles(): Promise<string[]> {
  const files: string[] = []
  for (const id of await childNames(projectsRoot())) {
    const cache = join(projectsRoot(), id, 'cache')
    for (const name of await childNames(cache)) {
      if (/^spectrum-.+\.bin$/.test(name)) files.push(join(cache, name))
    }
  }
  return files
}

async function walkAll(paths: string[]): Promise<Walk> {
  const total: Walk = { bytes: 0, files: 0, newest: 0 }
  for (const w of await Promise.all(paths.map(walk))) {
    total.bytes += w.bytes
    total.files += w.files
  }
  return total
}

async function cacheEntry(id: CacheId): Promise<CacheEntry> {
  let w: Walk
  switch (id) {
    case 'temp': {
      const mine = await walk(tmpDir())
      const sys = await walkAll((await remotionTemps(0)).map((x) => x.path))
      w = { bytes: mine.bytes + sys.bytes, files: mine.files + sys.files, newest: 0 }
      break
    }
    case 'render-parts':
      w = await walk(renderPartsDir())
      break
    case 'spectrum':
      w = await walkAll(await spectrumFiles())
      break
    case 'fonts':
      w = await walk(qpcFontsDir())
      break
  }
  return { id, bytes: w.bytes, files: w.files }
}

export async function usage(): Promise<StorageUsage> {
  const exportFolder = getSettings().exportFolder
  const [entries, projects, exported] = await Promise.all([
    Promise.all((['temp', 'render-parts', 'spectrum', 'fonts'] as const).map(cacheEntry)),
    walk(projectsRoot()),
    walk(exportFolder)
  ])
  return { entries, projectsBytes: projects.bytes, exportFolder, exportBytes: exported.bytes, busy: activeJobs() > 0 }
}

const busyError = (): Error => new Error(t('Masih ada proses yang berjalan. Tunggu sampai selesai, lalu coba lagi.'))

export async function clear(ids: CacheId[]): Promise<number> {
  if (activeJobs() > 0) throw busyError()
  let freed = 0
  for (const id of new Set(ids)) {
    switch (id) {
      case 'temp':
        freed += await emptyDir(tmpDir())
        for (const x of await remotionTemps(TEMP_IDLE_MANUAL)) freed += await removeEntry(x.path)
        break
      case 'render-parts':
        freed += await emptyDir(renderPartsDir())
        break
      case 'spectrum':
        for (const f of await spectrumFiles()) freed += await removeEntry(f)
        break
      case 'fonts':
        freed += await emptyDir(qpcFontsDir())
        break
    }
  }
  return freed
}

/** What needs no attention, removed once at start: old render leftovers and abandoned pieces of long exports. */
export async function autoClean(): Promise<void> {
  const now = Date.now()
  // Nothing runs at start, so the app's own tmp folder is all leftovers.
  await emptyDir(tmpDir())
  for (const x of await remotionTemps(TEMP_IDLE_AUTO)) await removeEntry(x.path)
  await emptyDir(renderPartsDir(), async (_name, path) => {
    const st = await statOrNull(path)
    return !!st && st.isDirectory() && isIdle((await walk(path)).newest, now, PARTS_IDLE_AUTO)
  })
}

export async function assets(): Promise<StorageProject[]> {
  const out: StorageProject[] = []
  for (const summary of listProjects()) {
    const list = assetsOf(summary.id)
    if (list.length === 0) continue
    const project = getProject(summary.id)
    const rows: StorageAsset[] = await Promise.all(
      list.map(async (a) => {
        const st = await statOrNull(assetAbsPath(a.projectId, a.path))
        return { id: a.id, name: a.name, kind: a.kind, bytes: st?.isFile() ? st.size : 0, uses: assetUses(project, a.id) }
      })
    )
    rows.sort((a, b) => Number(a.uses.length > 0) - Number(b.uses.length > 0) || b.bytes - a.bytes)
    out.push({ id: summary.id, title: summary.title, assets: rows, bytes: rows.reduce((n, a) => n + a.bytes, 0) })
  }
  return out
}

async function removeAsset(projectId: string, assetId: string): Promise<number> {
  const asset = getAssetOrNull(assetId)
  if (!asset || asset.projectId !== projectId) throw new Error(t('Berkas proyek tidak ditemukan.'))
  const root = resolve(projectsRoot(), projectId)
  const file = resolve(assetAbsPath(projectId, asset.path))
  // The path comes from the database; never delete anything outside the project's own folder.
  if (!file.startsWith(root + sep)) throw new Error(t('Berkas proyek tidak ditemukan.'))

  const project = getProject(projectId)
  const uses = assetUses(project, assetId)
  const st = await statOrNull(file)
  try {
    await unlink(file)
  } catch (e) {
    // A file that is already gone is fine; anything else keeps the row so the user can see and retry it.
    if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e
  }
  const cache = join(root, 'cache')
  for (const name of await childNames(cache)) {
    if (name.startsWith(`spectrum-${assetId}-`)) await rm(join(cache, name), { force: true }).catch(() => undefined)
  }
  deleteAsset(assetId)
  if (uses.length > 0) patchProject(projectId, clearReferences(project, assetId))
  return st?.isFile() ? st.size : 0
}

export async function deleteAssets(items: { projectId: string; assetId: string }[]): Promise<number> {
  if (activeJobs() > 0) throw busyError()
  let freed = 0
  for (const { projectId, assetId } of items) freed += await removeAsset(projectId, assetId)
  return freed
}

export function registerStorageIpc(): void {
  handle('storage', 'usage', () => usage())
  handle('storage', 'clear', (ids) => clear(ids))
  handle('storage', 'assets', () => assets())
  handle('storage', 'deleteAssets', (items) => deleteAssets(items))
}
