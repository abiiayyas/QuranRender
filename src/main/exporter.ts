import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import { BrowserWindow, dialog, powerSaveBlocker, shell } from 'electron'
import { getLang, t } from '@shared/i18n'
import { clampRange, formatTime, rangeFrames, rangeProblem, type ExportRange } from '@shared/exportRange'
import { checkExport } from '@shared/policy'
import { blendSpeed, measuredMsPerMpFrame, useChunks } from '@shared/renderPlan'
import { toSrt, toVtt, youtubeChapters, type SubtitleMode } from '@shared/subtitles'
import { shiftSegments } from '@shared/timedSegments'
import { advanceStatus, type ArabicScript, type Asset, type ExportOptions, type Job, type PolicyIssue, type Project, type Verse } from '@shared/types'
import { canvasSize, verseKey, type VideoProps } from '@shared/video'
import { notifyExportDone, runAfterExport } from './afterExport'
import { ambientOffsetDb } from './ambient'
import { handle } from './ipc'
import { activeJobs, startJob } from './jobs'
import { assetAbsPath } from './paths'
import { getVerses, surahList } from './quran'
import { partialOf, renderChunked } from './renderChunks'
import { renderVideo } from './render'
import { ensureSpectrum } from './spectrum'
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

export async function buildVideoProps(project: Project, height: number, fps: number, baseUrl: VideoProps['baseUrl'], range: ExportRange | null = null): Promise<VideoProps> {
  const assets = referencedAssets(project)
  const source = project.sourceAssetId ? assets[project.sourceAssetId] : undefined
  if (!source) throw new Error(t('Proyek belum memiliki sumber audio.'))
  const lastEnd = Math.max(0, ...project.segments.map((s) => s.endMs))
  const spectrumUrl = project.overlays.some((o) => o.kind === 'visualizer')
    ? `${baseUrl.asset}${encodeURIComponent(project.id)}/${(await ensureSpectrum(project.id, source.id)).split('/').map(encodeURIComponent).join('/')}`
    : null
  return {
    project,
    assets,
    verses: await versesOf(project, project.script),
    surah: surahList().find((s) => s.id === project.surah) ?? null,
    ...canvasSize(project.aspect, height),
    fps,
    durationMs: source.durationMs ?? lastEnd,
    lang: getLang(),
    rangeMs: range,
    spectrumUrl,
    ambientOffsetDb: project.ambient ? await ambientOffsetDb(project.id, source.id, project.ambient.id) : null,
    baseUrl
  }
}

/** The range the renderer asked for, checked again here (it is not trusted): null for the whole video, an error for a bad one. */
function resolveRange(project: Project, range: ExportRange | null | undefined): ExportRange | null {
  if (!range) return null
  const source = project.sourceAssetId ? getAssetOrNull(project.sourceAssetId) : null
  const durationMs = source?.durationMs ?? Math.max(0, ...project.segments.map((s) => s.endMs))
  if (!Number.isFinite(range.fromMs) || !Number.isFinite(range.toMs)) throw new Error(t('Rentang waktu ekspor tidak valid.'))
  const problem = rangeProblem(range, durationMs)
  if (problem === 'beyond') throw new Error(t('Awal rentang ada di luar rekaman.'))
  if (problem === 'order') throw new Error(t('Akhir rentang harus setelah awalnya.'))
  if (problem === 'short') throw new Error(t('Rentang ekspor paling pendek 1 detik.'))
  return clampRange(range, durationMs)
}

async function check(project: Project, range: ExportRange | null = null): Promise<PolicyIssue[]> {
  const src = project.sourceAssetId ? getAssetOrNull(project.sourceAssetId) : null
  const sourceOk = !!src && existsSync(assetAbsPath(src.projectId, src.path))
  // Word counts are the same in every script; offline with an uncached script, the range check is skipped.
  const verses = await versesOf(project, project.script).catch(() => versesOf(project, 'kemenag')).catch(() => ({}))
  // For a short, only the segments it holds can hold it back: a bad segment somewhere else in a long recording does not matter.
  const inRange = range ? { ...project, segments: project.segments.filter((s) => s.endMs > range.fromMs && s.startMs < range.toMs) } : project
  return checkExport(inRange, { sourceOk, verses })
}

/** File-name-safe title (macOS and the exFAT drives videos often go to). */
export const safeName = (title: string): string => title.replace(/[\\/:*?"<>|\u0000-\u001f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80) || 'Video Quran'

function stamp(d = new Date()): string {
  const p = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}.${p(d.getMinutes())}.${p(d.getSeconds())}`
}

export function ensureFolder(folder: string): string {
  try {
    mkdirSync(folder, { recursive: true })
  } catch {
    throw new Error(t('Folder ekspor tidak bisa dibuat: {folder}. Silakan pilih folder lain.', { folder }))
  }
  return folder
}

async function start(o: ExportOptions): Promise<Job> {
  const project = getProject(o.projectId)
  const range = resolveRange(project, o.range)
  if ((await check(project, range)).some((i) => i.severity === 'error')) {
    throw new Error(t('Masih ada masalah yang perlu diperbaiki sebelum ekspor. Silakan periksa daftar di dialog Ekspor.'))
  }
  const folder = ensureFolder(o.folder)
  // A short says which stretch it is in its name, so several cuts of one recording do not look alike.
  const name = `${safeName(project.title)}${range ? ` ${formatTime(range.fromMs).replace(/:/g, '.')}-${formatTime(range.toMs).replace(/:/g, '.')}` : ''} ${stamp()}`
  const outPath = join(folder, `${name}.mp4`)

  return startJob(project.id, 'export', 'cpu', async (ctx) => {
    ctx.progress(0.01, t('Menyiapkan mesin render…'))
    // A long render must not be cut off by the Mac falling asleep; released however the job ends.
    const blocker = powerSaveBlocker.start('prevent-app-suspension')
    // Read again: the user may have edited between the click and the queue slot.
    const p = getProject(project.id)
    const server = await startFileServer()
    try {
      const props = await buildVideoProps(p, o.height, o.fps, { asset: `${server.origin}asset/`, font: `${server.origin}fonts/` }, range)
      const started = Date.now()
      let frames = rangeFrames(range, props.durationMs, props.fps).count
      if (useChunks(o.mode, range ? range.toMs - range.fromMs : props.durationMs)) {
        const r = await renderChunked({ props, outPath, signal: ctx.signal, fresh: !!o.fresh, onProgress: (progress, message) => ctx.progress(0.02 + progress * 0.96, message) })
        frames = r.framesRendered
      } else {
        await renderVideo({
          props,
          outPath,
          signal: ctx.signal,
          onProgress: (progress, rendered, total) => ctx.progress(0.02 + progress * 0.96, t('Merender bingkai {frames} dari {total}', { frames: rendered, total }))
        })
      }
      // What this computer can do feeds the time estimate in the Export dialog.
      const speed = measuredMsPerMpFrame({ elapsedMs: Date.now() - started, frames, width: props.width, height: props.height, motion: p.background.kind === 'motion' })
      if (speed !== null) setSettings({ renderMsPerMpFrame: blendSpeed(getSettings().renderMsPerMpFrame, speed) })

      if (o.srt || o.vtt || o.chapters) {
        ctx.progress(0.99, t('Menulis subtitle…'))
        // QPC words are page-font glyph codes, unreadable as plain text: subtitles use Uthmani text instead.
        const verses = p.script === 'qpc' ? await versesOf(p, 'uthmani') : props.verses
        const mode: SubtitleMode = p.editions.length > 0 ? 'both' : 'arabic'
        // For a short the times start again at zero, like the video, and only what falls inside is kept.
        const cut = range ? { ...p, segments: shiftSegments(p.segments, range.fromMs, range.toMs) } : p
        if (o.srt) writeFileSync(join(folder, `${name}.srt`), toSrt(cut, verses, mode))
        if (o.vtt) writeFileSync(join(folder, `${name}.vtt`), toVtt(cut, verses, mode))
        if (o.chapters) {
          const lines = youtubeChapters(cut, props.surah?.nameLatin ?? '', range ? range.toMs - range.fromMs : props.durationMs)
          writeFileSync(join(folder, `${name} - chapters.txt`), `${lines.join('\n')}\n`)
        }
      }
    } catch (e) {
      rmSync(outPath, { force: true })
      throw e
    } finally {
      powerSaveBlocker.stop(blocker)
      await server.close()
    }
    patchProject(p.id, { status: advanceStatus(getProject(p.id).status, 'exported') })
    notifyExportDone(outPath)
    // Only when nothing else is running or queued: putting the Mac to sleep must not cut off another job. This job is
    // still counted until it returns, hence 1. Delayed so the finished state reaches the window first.
    if (o.after !== 'none' && activeJobs() <= 1) setTimeout(() => void runAfterExport(o.after), 1500)
    return outPath
  })
}

export function registerExportIpc(): void {
  handle('exporter', 'check', (projectId, range) => {
    const project = getProject(projectId)
    return check(project, resolveRange(project, range))
  })
  handle('exporter', 'start', (options) => start(options))
  handle('exporter', 'partial', async (options) => {
    const project = getProject(options.projectId)
    const source = project.sourceAssetId ? getAssetOrNull(project.sourceAssetId) : null
    const range = resolveRange(project, options.range)
    if (!source || !useChunks(options.mode, range ? range.toMs - range.fromMs : (source.durationMs ?? 0))) return null
    // Only the fingerprint is needed, so the file server's address does not matter.
    return partialOf(await buildVideoProps(project, options.height, options.fps, { asset: 'asset/', font: 'fonts/' }, range))
  })
  handle('exporter', 'defaultFolder', () => ensureFolder(getSettings().exportFolder))
  handle('exporter', 'pickFolder', async () => {
    const win = BrowserWindow.getFocusedWindow()
    const opts = { title: t('Pilih folder ekspor'), defaultPath: getSettings().exportFolder, properties: ['openDirectory', 'createDirectory'] as ('openDirectory' | 'createDirectory')[] }
    const r = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts)
    const folder = r.canceled ? null : (r.filePaths[0] ?? null)
    if (folder) setSettings({ exportFolder: folder })
    return folder
  })
  handle('exporter', 'reveal', (path) => {
    if (!existsSync(path)) throw new Error(t('Berkas {name} sudah tidak ada di folder itu.', { name: basename(path) }))
    shell.showItemInFolder(path)
  })
}
