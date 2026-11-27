import { t } from '@shared/i18n'
import { OPENDUA_EDITION } from '@shared/dua'
import { KEMENAG } from '@shared/translation'
import { randomUUID } from 'node:crypto'
import { copyFile, mkdir, rename, rm, stat } from 'node:fs/promises'
import { basename, extname, join } from 'node:path'
import { BrowserWindow, dialog, type OpenDialogOptions } from 'electron'
import { advanceStatus, type Asset, type AssetSource } from '@shared/types'
import { ffmpeg, probe, type Probe } from '../media'
import { assetAbsPath, projectDir } from '../paths'
import { getProject, insertAsset, patchProject } from '../repo'

export const AUDIO_EXT = ['mp3', 'm4a', 'aac', 'wav', 'flac', 'ogg', 'opus']
export const VIDEO_EXT = ['mp4', 'mov', 'mkv', 'webm']
export const IMAGE_EXT = ['png', 'jpg', 'jpeg', 'webp']

const extOf = (path: string): string => extname(path).slice(1).toLowerCase()

/** Chromium (preview and Remotion export) decodes these; anything else is converted on import. */
const PLAYABLE_AUDIO = ['mp3', 'aac', 'opus', 'vorbis', 'flac', 'pcm_s16le', 'pcm_s24le', 'pcm_s32le', 'pcm_f32le', 'pcm_u8']
const PLAYABLE_VIDEO = ['h264', 'vp8', 'vp9', 'av1']
const PLAYABLE_VIDEO_CONTAINER = ['mp4', 'mov', 'webm']

export async function pickFile(title: string, name: string, extensions: string[]): Promise<string | null> {
  const opts: OpenDialogOptions = { title, properties: ['openFile'], filters: [{ name, extensions }] }
  const win = BrowserWindow.getFocusedWindow()
  const res = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts)
  return res.canceled ? null : (res.filePaths[0] ?? null)
}

/** The path may come from the renderer: it must be an existing regular file with an allowed extension. */
export async function checkFile(path: unknown, allowed: string[]): Promise<string> {
  if (typeof path !== 'string' || !path) throw new Error(t('Berkas tidak valid.'))
  if (!allowed.includes(extOf(path))) {
    throw new Error(t('Format berkas ini belum didukung. Silakan pilih berkas {formats}.', { formats: allowed.join(', ') }))
  }
  const st = await stat(path).catch(() => null)
  if (!st?.isFile()) throw new Error(t('Berkas tidak ditemukan. Mungkin sudah dipindahkan atau dihapus.'))
  return path
}

function needsConvert(ext: string, p: Probe): boolean {
  if (p.hasAudio && !PLAYABLE_AUDIO.includes(p.audioCodec ?? '')) return true
  if (p.hasVideo) return !PLAYABLE_VIDEO_CONTAINER.includes(ext) || !PLAYABLE_VIDEO.includes(p.videoCodec ?? '')
  return ext === 'mkv'
}

/**
 * Copies (or moves) `src` into `projectDir/<folder>/<uuid>.<ext>`, converting what Chromium cannot play: audio to
 * m4a (AAC), video to mp4 (H.264 + AAC). `p` is the probe of `src`. Returns the project-relative path and the probe of
 * the stored file.
 */
export async function store(
  projectId: string,
  src: string,
  p: Probe,
  o: { folder: 'audio' | 'media'; move?: boolean; signal?: AbortSignal; onProgress?: (p: number) => void }
): Promise<{ path: string; probe: Probe }> {
  const ext = extOf(src)
  const id = randomUUID()
  await mkdir(join(projectDir(projectId), o.folder), { recursive: true })
  if (!needsConvert(ext, p)) {
    const rel = `${o.folder}/${id}.${ext}`
    const dest = assetAbsPath(projectId, rel)
    if (o.move) await rename(src, dest).catch(() => copyFile(src, dest).then(() => rm(src, { force: true })))
    else await copyFile(src, dest)
    return { path: rel, probe: p }
  }
  const rel = `${o.folder}/${id}.${p.hasVideo ? 'mp4' : 'm4a'}`
  const dest = assetAbsPath(projectId, rel)
  const audio = p.hasAudio ? (p.audioCodec === 'aac' ? ['-c:a', 'copy'] : ['-c:a', 'aac', '-b:a', '192k']) : ['-an']
  const video = p.hasVideo
    ? ['-map', '0:v:0', ...(p.videoCodec === 'h264' ? ['-c:v', 'copy'] : ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-pix_fmt', 'yuv420p'])]
    : ['-vn']
  try {
    await ffmpeg(['-i', src, ...video, ...(p.hasAudio ? ['-map', '0:a:0'] : []), ...audio, '-movflags', '+faststart', dest], {
      signal: o.signal,
      durationMs: p.durationMs,
      onProgress: o.onProgress
    })
  } catch (e) {
    await rm(dest, { force: true })
    throw o.signal?.aborted ? e : new Error(t('Berkas ini tidak bisa dikonversi ke format yang bisa diputar.'))
  }
  if (o.move) await rm(src, { force: true })
  return { path: rel, probe: await probe(dest) }
}

/** Stores `src` as the project's source. Old segments belonged to the old audio, so they go (the renderer confirms first). */
export async function importSource(
  projectId: string,
  src: string,
  o: { source: AssetSource; name?: string; move?: boolean; signal?: AbortSignal; onProgress?: (p: number) => void; meta?: Record<string, unknown> }
): Promise<Asset> {
  getProject(projectId)
  const pre = await probe(src)
  if (!pre.hasAudio) throw new Error(t('Berkas ini tidak berisi suara. Silakan pilih rekaman yang ada audionya.'))
  const { path, probe: p } = await store(projectId, src, pre, { folder: 'audio', move: o.move, signal: o.signal, onProgress: o.onProgress })
  const asset = insertAsset({
    projectId,
    kind: p.hasVideo ? 'video' : 'audio',
    path,
    name: o.name ?? basename(src),
    durationMs: p.durationMs,
    width: p.width,
    height: p.height,
    source: o.source,
    meta: o.meta ?? {}
  })
  const cur = getProject(projectId)
  const resetDua =
    o.source !== 'opendua' && cur.dua
      ? {
          dua: null,
          ...(cur.editions.length === 1 && cur.editions[0] === OPENDUA_EDITION ? { editions: [KEMENAG] } : {})
        }
      : {}
  patchProject(projectId, { sourceAssetId: asset.id, segments: [], status: advanceStatus(cur.status, 'source'), ...resetDua })
  return asset
}

export async function importMediaFile(projectId: string, src: string): Promise<Asset> {
  getProject(projectId)
  const image = IMAGE_EXT.includes(extOf(src))
  if (image) {
    const p = await probe(src)
    const rel = `media/${randomUUID()}.${extOf(src)}`
    await mkdir(join(projectDir(projectId), 'media'), { recursive: true })
    await copyFile(src, assetAbsPath(projectId, rel))
    return insertAsset({ projectId, kind: 'image', path: rel, name: basename(src), durationMs: null, width: p.width, height: p.height, source: 'local', meta: {} })
  }
  const pre = await probe(src)
  if (!pre.hasVideo) throw new Error(t('Berkas ini tidak berisi gambar video.'))
  const { path, probe: p } = await store(projectId, src, pre, { folder: 'media' })
  return insertAsset({ projectId, kind: 'video', path, name: basename(src), durationMs: p.durationMs, width: p.width, height: p.height, source: 'local', meta: {} })
}
