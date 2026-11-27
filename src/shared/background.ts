import type { Background } from './types'

export const DEFAULT_BG_TRANSITION_MS = 500
export const MAX_BG_TRANSITION_MS = 2000

export interface BackgroundClip {
  id: string
  kind: 'image' | 'video'
  assetId: string
  startMs: number
  endMs: number
}

/** Every asset id referenced by a project's background (single or multi). */
export function backgroundAssetIds(bg: Pick<Background, 'assetId' | 'clips'>): string[] {
  const ids = new Set<string>()
  if (bg.assetId) ids.add(bg.assetId)
  if (bg.clips) for (const c of bg.clips) if (c.assetId) ids.add(c.assetId)
  return [...ids]
}

/** Splits `0..durationMs` evenly across all clips. */
export function distributeClips(clips: ReadonlyArray<BackgroundClip>, durationMs: number): BackgroundClip[] {
  const n = clips.length
  if (n === 0) return []
  const total = Math.max(1000, Math.round(durationMs))
  return clips.map((c, i) => ({
    ...c,
    startMs: Math.round((total * i) / n),
    endMs: i === n - 1 ? total : Math.round((total * (i + 1)) / n)
  }))
}

/**
 * Adds a media asset to the background:
 * - If single image/video already exists, promotes to `multi` with both clips evenly distributed.
 * - If already `multi`, appends the clip and redistributes durations.
 * - Otherwise sets single `image` or `video` mode (preserving single loopable background).
 */
export function appendBackgroundClip(
  bg: Background,
  asset: { id: string; kind: 'image' | 'video' },
  durationMs: number,
  newId: () => string
): Background {
  if (bg.kind === 'multi') {
    const next = [...(bg.clips ?? []), { id: newId(), kind: asset.kind, assetId: asset.id, startMs: 0, endMs: 0 }]
    return { ...bg, kind: 'multi', assetId: null, clips: distributeClips(next, durationMs), transitionMs: bg.transitionMs ?? DEFAULT_BG_TRANSITION_MS }
  }
  if ((bg.kind === 'image' || bg.kind === 'video') && bg.assetId) {
    const first: BackgroundClip = { id: newId(), kind: bg.kind, assetId: bg.assetId, startMs: 0, endMs: 0 }
    const second: BackgroundClip = { id: newId(), kind: asset.kind, assetId: asset.id, startMs: 0, endMs: 0 }
    return {
      ...bg,
      kind: 'multi',
      assetId: null,
      clips: distributeClips([first, second], durationMs),
      transitionMs: bg.transitionMs ?? DEFAULT_BG_TRANSITION_MS
    }
  }
  return { ...bg, kind: asset.kind, assetId: asset.id, clips: [] }
}

/** Removes one clip from `multi` mode; drops back to single mode when 1 remains, or color when 0 remain. */
export function removeBackgroundClip(bg: Background, clipId: string, durationMs: number): Background {
  const rest = (bg.clips ?? []).filter((c) => c.id !== clipId)
  if (rest.length === 0) return { ...bg, kind: 'color', assetId: null, clips: [] }
  if (rest.length === 1) return { ...bg, kind: rest[0].kind, assetId: rest[0].assetId, clips: [] }
  return { ...bg, kind: 'multi', assetId: null, clips: distributeClips(rest, durationMs) }
}

/** Moves a clip from `from` to `to` and redistributes durations evenly. */
export function reorderBackgroundClip(
  clips: ReadonlyArray<BackgroundClip>,
  from: number,
  to: number,
  durationMs: number
): BackgroundClip[] {
  if (from < 0 || from >= clips.length || to < 0 || to >= clips.length || from === to) return [...clips]
  const next = [...clips]
  const [moved] = next.splice(from, 1)
  next.splice(to, 0, moved)
  return distributeClips(next, durationMs)
}

/**
 * Pure frame-time lookup of visible background clip layers and their opacities (0..1) for crossfade transitions.
 * Returns at most 2 layers (underneath + fading-in clip on top).
 */
export function activeBackgroundLayers(
  clips: ReadonlyArray<BackgroundClip>,
  tMs: number,
  transitionMs: number
): { clip: BackgroundClip; opacity: number }[] {
  const sorted = [...clips].sort((a, b) => a.startMs - b.startMs || a.endMs - b.endMs)
  if (sorted.length === 0) return []
  let idx = sorted.findIndex((c) => tMs >= c.startMs && tMs < c.endMs)
  if (idx < 0) idx = tMs < sorted[0].startMs ? 0 : sorted.length - 1
  const cur = sorted[idx]
  const fade = Math.max(0, transitionMs)
  if (fade === 0 || sorted.length === 1) return [{ clip: cur, opacity: 1 }]

  if (idx > 0) {
    const prev = sorted[idx - 1]
    const boundary = cur.startMs
    const half = Math.min(fade / 2, (prev.endMs - prev.startMs) / 2, (cur.endMs - cur.startMs) / 2)
    if (half > 0 && tMs >= boundary - half && tMs < boundary + half) {
      const opacity = Math.min(1, Math.max(0, (tMs - (boundary - half)) / (2 * half)))
      return [
        { clip: prev, opacity: 1 },
        { clip: cur, opacity }
      ]
    }
  }

  if (idx + 1 < sorted.length) {
    const next = sorted[idx + 1]
    const boundary = next.startMs
    const half = Math.min(fade / 2, (cur.endMs - cur.startMs) / 2, (next.endMs - next.startMs) / 2)
    if (half > 0 && tMs >= boundary - half && tMs < boundary + half) {
      const opacity = Math.min(1, Math.max(0, (tMs - (boundary - half)) / (2 * half)))
      return [
        { clip: cur, opacity: 1 },
        { clip: next, opacity }
      ]
    }
  }

  return [{ clip: cur, opacity: 1 }]
}
