import { useId } from 'react'
import { msg, t } from '@shared/i18n'
import { anchorOf, DEFAULT_MARGIN, marginOf, MAX_MARGIN, placeAt, type Edge } from '@shared/placement'
import type { Overlay } from '@shared/types'
import { canvasSize } from '@shared/video'
import { SAFE_AREA } from '@video/common'
import { useProject } from '../../../store/project'
import { setOverlay, Slider } from './controls'

const CELLS: { h: Edge; v: Edge; label: string }[] = [
  { h: 0, v: 0, label: msg('Kiri atas') },
  { h: 0.5, v: 0, label: msg('Atas tengah') },
  { h: 1, v: 0, label: msg('Kanan atas') },
  { h: 0, v: 0.5, label: msg('Kiri tengah') },
  { h: 0.5, v: 0.5, label: msg('Tengah') },
  { h: 1, v: 0.5, label: msg('Kanan tengah') },
  { h: 0, v: 1, label: msg('Kiri bawah') },
  { h: 0.5, v: 1, label: msg('Bawah tengah') },
  { h: 1, v: 1, label: msg('Kanan bawah') }
]

/**
 * Where an overlay goes: a 3 x 3 grid of places in the safe area, and how far from the edge it keeps once it is pinned to
 * one. The sliders below it still move it freely from there.
 */
export function PlacementControl({ o }: { o: Overlay }) {
  const labelId = useId()
  const aspect = useProject((s) => s.project!.aspect)
  const safe = SAFE_AREA[aspect]
  const size = canvasSize(aspect, 1080)
  const a = anchorOf(o)
  const pinned = a.x !== 0.5 || a.y !== 0.5
  const margin = marginOf(o, safe, size)

  return (
    <>
      <div className="ed-row ed-row--wide">
        <span className="ed-row__lbl" id={labelId}>
          {t('Letak')}
        </span>
        <div className="pos-grid" role="group" aria-labelledby={labelId}>
          {CELLS.map((c) => (
            <button
              key={`${c.h}-${c.v}`}
              type="button"
              className={c.h === a.x && c.v === a.y ? 'pos-grid__cell is-selected' : 'pos-grid__cell'}
              data-h={c.h}
              data-v={c.v}
              aria-pressed={c.h === a.x && c.v === a.y}
              aria-label={t(c.label)}
              title={t(c.label)}
              // Keeps the distance it already had from the edge; a first placement starts with a comfortable one.
              onClick={() => setOverlay(o.id, placeAt(c.h, c.v, pinned ? margin : DEFAULT_MARGIN, safe, size))}
            >
              <i />
            </button>
          ))}
        </div>
      </div>
      {pinned && (
        <Slider
          label={t('Jarak dari tepi aman')}
          value={margin}
          min={0}
          max={MAX_MARGIN}
          step={0.005}
          format={(v) => `${(v * 100).toFixed(1)}%`}
          onChange={(v) => setOverlay(o.id, placeAt(a.x, a.y, v, safe, size), `ovMargin${o.id}`)}
        />
      )}
    </>
  )
}
