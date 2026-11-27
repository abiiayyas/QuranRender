import { useEffect, useState } from 'react'
import { computeSegmentFit, type SegmentFit } from '@video/fit'
import { ensureFonts, fontSpecs } from '@video/fonts'
import { autoSplit } from '@shared/autosplit'
import { OPENDUA_EDITION, duaTexts, duaVerses, segmentVerseKey } from '@shared/dua'
import { autoTrim } from '@shared/translation'
import type { Project, Segment, SurahInfo, Verse } from '@shared/types'
import { canvasSize } from '@shared/video'
import { fetchVerses, loadSurahs } from './quran'

/** Does a segment's text fit one screen at the sizes the video really uses? */
export interface FitInfo {
  overflow: boolean
  /** Why: 'arabic' = the ayah itself needs cutting into screens; 'translation' = the Arabic fits, the translation text is the long part. */
  cause: 'arabic' | 'translation' | null
  /** Share of their base size the Arabic and the translation ended at. */
  arabic: number
  translation: number
}

export interface FitContext {
  verses: Record<string, Verse>
  surah: SurahInfo | null
  fits(seg: Segment): SegmentFit
}

/** Loads what measuring needs (verses in the project's script, the fonts the composition uses) and returns the checker. */
export async function fitContext(project: Project): Promise<FitContext> {
  const quranSegs = project.segments.filter((s) => s.kind !== 'dua')
  const [quranVerses, surahs] = await Promise.all([
    quranSegs.length > 0 ? fetchVerses(quranSegs, project.script) : Promise.resolve({}),
    project.dua ? Promise.resolve([]) : loadSurahs()
  ])
  const verses = { ...quranVerses, ...duaVerses(project.dua) }
  await ensureFonts('studio://fonts/', fontSpecs(project.script, verses))
  const surah = surahs.find((s) => s.id === project.surah) ?? null
  const { width, height } = canvasSize(project.aspect, 1080)
  const unit = Math.min(width, height)
  return { verses, surah, fits: (seg) => computeSegmentFit({ project, verses, surah, width, height }, seg, unit) }
}

const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 0))

/** Fit of every ayah, basmalah and isti'adzah segment. Yields to the UI every few segments: a long recitation has hundreds. */
export async function computeFitReport(project: Project, isStale: () => boolean = () => false): Promise<Record<string, FitInfo>> {
  const ctx = await fitContext(project)
  const out: Record<string, FitInfo> = {}
  for (let i = 0; i < project.segments.length; i++) {
    const seg = project.segments[i]
    const f = ctx.fits(seg)
    const cause = !f.overflow ? null : ctx.fits({ ...seg, translations: [] }).overflow ? 'arabic' : 'translation'
    out[seg.id] = { overflow: f.overflow, cause, arabic: f.scales[0], translation: f.blocks.length > 1 && f.showTr ? f.scales[1] : 1 }
    if (i % 12 === 11) {
      await tick()
      if (isStale()) return out
    }
  }
  return out
}

/** Live fit report for the open project; recomputed shortly after edits settle. */
export function useFitReport(project: Project): Record<string, FitInfo> {
  const [report, setReport] = useState<Record<string, FitInfo>>({})
  useEffect(() => {
    let stale = false
    const timer = setTimeout(() => {
      void computeFitReport(project, () => stale).then(
        (r) => !stale && setReport(r),
        () => !stale && setReport({})
      )
    }, 400)
    return () => {
      stale = true
      clearTimeout(timer)
    }
  }, [project.segments, project.style, project.script, project.editions, project.reciter, project.aspect, project.surah, project.dua]) // eslint-disable-line react-hooks/exhaustive-deps
  return report
}

/**
 * Cuts the given segments (or every one that does not fit) into screens that do, at natural pauses. Each candidate part
 * is measured with its own share of the primary translation, as it will be drawn. Returns the new list and how many cuts
 * were made; the caller fills the translations of the new parts afterwards.
 */
export async function splitLongSegments(
  project: Project,
  wholeTexts: Record<string, string>,
  only?: ReadonlySet<string>
): Promise<{ segments: Segment[]; cuts: number; trimNeeded: number }> {
  const ctx = await fitContext(project)
  const primary = project.editions[0]
  let cuts = 0
  /** Segments that fit once their translation is cut to their own words: cutting the Arabic would not help, trimming does. */
  let trimNeeded = 0
  const segments = project.segments.flatMap((seg) => {
    if ((seg.kind !== 'ayah' && seg.kind !== 'dua') || (only && !only.has(seg.id))) return [seg]
    const key = segmentVerseKey(seg)
    const verse = ctx.verses[key] ?? null
    const full = wholeTexts[key] ?? (primary === OPENDUA_EDITION ? duaTexts(project.dua)[key] : undefined)
    const count = verse?.words.length ?? 0
    const fits = (part: Segment): boolean => {
      const translated: Segment =
        primary && full && count > 0
          ? { ...part, translations: [{ edition: primary, text: autoTrim(full, part.wordFrom, part.wordTo, count).text, status: 'auto' }] }
          : part
      return !ctx.fits(translated).overflow
    }
    const parts = autoSplit(seg, verse, fits)
    cuts += parts.length - 1
    if (parts.length === 1 && fits(seg)) trimNeeded++
    return parts
  })
  return { segments, cuts, trimNeeded }
}
