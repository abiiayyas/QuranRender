import type { CSSProperties } from 'react'
import type { StyleSettings } from '@shared/style'
import type { Aspect } from '@shared/types'

const RATIO: Record<Aspect, string> = { '16:9': '16 / 9', '9:16': '9 / 16', '1:1': '1' }

/** Abstract swatch of a video look: bars in its colours, never real text (Arabic is not decoration). */
export function LookThumb({ style: s, color, aspect = '1:1' }: { style: StyleSettings; color: string; aspect?: Aspect }) {
  const box = s.boxOpacity > 0
  return (
    <span className="preset-thumb" style={{ background: color, aspectRatio: RATIO[aspect] } as CSSProperties} aria-hidden="true">
      {s.frame && <span className="preset-thumb__frame" style={{ borderColor: s.frameColor }} />}
      <span className={box && s.boxStyle === 'band' ? 'preset-thumb__block is-band' : 'preset-thumb__block'} style={{ background: box ? s.boxColor : undefined }} data-pos={s.position}>
        <span className="preset-thumb__line">
          <i style={{ background: s.arabicColor, opacity: s.inactiveOpacity }} />
          <i style={{ background: s.highlight === 'none' ? s.arabicColor : s.highlightColor }} />
        </span>
        <span className="preset-thumb__line">
          <i style={{ background: s.arabicColor, opacity: s.inactiveOpacity }} />
        </span>
        {s.showTranslation && <span className="preset-thumb__tr" style={{ background: s.translationColor }} />}
      </span>
    </span>
  )
}
