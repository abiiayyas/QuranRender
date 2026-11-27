import type { CSSProperties } from 'react'
import { t } from '@shared/i18n'
import { useUpdater } from '../store/updater'
import { toast } from '../store/app'
import { errorText } from '../lib/format'
import { Icon } from './ui'

/** Non-intrusive banner on Home when a newer GitHub Release is available, downloading, or ready to open. */
export function UpdateBanner() {
  const state = useUpdater((s) => s.state)
  const dismissedVersion = useUpdater((s) => s.dismissedVersion)
  const download = useUpdater((s) => s.download)
  const open = useUpdater((s) => s.open)
  const dismiss = useUpdater((s) => s.dismiss)

  const info = state.info
  if (!info || !info.available) return null
  if (state.status !== 'available' && state.status !== 'downloading' && state.status !== 'downloaded') return null
  if (state.status === 'available' && dismissedVersion === info.latestVersion) return null

  const pct = Math.round(state.progress * 100)

  return (
    <section className="qr-panel upd-banner" aria-label={t('Pembaruan aplikasi')}>
      <div className="upd-banner__body">
        <div className="upd-banner__title">
          <Icon name="download" size="sm" />
          <strong>
            {state.status === 'downloading'
              ? t('Mengunduh Quran Render v{version}… {pct}%', { version: info.latestVersion, pct })
              : state.status === 'downloaded'
                ? t('Pembaruan v{version} siap dipasang', { version: info.latestVersion })
                : t('Versi baru tersedia: v{version}', { version: info.latestVersion })}
          </strong>
        </div>
        {state.status === 'available' && info.notes && (
          <p className="upd-banner__notes">{info.notes.split('\n').find((l) => l.trim()) ?? ''}</p>
        )}
        {state.status === 'downloading' && (
          <span
            className="qr-progress"
            style={{ '--v': state.progress } as CSSProperties}
            role="progressbar"
            aria-label={t('Mengunduh pembaruan')}
            aria-valuenow={pct}
            aria-valuemin={0}
            aria-valuemax={100}
          />
        )}
      </div>
      <div className="upd-banner__actions">
        {state.status === 'available' && (
          <>
            <button type="button" className="qr-btn qr-btn--primary qr-btn--sm" onClick={() => void download()}>
              <Icon name="download" size="sm" />
              {t('Unduh & pasang')}
            </button>
            <button
              type="button"
              className="qr-btn qr-btn--ghost qr-btn--sm"
              onClick={() => void window.api.app.openExternal(info.releaseUrl).catch((e) => toast('error', errorText(e)))}
            >
              {t('Catatan rilis')}
              <Icon name="external-link" size="sm" />
            </button>
            <button type="button" className="qr-btn qr-btn--ghost qr-btn--sm" onClick={dismiss}>
              {t('Nanti')}
            </button>
          </>
        )}
        {state.status === 'downloaded' && (
          <>
            <button type="button" className="qr-btn qr-btn--primary qr-btn--sm" onClick={() => void open()}>
              <Icon name="folder-open" size="sm" />
              {t('Buka installer')}
            </button>
            <button type="button" className="qr-btn qr-btn--ghost qr-btn--sm" onClick={dismiss}>
              {t('Tutup')}
            </button>
          </>
        )}
      </div>
    </section>
  )
}
