import { randomUUID } from 'node:crypto'
import { rm } from 'node:fs/promises'
import { join } from 'node:path'
import { buildTimedSegments, type ProviderTiming } from '@shared/timedSegments'
import { advanceStatus, type Job } from '@shared/types'
import { startJob } from '../jobs'
import { ffmpeg } from '../media'
import { tmpDir } from '../paths'
import { canonicalWordCount, surahInfo } from '../quran'
import { getProject, patchProject } from '../repo'
import { importSource } from './importFile'
import { mp3quranAudioUrl, mp3quranReciters, mp3quranTiming } from './mp3quran'
import { downloadFile } from './net'
import { qdcChapter, qdcReciters } from './qdc'

export function startDownload(projectId: string, reciterId: string): Job {
  const project = getProject(projectId)
  if (!project.surah) throw new Error('Silakan pilih surah terlebih dahulu.')
  const [provider, rid] = reciterId.split(':')
  if ((provider !== 'mp3quran' && provider !== 'qdc') || !rid) throw new Error('Qari tidak dikenal.')

  return startJob(projectId, 'download', 'net', async (ctx) => {
    const p = getProject(projectId)
    if (!p.surah) throw new Error('Silakan pilih surah terlebih dahulu.')
    const surah = surahInfo(p.surah)
    ctx.progress(0.02, 'Menyiapkan unduhan…')

    let url: string
    let timing: ProviderTiming | null = null
    let name: string
    if (provider === 'qdc') {
      const r = (await qdcReciters()).find((x) => x.id === reciterId)
      if (!r) throw new Error('Qari tidak ditemukan di Quran.com.')
      name = r.name
      ;({ url, timing } = await qdcChapter(Number(rid), surah.id, ctx.signal))
    } else {
      const r = (await mp3quranReciters()).find((x) => x.id === reciterId)
      if (!r) throw new Error('Qari tidak ditemukan di MP3Quran.')
      if (!r.surahs.includes(surah.id)) throw new Error(`Qari ini belum memiliki rekaman ${surah.nameLatin}.`)
      name = r.name
      url = mp3quranAudioUrl(r, surah.id)
      if (r.timed) timing = await mp3quranTiming(r, surah.id, ctx.signal)
    }

    const from = p.ayahFrom ?? 1
    const to = p.ayahTo ?? surah.ayahCount
    const cut =
      timing && timing.ayahs.length > 0
        ? buildTimedSegments(timing, {
            surah: surah.id,
            from,
            to,
            source: provider,
            wordCount: (ayah) => canonicalWordCount(surah.id, ayah),
            newId: randomUUID
          })
        : null

    const tmp = join(tmpDir(), `${randomUUID()}.mp3`)
    const cutFile = join(tmpDir(), `${randomUUID()}.m4a`)
    try {
      ctx.progress(0.05, 'Mengunduh tilawah…')
      await downloadFile(url, tmp, { signal: ctx.signal, onProgress: (f) => ctx.progress(0.05 + f * 0.75) })
      let file = tmp
      if (cut && (cut.startMs > 0 || cut.endMs != null)) {
        ctx.progress(0.8, 'Memotong sesuai rentang ayat…')
        // Input seeking with re-encoding is sample-accurate, so segment times stay exact.
        const range = ['-ss', String(cut.startMs / 1000), ...(cut.endMs != null ? ['-to', String(cut.endMs / 1000)] : [])]
        await ffmpeg([...range, '-i', tmp, '-vn', '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', cutFile], {
          signal: ctx.signal,
          durationMs: cut.endMs != null ? cut.endMs - cut.startMs : null,
          onProgress: (f) => ctx.progress(0.8 + f * 0.15)
        })
        file = cutFile
      }
      ctx.progress(0.96, 'Menyimpan ke proyek…')
      const asset = await importSource(projectId, file, {
        source: provider,
        name: `${name} – ${surah.nameLatin}`,
        move: true,
        signal: ctx.signal,
        meta: { reciterId, url, cutStartMs: cut?.startMs ?? 0, cutEndMs: cut?.endMs ?? null }
      })
      const cur = getProject(projectId)
      patchProject(projectId, {
        sourceAssetId: asset.id,
        segments: cut?.segments ?? [],
        status: advanceStatus(cur.status, cut ? 'synced' : 'source'),
        ...(cur.reciter.trim() ? {} : { reciter: name })
      })
      if (cut) return 'Tilawah terunduh dan ayat sudah tersinkron.'
      return from > 1 || to < surah.ayahCount
        ? 'Tilawah terunduh satu surah penuh. Silakan potong bagian yang dibutuhkan.'
        : 'Tilawah terunduh.'
    } finally {
      await Promise.all([rm(tmp, { force: true }), rm(cutFile, { force: true })])
    }
  })
}
