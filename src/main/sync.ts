import { t } from '@shared/i18n'
import { rm, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { needsReview } from '@shared/segments'
import { advanceStatus, type Project } from '@shared/types'
import { alignFile, mapAlignment } from './aligner'
import { handle } from './ipc'
import { startJob } from './jobs'
import { ffmpeg } from './media'
import { assetAbsPath, tmpDir } from './paths'
import { canonicalWordCount } from './quran'
import { getAsset, getProject, patchProject } from './repo'

function wordCountOrNull(surah: number, ayah: number): number | null {
  try {
    return canonicalWordCount(surah, ayah)
  } catch {
    return null
  }
}

export function registerSyncIpc(): void {
  handle('sync', 'align', (projectId, model) => {
    const project = getProject(projectId)
    if (!project.sourceAssetId) throw new Error(t('Proyek belum punya audio. Silakan tambahkan sumber di langkah 1.'))
    const asset = getAsset(project.sourceAssetId)
    return startJob(projectId, 'align', 'align', async (ctx) => {
      const flac = join(tmpDir(), `${ctx.jobId}.flac`)
      try {
        ctx.progress(0.02, t('Menyiapkan audio…'))
        // Mono 16 kHz FLAC is what the model listens to anyway and keeps the upload small.
        await ffmpeg(['-nostdin', '-v', 'error', '-stats', '-i', assetAbsPath(projectId, asset.path), '-vn', '-ac', '1', '-ar', '16000', '-sample_fmt', 's16', '-c:a', 'flac', flac], {
          signal: ctx.signal,
          durationMs: asset.durationMs,
          onProgress: (p) => ctx.progress(0.02 + p * 0.08)
        })
        const audioMs = asset.durationMs ?? ((await stat(flac)).size / 1_048_576) * 60_000
        // The server reports no progress; this curve approaches the end without reaching it.
        const expectedMs = Math.max(20_000, audioMs * 0.3)
        const result = await alignFile(flac, model, ctx.signal, (stage, message, elapsedMs) => {
          const p = stage === 'uploading' ? 0.12 : stage === 'queued' ? 0.2 : 0.25 + 0.65 * (1 - Math.exp(-elapsedMs / expectedMs))
          ctx.progress(p, message)
        })
        ctx.progress(0.95, t('Memetakan hasil ke ayat…'))
        const out = mapAlignment(result, wordCountOrNull)
        if (out.segments.length === 0) throw new Error(out.warnings[0] ?? t('Penyelaras tidak menemukan bacaan ayat di audio ini.'))
        const cur = getProject(projectId)
        const patch: Partial<Project> = { segments: out.segments, status: advanceStatus(cur.status, 'synced') }
        if (!cur.surah && out.detected) Object.assign(patch, { surah: out.detected.surah, ayahFrom: out.detected.from, ayahTo: out.detected.to })
        patchProject(projectId, patch)
        const review = out.segments.filter(needsReview).length
        const summary = review
          ? t('{n} segmen tersinkron, {review} perlu dicek.', { n: out.segments.length, review })
          : t('{n} segmen tersinkron.', { n: out.segments.length })
        return [summary, ...out.warnings].join(' ')
      } finally {
        await rm(flac, { force: true })
      }
    })
  })
}
