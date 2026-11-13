import type { Aspect, Project } from './types'

/** Composition id in src/remotion/Root.tsx; the dialog preview (Player) and the saved JPG both draw it. */
export const THUMBNAIL_COMPOSITION_ID = 'quran-thumbnail'

/** Shorts, Reels and TikTok accept covers up to 2 MB. */
export const THUMBNAIL_MAX_BYTES = 2 * 1024 * 1024

export interface ThumbnailSpec {
  /** Big words; the last one takes the accent colour. 2 to 4 words read best. */
  title: string
  /** Optional small line under the title (reciter, ayah range). */
  subtitle: string
  position: 'top' | 'center' | 'bottom'
  accent: string
  /** 0..0.9 black layer between picture and text, so the words stay readable on any picture. */
  dim: number
  /** An image asset of the project (a video frame is first cut into one); null = the project's background colour. */
  assetId: string | null
}

export const THUMBNAIL_ACCENTS = ['#FACC15', '#34D399', '#38BDF8', '#F87171']

/** Characters of the title after which it stops being a thumbnail and becomes a paragraph. */
export const THUMBNAIL_TITLE_MAX = 40

/** What the props of the composition are; imageSrc is already a full URL (studio:// in the app, http while saving). */
export interface ThumbnailProps {
  spec: ThumbnailSpec
  imageSrc: string | null
  color: string
  width: number
  height: number
  /** Prefix for font files, as in VideoProps. */
  fontBase: string
}

export const thumbnailSize = (aspect: Aspect, short = 1080): { width: number; height: number } => {
  if (aspect === '1:1') return { width: short, height: short }
  const long = Math.round((short * 16) / 9 / 2) * 2
  return aspect === '16:9' ? { width: long, height: short } : { width: short, height: long }
}

/** Splits off the last word, which gets the accent colour. */
export function splitAccent(title: string): { head: string; last: string } {
  const words = title.trim().split(/\s+/).filter(Boolean)
  const last = words.pop() ?? ''
  return { head: words.join(' '), last }
}

/**
 * Share of the picture shown in Instagram's profile grid (a centred 3:4 crop of a 9:16 cover): the bands above and
 * below it, as fractions of the height. Null for formats that are not cropped.
 */
export function gridBands(aspect: Aspect): { top: number; bottom: number } | null {
  // A 9:16 cover is 16/9 widths tall; the grid shows 4/3 widths of it: 0.75 of the height, so 12.5% is cut at each end.
  return aspect === '9:16' ? { top: 0.125, bottom: 0.125 } : null
}

export function defaultThumbnail(project: Pick<Project, 'surah' | 'ayahFrom' | 'ayahTo' | 'reciter' | 'background'>, surahName: string | null): ThumbnailSpec {
  const range = project.surah && project.ayahFrom ? `Ayat ${project.ayahFrom}${project.ayahTo && project.ayahTo !== project.ayahFrom ? `–${project.ayahTo}` : ''}` : ''
  const bg = project.background
  return {
    title: surahName ? `Surah ${surahName}` : 'Tilawah Al-Qur’an',
    subtitle: project.reciter.trim() || range,
    position: 'center',
    accent: THUMBNAIL_ACCENTS[0],
    dim: 0.5,
    assetId: bg.kind === 'image' ? bg.assetId : null
  }
}
