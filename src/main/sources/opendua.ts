import { randomUUID } from 'node:crypto'
import { rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import {
  OPENDUA_CATALOGUE_URL,
  OPENDUA_CREDIT,
  OPENDUA_EDITION,
  buildDuaSegments,
  parseOpenDuaCatalogue,
  type DuaInfo,
  type OpenDuaEntry
} from '@shared/dua'
import { t } from '@shared/i18n'
import { advanceStatus, type Job } from '@shared/types'
import { cacheGet, cacheSet } from '../db'
import { startJob } from '../jobs'
import { ffmpeg, probe } from '../media'
import { tmpDir } from '../paths'
import { getProject, patchProject } from '../repo'
import { importSource } from './importFile'
import { downloadFile, getJson } from './net'

const CACHE_KEY = 'opendua:catalogue:v0.0.4'
const WEEK = 7 * 86_400_000

/** Fetches and caches playable OpenDua entries (entries without recitation audio are excluded). */
export async function openDuaEntries(): Promise<OpenDuaEntry[]> {
  const cached = cacheGet<OpenDuaEntry[]>(CACHE_KEY, WEEK)
  if (cached) return cached
  const raw = await getJson<unknown>(OPENDUA_CATALOGUE_URL)
  const parsed = parseOpenDuaCatalogue(raw)
  if (parsed.length === 0) throw new Error(t('Daftar doa OpenDua tidak bisa dibaca. Silakan coba lagi nanti.'))
  cacheSet(CACHE_KEY, parsed)
  return parsed
}

export function startDownloadDua(projectId: string, entryId: string): Job {
  getProject(projectId)
  if (!entryId) throw new Error(t('Doa belum dipilih.'))

  return startJob(projectId, 'download', 'net', async (ctx) => {
    ctx.progress(0.02, t('Menyiapkan daftar doa…'))
    const list = await openDuaEntries()
    const entry = list.find((e) => e.id === entryId)
    if (!entry || entry.clips.length === 0) throw new Error(t('Doa tidak ditemukan atau belum memiliki audio di OpenDua.'))

    const temps: string[] = []
    try {
      const probed: { file: string; durationMs: number }[] = []
      const n = entry.clips.length
      for (let i = 0; i < n; i++) {
        const clip = entry.clips[i]
        const tmp = join(tmpDir(), `${randomUUID()}.mp3`)
        temps.push(tmp)
        ctx.progress(0.05 + (i / n) * 0.7, t('Mengunduh audio doa…'))
        await downloadFile(clip.audioUrl, tmp, {
          signal: ctx.signal,
          onProgress: (f) => ctx.progress(0.05 + ((i + f) / n) * 0.7)
        })
        const info = await probe(tmp)
        probed.push({ file: tmp, durationMs: info.durationMs ?? Math.max(1000, Math.round(clip.durationSeconds * 1000)) })
      }

      let finalFile = probed[0].file
      if (probed.length > 1) {
        ctx.progress(0.8, t('Menggabungkan audio doa…'))
        const listFile = join(tmpDir(), `${randomUUID()}.txt`)
        const mergedFile = join(tmpDir(), `${randomUUID()}.m4a`)
        temps.push(listFile, mergedFile)
        const lines = probed.map((p) => `file '${p.file.replace(/'/g, "'\\''")}'`).join('\n')
        await writeFile(listFile, lines, 'utf8')
        const totalMs = probed.reduce((acc, p) => acc + p.durationMs, 0)
        await ffmpeg(['-f', 'concat', '-safe', '0', '-i', listFile, '-vn', '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', mergedFile], {
          signal: ctx.signal,
          durationMs: totalMs,
          onProgress: (f) => ctx.progress(0.8 + f * 0.14)
        })
        finalFile = mergedFile
      }

      ctx.progress(0.95, t('Menyimpan ke proyek…'))
      const asset = await importSource(projectId, finalFile, {
        source: 'opendua',
        name: `${entry.reciter} – ${entry.title}`,
        move: true,
        signal: ctx.signal,
        meta: {
          entryId: entry.id,
          chapterTitle: entry.chapterTitle,
          reciter: entry.reciter,
          credit: OPENDUA_CREDIT
        }
      })

      const dua: DuaInfo = {
        entryId: entry.id,
        title: entry.title,
        chapterTitle: entry.chapterTitle,
        reciter: entry.reciter,
        items: entry.clips.map((c) => ({ id: c.id, words: c.words, translation: c.translation }))
      }

      const durations = probed.map((p) => p.durationMs)
      if (durations.length === 1 && asset.durationMs) durations[0] = asset.durationMs
      const segments = buildDuaSegments(
        entry.clips.map((c, i) => ({
          itemId: c.id,
          wordCount: c.words.length,
          translation: c.translation,
          durationMs: durations[i]
        })),
        randomUUID
      )
      if (asset.durationMs && segments.length > 0) {
        const last = segments[segments.length - 1]
        if (last.endMs !== asset.durationMs && asset.durationMs > last.startMs) {
          segments[segments.length - 1] = { ...last, endMs: asset.durationMs }
        }
      }

      const cur = getProject(projectId)
      patchProject(projectId, {
        sourceAssetId: asset.id,
        dua,
        surah: null,
        ayahFrom: null,
        ayahTo: null,
        editions: [OPENDUA_EDITION],
        reciter: entry.reciter,
        segments,
        status: advanceStatus(cur.status, 'synced')
      })
      return t('Doa terunduh dan siap disunting.')
    } finally {
      await Promise.all(temps.map((f) => rm(f, { force: true })))
    }
  })
}
