import { t, locale } from '@shared/i18n'
import { readFile } from 'node:fs/promises'
import { basename } from 'node:path'
import { newSegmentId, REVIEW_CONFIDENCE } from '@shared/segments'
import { alignerToCanonical } from '@shared/verses'
import type { Segment, SegmentKind, WordTiming } from '@shared/types'

/**
 * Client for the public HF Space `hetchyy/quranic-universal-aligner` (MIT). It recognizes the ayahs itself (no range
 * needed), times every word and marks basmalah / isti'adzah. Gradio protocol: upload the file, call
 * `process_audio_session` (returns an event id), then read its SSE stream until `complete` or `error`. Its words are
 * numbered as in Digital Khatt, which equals our canonical numbering except a few ayahs (`alignerToCanonical`).
 */
export const SPACE_URL = 'https://hetchyy-quranic-universal-aligner.hf.space'
const API = 'process_audio_session'
/** A long surah plus the shared GPU queue can take many minutes. */
const MAX_WAIT_MS = 60 * 60_000
/** The server sends heartbeats while it works; this long without any byte means the stream is dead. */
const IDLE_MS = 180_000
const CALL_TIMEOUT_MS = 60_000
/** FLAC mono 16 kHz is about 1 MB per minute of audio. */
const UPLOAD_TIMEOUT_MS = 15 * 60_000

export type AlignModel = 'base' | 'large'
export type AlignStage = 'uploading' | 'queued' | 'processing'

/** Same defaults as the Space's own UI. */
const OPTIONS = { minSilenceMs: 200, minSpeechMs: 1000, padMs: 100 }

// Response shape (unknown fields ignored) ---------------------------------------------------------------------

export interface AlignerWord {
  /** "s:a:w", 1-based; specials use "0:0:n". */
  location: string
  /** Seconds, relative to the segment's `time_from`. */
  start: number
  end: number
}

export interface AlignerSegment {
  /** Seconds from the start of the audio. */
  time_from: number
  time_to: number
  /** "s:a:w"; empty for specials. */
  ref_from?: string
  ref_to?: string
  confidence?: number
  has_missing_words?: boolean
  has_repeated_words?: boolean
  /** "quran" | "special" */
  kind?: string
  /** "Basmala" | "Isti'adha" for specials. */
  special_type?: string | null
  error?: unknown
  words?: AlignerWord[]
}

export interface AlignerResult {
  segments: AlignerSegment[]
  error?: unknown
}

// Errors --------------------------------------------------------------------------------------------------------

const offlineText = (): string => t('Tidak dapat terhubung ke layanan penyelaras online (Hugging Face Space). Periksa koneksi internet lalu coba lagi.')
const timeoutText = (): string => t('Layanan penyelaras (Hugging Face Space) tidak menanggapi dalam batas waktu. Silakan coba lagi beberapa saat lagi.')

function errorText(v: unknown): string | null {
  if (v == null) return null
  if (typeof v === 'string') return v.trim() || null
  return JSON.stringify(v)
}

/** Parsed JSON, or null when the body is not JSON. */
function parseJson(body: string): unknown {
  try {
    return JSON.parse(body)
  } catch {
    return null
  }
}

function field(v: unknown, key: string): unknown {
  return v && typeof v === 'object' && key in v ? (v as Record<string, unknown>)[key] : undefined
}

function statusError(status: number, body: string): Error {
  const v = parseJson(body)
  const detail = errorText(field(v, 'error')) ?? errorText(field(v, 'detail'))
  const base =
    status === 404
      ? t('Layanan penyelaras tidak ditemukan (Space mungkin dipindahkan atau dimatikan)')
      : status === 413
        ? t('Berkas audio terlalu besar untuk layanan penyelaras')
        : status === 429
          ? t('Layanan penyelaras sedang membatasi permintaan (kuota habis). Silakan coba lagi nanti')
          : status >= 502 && status <= 504
            ? t('Layanan penyelaras sedang tidak tersedia atau baru dinyalakan. Mohon tunggu 1–2 menit lalu coba lagi')
            : t('Layanan penyelaras menolak permintaan (HTTP {status})', { status })
  return new Error(detail ? `${base}: ${detail}` : `${base}.`)
}

/** fetch's own failures (DNS, refused, TLS) carry a cause code; timeouts arrive as TimeoutError. */
function networkError(e: unknown, outer: AbortSignal): unknown {
  if (outer.aborted || !(e instanceof Error)) return e
  if (e.name === 'TimeoutError') return new Error(timeoutText())
  if (e.name === 'TypeError' || field(e.cause, 'code')) return new Error(offlineText())
  return e
}

async function request(url: string, init: RequestInit, signal: AbortSignal, timeoutMs: number): Promise<Response> {
  try {
    return await fetch(url, { ...init, signal: AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]) })
  } catch (e) {
    throw networkError(e, signal)
  }
}

// Client --------------------------------------------------------------------------------------------------------

/** Uploads `file` (ideally FLAC mono 16 kHz) and returns the parsed result. */
export async function alignFile(
  file: string,
  model: AlignModel,
  signal: AbortSignal,
  onStage: (stage: AlignStage, message: string, elapsedMs: number) => void
): Promise<AlignerResult> {
  const bytes = await readFile(file)
  onStage('uploading', t('Mengunggah audio ({size} MB)…', { size: (bytes.length / 1_048_576).toLocaleString(locale(), { minimumFractionDigits: 1, maximumFractionDigits: 1 }) }), 0)
  const form = new FormData()
  form.append('files', new Blob([bytes]), basename(file))
  const up = await request(`${SPACE_URL}/gradio_api/upload`, { method: 'POST', body: form }, signal, UPLOAD_TIMEOUT_MS)
  const upBody = await up.text()
  if (!up.ok) throw statusError(up.status, upBody)
  const paths = parseJson(upBody)
  const serverPath = Array.isArray(paths) && typeof paths[0] === 'string' ? paths[0] : null
  if (!serverPath) throw new Error(t('Jawaban layanan penyelaras tidak dapat dibaca: unggahan tidak mengembalikan jalur berkas.'))

  onStage('queued', t('Menunggu giliran di server penyelaras…'), 0)
  const call = await request(
    `${SPACE_URL}/gradio_api/call/${API}`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        data: [
          { path: serverPath, meta: { _type: 'gradio.FileData' } },
          OPTIONS.minSilenceMs,
          OPTIONS.minSpeechMs,
          OPTIONS.padMs,
          model === 'large' ? 'Large' : 'Base',
          'GPU'
        ]
      })
    },
    signal,
    CALL_TIMEOUT_MS
  )
  const callBody = await call.text()
  if (!call.ok) throw statusError(call.status, callBody)
  const eventId = field(parseJson(callBody), 'event_id')
  if (typeof eventId !== 'string' || !eventId) throw new Error(t('Jawaban layanan penyelaras tidak dapat dibaca: panggilan tidak mengembalikan event_id.'))
  return await waitResult(eventId, signal, onStage)
}

async function waitResult(eventId: string, signal: AbortSignal, onStage: (stage: AlignStage, message: string, elapsedMs: number) => void): Promise<AlignerResult> {
  const idle = new AbortController()
  let idleTimer = setTimeout(() => idle.abort(), IDLE_MS)
  const started = Date.now()
  const res = await request(
    `${SPACE_URL}/gradio_api/call/${API}/${eventId}`,
    { headers: { accept: 'text/event-stream' } },
    AbortSignal.any([signal, idle.signal]),
    MAX_WAIT_MS
  ).catch((e) => {
    clearTimeout(idleTimer)
    throw idle.signal.aborted && !signal.aborted ? new Error(timeoutText()) : e
  })
  if (!res.ok || !res.body) {
    clearTimeout(idleTimer)
    throw statusError(res.status, await res.text())
  }
  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buf = ''
  try {
    for (;;) {
      const { done, value } = await reader.read()
      clearTimeout(idleTimer)
      idleTimer = setTimeout(() => idle.abort(), IDLE_MS)
      if (done) break
      buf += decoder.decode(value, { stream: true }).replace(/\r\n/g, '\n')
      let cut: number
      while ((cut = buf.indexOf('\n\n')) >= 0) {
        const block = buf.slice(0, cut)
        buf = buf.slice(cut + 2)
        const ev = parseSse(block)
        if (!ev) continue
        if (ev.event === 'complete') return parseComplete(ev.data)
        if (ev.event === 'error') {
          const raw = ev.data.trim()
          const reason = errorText(parseJson(raw)) ?? (raw && raw !== 'null' ? raw : null)
          throw new Error(
            reason
              ? t('Layanan penyelaras gagal memproses audio: {reason}', { reason })
              : t('Layanan penyelaras gagal memproses audio tanpa keterangan (kuota GPU bersama mungkin habis). Silakan coba lagi nanti.')
          )
        }
        const elapsed = Date.now() - started
        onStage('processing', t('Server sedang memproses audio… {time}', { time: minutesSeconds(elapsed) }), elapsed)
      }
    }
  } catch (e) {
    if (idle.signal.aborted && !signal.aborted) throw new Error(timeoutText())
    throw networkError(e, signal)
  } finally {
    clearTimeout(idleTimer)
    reader.cancel().catch(() => undefined)
  }
  throw new Error(t('Koneksi ke layanan penyelaras berakhir sebelum hasil tersedia. Silakan coba lagi.'))
}

function parseSse(block: string): { event: string; data: string } | null {
  let event = ''
  const data: string[] = []
  for (const line of block.split('\n')) {
    if (line.startsWith('event:')) event = line.slice(6).trim()
    else if (line.startsWith('data:')) data.push(line.slice(5).replace(/^ /, ''))
  }
  return event || data.length ? { event, data: data.join('\n') } : null
}

function minutesSeconds(ms: number): string {
  const s = Math.floor(ms / 1000)
  return s >= 60 ? t('{m} mnt {s} dtk', { m: Math.floor(s / 60), s: s % 60 }) : t('{s} dtk', { s })
}

function isSegment(v: unknown): v is AlignerSegment {
  return typeof field(v, 'time_from') === 'number' && typeof field(v, 'time_to') === 'number'
}

/** `data` of the `complete` event: Gradio's output array with the result object first. */
export function parseComplete(data: string): AlignerResult {
  const v = parseJson(data)
  const obj: unknown = Array.isArray(v) ? v[0] : v
  if (!obj || typeof obj !== 'object') throw new Error(t('Jawaban layanan penyelaras tidak dapat dibaca: hasil kosong atau bukan JSON.'))
  const raw = field(obj, 'segments')
  const segments = Array.isArray(raw) ? raw.filter(isSegment) : []
  const err = errorText(field(obj, 'error'))
  if (err && segments.length === 0) throw new Error(t('Layanan penyelaras gagal memproses audio: {reason}', { reason: err }))
  return { segments, error: field(obj, 'error') }
}

// Mapping to project segments -------------------------------------------------------------------------------

export interface AlignOutcome {
  segments: Segment[]
  /** First recognized surah and its ayah span (for projects without a range yet). */
  detected: { surah: number; from: number; to: number } | null
  warnings: string[]
}

/** "s:a:w" with the aligner's word number converted to the canonical one (specials "0:0:n" stay as they are). */
function parseLocation(s: string | undefined): [number, number, number] | null {
  const m = /^\s*(\d+):(\d+):(\d+)\s*$/.exec(s ?? '')
  if (!m) return null
  const [surah, ayah, w] = [+m[1], +m[2], +m[3]]
  return [surah, ayah, surah > 0 ? alignerToCanonical(surah, ayah, w) : w]
}

function specialKind(label: string | null | undefined): Exclude<SegmentKind, 'ayah'> | null {
  const n = (label ?? '').toLowerCase().replace(/[^a-z]/g, '')
  if (['basmala', 'basmalah', 'bismillah'].includes(n)) return 'basmalah'
  if (['istiadha', 'istiadhah', 'istiaza', 'istiadzah', 'taawwudh'].includes(n)) return 'istiadzah'
  return null
}

const ms = (sec: number): number => Math.round(Math.max(0, sec) * 1000)
const sec1 = (s: number): string => (locale() === 'id-ID' ? s.toFixed(1).replace('.', ',') : s.toFixed(1))

interface Part {
  surah: number
  ayah: number
  from: number
  to: number
  startMs: number
  endMs: number
  words: WordTiming[]
}

/**
 * Aligner result → project segments in time order: one per ayah part (an aligner segment spanning ayahs is cut at the
 * first word of each next ayah), plus basmalah / isti'adzah. `wordCount(s, a)` gives the canonical word count, or null
 * for an ayah that does not exist. Ends stretch to the next start so text stays on screen through pauses.
 */
export function mapAlignment(result: AlignerResult, wordCount: (surah: number, ayah: number) => number | null): AlignOutcome {
  const warnings: string[] = []
  const out: Segment[] = []
  const counts = new Map<string, number | null>()
  const count = (s: number, a: number): number | null => {
    const k = `${s}:${a}`
    if (!counts.has(k)) {
      const n = wordCount(s, a)
      counts.set(k, n)
      if (!n) warnings.push(t('Ayat {k} dari penyelaras tidak dikenali; bagiannya dilewati.', { k }))
    }
    return counts.get(k) ?? null
  }

  for (const seg of [...result.segments].sort((a, b) => a.time_from - b.time_from)) {
    const segStart = ms(seg.time_from)
    const segEnd = Math.max(segStart, ms(seg.time_to))
    const err = errorText(seg.error)
    if (err) {
      warnings.push(t('Bagian {from}–{to} dtk tidak dikenali penyelaras ({err}); silakan sinkronkan manual.', { from: sec1(seg.time_from), to: sec1(seg.time_to), err }))
      continue
    }
    // The segment model has no separate flag for skipped or repeated words; capping the confidence below the review
    // threshold makes such a segment show up in review like any other doubtful one.
    let confidence = Math.min(1, Math.max(0, seg.confidence ?? 0))
    if (seg.has_missing_words || seg.has_repeated_words) confidence = Math.min(confidence, REVIEW_CONFIDENCE - 0.01)
    const base = { confidence, source: 'aligner' as const, translations: [] }
    const timed = (w: AlignerWord, idx: number): WordTiming => {
      const startMs = Math.min(Math.max(segStart + ms(w.start), segStart), segEnd)
      return { idx, startMs, endMs: Math.min(Math.max(segStart + ms(w.end), startMs), segEnd) }
    }

    if (seg.kind === 'special') {
      const kind = specialKind(seg.special_type)
      if (!kind) {
        warnings.push(t('Bagian {from}–{to} dtk berisi bacaan khusus "{kind}" yang belum didukung; dilewati.', { from: sec1(seg.time_from), to: sec1(seg.time_to), kind: seg.special_type ?? '?' }))
        continue
      }
      const words = (seg.words ?? []).map((w, i) => timed(w, parseLocation(w.location)?.[2] || i + 1))
      out.push({ ...base, id: newSegmentId(), kind, surah: 0, ayah: 0, wordFrom: 0, wordTo: 0, startMs: segStart, endMs: segEnd, words: dedupe(words) })
      continue
    }

    const parts: Part[] = []
    const refFrom = parseLocation(seg.ref_from)
    const refTo = parseLocation(seg.ref_to)
    if (seg.words?.length) {
      for (const w of seg.words) {
        const loc = parseLocation(w.location)
        if (!loc) continue
        const [s, a, idx] = loc
        const tw = timed(w, idx)
        const last = parts.at(-1)
        if (last && last.surah === s && last.ayah === a) {
          last.from = Math.min(last.from, idx)
          last.to = Math.max(last.to, idx)
          // Two aligner words of one canonical word (Digital Khatt splits a few) become one timing.
          const prev = last.words.at(-1)
          if (prev && prev.idx === idx) prev.endMs = Math.max(prev.endMs, tw.endMs)
          else last.words.push(tw)
        } else parts.push({ surah: s, ayah: a, from: idx, to: idx, startMs: segStart, endMs: segEnd, words: [tw] })
      }
      // Boundary between parts = first word of the next part.
      for (let i = 0; i < parts.length; i++) {
        if (i > 0) parts[i].startMs = parts[i].words[0].startMs
        if (i + 1 < parts.length) parts[i].endMs = parts[i + 1].words[0].startMs
      }
      // Words the reciter skipped at the edges still belong to the referenced range.
      const first = parts[0]
      const last = parts.at(-1)
      if (first && refFrom && refFrom[0] === first.surah && refFrom[1] === first.ayah) first.from = Math.min(first.from, refFrom[2])
      if (last && refTo && refTo[0] === last.surah && refTo[1] === last.ayah) last.to = Math.max(last.to, refTo[2])
    } else if (refFrom && refTo && refFrom[0] === refTo[0] && refTo[1] >= refFrom[1]) {
      // No word timing: the ref range by ayah, time shared by word count.
      const [s, a1, w1] = refFrom
      const [, a2, w2] = refTo
      for (let a = a1; a <= a2; a++) {
        const n = count(s, a)
        if (!n) continue
        const from = a === a1 ? w1 : 1
        const to = a === a2 ? w2 : n
        parts.push({ surah: s, ayah: a, from, to: Math.max(from, to), startMs: segStart, endMs: segEnd, words: [] })
      }
      const total = Math.max(1, parts.reduce((sum, p) => sum + p.to - p.from + 1, 0))
      let acc = 0
      parts.forEach((p, i) => {
        p.startMs = segStart + Math.round(((segEnd - segStart) * acc) / total)
        acc += p.to - p.from + 1
        p.endMs = i === parts.length - 1 ? segEnd : segStart + Math.round(((segEnd - segStart) * acc) / total)
      })
    }
    if (parts.length === 0) {
      warnings.push(t('Bagian {from}–{to} dtk tidak memuat rujukan ayat; dilewati.', { from: sec1(seg.time_from), to: sec1(seg.time_to) }))
      continue
    }
    for (const p of parts) {
      const n = count(p.surah, p.ayah)
      if (!n) continue
      const from = Math.min(Math.max(1, p.from), n)
      const to = Math.min(Math.max(from, p.to), n)
      const endMs = Math.max(p.endMs, p.startMs)
      const words = dedupe(p.words.filter((w) => w.idx >= from && w.idx <= to)).map((w) => {
        const startMs = Math.min(Math.max(w.startMs, p.startMs), endMs)
        return { idx: w.idx, startMs, endMs: Math.min(Math.max(w.endMs, startMs), endMs) }
      })
      out.push({ ...base, id: newSegmentId(), kind: 'ayah', surah: p.surah, ayah: p.ayah, wordFrom: from, wordTo: to, startMs: p.startMs, endMs, words })
    }
  }

  out.sort((a, b) => a.startMs - b.startMs)
  for (let i = 1; i < out.length; i++) if (out[i].startMs > out[i - 1].endMs) out[i - 1].endMs = out[i].startMs

  const ayahs = out.filter((s) => s.kind === 'ayah')
  const surah = ayahs[0]?.surah
  const inSurah = ayahs.filter((s) => s.surah === surah).map((s) => s.ayah)
  if (out.length === 0) warnings.push(t('Penyelaras tidak menemukan bacaan ayat di audio ini.'))
  return {
    segments: out,
    detected: surah ? { surah, from: Math.min(...inSurah), to: Math.max(...inSurah) } : null,
    warnings
  }
}

/** One timing per word (a repeated word keeps its first reading), in word order. */
function dedupe(words: WordTiming[]): WordTiming[] {
  const seen = new Set<number>()
  return [...words]
    .sort((a, b) => a.idx - b.idx || a.startMs - b.startMs)
    .filter((w) => (seen.has(w.idx) ? false : (seen.add(w.idx), true)))
}
