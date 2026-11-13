import type { Segment } from '../shared/types'
import type { VideoProps } from '../shared/video'
import { AR_LINE, AR_LINE_MIN, SAFE_AREA, TR_LINE, q } from './common'
import { FAMILY, qpcFamily } from './fonts'
import { fitBlocks, splitWords, type Block, type Fit, type Run } from './layout'
import { segmentWords, type DisplayWord } from './timing'

/** Smallest shares the blocks may shrink to: below these the text stops being comfortable to read on a phone. */
export const ARABIC_MIN_SCALE = 0.5
export const TRANSLATION_MIN_SCALE = 0.7

export function arabicFamily(project: VideoProps['project'], seg: Segment, page: number | undefined): string {
  if (seg.kind === 'istiadzah') return project.script === 'uthmani' ? FAMILY.uthmani : FAMILY.lpmq
  if (project.script === 'qpc') return page ? qpcFamily(page) : FAMILY.lpmq
  return project.script === 'uthmani' ? FAMILY.uthmani : FAMILY.lpmq
}

export interface SegmentFit extends Fit {
  blocks: Block[]
  gaps: number[]
  words: DisplayWord[]
  showTr: boolean
  maxW: number
  regionTop: number
  regionBottom: number
  boxPad: number
  boxed: boolean
  banded: boolean
}

/**
 * Where and how big a segment's text is drawn. The composition draws from this, and the editor asks it too (with the
 * fonts loaded) to warn about segments that cannot fit one screen, so both always agree.
 */
export function computeSegmentFit(p: Pick<VideoProps, 'project' | 'verses' | 'surah' | 'width' | 'height'>, seg: Segment, unit: number): SegmentFit {
  const { project, verses, surah, width, height } = p
  const style = project.style
  const safe = SAFE_AREA[project.aspect]
  const { words, verse } = segmentWords(seg, verses)
  const translation = seg.translations.find((x) => x.edition === project.editions[0])?.text.trim() ?? ''
  const showTr = style.showTranslation && translation !== ''
  const reference = style.showReference && seg.kind === 'ayah' ? `QS ${surah?.nameLatin ?? `Surah ${seg.surah}`} ${seg.surah}:${seg.ayah}` : ''
  const arFamily = q(arabicFamily(project, seg, verse?.page))
  const trFamily = q(style.translationFont === 'Amiri' ? FAMILY.amiri : FAMILY.inter)
  const banded = style.boxOpacity > 0 && style.boxStyle === 'band'
  const boxed = style.boxOpacity > 0 && style.boxStyle === 'card'
  const boxPad = unit * 0.045
  const maxW = style.maxWidth * width - (boxed ? boxPad * 2 : 0)

  // Room between the surah name and the reciter pill, minus the box padding.
  const regionTop = height * safe.top + (style.showSurahName && surah ? unit * 0.055 * 1.5 + unit * 0.03 : 0)
  const regionBottom = height * (1 - safe.bottom) - (style.showReciter && project.reciter.trim() ? unit * 0.06 + unit * 0.03 : 0)
  const maxH = regionBottom - regionTop - (boxed || banded ? boxPad * 2 : 0)

  const blocks: Block[] = [
    { runs: words.map((w) => ({ text: w.text, family: arFamily })), size: style.arabicSize * unit, lineHeight: AR_LINE, minLineHeight: AR_LINE_MIN, pad: 0.14, minScale: ARABIC_MIN_SCALE, order: 1 }
  ]
  const gaps = [0]
  const trSize = style.translationSize * unit
  if (showTr) {
    const runs: Run[] = splitWords(translation, trFamily, 400, trSize, maxW).map((text) => ({ text, family: trFamily }))
    blocks.push({ runs, size: trSize, lineHeight: TR_LINE, minLineHeight: TR_LINE, pad: 0.13, minScale: TRANSLATION_MIN_SCALE, order: 0 })
    gaps.push(trSize * 0.6)
  }
  if (reference) {
    const refSize = unit * 0.026
    blocks.push({ runs: [{ text: reference, family: q(FAMILY.inter), weight: 500 }], size: refSize, lineHeight: 1.4, minLineHeight: 1.4, pad: 0, minScale: 1, order: 0 })
    gaps.push(refSize * 0.9)
  }
  return { ...fitBlocks(blocks, gaps, maxW, maxH), blocks, gaps, words, showTr, maxW, regionTop, regionBottom, boxPad, boxed, banded }
}
