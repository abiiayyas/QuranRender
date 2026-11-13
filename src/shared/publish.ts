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
  { id: 'shorts', label: 'YouTube Shorts', hint: 'Judul pendek dan deskripsi untuk video vertikal.', hasTitle: true, titleMax: 100, textMax: 5000, autoTag: '#Shorts' },
  { id: 'tiktok', label: 'TikTok', hint: 'Satu keterangan pendek dengan beberapa hashtag.', hasTitle: false, titleMax: 0, textMax: 2200, autoTag: null },
  { id: 'reels', label: 'Reels (FB/IG)', hint: 'Satu keterangan untuk Reels Facebook dan Instagram.', hasTitle: false, titleMax: 0, textMax: 2200, autoTag: null },
  { id: 'youtube', label: 'YouTube', hint: 'Judul, deskripsi, bab, dan hashtag untuk video panjang.', hasTitle: true, titleMax: 100, textMax: 5000, autoTag: null }
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
  reciter: string
  translationName: string | null
  /** Where the recording came from, when the app knows it. */
  audioSource: string | null
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
  return [...new Set(text.split(/\s+/).filter((t) => t.startsWith('#') && t.length > 1))]
}

export const AUDIO_SOURCE_NAME: Record<string, string> = { mp3quran: 'MP3Quran', qdc: 'Quran.com' }

/** The first draft, written without AI: facts and attribution only, so it is always correct and always available. */
export function draftFor(platform: PlatformId, f: PublishFacts): PublishDraft {
  const p = platformOf(platform)
  const what = `QS ${f.surahName}${f.ayahLabel ? ` ayat ${f.ayahLabel}` : ''}`
  const by = f.reciter.trim() ? ` oleh ${f.reciter.trim()}` : ''
  const lines = [`Tilawah ${what}${by}.`]
  if (platform === 'youtube') lines.push('Teks Arab ditampilkan apa adanya, lengkap dengan terjemahan dan sorotan per kata.')
  const credits = [f.translationName ? `Terjemahan: ${f.translationName}.` : '', f.audioSource ? `Sumber audio: ${f.audioSource}.` : ''].filter(Boolean)
  const tags = ['#Quran', '#Tilawah', hashtagOf(f.surahName), hashtagOf(f.reciter)].filter(Boolean)
  return {
    title: p.hasTitle ? `${what}${by}`.slice(0, p.titleMax) : '',
    body: [lines.join(' '), credits.join(' ')].filter(Boolean).join('\n\n'),
    hashtags: [...new Set(tags)].join(' ')
  }
}

/** What the user pastes into the platform's description (or caption) box. */
export function pastedText(platform: PlatformId, d: PublishDraft, chapters: string[] = []): string {
  const p = platformOf(platform)
  const tags = hashtagList(d.hashtags)
  if (p.autoTag && !tags.some((t) => t.toLowerCase() === p.autoTag!.toLowerCase())) tags.push(p.autoTag)
  // YouTube needs at least three chapters, the first at 0:00, to show them in the player.
  const chapterBlock = platform === 'youtube' && chapters.length >= 3 ? `Bab:\n${chapters.join('\n')}` : ''
  return [d.body.trim(), chapterBlock, tags.join(' ')].filter(Boolean).join('\n\n')
}

/** The whole kit as one .txt, in the order a person fills in the upload form. */
export function kitAsText(kit: PublishKit, chaptersOf: (id: PlatformId) => string[]): string {
  return PLATFORMS.filter((p) => kit[p.id])
    .map((p) => {
      const d = kit[p.id]!
      return [`=== ${p.label} ===`, p.hasTitle ? `Judul:\n${d.title}\n` : '', `${p.hasTitle ? 'Deskripsi' : 'Keterangan'}:\n${pastedText(p.id, d, chaptersOf(p.id))}`].filter(Boolean).join('\n')
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
