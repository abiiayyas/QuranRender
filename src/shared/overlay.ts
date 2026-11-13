import type { Overlay } from './types'

export const CTA_DEFAULT_TEXT = 'Jangan lupa bagikan dan doakan'

export interface OverlayPhase {
  /** 0..1: how far the entrance has run. */
  enter: number
  /** 0..1: how far the exit has run (1 = gone). */
  exit: number
  /** 0..1 across the overlay's own window. */
  progress: number
}

/**
 * Entrance and exit share the window: each takes up to `inMs`/`outMs`, but never more than 40% of a short overlay, so a
 * 1 s overlay still shows something readable in between.
 */
export function overlayPhase(t: number, startMs: number, endMs: number, inMs = 600, outMs = 450): OverlayPhase {
  const span = Math.max(1, endMs - startMs)
  const i = Math.min(inMs, span * 0.4)
  const o = Math.min(outMs, span * 0.4)
  const clamp = (v: number): number => Math.min(1, Math.max(0, v))
  return { enter: clamp((t - startMs) / i), exit: clamp((t - (endMs - o)) / o), progress: clamp((t - startMs) / span) }
}

/** Near-black or white, whichever has the higher WCAG contrast on the hex background. */
export function readableOn(hex: string): '#101114' | '#FFFFFF' {
  const n = parseInt(hex.slice(1, 7), 16)
  const lin = (c: number): number => {
    const s = c / 255
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
  }
  const l = 0.2126 * lin((n >> 16) & 255) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255)
  // 1.05 / (l + 0.05) is the contrast with white; (l + 0.05) / 0.056 is the contrast with #101114 (luminance 0.006).
  return (l + 0.05) / 0.056 > 1.05 / (l + 0.05) ? '#101114' : '#FFFFFF'
}

/** Name an overlay in lists and on the timeline. */
export function overlayLabel(o: Pick<Overlay, 'kind' | 'text'>): string {
  switch (o.kind) {
    case 'qari':
      return 'Nama qari'
    case 'progress':
      return 'Kemajuan'
    case 'cta':
      return o.text.trim() || CTA_DEFAULT_TEXT
    case 'visualizer':
      return 'Gelombang suara'
    case 'image':
      return 'Gambar'
    default:
      return o.text
  }
}
