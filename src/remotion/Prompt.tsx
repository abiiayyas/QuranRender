import type { CSSProperties } from 'react'
import { msg, t } from '../shared/i18n'
import { readableOn } from '../shared/overlay'
import { PROMPT_DEFAULTS, promptPhase } from '../shared/subscribe'
import type { Overlay } from '../shared/types'
import type { VideoProps } from '../shared/video'
import { FAMILY } from './fonts'
import { q, textShadow } from './common'

/** The pill after it has been tapped: neutral, so "done" reads at a glance whatever colour the prompt was. */
const DONE_BG = '#2B2F36'

const easeOut = (v: number): number => 1 - (1 - v) ** 3

// Labels before and after the tap. Platform words (Subscribe, Follow) stay as people know them.
const LABEL = {
  subscribe: { idle: msg('Subscribe'), done: msg('Berlangganan') },
  follow: { idle: msg('Ikuti'), done: msg('Mengikuti') }
} as const

function Glyph({ name, size }: { name: 'bell' | 'plus' | 'check'; size: number }) {
  const d = {
    bell: 'M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9M10.3 21a1.94 1.94 0 0 0 3.4 0',
    plus: 'M12 5v14M5 12h14',
    check: 'M5 12.5l4.5 4.5L19 7.5'
  }[name]
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d={d} />
    </svg>
  )
}

/**
 * A subscribe or follow button that slides in, gets tapped, confirms, and slides out, then comes back every `cycle.everyMs`.
 * `o.text` is an optional account name shown under it; `o.size` is the label size as a fraction of the canvas width.
 */
export function PromptOverlay({ o, t: now, props }: { o: Overlay; t: number; props: VideoProps }) {
  const { width, height } = props
  const cycle = o.cycle ?? PROMPT_DEFAULTS
  const phase = promptPhase(now, o.startMs, cycle.everyMs, cycle.showMs)
  if (!phase) return null

  const variant = o.variant === 'follow' ? 'follow' : 'subscribe'
  const done = phase.tap >= 0.5
  const font = o.size * width
  const unit = Math.min(width, height)
  const enter = easeOut(phase.enter)
  // A quick dip in the middle of the tap reads as a press.
  const press = 1 - 0.08 * Math.sin(phase.tap * Math.PI)
  const bg = done ? DONE_BG : o.color
  // The bell rocks for a moment right after the tap, then settles.
  const ring = variant === 'subscribe' && done ? Math.sin(phase.local / 55) * 16 * Math.max(0, 1 - (phase.tap - 0.5) * 2 - (phase.local - 2200) / 1400) : 0
  const style: CSSProperties = {
    position: 'absolute',
    left: o.x * width,
    top: o.y * height,
    transform: `translate(-50%, calc(-50% + ${(1 - enter) * font * 1.6}px)) scale(${(0.9 + 0.1 * enter) * press})`,
    opacity: o.opacity * enter * (1 - phase.exit),
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: font * 0.45,
    fontFamily: q(FAMILY.inter)
  }
  return (
    <div style={style}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: font * 0.45,
          padding: `${font * 0.5}px ${font * 1.05}px`,
          borderRadius: font * 3,
          background: bg,
          color: readableOn(bg),
          boxShadow: `0 ${unit * 0.006}px ${unit * 0.02}px rgba(0, 0, 0, 0.35)`,
          fontWeight: 700,
          fontSize: font,
          lineHeight: 1.2,
          whiteSpace: 'nowrap'
        }}
      >
        <span style={{ display: 'inline-flex', transform: `rotate(${ring}deg)`, transformOrigin: '50% 10%' }}>
          <Glyph name={variant === 'follow' ? (done ? 'check' : 'plus') : 'bell'} size={font * 1.1} />
        </span>
        {t(LABEL[variant][done ? 'done' : 'idle'])}
      </div>
      {o.text.trim() && (
        <div dir="auto" style={{ color: '#FFFFFF', fontWeight: 600, fontSize: font * 0.72, textShadow: textShadow(unit) }}>
          {o.text.trim()}
        </div>
      )}
    </div>
  )
}
