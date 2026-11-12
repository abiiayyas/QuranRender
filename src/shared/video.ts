import type { Aspect, Asset, Project, SurahInfo, Verse } from './types'

/** Composition id in src/remotion/Root.tsx; preview (Player) and export (renderMedia) both use it. */
export const COMPOSITION_ID = 'quran-video'

/**
 * Everything the composition draws from. Preview and export build the same object; only `baseUrl` differs:
 * preview loads files over studio://, export over the local http server main starts for the render.
 */
export interface VideoProps {
  project: Project
  /** Keyed by asset id; only assets the project references. */
  assets: Record<string, Asset>
  /** Keyed by `${surah}:${ayah}` for every ayah a segment shows, in the project's script. */
  verses: Record<string, Verse>
  surah: SurahInfo | null
  width: number
  height: number
  fps: number
  durationMs: number
  baseUrl: {
    /** Prefix for `${projectId}/${asset.path}`. */
    asset: string
    /** Prefix for font files (LPMQ.ttf, Amiri-*.ttf, Inter-Variable.ttf; downloaded on demand: `qpc/uthmani.woff2`, QPC pages `qpc/p{page}.woff2`). */
    font: string
  }
}

export const verseKey = (surah: number, ayah: number): string => `${surah}:${ayah}`

/** Canvas size for an aspect at a given short side (720/1080/2160). Even numbers, as H.264 needs. */
export function canvasSize(aspect: Aspect, short: number): { width: number; height: number } {
  if (aspect === '1:1') return { width: short, height: short }
  const long = Math.round((short * 16) / 9 / 2) * 2
  return aspect === '16:9' ? { width: long, height: short } : { width: short, height: long }
}
