import { t } from '@shared/i18n'
import { existsSync } from 'node:fs'
import { mkdir, rename, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { computeSpectrum, SPECTRUM_RATE, SPECTRUM_VERSION } from '@shared/spectrum'
import { handle } from './ipc'
import { ffmpeg } from './media'
import { assetAbsPath, projectDir } from './paths'
import { getAsset } from './repo'

const inflight = new Map<string, Promise<string>>()

/**
 * Makes (once per source asset) the loudness-per-frame table the visualizer overlay draws from, and returns its path
 * relative to the project folder, so the preview (studio://) and the export (local http server) can both fetch it.
 */
export function ensureSpectrum(projectId: string, assetId: string): Promise<string> {
  const rel = `cache/spectrum-${assetId}-v${SPECTRUM_VERSION}.bin`
  if (existsSync(join(projectDir(projectId), rel))) return Promise.resolve(rel)
  const key = `${projectId}:${rel}`
  let p = inflight.get(key)
  if (!p) {
    p = (async () => {
      const asset = getAsset(assetId)
      if (asset.projectId !== projectId) throw new Error(t('Berkas ini bukan milik proyek.'))
      const src = assetAbsPath(projectId, asset.path)
      if (!existsSync(src)) throw new Error(t('Berkas audio sudah tidak ada di folder proyek.'))
      const pcm = await ffmpeg(['-i', src, '-vn', '-ac', '1', '-ar', String(SPECTRUM_RATE), '-f', 's16le', '-'])
      const table = computeSpectrum(new Int16Array(pcm.buffer, pcm.byteOffset, Math.floor(pcm.byteLength / 2)))
      const abs = join(projectDir(projectId), rel)
      await mkdir(dirname(abs), { recursive: true })
      // Written aside and renamed, so a render never reads half a table.
      await writeFile(`${abs}.tmp`, table)
      await rename(`${abs}.tmp`, abs)
      return rel
    })().finally(() => inflight.delete(key))
    inflight.set(key, p)
  }
  return p
}

export function registerSpectrumIpc(): void {
  handle('sources', 'spectrum', (projectId, assetId) => ensureSpectrum(projectId, assetId))
}
