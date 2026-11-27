import { msg, t } from './i18n'

export type PlatformId = 'shorts' | 'tiktok' | 'reels' | 'youtube'

export interface Platform {
  id: PlatformId
  label: string
  hint: string
  /** Platforms without a separate title (TikTok, Reels) post one caption. */
  hasTitle: boolean
  titleMax: number
  /** Limit of the pasted text: the whole description (YouTube) or caption (TikTok, Reels). */
  textMax: number
  /** Added by the platform itself, so it is added to the pasted text but not asked from the user. */
  autoTag: string | null
}

export const PLATFORMS: Platform[] = [
  { id: 'shorts', label: 'YouTube Shorts', hint: msg('Judul pendek dan deskripsi untuk video vertikal.'), hasTitle: true, titleMax: 100, textMax: 5000, autoTag: '#Shorts' },
  { id: 'tiktok', label: 'TikTok', hint: msg('Satu keterangan pendek dengan beberapa hashtag.'), hasTitle: false, titleMax: 0, textMax: 2200, autoTag: null },
  { id: 'reels', label: 'Reels (FB/IG)', hint: msg('Satu keterangan untuk Reels Facebook dan Instagram.'), hasTitle: false, titleMax: 0, textMax: 2200, autoTag: null },
  { id: 'youtube', label: 'YouTube', hint: msg('Judul, deskripsi, bab, dan hashtag untuk video panjang.'), hasTitle: true, titleMax: 100, textMax: 5000, autoTag: null }
]

export const platformOf = (id: PlatformId): Platform => PLATFORMS.find((p) => p.id === id)!

export interface PublishDraft {
  title: string
  body: string
  /** Space-separated, each starting with #. */
  hashtags: string
}

export type PublishKit = Partial<Record<PlatformId, PublishDraft>>

/** Facts the drafts are written from. Nothing in them is Arabic text. */
export interface PublishFacts {
  surahName: string
  /** "1–7", "255", or '' when the project has no range. */
  ayahLabel: string
  /** Set when the project uses an OpenDua supplication. */
  duaTitle?: string | null
  /** Required CC BY 4.0 attribution line for OpenDua. */
  duaCredit?: string | null
  reciter: string
  translationName: string | null
  /** Where the recording came from, when the app knows it. */
  audioSource: string | null
  /** Credit for a stock photo or video used as the background ("Foto oleh Ana di Pexels"); null for AI images and own files. */
  backgroundCredit?: string | null
}

/** "Al-Fatihah" becomes "AlFatihah": hashtags cannot hold punctuation or spaces. */
export function hashtagOf(text: string): string {
  const word = text
    .replace(/[’'`‘]/g, '')
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean)
    .map((w) => w[0].toUpperCase() + w.slice(1))
    .join('')
  return word ? `#${word}` : ''
}

export function hashtagList(text: string): string[] {
  return [...new Set(text.split(/\s+/).filter((w) => w.startsWith('#') && w.length > 1))]
}

export const AUDIO_SOURCE_NAME: Record<string, string> = { mp3quran: 'MP3Quran', qdc: 'Quran.com', opendua: 'OpenDua (CC BY 4.0)' }

/** The first draft, written without AI: facts and attribution only, so it is always correct and always available. */
export function draftFor(platform: PlatformId, f: PublishFacts): PublishDraft {
  const p = platformOf(platform)
  const reciter = f.reciter.trim()
  if (f.duaTitle) {
    const what = f.duaTitle
    const lines = [reciter ? t('Doa {what} oleh {reciter}.', { what, reciter }) : t('Doa {what}.', { what })]
    if (platform === 'youtube') lines.push(t('Teks Arab ditampilkan apa adanya, lengkap dengan terjemahan.'))
    const credits = [
      f.translationName ? t('Terjemahan: {name}.', { name: f.translationName }) : '',
      f.duaCredit?.trim() ? t('Sumber audio & teks: {credit}.', { credit: f.duaCredit.trim() }) : f.audioSource ? t('Sumber audio: {name}.', { name: f.audioSource }) : '',
      f.backgroundCredit?.trim() ? t('Latar: {credit}.', { credit: f.backgroundCredit.trim() }) : ''
    ].filter(Boolean)
    const tags = [t('#Doa'), t('#Dzikir'), hashtagOf(f.reciter)].filter(Boolean)
    return {
      title: p.hasTitle ? (reciter ? t('{what} oleh {reciter}', { what, reciter }) : what).slice(0, p.titleMax) : '',
      body: [lines.join(' '), credits.join(' ')].filter(Boolean).join('\n\n'),
      hashtags: [...new Set(tags)].join(' ')
    }
  }
  const range = /[–-]/.test(f.ayahLabel)
  const what = f.ayahLabel ? t('QS {surah} ayat {ayah}', { surah: f.surahName, ayah: f.ayahLabel, n: range ? 2 : 1 }) : t('QS {surah}', { surah: f.surahName })
  const lines = [reciter ? t('Tilawah {what} oleh {reciter}.', { what, reciter }) : t('Tilawah {what}.', { what })]
  if (platform === 'youtube') lines.push(t('Teks Arab ditampilkan apa adanya, lengkap dengan terjemahan dan sorotan per kata.'))
  const credits = [
    f.translationName ? t('Terjemahan: {name}.', { name: f.translationName }) : '',
    f.audioSource ? t('Sumber audio: {name}.', { name: f.audioSource }) : '',
    f.backgroundCredit?.trim() ? t('Latar: {credit}.', { credit: f.backgroundCredit.trim() }) : ''
  ].filter(Boolean)
  const tags = [t('#Quran'), t('#Tilawah'), hashtagOf(f.surahName), hashtagOf(f.reciter)].filter(Boolean)
  return {
    title: p.hasTitle ? (reciter ? t('{what} oleh {reciter}', { what, reciter }) : what).slice(0, p.titleMax) : '',
    body: [lines.join(' '), credits.join(' ')].filter(Boolean).join('\n\n'),
    hashtags: [...new Set(tags)].join(' ')
  }
}

/** AI-written bodies are free text; the stock credit must still be in them, so it is appended when the AI left it out. */
export function withBackgroundCredit(d: PublishDraft, credit: string | null | undefined): PublishDraft {
  const c = credit?.trim()
  if (!c || d.body.includes(c)) return d
  return { ...d, body: [d.body.trim(), t('Latar: {credit}.', { credit: c })].filter(Boolean).join('\n\n') }
}

/** Ensures OpenDua CC BY 4.0 attribution stays in AI-written upload copy. */
export function withDuaCredit(d: PublishDraft, credit: string | null | undefined): PublishDraft {
  const c = credit?.trim()
  if (!c || d.body.includes(c)) return d
  return { ...d, body: [d.body.trim(), t('Sumber audio & teks: {credit}.', { credit: c })].filter(Boolean).join('\n\n') }
}

/** What the user pastes into the platform's description (or caption) box. */
export function pastedText(platform: PlatformId, d: PublishDraft, chapters: string[] = []): string {
  const p = platformOf(platform)
  const tags = hashtagList(d.hashtags)
  if (p.autoTag && !tags.some((x) => x.toLowerCase() === p.autoTag!.toLowerCase())) tags.push(p.autoTag)
  // YouTube needs at least three chapters, the first at 0:00, to show them in the player.
  const chapterBlock = platform === 'youtube' && chapters.length >= 3 ? `${t('Bab:')}\n${chapters.join('\n')}` : ''
  return [d.body.trim(), chapterBlock, tags.join(' ')].filter(Boolean).join('\n\n')
}

/** The whole kit as one .txt, in the order a person fills in the upload form. */
export function kitAsText(kit: PublishKit, chaptersOf: (id: PlatformId) => string[]): string {
  return PLATFORMS.filter((p) => kit[p.id])
    .map((p) => {
      const d = kit[p.id]!
      return [`=== ${p.label} ===`, p.hasTitle ? `${t('Judul:')}\n${d.title}\n` : '', `${p.hasTitle ? t('Deskripsi:') : t('Keterangan:')}\n${pastedText(p.id, d, chaptersOf(p.id))}`].filter(Boolean).join('\n')
    })
    .join('\n\n')
}

const ARABIC = /[\u0600-\u06FF\u0750-\u077F\uFB50-\uFDFF\uFE70-\uFEFF]/

/**
 * Turns an AI reply into drafts. Anything with Arabic letters is dropped for that platform (the AI never writes or
 * quotes the Qur'an), text is cut to the platform's limits, and hashtags are cleaned. Platforms the reply lacks or
 * breaks keep `fallback`.
 */
export function sanitizeKit(raw: unknown, platforms: PlatformId[], fallback: (id: PlatformId) => PublishDraft): PublishKit {
  const obj = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {}
  const out: PublishKit = {}
  for (const id of platforms) {
    const p = platformOf(id)
    const r = obj[id] as Partial<Record<keyof PublishDraft, unknown>> | undefined
    const ok = !!r && typeof r.body === 'string' && r.body.trim() !== '' && (!p.hasTitle || (typeof r.title === 'string' && r.title.trim() !== ''))
    const text = ok ? [r!.title, r!.body, r!.hashtags].map((x) => (typeof x === 'string' ? x : '')).join(' ') : ''
    if (!ok || ARABIC.test(text)) {
      out[id] = fallback(id)
      continue
    }
    const tags = hashtagList(typeof r!.hashtags === 'string' ? r!.hashtags : '').slice(0, 8)
    out[id] = {
      title: p.hasTitle ? String(r!.title).trim().slice(0, p.titleMax) : '',
      body: String(r!.body).trim().slice(0, p.textMax),
      hashtags: tags.length > 0 ? tags.join(' ') : fallback(id).hashtags
    }
  }
  return out
}
