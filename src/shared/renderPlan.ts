/** How an export is rendered. auto: one go for short videos, pieces for long ones. */
export type RenderMode = 'auto' | 'direct' | 'chunked'

/** What to do when an export has finished successfully. */
export type AfterExport = 'none' | 'sleep' | 'quit'

export const CHUNK_SECONDS = 600
/** From this length on, `auto` renders in pieces: a failure then costs one piece, not hours. */
export const AUTO_CHUNK_AFTER_MS = 15 * 60_000

export interface Chunk {
  index: number
  /** First and last frame, inclusive, as Remotion's `frameRange` takes them. */
  from: number
  to: number
}

/** Splits `totalFrames` into pieces of about `chunkSeconds`; every frame is in exactly one piece. */
export function planChunks(totalFrames: number, fps: number, chunkSeconds = CHUNK_SECONDS): Chunk[] {
  const size = Math.max(1, Math.round(chunkSeconds * fps))
  const out: Chunk[] = []
  for (let from = 0; from < totalFrames; from += size) out.push({ index: out.length, from, to: Math.min(totalFrames, from + size) - 1 })
  return out.length > 0 ? out : [{ index: 0, from: 0, to: 0 }]
}

export const useChunks = (mode: RenderMode, durationMs: number): boolean => mode === 'chunked' || (mode === 'auto' && durationMs >= AUTO_CHUNK_AFTER_MS)

/** Starting Chrome and the composition costs a few seconds whatever the length. */
export const RENDER_OVERHEAD_MS = 5000
/** Background motion (aurora, particles, ...) costs about 1.7 times a still background to draw (measured 1.65 to 1.9). */
export const MOTION_FACTOR = 1.75
/** Milliseconds to render one megapixel of one frame on a still background: measured on the first test machine, 720p and 1080p agree within 10%. */
export const DEFAULT_MS_PER_MP_FRAME = 16

const megapixels = (width: number, height: number): number => (width * height) / 1e6

export function estimateRenderMs(o: { durationMs: number; fps: number; width: number; height: number; motion: boolean; msPerMpFrame: number | null }): number {
  const frames = Math.ceil((o.durationMs / 1000) * o.fps)
  return RENDER_OVERHEAD_MS + frames * megapixels(o.width, o.height) * (o.msPerMpFrame ?? DEFAULT_MS_PER_MP_FRAME) * (o.motion ? MOTION_FACTOR : 1)
}

/** The speed an export showed, as a still-background figure so it can be reused for any export. Null when there is too little to measure. */
export function measuredMsPerMpFrame(o: { elapsedMs: number; frames: number; width: number; height: number; motion: boolean }): number | null {
  if (o.frames < 30 || o.elapsedMs <= RENDER_OVERHEAD_MS) return null
  return (o.elapsedMs - RENDER_OVERHEAD_MS) / (o.frames * megapixels(o.width, o.height)) / (o.motion ? MOTION_FACTOR : 1)
}

/** Half old, half new: one slow export (a busy machine) does not throw the estimate off for good. */
export const blendSpeed = (previous: number | null, measured: number): number => (previous === null ? measured : (previous + measured) / 2)
