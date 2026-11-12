import { useEffect, useRef } from 'react'
import { needsReview, segmentLabel } from '@shared/segments'
import type { Segment, Verse } from '@shared/types'
import { verseKey } from '@shared/video'
import { Icon } from '../../../components/ui'
import { formatMs } from '../../../lib/format'

export function ConfidenceBadge({ seg }: { seg: Segment }) {
  if (seg.confidence == null) return <span className="qr-badge qr-badge--plain">Manual</span>
  const pct = Math.round(seg.confidence * 100)
  return <span className={`qr-badge ${needsReview(seg) ? 'qr-badge--warning' : 'qr-badge--success'}`}>{pct}%</span>
}

/** Time-ordered segments; the selected row scrolls into view when the selection moves by keyboard or playback. */
export function SegmentList({
  segments,
  verses,
  selectedId,
  onSelect
}: {
  segments: ReadonlyArray<Segment>
  verses: Record<string, Verse>
  selectedId: string | null
  onSelect: (id: string) => void
}) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    ref.current?.querySelector('.is-selected')?.scrollIntoView({ block: 'nearest' })
  }, [selectedId])

  if (segments.length === 0)
    return <p className="pn-note">Belum ada segmen. Jalankan sinkron otomatis, atau tambahkan segmen secara manual di posisi pemutar.</p>

  return (
    <div className="seg-list" ref={ref} role="list" aria-label="Daftar segmen">
      {segments.map((s) => {
        const review = needsReview(s)
        const label = segmentLabel(s, verses[verseKey(s.surah, s.ayah)]?.words.length)
        return (
          <div role="listitem" key={s.id}>
            <button
              type="button"
              className={s.id === selectedId ? 'qr-item sync-row is-selected' : 'qr-item sync-row'}
              aria-current={s.id === selectedId ? 'true' : undefined}
              onClick={() => onSelect(s.id)}
            >
              <span className="qr-item__name">
                <b>{label}</b>
                <small className="qr-item__meta">
                  {formatMs(s.startMs)}–{formatMs(s.endMs)}
                </small>
              </span>
              {review && (
                <span className="sync-flag" title="Perlu dicek">
                  <Icon name="triangle-alert" size="sm" />
                  <span className="sr-only">Perlu dicek</span>
                </span>
              )}
              <ConfidenceBadge seg={s} />
            </button>
          </div>
        )
      })}
    </div>
  )
}
