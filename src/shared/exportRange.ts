import type { Overlay, Segment } from './types'

/** A stretch of the project's timeline to export on its own, as milliseconds on that timeline. */
export interface ExportRange {
  fromMs: number
  toMs: number
}

export const MIN_RANGE_MS = 1000

export type RangeProblem = 'beyond' | 'order' | 'short'

/** What is wrong with a range, or null. An end past the recording is not a problem: it is clamped (`clampRange`). */
export function rangeProblem(r: ExportRange, durationMs: number): RangeProblem | null {
  if (!(r.fromMs >= 0) || r.fromMs >= durationMs) return 'beyond'
  if (!(r.toMs > r.fromMs)) return 'order'
  if (Math.min(r.toMs, durationMs) - r.fromMs < MIN_RANGE_MS) return 'short'
  return null
}

export const clampRange = (r: ExportRange, durationMs: number): ExportRange => ({ fromMs: Math.max(0, r.fromMs), toMs: Math.min(durationMs, r.toMs) })

export interface RangeFrames {
  /** First and last frame to draw, inclusive (Remotion's `frameRange`). */
  from: number
  to: number
  count: number
}

/** The frames of a range at `fps`; the whole video when there is none. Always at least one frame, always inside the video. */
export function rangeFrames(r: ExportRange | null, durationMs: number, fps: number): RangeFrames {
  const total = Math.max(1, Math.ceil((durationMs / 1000) * fps))
  if (!r) return { from: 0, to: total - 1, count: total }
  const from = Math.min(total - 1, Math.max(0, Math.round((r.fromMs / 1000) * fps)))
  const end = Math.min(total, Math.max(from + 1, Math.round((r.toMs / 1000) * fps)))
  return { from, to: end - 1, count: end - from }
}

/** Length of the exported video in ms: what the file will last. */
export const rangeLengthMs = (r: ExportRange | null, durationMs: number, fps: number): number => (rangeFrames(r, durationMs, fps).count / fps) * 1000

/**
 * Reads a time typed by a person: `83`, `83.5`, `1:23`, `1:23.5` or `1:02:03`, with a comma or a dot as the decimal mark.
 * Null for anything else (and for seconds or minutes of 60 or more after a colon).
 */
export function parseTime(text: string): number | null {
  const s = text.trim().replace(',', '.')
  const num = String.raw`(\d+(?:\.\d+)?)`
  let m = new RegExp(`^${num}$`).exec(s)
  if (m) return Math.round(Number(m[1]) * 1000)
  m = new RegExp(String.raw`^(\d+):${num}$`).exec(s)
  if (m && Number(m[2]) < 60) return Math.round((Number(m[1]) * 60 + Number(m[2])) * 1000)
  m = new RegExp(String.raw`^(\d+):(\d{1,2}):${num}$`).exec(s)
  if (m && Number(m[2]) < 60 && Number(m[3]) < 60) return Math.round((Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3])) * 1000)
  return null
}

/**
 * `m:ss`, or `h:mm:ss` from an hour on, with a tenth of a second only when there is one. `exact` keeps the milliseconds
 * instead (trailing zeros dropped): a time that must land on a segment's edge cannot be rounded to a tenth, or it falls
 * just inside the segment and cuts it again.
 */
export function formatTime(ms: number, exact = false): string {
  const total = exact ? Math.max(0, Math.round(ms)) : Math.max(0, Math.round(ms / 100)) * 100
  const whole = Math.floor(total / 1000)
  const frac = total % 1000
  const h = Math.floor(whole / 3600)
  const m = Math.floor(whole / 60) % 60
  const s = String(whole % 60).padStart(2, '0')
  const sec = frac === 0 ? s : `${s}.${String(frac).padStart(3, '0').replace(/0+$/, '')}`
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`
}

const byStart = (segments: readonly Segment[]): Segment[] => [...segments].sort((a, b) => a.startMs - b.startMs)

/** What the range holds, and the segments it cuts through (a short that starts or ends in the middle of a verse). */
export function rangeContents(segments: readonly Segment[], r: ExportRange): { segments: Segment[]; cutStart: Segment | null; cutEnd: Segment | null } {
  const inside = byStart(segments).filter((s) => s.endMs > r.fromMs && s.startMs < r.toMs)
  return {
    segments: inside,
    cutStart: inside.find((s) => s.startMs < r.fromMs) ?? null,
    cutEnd: [...inside].reverse().find((s) => s.endMs > r.toMs) ?? null
  }
}

/** Moves each end that cuts through a segment to that segment's edge, so the short starts and stops on whole verses. */
export function snapToSegments(segments: readonly Segment[], r: ExportRange): ExportRange {
  const { cutStart, cutEnd } = rangeContents(segments, r)
  return { fromMs: cutStart ? cutStart.startMs : r.fromMs, toMs: cutEnd ? cutEnd.endMs : r.toMs }
}

/**
 * Where an overlay shows in a range: its own window cut to the range, so one set to run "until the end of the video" covers
 * the whole short, and entrance animations start with the short. Null when it never shows inside it.
 */
export function overlayWindow(o: Pick<Overlay, 'startMs' | 'endMs'>, durationMs: number, r: ExportRange | null): { startMs: number; endMs: number } | null {
  const startMs = Math.max(o.startMs, r?.fromMs ?? 0)
  const endMs = Math.min(o.endMs ?? durationMs, r?.toMs ?? durationMs)
  return endMs > startMs ? { startMs, endMs } : null
}

/** Overlays that exist on the timeline but fall outside the range, so the user is told they will not appear. */
export function overlaysOutside<T extends Pick<Overlay, 'startMs' | 'endMs'>>(overlays: readonly T[], durationMs: number, r: ExportRange): T[] {
  return overlays.filter((o) => overlayWindow(o, durationMs, null) !== null && overlayWindow(o, durationMs, r) === null)
}

export type RangeInputProblem = RangeProblem | 'format'

/** The two time fields as typed, turned into a range to export, or the one thing wrong with them. */
export function resolveRangeInput(fromText: string, toText: string, durationMs: number): { range: ExportRange | null; problem: RangeInputProblem | null } {
  const fromMs = parseTime(fromText)
  const toMs = parseTime(toText)
  if (fromMs === null || toMs === null) return { range: null, problem: 'format' }
  const range = { fromMs, toMs }
  const problem = rangeProblem(range, durationMs)
  return problem ? { range: null, problem } : { range: clampRange(range, durationMs), problem: null }
}
