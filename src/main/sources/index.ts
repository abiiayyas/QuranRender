import { t } from '@shared/i18n'
import { randomUUID } from 'node:crypto'
import { mkdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { shiftSegments } from '@shared/timedSegments'
import type { Job } from '@shared/types'
import { handle } from '../ipc'
import { startJob } from '../jobs'
import { ffmpeg, probe, waveform } from '../media'
import { assetAbsPath, projectDir } from '../paths'
import { getAsset, getProject, insertAsset, patchProject } from '../repo'
import { startDownload } from './download'
import { AUDIO_EXT, checkFile, IMAGE_EXT, importMediaFile, importSource, pickFile, VIDEO_EXT } from './importFile'
import { mp3quranReciters } from './mp3quran'
import { openDuaEntries, startDownloadDua } from './opendua'
import { qdcReciters } from './qdc'
import { startYoutube } from './ytdlp'

const MIN_TRIM_MS = 500

function startTrim(projectId: string, inMs: number, outMs: number): Job {
  const p = getProject(projectId)
  if (!p.sourceAssetId) throw new Error(t('Belum ada sumber audio untuk dipotong.'))
  const src = getAsset(p.sourceAssetId)
  const end = src.durationMs ?? Infinity
  if (!Number.isFinite(inMs) || !Number.isFinite(outMs) || inMs < 0 || outMs > end + 50 || outMs - inMs < MIN_TRIM_MS) {
    throw new Error(t('Titik potong tidak valid. Pastikan titik keluar setelah titik masuk, dengan jarak minimal setengah detik.'))
  }
  const from = Math.round(inMs)
  const to = Math.round(Math.min(outMs, end))

  return startJob(projectId, 'trim', 'cpu', async (ctx) => {
    const video = src.kind === 'video'
    const rel = `audio/${randomUUID()}.${video ? 'mp4' : 'm4a'}`
    const dest = assetAbsPath(projectId, rel)
    await mkdir(join(projectDir(projectId), 'audio'), { recursive: true })
    const codecs = video
      ? ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', '18', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '192k']
      : ['-vn', '-c:a', 'aac', '-b:a', '192k']
    ctx.progress(0.02, t('Memotong sumber…'))
    try {
      // Input seeking with re-encoding cuts at the exact sample, so shifted segment times stay true.
      await ffmpeg(['-ss', String(from / 1000), '-to', String(to / 1000), '-i', assetAbsPath(projectId, src.path), ...codecs, '-movflags', '+faststart', dest], {
        signal: ctx.signal,
        durationMs: to - from,
        onProgress: (f) => ctx.progress(0.02 + f * 0.93)
      })
    } catch (e) {
      await rm(dest, { force: true })
      throw e
    }
    const pr = await probe(dest)
    const asset = insertAsset({
      projectId,
      kind: src.kind,
      path: rel,
      name: `${src.name} (dipotong)`,
      durationMs: pr.durationMs,
      width: pr.width,
      height: pr.height,
      source: 'trim',
      meta: { from: src.id, inMs: from, outMs: to }
    })
    // Read again: the user may have edited segments while the job waited in the queue.
    const cur = getProject(projectId)
    patchProject(projectId, { sourceAssetId: asset.id, segments: shiftSegments(cur.segments, from, to) })
    return t('Sumber sudah dipotong.')
  })
}

/** Peaks per asset + bucket count; an asset file never changes, so entries never go stale. */
const peaks = new Map<string, Promise<number[]>>()

function assetPeaks(projectId: string, assetId: string, count: number): Promise<number[]> {
  const a = getAsset(assetId)
  if (a.projectId !== projectId) throw new Error(t('Berkas proyek tidak ditemukan.'))
  const n = Math.min(20_000, Math.max(1, Math.round(count)))
  const key = `${assetId}:${n}`
  let p = peaks.get(key)
  if (!p) {
    p = waveform(assetAbsPath(projectId, a.path), n)
    p.catch(() => peaks.delete(key))
    peaks.set(key, p)
  }
  return p
}

export function registerSourcesIpc(): void {
  handle('sources', 'importFile', async (projectId, path) => {
    const allowed = [...AUDIO_EXT, ...VIDEO_EXT]
    const picked = path ?? (await pickFile(t('Pilih rekaman tilawah'), t('Audio atau video'), allowed))
    if (!picked) return null
    return importSource(projectId, await checkFile(picked, allowed), { source: 'local' })
  })

  handle('sources', 'importMedia', async (projectId, kind, path) => {
    const allowed = kind === 'image' ? IMAGE_EXT : kind === 'video' ? VIDEO_EXT : [...IMAGE_EXT, ...VIDEO_EXT]
    const picked = path ?? (await pickFile(kind === 'image' ? t('Pilih gambar') : kind === 'video' ? t('Pilih video') : t('Pilih gambar atau video'), t('Media'), allowed))
    if (!picked) return null
    return importMediaFile(projectId, await checkFile(picked, allowed))
  })

  handle('sources', 'reciters', (provider) => {
    if (provider === 'qdc') return qdcReciters()
    if (provider === 'mp3quran') return mp3quranReciters()
    throw new Error(t('Penyedia tilawah tidak dikenal.'))
  })

  handle('sources', 'download', (projectId, reciterId) => startDownload(projectId, reciterId))
  handle('sources', 'duas', () => openDuaEntries())
  handle('sources', 'downloadDua', (projectId, entryId) => startDownloadDua(projectId, entryId))
  handle('sources', 'youtube', (projectId, url) => startYoutube(projectId, url))
  handle('sources', 'trim', (projectId, inMs, outMs) => startTrim(projectId, inMs, outMs))
  handle('sources', 'waveform', (projectId, assetId, count) => assetPeaks(projectId, assetId, count))
}
