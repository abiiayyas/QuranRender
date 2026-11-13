import type { CSSProperties } from 'react'
import { AbsoluteFill, Img } from 'remotion'
import { splitAccent, type ThumbnailProps } from '../shared/thumbnail'
import { FAMILY, useFonts, type FontSpec } from './fonts'

const SPECS: FontSpec[] = [{ family: FAMILY.inter, file: 'Inter-Variable.ttf', weight: '100 900' }]

/**
 * The thumbnail: the project's picture (or its colour), a dim layer, and big words drawn here, so letters are always
 * right. The dialog preview and the saved JPG both render this component.
 */
export function Thumbnail({ spec, imageSrc, color, width, height, fontBase }: ThumbnailProps) {
  useFonts(fontBase, SPECS)
  // Landscape canvases are wide but short: size text from a width a portrait canvas would have.
  const base = Math.min(width, height * 1.4)
  const { head, last } = splitAccent(spec.title.toUpperCase())
  const length = spec.title.length
  const longest = Math.max(1, ...spec.title.split(/\s+/).map((w) => w.length))
  // Heavy uppercase Inter is about 0.7em per letter: the longest word must fit the text column whatever the title length.
  const size = Math.min(base * (length <= 14 ? 0.135 : length <= 26 ? 0.108 : 0.088), (width * 0.86) / (longest * 0.7))
  const stroke = size * 0.07
  const justify = spec.position === 'top' ? 'flex-start' : spec.position === 'bottom' ? 'flex-end' : 'center'
  const heavy: CSSProperties = {
    fontFamily: `"${FAMILY.inter}"`,
    fontWeight: 900,
    lineHeight: 1.04,
    letterSpacing: '-0.01em',
    // The outline sits behind the fill so thin joins stay open; the shadow lifts the words off busy pictures.
    WebkitTextStroke: `${stroke}px #000`,
    paintOrder: 'stroke fill',
    textShadow: `0 ${size * 0.05}px ${size * 0.12}px rgba(0, 0, 0, 0.55)`
  }

  return (
    <AbsoluteFill style={{ backgroundColor: color, overflow: 'hidden' }}>
      {imageSrc && <Img src={imageSrc} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />}
      <AbsoluteFill style={{ backgroundColor: `rgba(0, 0, 0, ${spec.dim})` }} />
      <AbsoluteFill style={{ display: 'flex', flexDirection: 'column', justifyContent: justify, padding: `${height * 0.14}px ${width * 0.07}px` }}>
        <div style={{ ...heavy, fontSize: size, color: '#fff', textWrap: 'balance', textAlign: 'left', maxWidth: '100%' }}>
          {/* A word never breaks at its hyphen ("AL-" / "FATIHAH"): whole words wrap instead. */}
          {head.split(' ').filter(Boolean).map((w, i) => (
            <span key={i}>
              <span style={{ whiteSpace: 'nowrap' }}>{w}</span>{' '}
            </span>
          ))}
          <span style={{ color: spec.accent, whiteSpace: 'nowrap' }}>{last}</span>
        </div>
        {spec.subtitle.trim() && (
          <div
            style={{
              marginTop: size * 0.22,
              fontFamily: `"${FAMILY.inter}"`,
              fontWeight: 700,
              fontSize: size * 0.34,
              color: '#fff',
              textShadow: `0 ${size * 0.02}px ${size * 0.08}px rgba(0, 0, 0, 0.7)`
            }}
          >
            {spec.subtitle}
          </div>
        )}
      </AbsoluteFill>
    </AbsoluteFill>
  )
}
