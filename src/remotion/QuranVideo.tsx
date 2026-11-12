import { useMemo, type CSSProperties, type ReactNode } from 'react'
import { AbsoluteFill, Audio, Img, interpolateColors, Loop, OffthreadVideo, useCurrentFrame } from 'remotion'
import type { Aspect, Asset, Overlay, Segment } from '../shared/types'
import type { VideoProps } from '../shared/video'
import type { StyleSettings } from '../shared/style'
import { FAMILY, fontSpecs, qpcFamily, useFonts } from './fonts'
import { fitBlocks, splitWords, type Block, type BlockLayout, type Run } from './layout'
import { activeSegment, fadeAt, segmentWords, wordWeights, type DisplayWord } from './timing'

/** Margins kept clear of platform UI (captions, buttons), as fractions of the canvas. The editor draws the same guide. */
export const SAFE_AREA: Record<Aspect, { top: number; bottom: number; side: number }> = {
  '9:16': { top: 0.08, bottom: 0.14, side: 0.1 },
  '16:9': { top: 0.08, bottom: 0.08, side: 0.08 },
  '1:1': { top: 0.06, bottom: 0.06, side: 0.06 }
}

const AR_LINE = 1.9
const AR_LINE_MIN = 1.6
const TR_LINE = 1.4
const q = (family: string): string => `"${family}"`

const assetSrc = (base: string, projectId: string, a: Asset): string =>
  `${base}${encodeURIComponent(projectId)}/${a.path.split(/[\\/]/).map(encodeURIComponent).join('/')}`

export function QuranVideo(props: VideoProps) {
  const { project, assets, verses, width, height, fps, baseUrl } = props
  const frame = useCurrentFrame()
  const t = (frame / fps) * 1000
  const specs = useMemo(() => fontSpecs(project.script, verses), [project.script, verses])
  const ready = useFonts(baseUrl.font, specs)
  const unit = Math.min(width, height)
  const style = project.style
  const source = project.sourceAssetId ? assets[project.sourceAssetId] : undefined
  const sourceIsBg = project.background.kind === 'source' && source?.kind === 'video'
  const seg = activeSegment(project.segments, t)

  return (
    <AbsoluteFill style={{ backgroundColor: project.background.color, overflow: 'hidden' }}>
      <BackgroundLayer {...props} unit={unit} source={source} sourceIsBg={sourceIsBg} />
      {source && !sourceIsBg && <Audio src={assetSrc(baseUrl.asset, project.id, source)} />}
      {style.frame && <FrameLines color={style.frameColor} unit={unit} />}
      {style.showSurahName && props.surah && (
        <div
          dir="rtl"
          lang="ar"
          style={{
            position: 'absolute',
            top: height * SAFE_AREA[project.aspect].top,
            left: 0,
            right: 0,
            textAlign: 'center',
            fontFamily: q(FAMILY.amiri),
            fontWeight: 700,
            fontSize: unit * 0.055,
            lineHeight: 1.5,
            color: style.arabicColor,
            textShadow: style.shadow ? textShadow(unit) : undefined
          }}
        >
          {`سورة ${props.surah.nameArabic}`}
        </div>
      )}
      {style.showReciter && project.reciter.trim() !== '' && (
        <div
          style={{
            position: 'absolute',
            bottom: height * SAFE_AREA[project.aspect].bottom,
            left: 0,
            right: 0,
            display: 'flex',
            justifyContent: 'center'
          }}
        >
          <span
            style={{
              fontFamily: q(FAMILY.inter),
              fontWeight: 500,
              fontSize: unit * 0.028,
              lineHeight: 1.3,
              color: '#FFFFFF',
              background: 'rgba(8, 9, 12, 0.55)',
              borderRadius: unit * 0.04,
              padding: `${unit * 0.01}px ${unit * 0.028}px`
            }}
          >
            {project.reciter}
          </span>
        </div>
      )}
      {seg && <SegmentText key={seg.id} {...props} seg={seg} t={t} unit={unit} ready={ready} />}
      {project.overlays.map((o) => (
        <OverlayItem key={o.id} o={o} t={t} props={props} />
      ))}
    </AbsoluteFill>
  )
}

const textShadow = (unit: number): string => `0 ${unit * 0.003}px ${unit * 0.012}px rgba(0, 0, 0, 0.55)`

function BackgroundLayer({
  project,
  assets,
  baseUrl,
  fps,
  unit,
  source,
  sourceIsBg
}: VideoProps & { unit: number; source: Asset | undefined; sourceIsBg: boolean }) {
  const bg = project.background
  const media = sourceIsBg ? source : bg.kind === 'image' || bg.kind === 'video' ? (bg.assetId ? assets[bg.assetId] : undefined) : undefined
  if (!media) return null
  const blur = bg.blur > 0 ? (bg.blur * unit) / 1080 : 0
  // Blur pulls the edges in; a slight zoom keeps them off-canvas.
  const fill: CSSProperties = {
    width: '100%',
    height: '100%',
    objectFit: 'cover',
    filter: blur ? `blur(${blur}px)` : undefined,
    transform: blur ? 'scale(1.08)' : undefined
  }
  const src = assetSrc(baseUrl.asset, project.id, media)
  let el: ReactNode
  if (media.kind === 'image') el = <Img src={src} style={fill} />
  else if (sourceIsBg) el = <OffthreadVideo src={src} style={fill} />
  else {
    const video = <OffthreadVideo src={src} muted style={fill} />
    const frames = media.durationMs ? Math.max(1, Math.floor((media.durationMs * fps) / 1000)) : 0
    el = frames ? <Loop durationInFrames={frames}>{video}</Loop> : video
  }
  return (
    <>
      <AbsoluteFill>{el}</AbsoluteFill>
      {bg.dim > 0 && <AbsoluteFill style={{ backgroundColor: '#000000', opacity: bg.dim }} />}
    </>
  )
}

function FrameLines({ color, unit }: { color: string; unit: number }) {
  const line = (inset: number, w: number, opacity: number) => (
    <div style={{ position: 'absolute', inset: unit * inset, border: `${Math.max(1, unit * w)}px solid ${color}`, opacity }} />
  )
  return (
    <>
      {line(0.03, 0.003, 0.85)}
      {line(0.045, 0.0015, 0.45)}
    </>
  )
}

/** Hex `#rrggbb` → relative luminance 0..1, to pick a word-box alpha that keeps the text readable. */
function luminance(hex: string): number {
  const n = parseInt(hex.slice(1, 7), 16)
  if (Number.isNaN(n)) return 0
  return (0.2126 * ((n >> 16) & 255) + 0.7152 * ((n >> 8) & 255) + 0.0722 * (n & 255)) / 255
}

function arabicFamily(project: VideoProps['project'], seg: Segment, page: number | undefined): string {
  if (seg.kind === 'istiadzah') return project.script === 'uthmani' ? FAMILY.uthmani : FAMILY.lpmq
  if (project.script === 'qpc') return page ? qpcFamily(page) : FAMILY.lpmq
  return project.script === 'uthmani' ? FAMILY.uthmani : FAMILY.lpmq
}

function SegmentText({ project, verses, surah, width, height, seg, t, unit, ready }: VideoProps & { seg: Segment; t: number; unit: number; ready: boolean }) {
  const style = project.style
  const safe = SAFE_AREA[project.aspect]
  const { words, verse } = useMemo(() => segmentWords(seg, verses), [seg, verses])
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

  const layout = useMemo(() => {
    const blocks: Block[] = [
      { runs: words.map((w) => ({ text: w.text, family: arFamily })), size: style.arabicSize * unit, lineHeight: AR_LINE, minLineHeight: AR_LINE_MIN, pad: 0.14 }
    ]
    const gaps = [0]
    const trSize = style.translationSize * unit
    if (showTr) {
      const runs: Run[] = splitWords(translation, trFamily, 400, trSize, maxW).map((text) => ({ text, family: trFamily }))
      blocks.push({ runs, size: trSize, lineHeight: TR_LINE, minLineHeight: TR_LINE, pad: 0.13 })
      gaps.push(trSize * 0.6)
    }
    if (reference) {
      const refSize = unit * 0.026
      blocks.push({ runs: [{ text: reference, family: q(FAMILY.inter), weight: 500 }], size: refSize, lineHeight: 1.4, minLineHeight: 1.4, pad: 0 })
      gaps.push(refSize * 0.9)
    }
    return { ...fitBlocks(blocks, gaps, maxW, maxH), blocks, gaps }
    // `ready` invalidates measurements taken with fallback fonts.
  }, [words, arFamily, trFamily, translation, showTr, reference, style.arabicSize, style.translationSize, unit, maxW, maxH, ready])

  const opacity = fadeAt(t, seg.startMs, seg.endMs, style.fadeMs)
  const weights = style.highlight === 'none' ? null : wordWeights(words, seg.words, t, seg.endMs)
  const scale = layout.scale

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
          <div key={bi} style={{ marginTop: bi > 0 && l.lines.length > 0 ? layout.gaps[bi] * scale : 0 }}>
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

const rgba = (hex: string, a: number): string => {
  const n = parseInt(hex.slice(1, 7), 16)
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`
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

function OverlayItem({ o, t, props }: { o: Overlay; t: number; props: VideoProps }) {
  const end = o.endMs ?? props.durationMs
  if (t < o.startMs || t >= end) return null
  const { width, height, project, assets, baseUrl } = props
  const pos: CSSProperties = { position: 'absolute', left: o.x * width, top: o.y * height, transform: 'translate(-50%, -50%)', opacity: o.opacity }
  if (o.kind === 'image') {
    const a = o.assetId ? assets[o.assetId] : undefined
    if (!a) return null
    return <Img src={assetSrc(baseUrl.asset, project.id, a)} style={{ ...pos, width: o.size * width, height: 'auto' }} />
  }
  if (!o.text.trim()) return null
  return (
    <div
      dir="auto"
      style={{
        ...pos,
        maxWidth: width * 0.9,
        width: 'max-content',
        textAlign: 'center',
        whiteSpace: 'pre-wrap',
        fontFamily: q(FAMILY.inter),
        fontWeight: 600,
        fontSize: o.size * width,
        lineHeight: 1.3,
        color: o.color
      }}
    >
      {o.text}
    </div>
  )
}
