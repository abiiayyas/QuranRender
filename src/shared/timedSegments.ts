import type { Segment, WordTiming } from './types'

/** One ayah as the provider timed it. `words` keeps recitation order, so a repeated stretch shows up again. */
export interface AyahTiming {
  ayah: number
  startMs: number
  endMs: number
  words: WordTiming[]
}

export interface ProviderTiming {
  ayahs: AyahTiming[]
  /** Audio before ayah 1 the provider timed on its own (MP3Quran "ayah 0"). */
  intro: { startMs: number; endMs: number } | null
}

/** api.qurancdn.com audio_files?segments=true → verse_timings[] */
export interface QdcVerseTiming {
  verse_key: string
  timestamp_from: number
  timestamp_to: number
  /** [wordPosition, startMs, endMs]; the last entry of a verse sometimes lacks endMs. */
  segments?: (number | null)[][] | null
}

/** mp3quran.net/api/v3/ayat_timing → [] */
export interface Mp3QuranAyahTiming {
  ayah: number
  start_time: number
  end_time: number
}

const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)

export function parseQdc(list: QdcVerseTiming[]): ProviderTiming {
  const ayahs: AyahTiming[] = []
  for (const v of list) {
    const ayah = Number(v.verse_key.split(':')[1])
    if (!Number.isInteger(ayah) || !finite(v.timestamp_from) || !finite(v.timestamp_to)) continue
    const startMs = v.timestamp_from
    const endMs = Math.max(startMs, v.timestamp_to)
    const raw = (v.segments ?? []).filter((s) => finite(s[0]) && s[0] >= 1 && finite(s[1]))
    const words = raw.map((s, i): WordTiming => {
      const start = clamp(s[1] as number, startMs, endMs)
      const next = raw[i + 1]?.[1]
      const end = finite(s[2]) ? s[2] : finite(next) ? next : endMs
      return { idx: s[0] as number, startMs: start, endMs: clamp(end, start, endMs) }
    })
    ayahs.push({ ayah, startMs, endMs, words })
  }
  return { ayahs: ayahs.sort((a, b) => a.ayah - b.ayah), intro: null }
}

export function parseMp3Quran(list: Mp3QuranAyahTiming[]): ProviderTiming {
  let intro: ProviderTiming['intro'] = null
  const ayahs: AyahTiming[] = []
  for (const t of list) {
    if (!finite(t.ayah) || !finite(t.start_time) || !finite(t.end_time)) continue
    const span = { startMs: t.start_time, endMs: Math.max(t.start_time, t.end_time) }
    if (t.ayah === 0) {
      if (span.endMs > span.startMs) intro = span
    } else ayahs.push({ ayah: t.ayah, ...span, words: [] })
  }
  return { ayahs: ayahs.sort((a, b) => a.ayah - b.ayah), intro }
}

/** Shorter lead-in before ayah 1 is a breath or silence, not a basmalah. */
export const INTRO_MIN_MS = 3000

export interface TimedCut {
  /** Where to cut the provider file; segments are relative to it. */
  startMs: number
  /** null = keep to the end of the file. */
  endMs: number | null
  segments: Segment[]
}

/**
 * Segments for ayahs `from..to` of a timed provider file, shifted so the cut start is 0. An ayah whose words jump back
 * (the reciter repeats a stretch) becomes one segment per run, each with its own word range.
 */
export function buildTimedSegments(
  t: ProviderTiming,
  o: {
    surah: number
    from: number
    to: number
    source: 'qdc' | 'mp3quran'
    /** Canonical word count of an ayah of `surah`. */
    wordCount: (ayah: number) => number
    newId: () => string
  }
): TimedCut {
  const picked = t.ayahs.filter((a) => a.ayah >= o.from && a.ayah <= o.to).map((a) => ({ ...a, words: a.words.slice() }))
  if (picked.length === 0 || picked[0].ayah !== o.from || picked[picked.length - 1].ayah !== o.to) {
    throw new Error('Waktu ayat dari penyedia tidak lengkap untuk rentang ini.')
  }
  const segments: Segment[] = []
  const base = { confidence: 1, source: o.source, translations: [] }

  if (o.from === 1 && o.surah !== 1 && o.surah !== 9) {
    const first = picked[0]
    const lead = first.words[0]?.startMs ?? first.startMs
    const intro = t.intro ?? (lead >= INTRO_MIN_MS ? { startMs: 0, endMs: lead } : null)
    if (intro) {
      segments.push({ ...base, id: o.newId(), kind: 'basmalah', surah: 0, ayah: 0, wordFrom: 0, wordTo: 0, ...intro, words: [] })
      first.startMs = Math.max(first.startMs, intro.endMs)
    }
  }

  for (const a of picked) {
    const count = o.wordCount(a.ayah)
    const words = a.words.filter((w) => w.idx <= count)
    const runs: WordTiming[][] = []
    for (const w of words) {
      const run = runs[runs.length - 1]
      if (run && w.idx > run[run.length - 1].idx) run.push(w)
      else runs.push([w])
    }
    if (runs.length === 0) {
      segments.push({ ...base, id: o.newId(), kind: 'ayah', surah: o.surah, ayah: a.ayah, wordFrom: 1, wordTo: count, startMs: a.startMs, endMs: a.endMs, words: [] })
      continue
    }
    runs.forEach((run, i) => {
      const last = i === runs.length - 1
      const startMs = i === 0 ? a.startMs : run[0].startMs
      const endMs = last ? a.endMs : runs[i + 1][0].startMs
      segments.push({
        ...base,
        id: o.newId(),
        kind: 'ayah',
        surah: o.surah,
        ayah: a.ayah,
        wordFrom: i === 0 ? 1 : run[0].idx,
        wordTo: last ? count : run[run.length - 1].idx,
        startMs,
        endMs,
        words: run.map((w) => ({ idx: w.idx, startMs: clamp(w.startMs, startMs, endMs), endMs: clamp(w.endMs, startMs, endMs) }))
      })
    })
  }

  const startMs = o.from === 1 ? 0 : picked[0].startMs
  const endMs = t.ayahs.some((a) => a.ayah > o.to) ? picked[picked.length - 1].endMs : null
  return { startMs, endMs, segments: shiftSegments(segments, startMs, endMs ?? Infinity) }
}

/**
 * Segments for audio cut to [inMs, outMs]: times shift by -inMs, segments fully outside are dropped and partial ones
 * (and their words) are clamped.
 */
export function shiftSegments(segments: Segment[], inMs: number, outMs: number): Segment[] {
  const len = outMs - inMs
  const out: Segment[] = []
  for (const s of segments) {
    if (s.endMs <= inMs || s.startMs >= outMs) continue
    const startMs = clamp(s.startMs - inMs, 0, len)
    const endMs = clamp(s.endMs - inMs, startMs, len)
    const words = s.words
      .filter((w) => w.endMs > inMs && w.startMs < outMs)
      .map((w) => {
        const ws = clamp(w.startMs - inMs, startMs, endMs)
        return { idx: w.idx, startMs: ws, endMs: clamp(w.endMs - inMs, ws, endMs) }
      })
    out.push({ ...s, startMs, endMs, words })
  }
  return out
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(Math.max(v, lo), hi)
}
