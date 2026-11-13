export const PROMPT_DEFAULTS = { everyMs: 60_000, showMs: 6000 } as const
/** Shortest appearance that still leaves room to enter, be tapped, and leave. */
export const PROMPT_MIN_SHOW_MS = 2500

const ENTER_MS = 450
const EXIT_MS = 400
const TAP_MS = 350

export interface PromptPhase {
  /** 0..1: how far the entrance has run. */
  enter: number
  /** 0..1: how far the exit has run (1 = gone). */
  exit: number
  /** 0..1: how far the tap has run. The button reads as pressed in the middle and as confirmed (subscribed/following) at 1. */
  tap: number
  /** Milliseconds since this appearance began. */
  local: number
}

const clamp = (v: number): number => Math.min(1, Math.max(0, v))

/**
 * A subscribe or follow prompt that shows for `showMs`, hides, and comes back every `everyMs`, counted from the overlay's
 * own start (so the first appearance is at `startMs`). Null while hidden. A pure function of time, so the preview and the
 * export agree.
 */
export function promptPhase(t: number, startMs: number, everyMs: number, showMs: number): PromptPhase | null {
  if (t < startMs) return null
  const every = Math.max(1000, everyMs)
  const show = Math.max(PROMPT_MIN_SHOW_MS, Math.min(showMs, every))
  const local = (t - startMs) % every
  if (local >= show) return null
  const tapAt = Math.min(show * 0.4, 1600)
  return { enter: clamp(local / ENTER_MS), exit: clamp((local - (show - EXIT_MS)) / EXIT_MS), tap: clamp((local - tapAt) / TAP_MS), local }
}
