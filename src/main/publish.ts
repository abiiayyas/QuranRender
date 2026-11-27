import { getLang, t } from '@shared/i18n'
import { randomUUID } from 'node:crypto'
import { existsSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { BrowserWindow, clipboard, dialog } from 'electron'
import { backgroundAssetIds } from '@shared/background'
import { OPENDUA_CREDIT, OPENDUA_EDITION } from '@shared/dua'
import { AUDIO_SOURCE_NAME, draftFor, PLATFORMS, platformOf, sanitizeKit, withBackgroundCredit, withDuaCredit, type PlatformId, type PublishFacts, type PublishKit } from '@shared/publish'
import { defaultThumbnail, thumbnailSize, type ThumbnailProps } from '@shared/thumbnail'
import type { Project } from '@shared/types'
import { chat } from './ai'
import { ensureFolder, safeName } from './exporter'
import { handle } from './ipc'
import { startJob } from './jobs'
import { ffmpeg, probe } from './media'
import { assetAbsPath, projectDir } from './paths'
import { surahList } from './quran'
import { renderThumbnail } from './render'
import { startFileServer } from './renderServer'
import { getAsset, getAssetOrNull, getProject, insertAsset } from './repo'
import { getDb } from './db'
import { getSettings } from './settings'

const mmss = (ms: number): string => `${Math.floor(ms / 60000)}:${String(Math.floor((ms % 60000) / 1000)).padStart(2, '0')}`

function editionName(id: string): string | null {
  if (id === 'id.kemenag') return 'Kemenag RI'
  if (id === OPENDUA_EDITION) return 'OpenDua English'
  const row = getDb().prepare('SELECT name FROM editions WHERE id = ?').get(id) as { name: string } | undefined
  return row?.name ?? null
}

export function publishFacts(p: Project): PublishFacts {
  const surah = surahList().find((s) => s.id === p.surah)
  const source = p.sourceAssetId ? getAssetOrNull(p.sourceAssetId) : null
  const label =
    p.ayahFrom && p.ayahTo ? (p.ayahFrom === p.ayahTo ? `${p.ayahFrom}` : `${p.ayahFrom}–${p.ayahTo}`) : p.ayahFrom ? `${p.ayahFrom}` : ''
  // Only stock pictures carry a credit; AI images and the user's own files get none.
  const credits = [
    ...new Set(
      backgroundAssetIds(p.background)
        .map((id) => getAssetOrNull(id))
        .filter((a): a is NonNullable<typeof a> => a?.source === 'stock' && typeof a.meta.credit === 'string' && a.meta.credit.trim() !== '')
        .map((a) => String(a.meta.credit).trim())
    )
  ]
  const backgroundCredit = credits.length > 0 ? credits.join(' · ') : null
  if (p.dua) {
    return {
      surahName: p.dua.title,
      ayahLabel: '',
      duaTitle: p.dua.title,
      duaCredit: OPENDUA_CREDIT,
      reciter: p.reciter,
      translationName: p.editions[0] ? editionName(p.editions[0]) : null,
      audioSource: AUDIO_SOURCE_NAME.opendua,
      backgroundCredit
    }
  }
  return {
    surahName: surah?.nameLatin ?? (p.surah ? `Surah ${p.surah}` : 'Al-Qur’an'),
    ayahLabel: surah ? label : '',
    reciter: p.reciter,
    translationName: p.editions[0] ? editionName(p.editions[0]) : null,
    audioSource: (source && AUDIO_SOURCE_NAME[source.source]) ?? null,
    backgroundCredit
  }
}

/** A few translated lines, so the AI can name the theme without being given (or inventing) any Arabic. */
function themeLines(p: Project): string[] {
  const edition = p.editions[0]
  return p.segments
    .filter((s) => s.kind === 'ayah' || s.kind === 'dua')
    .slice(0, 4)
    .map((s) => s.translations.find((x) => x.edition === edition)?.text ?? '')
    .filter(Boolean)
    .map((x) => x.slice(0, 180))
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    const a = text.indexOf('{')
    const b = text.lastIndexOf('}')
    if (a < 0 || b <= a) return null
    try {
      return JSON.parse(text.slice(a, b + 1))
    } catch {
      return null
    }
  }
}

async function generate(projectId: string, platforms: PlatformId[]) {
  const p = getProject(projectId)
  const facts = publishFacts(p)
  const fallback = (id: PlatformId) => draftFor(id, facts)
  const spec = platforms.map((id) => {
    const pf = platformOf(id)
    return `- "${id}" (${pf.label}): ${pf.hasTitle ? `title up to ${pf.titleMax} characters, ` : 'no title (leave it empty), '}${id === 'youtube' ? 'body of 2 to 3 short paragraphs' : 'body of one or two short sentences'}`
  })
  const subject = facts.duaTitle ? 'Islamic supplication (dua)' : 'Qur’an recitation'
  const reply = await chat(
    [
      {
        role: 'system',
        content: [
          `You write upload copy for videos of ${subject}, in warm, polite ${getLang() === 'en' ? 'English' : 'Indonesian'}.`,
          'Rules: never write, quote, or paraphrase Arabic wording; never state virtues, rewards, or claims about the reciter that the facts do not give; no clickbait.',
          'Use only the facts given. Say who recited and which translation was used when the facts have it.',
          'Hashtags: 3 to 6, each starting with #, no spaces inside, no punctuation inside.',
          `Return only JSON shaped like {"<platform>": {"title": string, "body": string, "hashtags": string}} for these platforms:\n${spec.join('\n')}`
        ].join('\n')
      },
      { role: 'user', content: JSON.stringify({ ...facts, themeTranslations: themeLines(p) }) }
    ],
    { json: true, maxTokens: 1600 }
  )
  const kit = sanitizeKit(parseJson(reply), platforms, fallback)
  const out: PublishKit = {}
  for (const id of platforms) {
    if (kit[id]) out[id] = withDuaCredit(withBackgroundCredit(kit[id], facts.backgroundCredit), facts.duaCredit)
  }
  return out
}

async function frame(projectId: string, assetId: string, ms: number) {
  const src = getAsset(assetId)
  if (src.projectId !== projectId || src.kind !== 'video') throw new Error(t('Bingkai hanya bisa diambil dari video proyek ini.'))
  const abs = assetAbsPath(src.projectId, src.path)
  if (!existsSync(abs)) throw new Error(t('Berkas video sudah tidak ada di folder proyek.'))
  const at = Math.max(0, Math.min(ms, (src.durationMs ?? ms) - 100))
  const path = `media/${randomUUID()}.jpg`
  const out = join(projectDir(projectId), path)
  await ffmpeg(['-ss', String(at / 1000), '-i', abs, '-frames:v', '1', '-q:v', '2', out])
  if (!existsSync(out)) throw new Error(t('Bingkai tidak bisa diambil pada posisi itu.'))
  const { width, height } = await probe(out)
  return insertAsset({ projectId, kind: 'image', path, name: t('Bingkai {time} dari {name}', { time: mmss(at), name: src.name }), durationMs: null, width, height, source: 'frame', meta: { fromAssetId: assetId, ms: at } })
}

async function thumbnail(projectId: string, saveAs: boolean) {
  const project = getProject(projectId)
  const name = `${safeName(project.title)} - thumbnail.jpg`
  let outPath: string
  if (saveAs) {
    const opts = { title: t('Simpan salinan thumbnail'), defaultPath: join(ensureFolder(getSettings().exportFolder), name), filters: [{ name: 'JPEG', extensions: ['jpg'] }] }
    const win = BrowserWindow.getFocusedWindow()
    const r = win ? await dialog.showSaveDialog(win, opts) : await dialog.showSaveDialog(opts)
    if (r.canceled || !r.filePath) return null
    outPath = r.filePath
  } else {
    outPath = join(ensureFolder(getSettings().exportFolder), name)
  }

  return startJob(projectId, 'thumbnail', 'cpu', async (ctx) => {
    ctx.progress(0.1, t('Menyiapkan mesin render…'))
    const p = getProject(projectId)
    const surah = surahList().find((s) => s.id === p.surah)?.nameLatin ?? null
    const spec = p.thumbnail ?? defaultThumbnail(p, surah)
    const image = spec.assetId ? getAssetOrNull(spec.assetId) : null
    if (image && (image.projectId !== projectId || image.kind !== 'image' || !existsSync(assetAbsPath(projectId, image.path)))) {
      throw new Error(t('Gambar latar thumbnail sudah tidak ada. Silakan pilih gambar lain.'))
    }
    const server = await startFileServer()
    try {
      const props: ThumbnailProps = {
        spec,
        imageSrc: image ? `${server.origin}asset/${encodeURIComponent(projectId)}/${image.path.split(/[\\/]/).map(encodeURIComponent).join('/')}` : null,
        color: p.background.color,
        ...thumbnailSize(p.aspect),
        fontBase: `${server.origin}fonts/`
      }
      await renderThumbnail({ props, outPath, signal: ctx.signal })
    } finally {
      await server.close()
    }
    return outPath
  })
}

export function registerPublishIpc(): void {
  handle('publish', 'facts', (projectId) => publishFacts(getProject(projectId)))
  handle('publish', 'frame', (projectId, assetId, ms) => frame(projectId, assetId, ms))
  handle('publish', 'thumbnail', (projectId, saveAs) => thumbnail(projectId, saveAs))
  handle('publish', 'generate', (projectId, platforms) => generate(projectId, platforms.filter((id) => PLATFORMS.some((p) => p.id === id))))
  handle('publish', 'saveText', async (defaultName, text) => {
    const opts = { title: t('Simpan teks publikasi'), defaultPath: join(ensureFolder(getSettings().exportFolder), safeName(defaultName)), filters: [{ name: t('Teks'), extensions: ['txt'] }] }
    const win = BrowserWindow.getFocusedWindow()
    const r = win ? await dialog.showSaveDialog(win, opts) : await dialog.showSaveDialog(opts)
    if (r.canceled || !r.filePath) return null
    writeFileSync(r.filePath, text, 'utf8')
    return r.filePath
  })
  handle('app', 'copyText', (text) => clipboard.writeText(text))
}
