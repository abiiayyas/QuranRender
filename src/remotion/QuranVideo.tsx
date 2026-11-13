import { useMemo, type CSSProperties, type ReactNode } from 'react'
import { AbsoluteFill, Audio, Freeze, Img, Loop, OffthreadVideo, Sequence, spring, useCurrentFrame } from 'remotion'
import { bounceLeg, fadeFrames, fadeLayers } from '../shared/loop'
import { DEFAULT_MOTION, type LoopMode } from '../shared/motion'
import { CTA_DEFAULT_TEXT, overlayPhase, readableOn } from '../shared/overlay'
import type { Asset, Overlay } from '../shared/types'
import type { VideoProps } from '../shared/video'
import { SAFE_AREA, assetSrc, q, rgba, textShadow } from './common'
import { FAMILY, fontSpecs, useFonts } from './fonts'
import { MotionBackground } from './motion'
import { SegmentText } from './SegmentText'
import { VisualizerOverlay } from './Visualizer'
import { activeSegment } from './timing'

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

function BackgroundLayer({
  project,
  assets,
  baseUrl,
  fps,
  width,
  height,
  durationMs,
  unit,
  source,
  sourceIsBg
}: VideoProps & { unit: number; source: Asset | undefined; sourceIsBg: boolean }) {
  const frame = useCurrentFrame()
  const bg = project.background
  const dimmer = bg.dim > 0 && <AbsoluteFill style={{ backgroundColor: '#000000', opacity: bg.dim }} />
  if (bg.kind === 'motion') {
    return (
      <>
        <AbsoluteFill>
          <MotionBackground spec={bg.motion ?? DEFAULT_MOTION} width={width} height={height} frame={frame} fps={fps} />
        </AbsoluteFill>
        {dimmer}
      </>
    )
  }
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
    const clip = media.durationMs ? Math.max(1, Math.floor((media.durationMs * fps) / 1000)) : 0
    const total = Math.ceil((durationMs * fps) / 1000)
    el = <LoopedVideo src={src} style={fill} clip={clip} total={total} fps={fps} mode={bg.loop ?? 'repeat'} />
  }
  return (
    <>
      <AbsoluteFill>{el}</AbsoluteFill>
      {dimmer}
    </>
  )
}

/** A silent background clip that fills a longer timeline: restart, play back and forth, or crossfade at the seam. */
function LoopedVideo({ src, style, clip, total, fps, mode }: { src: string; style: CSSProperties; clip: number; total: number; fps: number; mode: LoopMode }) {
  const frame = useCurrentFrame()
  const video = <OffthreadVideo src={src} muted style={style} />
  if (clip === 0 || clip >= total) return video
  if (mode === 'bounce' && clip > 1) {
    // Forward legs are Sequences so they play natively (smooth in the Player). A video element cannot play backward, so
    // reverse legs show frozen frames instead. They sit outside any Sequence on purpose: inside one, the video's frame is
    // clamped to the Sequence's remaining length, which breaks the last, truncated leg of the timeline.
    const leg = bounceLeg(frame, clip)
    if (leg.reverse) return <Freeze key={leg.leg} frame={leg.frame}>{video}</Freeze>
    return (
      <Sequence key={leg.leg} from={leg.start} durationInFrames={clip - 1} layout="none">
        {video}
      </Sequence>
    )
  }
  const fade = fadeFrames(fps, clip)
  if (mode === 'fade' && fade > 0) {
    return (
      <>
        {fadeLayers(frame, clip, fade).map((l) => (
          <Sequence key={l.cycle} from={l.start} durationInFrames={clip} style={{ opacity: l.opacity }}>
            {video}
          </Sequence>
        ))}
      </>
    )
  }
  return <Loop durationInFrames={clip}>{video}</Loop>
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
  if (o.kind === 'qari') return <QariOverlay o={o} t={t} end={end} pos={pos} props={props} />
  if (o.kind === 'progress') return <ProgressOverlay o={o} t={t} end={end} props={props} />
  if (o.kind === 'cta') return <CtaOverlay o={o} t={t} end={end} pos={pos} props={props} />
  if (o.kind === 'visualizer') return <VisualizerOverlay o={o} t={t} props={props} />
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

interface TimedOverlay {
  o: Overlay
  t: number
  end: number
  props: VideoProps
}

const easeOut = (v: number): number => 1 - (1 - v) ** 3

/** Reciter and surah as a lower third that slides in, holds, and fades before its window ends. */
function QariOverlay({ o, t, end, pos, props }: TimedOverlay & { pos: CSSProperties }) {
  const { width, project, surah } = props
  const name = project.reciter.trim()
  if (!name) return null
  const { enter, exit } = overlayPhase(t, o.startMs, end)
  const e = easeOut(enter)
  const font = o.size * width
  return (
    <div
      style={{
        ...pos,
        opacity: o.opacity * e * (1 - exit),
        transform: `translate(calc(-50% + ${(1 - e) * -0.06 * width}px), -50%)`,
        display: 'flex',
        alignItems: 'stretch',
        gap: font * 0.55,
        maxWidth: width * 0.84,
        width: 'max-content',
        padding: `${font * 0.5}px ${font * 0.85}px ${font * 0.5}px ${font * 0.6}px`,
        borderRadius: font * 0.5,
        background: 'rgba(8, 9, 12, 0.62)',
        fontFamily: q(FAMILY.inter),
        color: '#FFFFFF'
      }}
    >
      <div style={{ width: font * 0.14, borderRadius: font, background: o.color, flex: 'none' }} />
      <div style={{ minWidth: 0 }}>
        <div dir="auto" style={{ fontWeight: 700, fontSize: font, lineHeight: 1.25 }}>
          {name}
        </div>
        {surah && (
          <div style={{ fontWeight: 500, fontSize: font * 0.68, lineHeight: 1.35, color: 'rgba(255, 255, 255, 0.78)' }}>{`Surah ${surah.nameLatin}`}</div>
        )}
      </div>
    </div>
  )
}

/** A thin rounded bar that fills across the overlay's own window. */
function ProgressOverlay({ o, t, end, props }: Omit<TimedOverlay, 'pos'>) {
  const { width, height, project } = props
  const { progress } = overlayPhase(t, o.startMs, end)
  const trackW = width * (1 - 2 * SAFE_AREA[project.aspect].side)
  const thick = Math.max(2, o.size * height)
  return (
    <div
      style={{
        position: 'absolute',
        left: o.x * width - trackW / 2,
        top: o.y * height - thick / 2,
        width: trackW,
        height: thick,
        borderRadius: thick,
        background: rgba(o.color, 0.28),
        opacity: o.opacity,
        overflow: 'hidden'
      }}
    >
      <div style={{ width: `${progress * 100}%`, height: '100%', borderRadius: thick, background: o.color }} />
    </div>
  )
}

/** A short call to action in a pill: pops in, pulses gently, fades before the end. */
function CtaOverlay({ o, t, end, pos, props }: TimedOverlay & { pos: CSSProperties }) {
  const { width, height, fps } = props
  const { exit } = overlayPhase(t, o.startMs, end)
  const sec = (t - o.startMs) / 1000
  const pop = spring({ frame: sec * fps, fps, config: { damping: 14, stiffness: 140, mass: 0.8 } })
  const pulse = 1 + 0.025 * Math.sin((sec * Math.PI * 2) / 1.8)
  const font = o.size * width
  const unit = Math.min(width, height)
  return (
    <div
      dir="auto"
      style={{
        ...pos,
        opacity: o.opacity * Math.min(1, pop * 1.6) * (1 - exit),
        transform: `translate(-50%, -50%) scale(${(0.8 + 0.2 * pop) * pulse})`,
        maxWidth: width * 0.84,
        width: 'max-content',
        textAlign: 'center',
        padding: `${font * 0.5}px ${font * 1.1}px`,
        borderRadius: font * 3,
        background: o.color,
        color: readableOn(o.color),
        boxShadow: `0 ${unit * 0.006}px ${unit * 0.02}px rgba(0, 0, 0, 0.35)`,
        fontFamily: q(FAMILY.inter),
        fontWeight: 700,
        fontSize: font,
        lineHeight: 1.3
      }}
    >
      {o.text.trim() || CTA_DEFAULT_TEXT}
    </div>
  )
}
