import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import { BrowserWindow, dialog, shell } from 'electron'
import { checkExport } from '@shared/policy'
import { toSrt, toVtt, youtubeChapters, type SubtitleMode } from '@shared/subtitles'
import { advanceStatus, type ArabicScript, type Asset, type ExportOptions, type Job, type PolicyIssue, type Project, type Verse } from '@shared/types'
import { canvasSize, verseKey, type VideoProps } from '@shared/video'
import { handle } from './ipc'
import { startJob } from './jobs'
import { assetAbsPath } from './paths'
import { getVerses, surahList } from './quran'
import { renderVideo } from './render'
import { startFileServer } from './renderServer'
import { getAssetOrNull, getProject, patchProject } from './repo'
import { getSettings, setSettings } from './settings'

/** Verses of every ayah a segment shows, keyed `${surah}:${ayah}`; `1:1` too when there is a basmalah segment. */
async function versesOf(project: Project, script: ArabicScript): Promise<Record<string, Verse>> {
  const ranges = new Map<number, [number, number]>()
  const want = (surah: number, ayah: number): void => {
    const r = ranges.get(surah)
    ranges.set(surah, r ? [Math.min(r[0], ayah), Math.max(r[1], ayah)] : [ayah, ayah])
  }
  for (const s of project.segments) {
    if (s.kind === 'ayah') want(s.surah, s.ayah)
    else if (s.kind === 'basmalah') want(1, 1)
  }
  const out: Record<string, Verse> = {}
  for (const [surah, [from, to]] of ranges) for (const v of await getVerses(surah, from, to, script)) out[verseKey(v.surah, v.ayah)] = v
  return out
}

function referencedAssets(project: Project): Record<string, Asset> {
  const ids = [project.sourceAssetId, project.background.assetId, ...project.overlays.map((o) => o.assetId)]
  const out: Record<string, Asset> = {}
  for (const id of ids) {
    const a = id ? getAssetOrNull(id) : null
    if (a) out[a.id] = a
  }
  return out
}

export async function buildVideoProps(project: Project, height: number, fps: number, baseUrl: VideoProps['baseUrl']): Promise<VideoProps> {
  const assets = referencedAssets(project)
  const source = project.sourceAssetId ? assets[project.sourceAssetId] : undefined
  if (!source) throw new Error('Proyek belum memiliki sumber audio.')
  const lastEnd = Math.max(0, ...project.segments.map((s) => s.endMs))
  return {
    project,
    assets,
    verses: await versesOf(project, project.script),
    surah: surahList().find((s) => s.id === project.surah) ?? null,
    ...canvasSize(project.aspect, height),
    fps,
    durationMs: source.durationMs ?? lastEnd,
    baseUrl
  }
}

async function check(project: Project): Promise<PolicyIssue[]> {
  const src = project.sourceAssetId ? getAssetOrNull(project.sourceAssetId) : null
  const sourceOk = !!src && existsSync(assetAbsPath(src.projectId, src.path))
  // Word counts are the same in every script; offline with an uncached script, the range check is skipped.
  const verses = await versesOf(project, project.script).catch(() => versesOf(project, 'kemenag')).catch(() => ({}))
  return checkExport(project, { sourceOk, verses })
}

/** File-name-safe title (macOS and the exFAT drives videos often go to). */
const safeName = (title: string): string => title.replace(/[\\/:*?"<>|\u0000-\u001f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80) || 'Video Quran'

function stamp(d = new Date()): string {
  const p = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}.${p(d.getMinutes())}.${p(d.getSeconds())}`
}

function ensureFolder(folder: string): string {
  try {
    mkdirSync(folder, { recursive: true })
  } catch {
    throw new Error(`Folder ekspor tidak bisa dibuat: ${folder}. Silakan pilih folder lain.`)
  }
  return folder
}

async function start(o: ExportOptions): Promise<Job> {
  const project = getProject(o.projectId)
  if ((await check(project)).some((i) => i.severity === 'error')) {
    throw new Error('Masih ada masalah yang perlu diperbaiki sebelum ekspor. Silakan periksa daftar di dialog Ekspor.')
  }
  const folder = ensureFolder(o.folder)
  const name = `${safeName(project.title)} ${stamp()}`
  const outPath = join(folder, `${name}.mp4`)

  return startJob(project.id, 'export', 'cpu', async (ctx) => {
    ctx.progress(0.01, 'Menyiapkan mesin render…')
    // Read again: the user may have edited between the click and the queue slot.
    const p = getProject(project.id)
    const server = await startFileServer()
    try {
      const props = await buildVideoProps(p, o.height, o.fps, { asset: `${server.origin}asset/`, font: `${server.origin}fonts/` })
      await renderVideo({
        props,
        outPath,
        signal: ctx.signal,
        onProgress: (progress, frames, total) => ctx.progress(0.02 + progress * 0.96, `Merender bingkai ${frames} dari ${total}`)
      })

      if (o.srt || o.vtt || o.chapters) {
        ctx.progress(0.99, 'Menulis subtitle…')
        // QPC words are page-font glyph codes, unreadable as plain text: subtitles use Uthmani text instead.
        const verses = p.script === 'qpc' ? await versesOf(p, 'uthmani') : props.verses
        const mode: SubtitleMode = p.editions.length > 0 ? 'both' : 'arabic'
        if (o.srt) writeFileSync(join(folder, `${name}.srt`), toSrt(p, verses, mode))
        if (o.vtt) writeFileSync(join(folder, `${name}.vtt`), toVtt(p, verses, mode))
        if (o.chapters) {
          const lines = youtubeChapters(p, props.surah?.nameLatin ?? '', props.durationMs)
          writeFileSync(join(folder, `${name} - chapters.txt`), `${lines.join('\n')}\n`)
        }
      }
    } catch (e) {
      rmSync(outPath, { force: true })
      throw e
    } finally {
      await server.close()
    }
    patchProject(p.id, { status: advanceStatus(getProject(p.id).status, 'exported') })
    return outPath
  })
}

export function registerExportIpc(): void {
  handle('exporter', 'check', (projectId) => check(getProject(projectId)))
  handle('exporter', 'start', (options) => start(options))
  handle('exporter', 'defaultFolder', () => ensureFolder(getSettings().exportFolder))
  handle('exporter', 'pickFolder', async () => {
    const win = BrowserWindow.getFocusedWindow()
    const opts = { title: 'Pilih folder ekspor', defaultPath: getSettings().exportFolder, properties: ['openDirectory', 'createDirectory'] as ('openDirectory' | 'createDirectory')[] }
    const r = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts)
    const folder = r.canceled ? null : (r.filePaths[0] ?? null)
    if (folder) setSettings({ exportFolder: folder })
    return folder
  })
  handle('exporter', 'reveal', (path) => {
    if (!existsSync(path)) throw new Error(`Berkas ${basename(path)} sudah tidak ada di folder itu.`)
    shell.showItemInFolder(path)
  })
}
