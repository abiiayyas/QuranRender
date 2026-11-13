import { memo } from 'react'
import { msg, t } from '@shared/i18n'
import { STATUS_LABEL } from '@shared/translation'
import type { Segment, TranslationStatus } from '@shared/types'
import { Icon } from '../../../components/ui'
import { formatMs } from '../../../lib/format'

// Marks the labels of STATUS_LABEL (shared, Indonesian) so they are translated where shown.
msg('Utuh')
msg('Dipotong otomatis')
msg('Dipotong AI')
msg('Diedit')
msg('Perlu dicek')

const BADGE: Record<TranslationStatus, string> = {
  full: 'qr-badge qr-badge--plain',
  auto: 'qr-badge qr-badge--accent',
  ai: 'qr-badge qr-badge--accent',
  manual: 'qr-badge qr-badge--success',
  review: 'qr-badge qr-badge--warning'
}

function StatusBadge({ status }: { status: TranslationStatus | null }) {
  if (!status) return <span className="qr-badge qr-badge--danger">{t('Belum ada')}</span>
  return <span className={BADGE[status]}>{t(STATUS_LABEL[status])}</span>
}

export interface SegmentRowProps {
  seg: Segment
  label: string
  arabic: string
  primary: string | null
  /** Whole-ayah primary text, shown under partial segments as the reference to cut from. */
  whole: string | null
  partial: boolean
  secondaries: { id: string; name: string }[]
  playing: boolean
  aiBusy: boolean
  /** The text cannot fit one screen at readable sizes. */
  tooLong: boolean
  splitBusy: boolean
  onPlay(seg: Segment): void
  onEdit(segId: string, text: string): void
  onAccept(segId: string): void
  onAi(segId: string): void
  onSplit(segId: string): void
}

export const SegmentRow = memo(function SegmentRow(p: SegmentRowProps) {
  const { seg } = p
  const entry = p.primary ? seg.translations.find((x) => x.edition === p.primary) : undefined
  const status = entry?.status ?? null
  return (
    <li className={p.playing ? 'tx-row is-playing' : 'tx-row'}>
      <div className="tx-row__head">
        <button
          type="button"
          className="qr-btn qr-btn--ghost qr-btn--icon qr-btn--sm"
          aria-label={p.playing ? t('Jeda {label}', { label: p.label }) : t('Putar {label}', { label: p.label })}
          onClick={() => p.onPlay(seg)}
        >
          <Icon name={p.playing ? 'pause' : 'play'} size="sm" />
        </button>
        <span className="tx-row__label">
          <b>{p.label}</b>
          <small>
            {formatMs(seg.startMs)} – {formatMs(seg.endMs)}
          </small>
        </span>
        {p.tooLong && (
          <span className="qr-badge qr-badge--warning" title={t('Tulisan akan terlalu kecil atau menutupi bagian lain. Silakan belah segmen ini.')}>
            {t('Terlalu panjang untuk satu layar')}
          </span>
        )}
        {p.primary && <StatusBadge status={status} />}
      </div>
      {p.arabic && (
        <p className="tr-arabic" dir="rtl" lang="ar">
          {p.arabic}
        </p>
      )}
      {p.partial && p.whole && (
        <p className="tr-whole">
          <span className="tx-row__k">{t('Terjemahan ayat utuh:')}</span> {p.whole}
        </p>
      )}
      {p.primary && (
        <textarea
          className="tr-edit"
          rows={2}
          aria-label={t('Terjemahan {label}', { label: p.label })}
          placeholder={t('Terjemahan belum diisi.')}
          value={entry?.text ?? ''}
          onChange={(e) => p.onEdit(seg.id, e.target.value)}
        />
      )}
      {((p.primary && (status === 'review' || p.partial)) || p.tooLong) && (
        <div className="tr-actions">
          {status === 'review' && entry?.text && (
            <button type="button" className="qr-btn qr-btn--secondary qr-btn--sm" onClick={() => p.onAccept(seg.id)}>
              <Icon name="check" size="sm" />
              {t('Sudah benar')}
            </button>
          )}
          {p.tooLong && seg.kind === 'ayah' && (
            <button type="button" className="qr-btn qr-btn--secondary qr-btn--sm" disabled={p.splitBusy} onClick={() => p.onSplit(seg.id)}>
              <Icon name="scissors" size="sm" />
              {t('Belah otomatis')}
            </button>
          )}
          {p.primary && p.partial && (
            <button type="button" className="qr-btn qr-btn--ghost qr-btn--sm" disabled={p.aiBusy} onClick={() => p.onAi(seg.id)}>
              <Icon name="scissors" size="sm" />
              {t('Potong dengan AI')}
            </button>
          )}
        </div>
      )}
      {p.secondaries.map((ed) => {
        const tr = seg.translations.find((x) => x.edition === ed.id)
        return (
          <p key={ed.id} className="tx-sec">
            <span className="tx-row__k">{ed.name}</span>
            {tr?.text || <span className="muted">{t('Belum diisi.')}</span>}
            {tr?.status === 'review' && <span className="qr-badge qr-badge--warning">{t(STATUS_LABEL.review)}</span>}
          </p>
        )
      })}
    </li>
  )
})
