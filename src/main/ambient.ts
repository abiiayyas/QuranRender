import { existsSync } from 'node:fs'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { isAmbientId } from '@shared/ambient'
import { t } from '@shared/i18n'
import { gatedLevelDb, LOUDNESS_MAX_SECONDS, LOUDNESS_RATE } from '@shared/loudness'
import { handle } from './ipc'
import { ffmpeg } from './media'
import { ambientDir, assetAbsPath, projectDir } from './paths'
import { getAsset, getProject } from './repo'

/** Level of a file's first `LOUDNESS_MAX_SECONDS`, in dBFS. */
async function levelOf(path: string): Promise<number> {
  const pcm = await ffmpeg(['-i', path, '-vn', '-t', String(LOUDNESS_MAX_SECONDS), '-ac', '1', '-ar', String(LOUDNESS_RATE), '-f', 's16le', '-'])
  const level = gatedLevelDb(new Int16Array(pcm.buffer, pcm.byteOffset, Math.floor(pcm.byteLength / 2)))
  if (level === null) throw new Error(t('Tidak ada suara yang bisa diukur di berkas ini.'))
  return level
}

const soundLevels = new Map<string, Promise<number>>()
/** The bundled files never change while the app runs, so each is measured once. */
const soundLevel = (id: string): Promise<number> => {
  let p = soundLevels.get(id)
  if (!p) {
    p = levelOf(join(ambientDir(), `${id}.m4a`))
    // A failure (a file missing from a broken install) must not be remembered.
    p.catch(() => soundLevels.delete(id))
    soundLevels.set(id, p)
  }
  return p
}

/** The reciter's level, measured once per source asset and kept in the project's cache folder. */
async function voiceLevel(projectId: string, assetId: string): Promise<number> {
  const asset = getAsset(assetId)
  if (asset.projectId !== projectId) throw new Error(t('Berkas ini bukan milik proyek.'))
  const cache = join(projectDir(projectId), `cache/loudness-${assetId}-v1.json`)
  if (existsSync(cache)) {
    const saved = JSON.parse(await readFile(cache, 'utf8')) as { db?: number }
    if (typeof saved.db === 'number') return saved.db
  }
  const src = assetAbsPath(projectId, asset.path)
  if (!existsSync(src)) throw new Error(t('Berkas audio sudah tidak ada di folder proyek.'))
  const db = await levelOf(src)
  await mkdir(dirname(cache), { recursive: true })
  await writeFile(`${cache}.tmp`, JSON.stringify({ db }))
  await rename(`${cache}.tmp`, cache)
  return db
}

/** dB the recitation is above the bundled sound (see VideoProps.ambientOffsetDb). */
export async function ambientOffsetDb(projectId: string, assetId: string, soundId: string): Promise<number> {
  if (!isAmbientId(soundId)) throw new Error(t('Suara latar tidak dikenal.'))
  if (!existsSync(join(ambientDir(), `${soundId}.m4a`))) throw new Error(t('Berkas suara latar tidak ikut terpasang di aplikasi ini. Silakan pasang ulang dari installer terbaru.'))
  const [voice, sound] = await Promise.all([voiceLevel(projectId, assetId), soundLevel(soundId)])
  return voice - sound
}

export function registerAmbientIpc(): void {
  handle('sources', 'ambientOffset', async (projectId, soundId) => {
    const sourceId = getProject(projectId).sourceAssetId
    if (!sourceId) throw new Error(t('Proyek belum memiliki sumber audio.'))
    return ambientOffsetDb(projectId, sourceId, soundId)
  })
}
