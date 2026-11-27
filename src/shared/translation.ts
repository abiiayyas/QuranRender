import { segmentVerseKey } from './dua'
import { msg } from './i18n'
import type { Segment, SegmentTranslation, TranslationStatus } from './types'

/** The bundled edition; it cannot be removed. */
export const KEMENAG = 'id.kemenag'

/** Edition ids start with their language code: `id.kemenag`, `en.qdc20`. */
export const editionLanguage = (editionId: string): string => editionId.split('.')[0] ?? ''

/** Isti'adzah is not an ayah, so no edition has it. Languages without an entry fall back to Indonesian, marked for review. */
const ISTIADZAH: Record<string, string> = {
  id: 'Aku berlindung kepada Allah dari setan yang terkutuk.',
  en: 'I seek refuge with Allah from the accursed Satan.'
}

/** Only used when the edition has no 1:1 text loaded. */
const BASMALAH: Record<string, string> = {
  id: 'Dengan nama Allah Yang Maha Pengasih, Maha Penyayang.',
  en: 'In the name of Allah, the Entirely Merciful, the Especially Merciful.'
}

export const STATUS_LABEL: Record<TranslationStatus, string> = {
  full: msg('Utuh'),
  auto: msg('Dipotong otomatis'),
  ai: msg('Dipotong AI'),
  manual: msg('Diedit'),
  review: msg('Perlu dicek')
}

/**
 * Strips Quran.com markup: footnote markers (`<sup foot_note=..>1</sup>`, possibly nested by a broken source), other tags
 * (`<span>`, `<i>`, `<a>`, `<div>`) keeping their text, plain footnote digits glued to a word ("Tuhan3"), and entities.
 * Some sources put tags between words without spaces ("kill<sup>1</sup>Allah"), so every tag counts as a word break.
 */
export function cleanTranslation(raw: string): string {
  let s = raw
  // Innermost first, so a marker nested inside another marker's attributes collapses on the next pass.
  for (let prev = ''; prev !== s; ) {
    prev = s
    s = s.replace(/<sup\b[^<>]*>[^<]*<\/sup>/gi, ' ')
  }
  s = s
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&quot;/g, '"')
    .replace(/&apos;|&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#(\d+);/g, (_m, n: string) => String.fromCodePoint(Number(n)))
    .replace(/&amp;/g, '&')
  return s
    .replace(/(\p{Ll})\d+(?=[\s,.;:!?]|$)/gu, '$1')
    .replace(/\s+/g, ' ')
    .replace(/ ([,.;:!?)\]”])/g, '$1')
    .trim()
}

/** True for an ayah or dua segment that shows only part of its text. */
export function isPartial(seg: Pick<Segment, 'kind' | 'wordFrom' | 'wordTo'>, verseWordCount: number): boolean {
  if ((seg.kind !== 'ayah' && seg.kind !== 'dua') || verseWordCount <= 0) return false
  return seg.wordFrom > 1 || (seg.wordTo > 0 && seg.wordTo < verseWordCount)
}

/** Ends a phrase: a preferred place to cut. */
function endsPhrase(token: string): boolean {
  return /[,.;:!?—–\-،؛]$/.test(token.replace(/["'”’)\]»]+$/, '')) || /[)\]]$/.test(token)
}

/**
 * Cuts a whole-ayah translation for Arabic words `from..to` (1-based, inclusive) of `total`. The cut point is proportional
 * to the translation length, moved to the nearest phrase punctuation when close enough. Consecutive ranges share their
 * boundary, so the pieces join without gaps or overlap. `confident` is false when a boundary had no punctuation nearby.
 */
export function autoTrim(full: string, from: number, to: number, total: number): { text: string; confident: boolean } {
  const tokens = full.split(/\s+/).filter(Boolean)
  if (tokens.length === 0 || total <= 0) return { text: tokens.join(' '), confident: false }
  const a = Math.min(Math.max(from, 1), total)
  const b = Math.min(Math.max(to, a), total)
  const m = tokens.length
  const starts: number[] = []
  let pos = 0
  for (const t of tokens) {
    starts.push(pos)
    pos += [...t].length + 1
  }
  const totalChars = Math.max(0, pos - 1)
  let confident = true

  const boundary = (words: number): number => {
    if (words <= 0) return 0
    if (words >= total) return m
    const target = (totalChars * words) / total
    // "Close enough" for punctuation: 1.2× the average translation length per Arabic word, at least 12 characters.
    const window = Math.max((totalChars / total) * 1.2, 12)
    const dist = (i: number): number => Math.abs(starts[i] - target)
    let nearest = m
    let phrase = -1
    for (let i = 1; i < m; i++) {
      if (nearest === m || dist(i) < dist(nearest)) nearest = i
      if (endsPhrase(tokens[i - 1]) && dist(i) <= window && (phrase < 0 || dist(i) < dist(phrase))) phrase = i
    }
    if (phrase >= 0) return phrase
    confident = false
    return nearest
  }

  let s = boundary(a - 1)
  let e = boundary(b)
  if (s >= e) {
    // Too short to divide: one token at the proportional position.
    s = Math.min(Math.floor(((a - 1) / total) * m), m - 1)
    e = s + 1
    confident = false
  }
  return { text: tokens.slice(s, e).join(' '), confident }
}

function withEntry(seg: Segment, entry: SegmentTranslation): Segment {
  const i = seg.translations.findIndex((t) => t.edition === entry.edition)
  const cur = seg.translations[i]
  if (cur && cur.text === entry.text && cur.status === entry.status) return seg
  const translations = i < 0 ? [...seg.translations, entry] : seg.translations.map((t, j) => (j === i ? entry : t))
  return { ...seg, translations }
}

/**
 * Makes sure every segment has an entry for `editionId`. `texts` holds whole-ayah texts keyed `s:a` (plus `1:1` when a
 * basmalah segment exists); `verseWordCounts` the canonical word count per ayah. Manual edits are kept everywhere, AI cuts
 * on partial segments too; everything else is recomputed. Unchanged segments keep their identity.
 */
export function fillTranslations(
  segments: Segment[],
  editionId: string,
  texts: Record<string, string>,
  verseWordCounts: Record<string, number>
): Segment[] {
  const lang = editionLanguage(editionId)
  return segments.map((seg) => {
    const cur = seg.translations.find((t) => t.edition === editionId)
    if (cur?.status === 'manual' && cur.text.trim() !== '') return seg
    const put = (text: string, status: TranslationStatus): Segment => withEntry(seg, { edition: editionId, text, status })

    if (seg.kind === 'istiadzah') {
      const text = ISTIADZAH[lang]
      return text ? put(text, 'full') : put(ISTIADZAH.id, 'review')
    }
    if (seg.kind === 'basmalah') {
      const text = texts['1:1'] || BASMALAH[lang]
      return text ? put(text, 'full') : seg
    }

    const key = segmentVerseKey(seg)
    const full = texts[key]
    const count = verseWordCounts[key]
    if (!full || !count) return seg
    if (!isPartial(seg, count)) return put(full, 'full')
    if (cur?.status === 'ai' && cur.text.trim() !== '') return seg
    const cut = autoTrim(full, seg.wordFrom, seg.wordTo > 0 ? seg.wordTo : count, count)
    return cut.confident ? put(cut.text, 'auto') : put(full, 'review')
  })
}

/**
 * Accepts an AI cut only when it is a piece of the full translation: compared without case, punctuation and spacing,
 * since models sometimes drop a comma or bracket. Returns the cleaned fragment, or null.
 */
export function acceptFragment(fragment: unknown, full: string): string | null {
  if (typeof fragment !== 'string') return null
  const text = fragment.replace(/\s+/g, ' ').trim()
  if (!text) return null
  const norm = (s: string): string =>
    s
      .normalize('NFD')
      .replace(/\p{M}/gu, '')
      .toLocaleLowerCase()
      .replace(/[^\p{L}\p{N}]+/gu, ' ')
      .trim()
  const f = norm(text)
  if (!f) return null
  return ` ${norm(full)} `.includes(` ${f} `) ? text : null
}
