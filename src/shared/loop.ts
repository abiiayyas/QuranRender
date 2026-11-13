/** Frame mapping for a clip of `length` frames that must fill a longer timeline. Pure, so preview and export agree. */

/** Crossfade at the seam, in seconds (clamped so a short clip still has a stretch of its own). */
export const LOOP_FADE_S = 0.8

/** Forward 0..length-1, then backward length-2..1, and again: no repeated frame at either turn. */
export function bounceFrame(frame: number, length: number): number {
  if (length <= 1) return 0
  const s = length - 1
  const p = ((frame % (2 * s)) + 2 * s) % (2 * s)
  return p <= s ? p : 2 * s - p
}

/** A bounce is played as back-to-back legs of `length - 1` frames; odd legs run backward. */
export function bounceLeg(frame: number, length: number): { leg: number; reverse: boolean; start: number; frame: number } {
  const s = Math.max(1, length - 1)
  const leg = Math.max(0, Math.floor(frame / s))
  const local = frame - leg * s
  const reverse = leg % 2 === 1
  // The reverse leg opens on the last frame (the forward leg ended one short of it) and stops before frame 0.
  return { leg, reverse, start: leg * s, frame: reverse ? s - local : local }
}

export const fadeFrames = (fps: number, length: number): number => Math.min(Math.round(LOOP_FADE_S * fps), Math.floor(length / 3))

export interface FadeLayer {
  /** Index of the clip copy; copy k starts at `k * (length - fade)` on the timeline. */
  cycle: number
  /** Timeline frame at which this copy's frame 0 plays. */
  start: number
  /** The newer copy fades in over the older one, which stays opaque underneath. */
  opacity: number
}

/**
 * Copies of the clip start every `length - fade` frames, so each one overlaps the next by `fade` frames. Bottom layer
 * first. `fade` < 1 means no crossfade is possible; callers fall back to a plain repeat.
 */
export function fadeLayers(frame: number, length: number, fade: number): FadeLayer[] {
  const period = length - fade
  const cycle = Math.max(0, Math.floor(frame / period))
  const local = frame - cycle * period
  const layers: FadeLayer[] = []
  if (cycle > 0 && local < fade) layers.push({ cycle: cycle - 1, start: (cycle - 1) * period, opacity: 1 })
  layers.push({ cycle, start: cycle * period, opacity: cycle === 0 ? 1 : Math.min(1, local / fade) })
  return layers
}
