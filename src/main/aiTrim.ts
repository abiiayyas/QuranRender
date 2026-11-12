import { segmentArabic } from '@shared/subtitles'
import { acceptFragment, editionLanguage, isPartial } from '@shared/translation'
import type { Job, Segment, SegmentTranslation, Verse } from '@shared/types'
import { chat } from './ai'
import { startJob } from './jobs'
import { getVerses } from './quran'
import { getProject, patchProject } from './repo'
import { editionVerses } from './translations'

const BATCH = 8

const SYSTEM_PROMPT = `You align Quran translations to partial recitation segments. Each item gives the Arabic words of ONE segment of an ayah, the full Arabic ayah, and the full translation of that ayah. For every item, return the part of its translation that corresponds to the segment's Arabic words. Copy wording verbatim from the given translation (keep its language, spelling and punctuation); do not paraphrase, add commentary, or translate yourself. Prefer cutting at natural phrase boundaries. Never return an empty fragment. Reply with ONLY a JSON object {"fragments": [{"id": "<item id>", "fragment": "..."}]} that covers every item.`

interface Item {
  seg: Segment
  full: string
  arabicFull: string
  arabicPart: string
  count: number
}

function parseFragments(reply: string): Map<string, unknown> {
  const out = new Map<string, unknown>()
  const start = reply.indexOf('{')
  const end = reply.lastIndexOf('}')
  if (start < 0 || end <= start) return out
  try {
    const obj = JSON.parse(reply.slice(start, end + 1)) as { fragments?: { id?: unknown; fragment?: unknown }[] }
    for (const f of Array.isArray(obj.fragments) ? obj.fragments : []) out.set(String(f.id), f.fragment)
  } catch {
    // An unreadable reply leaves every item of the batch for review.
  }
  return out
}

/** Verses (bundled Kemenag script: offline, canonical word count) for every ayah the segments show. */
async function versesFor(segments: Segment[]): Promise<Record<string, Verse>> {
  const spans = new Map<number, [number, number]>()
  for (const s of segments) {
    const cur = spans.get(s.surah)
    spans.set(s.surah, cur ? [Math.min(cur[0], s.ayah), Math.max(cur[1], s.ayah)] : [s.ayah, s.ayah])
  }
  const out: Record<string, Verse> = {}
  for (const [surah, [from, to]] of spans) for (const v of await getVerses(surah, from, to, 'kemenag')) out[`${v.surah}:${v.ayah}`] = v
  return out
}

export function startAiTrim(projectId: string, editionId: string, segmentIds?: string[]): Job {
  return startJob(projectId, 'aitrim', 'net', async (ctx) => {
    const project = getProject(projectId)
    const ayahs = project.segments.filter((s) => s.kind === 'ayah' && (!segmentIds || segmentIds.includes(s.id)))
    const verses = await versesFor(ayahs)
    const texts: Record<string, string> = {}
    for (const s of new Set(ayahs.map((a) => a.surah))) {
      const list = ayahs.filter((a) => a.surah === s).map((a) => a.ayah)
      Object.assign(texts, editionVerses(editionId, s, Math.min(...list), Math.max(...list)))
    }

    const items: Item[] = []
    for (const seg of ayahs) {
      const key = `${seg.surah}:${seg.ayah}`
      const verse = verses[key]
      const full = texts[key]
      if (!verse || !full || !isPartial(seg, verse.words.length)) continue
      // Without explicit ids, the user's own and earlier AI cuts stay as they are.
      const status = seg.translations.find((t) => t.edition === editionId)?.status
      if (!segmentIds && (status === 'manual' || status === 'ai')) continue
      items.push({ seg, full, arabicFull: verse.words.filter(Boolean).join(' '), arabicPart: segmentArabic(seg, verses), count: verse.words.length })
    }
    if (items.length === 0) return 'Tidak ada ayat terpotong yang perlu dipotong AI.'

    const results = new Map<string, SegmentTranslation>()
    const apply = (): void => {
      // Re-read: the user may have edited (and autosaved) while the model was working.
      const latest = getProject(projectId)
      const segments = latest.segments.map((s) => {
        const r = results.get(s.id)
        if (!r) return s
        const cur = s.translations.find((t) => t.edition === editionId)
        if (cur?.status === 'manual' && !segmentIds) return s
        return { ...s, translations: cur ? s.translations.map((t) => (t.edition === editionId ? r : t)) : [...s.translations, r] }
      })
      patchProject(projectId, { segments })
    }

    const language = editionLanguage(editionId)
    try {
      for (let i = 0; i < items.length; i += BATCH) {
        ctx.progress(i / items.length, `Memotong ${i + 1}–${Math.min(i + BATCH, items.length)} dari ${items.length} segmen`)
        const batch = items.slice(i, i + BATCH)
        const payload = {
          translation_language: language,
          items: batch.map((it, j) => ({
            id: String(j + 1),
            verse: `${it.seg.surah}:${it.seg.ayah}`,
            segment_words: `${it.seg.wordFrom}-${it.seg.wordTo} of ${it.count}`,
            segment_arabic: it.arabicPart,
            full_ayah_arabic: it.arabicFull,
            full_translation: it.full
          }))
        }
        const chars = batch.reduce((n, it) => n + it.full.length, 0)
        const reply = await chat(
          [
            { role: 'system', content: SYSTEM_PROMPT },
            { role: 'user', content: JSON.stringify(payload) }
          ],
          { signal: ctx.signal, json: true, maxTokens: Math.min(4096, 256 + chars) }
        )
        const fragments = parseFragments(reply)
        batch.forEach((it, j) => {
          const text = acceptFragment(fragments.get(String(j + 1)), it.full)
          results.set(it.seg.id, text ? { edition: editionId, text, status: 'ai' } : { edition: editionId, text: it.full, status: 'review' })
        })
      }
    } catch (e) {
      // Keep what finished before the failure or cancel.
      if (results.size > 0) apply()
      throw e
    }
    apply()
    const review = [...results.values()].filter((r) => r.status === 'review').length
    return review > 0
      ? `${results.size - review} segmen dipotong AI, ${review} perlu dicek manual.`
      : `${results.size} segmen dipotong AI. Silakan periksa hasilnya.`
  })
}
