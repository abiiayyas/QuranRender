import { useMemo, type CSSProperties } from 'react'
import { interpolateColors } from 'remotion'
import type { Segment } from '../shared/types'
import type { StyleSettings } from '../shared/style'
import type { VideoProps } from '../shared/video'
import { rgba, textShadow } from './common'
import { computeSegmentFit } from './fit'
import type { BlockLayout } from './layout'
import { fadeAt, wordWeights, type DisplayWord } from './timing'

/** Hex `#rrggbb` → relative luminance 0..1, to pick a word-box alpha that keeps the text readable. */
function luminance(hex: string): number {
  const n = parseInt(hex.slice(1, 7), 16)
  if (Number.isNaN(n)) return 0
  return (0.2126 * ((n >> 16) & 255) + 0.7152 * ((n >> 8) & 255) + 0.0722 * (n & 255)) / 255
}

export function SegmentText({ project, verses, surah, width, height, seg, t, unit, ready }: VideoProps & { seg: Segment; t: number; unit: number; ready: boolean }) {
  const style = project.style
  // `ready` invalidates measurements taken with fallback fonts.
  const layout = useMemo(
    () => computeSegmentFit({ project, verses, surah, width, height }, seg, unit),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [project.style, project.script, project.editions, project.reciter, project.aspect, verses, surah, width, height, seg, unit, ready]
  )
  const { words, showTr, maxW, regionTop, regionBottom, boxPad, boxed, banded } = layout

  const opacity = fadeAt(t, seg.startMs, seg.endMs, style.fadeMs)
  const weights = style.highlight === 'none' ? null : wordWeights(words, seg.words, t, seg.endMs)

  const top =
    style.position === 'top'
      ? regionTop
      : style.position === 'bottom'
        ? regionBottom - layout.height - (boxed || banded ? boxPad * 2 : 0)
        : (regionTop + regionBottom - layout.height - (boxed || banded ? boxPad * 2 : 0)) / 2
  const widest = Math.max(0, ...layout.layouts.map((l) => l.widest))

  const container: CSSProperties = banded
    ? { position: 'absolute', left: 0, right: 0, top, padding: `${boxPad}px 0`, background: rgba(style.boxColor, style.boxOpacity) }
    : {
        position: 'absolute',
        left: '50%',
        top,
        transform: 'translateX(-50%)',
        padding: boxed ? boxPad : 0,
        width: boxed ? Math.min(widest, maxW) + boxPad * 2 : maxW,
        borderRadius: boxed ? unit * 0.035 : 0,
        background: boxed ? rgba(style.boxColor, style.boxOpacity) : undefined
      }

  return (
    <div style={{ ...container, opacity }}>
      {layout.layouts.map((l, bi) => {
        const block = layout.blocks[bi]
        const isAr = bi === 0
        const isTr = showTr && bi === 1
        return (
          <div key={bi} style={{ marginTop: bi > 0 && l.lines.length > 0 ? layout.gaps[bi] * layout.scales[bi] : 0 }}>
            {l.lines.map((line, li) => (
              <div
                key={li}
                dir={isAr ? 'rtl' : 'auto'}
                lang={isAr ? 'ar' : undefined}
                style={{
                  display: 'flex',
                  justifyContent: 'center',
                  whiteSpace: 'nowrap',
                  height: l.size * l.lineHeight,
                  lineHeight: `${l.size * l.lineHeight}px`,
                  fontSize: l.size,
                  fontFamily: block.runs[0]?.family,
                  fontWeight: block.runs[0]?.weight ?? 400,
                  color: isAr ? style.arabicColor : style.translationColor,
                  opacity: !isAr && !isTr ? 0.75 : 1,
                  textShadow: style.shadow ? textShadow(unit) : undefined
                }}
              >
                {line.map((ri) =>
                  isAr ? (
                    <ArabicWord key={ri} word={words[ri]} w={weights ? weights[ri] : null} l={l} style={style} />
                  ) : (
                    <span key={ri} style={{ padding: `0 ${l.pad}px` }}>
                      {block.runs[ri].text}
                    </span>
                  )
                )}
              </div>
            ))}
          </div>
        )
      })}
    </div>
  )
}

function ArabicWord({ word, w, l, style }: { word: DisplayWord; w: number | null; l: BlockLayout; style: StyleSettings }) {
  // No timing: no karaoke, every word at full strength.
  if (w === null) return <span style={{ padding: `0 ${l.pad}px` }}>{word.text}</span>
  const base: CSSProperties = {
    position: 'relative',
    padding: `0 ${l.pad}px`,
    opacity: style.inactiveOpacity + (1 - style.inactiveOpacity) * w
  }
  if (style.highlight === 'color') base.color = interpolateColors(w, [0, 1], [style.arabicColor, style.highlightColor])
  if (style.highlight === 'glow' && w > 0) {
    const c = rgba(style.highlightColor, 0.9 * w)
    base.textShadow = `0 0 ${l.size * 0.12}px ${c}, 0 0 ${l.size * 0.3}px ${c}`
  }
  if (style.highlight === 'box') {
    base.background = rgba(style.highlightColor, (luminance(style.highlightColor) > 0.5 ? 0.22 : 0.5) * w)
    base.borderRadius = l.size * 0.22
  }
  return (
    <span style={base}>
      {word.text}
      {style.highlight === 'underline' && w > 0 && (
        <span
          style={{
            position: 'absolute',
            left: l.pad,
            right: l.pad,
            bottom: l.size * l.lineHeight * 0.12,
            height: Math.max(2, l.size * 0.06),
            borderRadius: l.size * 0.03,
            background: style.highlightColor,
            opacity: w
          }}
        />
      )}
    </span>
  )
}
