import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readdirSync, renameSync, rmdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { app } from 'electron'
import { t } from '@shared/i18n'
import { rangeFrames } from '@shared/exportRange'
import { CHUNK_SECONDS, planChunks } from '@shared/renderPlan'
import type { VideoProps } from '@shared/video'
import { ffmpeg, probe } from './media'
import { assetAbsPath, renderPartsDir } from './paths'
import { prepareVideo, renderPiece, type VideoRender } from './render'

/** Dev and tests set this to make small pieces; real exports use CHUNK_SECONDS. */
export const chunkSeconds = (): number => {
  const v = Number(process.env['QR_CHUNK_SECONDS'])
  return Number.isFinite(v) && v >= 2 ? v : CHUNK_SECONDS
}

const chunkName = (i: number): string => `chunk-${String(i + 1).padStart(4, '0')}.mp4`

/**
 * Identifies a render: the same fingerprint means the same pixels and sound, so pieces left by an earlier run can be
 * reused. It covers what is drawn (the project without fields that never reach a frame), the canvas, the piece length,
 * the app version (the composition's code), and the size and age of every file the video reads.
 */
export function fingerprint(props: VideoProps, seconds = chunkSeconds()): string {
  const { updatedAt: _u, createdAt: _c, step: _s, status: _st, publish: _p, thumbnail: _t, title: _ti, ...project } = props.project
  const files = Object.values(props.assets)
    .map((a) => {
      const abs = assetAbsPath(a.projectId, a.path)
      const st = existsSync(abs) ? statSync(abs) : null
      return [a.id, st?.size ?? -1, Math.round(st?.mtimeMs ?? 0)]
    })
    .sort()
  const body = JSON.stringify({
    app: app.getVersion(),
    seconds,
    // The server origin changes on every run, so URLs are left out; what they point at is covered by `files`.
    props: { ...props, project, assets: Object.keys(props.assets).sort(), baseUrl: null, spectrumUrl: props.spectrumUrl ? 'spectrum' : null },
    files
  })
  return createHash('sha256').update(body).digest('hex').slice(0, 20)
}

export const partsPath = (projectId: string, fp: string): string => join(renderPartsDir(), projectId, fp)

/** Finished pieces in `dir` (not those still being written). */
function finishedPieces(dir: string): number[] {
  if (!existsSync(dir)) return []
  return readdirSync(dir)
    .map((n) => /^chunk-(\d{4})\.mp4$/.exec(n))
    .filter((m): m is RegExpExecArray => m !== null)
    .map((m) => Number(m[1]) - 1)
}

export interface Partial {
  done: number
  total: number
}

/** How much of this render is already on disk from an interrupted run, or null when nothing is. */
export function partialOf(props: VideoProps): Partial | null {
  const r = rangeFrames(props.rangeMs ?? null, props.durationMs, props.fps)
  const total = planChunks(r.count, props.fps, chunkSeconds(), r.from).length
  const done = finishedPieces(partsPath(props.project.id, fingerprint(props))).filter((i) => i < total).length
  return done > 0 ? { done, total } : null
}

/** A piece left by an earlier run counts only when it has the length it should: a half-flushed file must be redone. */
async function pieceIsGood(path: string, frames: number, fps: number): Promise<boolean> {
  try {
    const p = await probe(path)
    return p.hasVideo && p.durationMs !== null && Math.abs(p.durationMs - (frames / fps) * 1000) <= 1000 / fps + 20
  } catch {
    return false
  }
}

const quote = (path: string): string => `'${path.replace(/'/g, `'\\''`)}'`

export interface ChunkedResult {
  /** Frames drawn in this run (pieces reused from an earlier run are not counted): what a speed measurement needs. */
  framesRendered: number
  resumed: number
}

/**
 * Draws the video in pieces of about ten minutes, without sound, then the whole sound track once, and joins them with
 * ffmpeg without re-encoding the picture (the sound is encoded to AAC once). An interrupted run leaves its finished pieces in `partsPath`, and the next run with the
 * same fingerprint picks up from there; a successful one removes them.
 */
export async function renderChunked(o: {
  props: VideoProps
  outPath: string
  signal: AbortSignal
  fresh: boolean
  onProgress: (p: number, message: string) => void
}): Promise<ChunkedResult> {
  const { props } = o
  // Frames of the video being made: all of them, or those of the chosen stretch.
  const range = rangeFrames(props.rangeMs ?? null, props.durationMs, props.fps)
  const totalFrames = range.count
  const chunks = planChunks(totalFrames, props.fps, chunkSeconds(), range.from)
  const dir = partsPath(props.project.id, fingerprint(props))
  if (o.fresh) rmSync(dir, { recursive: true, force: true })
  mkdirSync(dir, { recursive: true })

  let prep: VideoRender | null = null
  let framesRendered = 0
  let resumed = 0
  let framesDone = 0
  const report = (inPiece: number, i: number): void =>
    o.onProgress(
      Math.min(0.98, (framesDone + inPiece) / (totalFrames + 1)),
      t('Potongan {i} dari {n}, bingkai {frames} dari {total}', { i: i + 1, n: chunks.length, frames: framesDone + inPiece, total: totalFrames })
    )

  for (const c of chunks) {
    const frames = c.to - c.from + 1
    const final = join(dir, chunkName(c.index))
    if (existsSync(final) && (await pieceIsGood(final, frames, props.fps))) {
      resumed++
      framesDone += frames
      continue
    }
    rmSync(final, { force: true })
    prep ??= await prepareVideo(props)
    const part = join(dir, `chunk-${String(c.index + 1).padStart(4, '0')}.part.mp4`)
    await renderPiece(prep, { kind: 'video', outPath: part, frameRange: [c.from, c.to], signal: o.signal, onFrames: (rendered) => report(rendered, c.index) })
    // Renamed only when whole, so an interruption never leaves something that looks finished.
    renameSync(part, final)
    framesDone += frames
    framesRendered += frames
  }

  const audio = join(dir, 'audio.wav')
  if (!existsSync(audio)) {
    o.onProgress(0.98, t('Menyiapkan suara…'))
    prep ??= await prepareVideo(props)
    const audioPart = join(dir, 'audio.part.wav')
    await renderPiece(prep, { kind: 'audio', outPath: audioPart, frameRange: props.rangeMs ? [range.from, range.to] : undefined, signal: o.signal })
    renameSync(audioPart, audio)
  }

  o.onProgress(0.99, t('Menggabungkan potongan…'))
  const list = join(dir, 'list.txt')
  writeFileSync(list, chunks.map((c) => `file ${quote(join(dir, chunkName(c.index)))}`).join('\n') + '\n')
  await ffmpeg(['-f', 'concat', '-safe', '0', '-i', list, '-i', audio, '-map', '0:v:0', '-map', '1:a:0', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', o.outPath], { signal: o.signal })

  // The joined file must be as long as the video: a missing piece would otherwise only show when someone watches it.
  const out = await probe(o.outPath)
  const expectedMs = (totalFrames / props.fps) * 1000
  if (out.durationMs === null || Math.abs(out.durationMs - expectedMs) > 1500) {
    throw new Error(t('Video hasil gabungan tidak sepanjang yang seharusnya. Silakan ulangi ekspor.'))
  }
  rmSync(dir, { recursive: true, force: true })
  try {
    // The project's folder goes too once it holds nothing else (another settings' pieces may still be there).
    rmdirSync(join(renderPartsDir(), props.project.id))
  } catch {
    // Not empty: leave it.
  }
  return { framesRendered, resumed }
}
