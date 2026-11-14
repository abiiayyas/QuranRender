import { useId } from 'react'
import { formatTime, overlaysOutside, rangeContents, rangeLengthMs, snapToSegments, type ExportRange, type RangeInputProblem } from '@shared/exportRange'
import { msg, t } from '@shared/i18n'
import { segmentLabel } from '@shared/segments'
import type { Overlay, Segment } from '@shared/types'
import { Icon, Segmented } from '../../components/ui'

export interface RangeInput {
  scope: 'all' | 'range'
  fromText: string
  toText: string
}

const PROBLEM: Record<RangeInputProblem, string> = {
  format: msg('Tulis waktu seperti 10:00, 1:23.5, atau 83 (detik).'),
  order: msg('Akhir rentang harus setelah awalnya.'),
  beyond: msg('Awal rentang ada di luar rekaman.'),
  short: msg('Rentang paling pendek 1 detik.')
}

/**
 * Which part of the recording becomes the video: all of it, or a stretch between two times. Says what the stretch holds and
 * what it cuts through, because a short that starts in the middle of a verse is usually a slip.
 */
export function ExportRangeFields({
  value,
  onChange,
  range,
  problem,
  durationMs,
  fps,
  segments,
  overlays,
  disabled
}: {
  value: RangeInput
  onChange: (next: RangeInput) => void
  /** The valid range the two fields make; null when they are wrong or the scope is the whole video. */
  range: ExportRange | null
  problem: RangeInputProblem | null
  durationMs: number
  fps: number
  segments: readonly Segment[]
  overlays: readonly Overlay[]
  disabled: boolean
}) {
  const ids = { scope: useId(), from: useId(), to: useId() }
  const contents = range ? rangeContents(segments, range) : null
  const first = contents?.segments[0]
  const last = contents?.segments.at(-1)
  const outside = range ? overlaysOutside(overlays, durationMs, range) : []
  const snap = range ? snapToSegments(segments, range) : null
  const needsSnap = !!snap && (snap.fromMs !== range!.fromMs || snap.toMs !== range!.toMs)

  return (
    <div className="qr-fieldset">
      <span className="qr-label" id={ids.scope}>
        {t('Bagian yang diekspor')}
      </span>
      <Segmented<RangeInput['scope']>
        labelledBy={ids.scope}
        value={value.scope}
        onChange={(scope) => onChange({ ...value, scope })}
        options={[
          { value: 'all', label: t('Seluruh video'), disabled },
          { value: 'range', label: t('Hanya sebagian'), disabled }
        ]}
      />
      {value.scope === 'range' && (
        <>
          <div className="exp-range">
            <label className="qr-label" htmlFor={ids.from}>
              {t('Mulai')}
            </label>
            <span className="qr-field">
              <input id={ids.from} value={value.fromText} disabled={disabled} inputMode="decimal" placeholder="0:00" aria-invalid={problem !== null} onChange={(e) => onChange({ ...value, fromText: e.target.value })} />
            </span>
            <label className="qr-label" htmlFor={ids.to}>
              {t('Sampai')}
            </label>
            <span className="qr-field">
              <input id={ids.to} value={value.toText} disabled={disabled} inputMode="decimal" placeholder={formatTime(durationMs)} aria-invalid={problem !== null} onChange={(e) => onChange({ ...value, toText: e.target.value })} />
            </span>
          </div>
          {problem && (
            <p className="qr-help exp-range__bad" role="alert">
              {t(PROBLEM[problem])}
            </p>
          )}
          {range && (
            <>
              <p className="qr-help">
                {t('Panjang hasil: {time}.', { time: formatTime(rangeLengthMs(range, durationMs, fps)) })}{' '}
                {first && last
                  ? first === last
                    ? t('Berisi QS {a}.', { a: segmentLabel(first) })
                    : t('Berisi QS {a} sampai {b} ({n} segmen).', { a: segmentLabel(first), b: segmentLabel(last), n: contents!.segments.length })
                  : t('Tidak ada segmen di rentang ini.')}
              </p>
              {(contents!.cutStart || contents!.cutEnd) && (
                <p className="qr-help exp-range__warn">
                  <Icon name="triangle-alert" size="sm" />
                  {contents!.cutStart && contents!.cutEnd && contents!.cutStart !== contents!.cutEnd
                    ? t('Rentang memotong QS {a} di awal dan QS {b} di akhir.', { a: segmentLabel(contents!.cutStart), b: segmentLabel(contents!.cutEnd) })
                    : contents!.cutStart && contents!.cutStart === contents!.cutEnd
                      ? t('Rentang memotong QS {a} di kedua ujungnya.', { a: segmentLabel(contents!.cutStart) })
                      : contents!.cutStart
                        ? t('Rentang mulai di tengah QS {a}.', { a: segmentLabel(contents!.cutStart) })
                        : t('Rentang berakhir di tengah QS {b}.', { b: segmentLabel(contents!.cutEnd!) })}
                </p>
              )}
              {needsSnap && snap && (
                <button
                  type="button"
                  className="qr-btn qr-btn--secondary qr-btn--sm"
                  disabled={disabled}
                  onClick={() => onChange({ ...value, fromText: formatTime(snap.fromMs, true), toText: formatTime(snap.toMs, true) })}
                >
                  {t('Rapikan ke batas ayat ({from} sampai {to})', { from: formatTime(snap.fromMs, true), to: formatTime(snap.toMs, true) })}
                </button>
              )}
              {outside.length > 0 && <p className="qr-help">{t('{n} overlay diatur di luar rentang ini, jadi tidak tampil. Overlay yang diatur sampai akhir video ikut dari awal hasil.', { n: outside.length })}</p>}
            </>
          )}
        </>
      )}
    </div>
  )
}
