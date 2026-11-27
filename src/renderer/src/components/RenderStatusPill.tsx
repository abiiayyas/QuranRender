import { t } from '@shared/i18n'
import { useJobs } from '../store/jobs'
import { Icon } from './ui'

/** Global header pill showing background export progress, queue count, or recent completion. */
export function RenderStatusPill() {
  const items = useJobs((s) => s.items)
  const dismissed = useJobs((s) => s.dismissed)
  const openQueue = useJobs((s) => s.openQueue)

  const list = Object.values(items).filter((j) => !dismissed[j.id])
  const active = list.filter((j) => j.status === 'running' || j.status === 'queued')
  const running = active.find((j) => j.status === 'running') ?? active[0]
  const done = list.filter((j) => j.status === 'done')
  const failed = list.filter((j) => j.status === 'failed')

  if (active.length === 0 && done.length === 0 && failed.length === 0) return null

  if (running) {
    const pct = Math.round(running.progress * 100)
    const label = active.length > 1 ? t('Merender {n} antrean · {pct}%', { n: active.length, pct }) : t('Merender {pct}%', { pct })
    return (
      <button type="button" className="qr-btn qr-btn--secondary qr-btn--sm render-pill is-running" onClick={openQueue} aria-label={t('Buka antrean render: {label}', { label })}>
        <span className="qr-spin" aria-hidden="true" />
        <span>{label}</span>
      </button>
    )
  }

  if (failed.length > 0) {
    return (
      <button type="button" className="qr-btn qr-btn--secondary qr-btn--sm render-pill is-error" onClick={openQueue}>
        <Icon name="circle-alert" size="sm" />
        <span>{t('Render gagal')}</span>
      </button>
    )
  }

  return (
    <button type="button" className="qr-btn qr-btn--secondary qr-btn--sm render-pill is-done" onClick={openQueue}>
      <Icon name="circle-check" size="sm" />
      <span>{done.length > 1 ? t('{n} ekspor selesai', { n: done.length }) : t('Ekspor selesai')}</span>
    </button>
  )
}
