import { t } from '@shared/i18n'
import { errorText } from '../lib/format'
import { toast } from '../store/app'
import { useJobs } from '../store/jobs'
import { Icon, JobProgress, Sheet } from './ui'

const ORDER: Record<string, number> = { running: 0, queued: 1, failed: 2, done: 3, canceled: 4 }

export function RenderQueueDialog() {
  const open = useJobs((s) => s.queueOpen)
  const items = useJobs((s) => s.items)
  const dismissed = useJobs((s) => s.dismissed)
  const closeQueue = useJobs((s) => s.closeQueue)
  const clearFinished = useJobs((s) => s.clearFinished)

  if (!open) return null

  const list = Object.values(items)
    .filter((j) => !dismissed[j.id])
    .sort((a, b) => (ORDER[a.status] ?? 9) - (ORDER[b.status] ?? 9) || b.createdAt - a.createdAt)
  const hasFinished = list.some((j) => j.status !== 'queued' && j.status !== 'running')

  return (
    <Sheet
      title={t('Antrean render')}
      size="md"
      onClose={closeQueue}
      footer={
        <>
          {hasFinished && (
            <button type="button" className="qr-btn qr-btn--ghost" onClick={clearFinished}>
              {t('Bersihkan yang selesai')}
            </button>
          )}
          <span className="spacer" />
          <button type="button" className="qr-btn qr-btn--primary" onClick={closeQueue}>
            {t('Tutup')}
          </button>
        </>
      }
    >
      <div className="stack">
        {list.length === 0 ? (
          <div className="qr-empty">
            <Icon name="film" size="lg" />
            <span className="qr-empty__title">{t('Belum ada antrean render')}</span>
            <span>{t('Ekspor yang berjalan di latar belakang atau dari ekspor batch akan tampil di sini.')}</span>
          </div>
        ) : (
          <ul className="rq-list">
            {list.map((j) => {
              const active = j.status === 'queued' || j.status === 'running'
              const badge =
                j.status === 'running'
                  ? 'qr-badge qr-badge--accent'
                  : j.status === 'queued'
                    ? 'qr-badge qr-badge--plain'
                    : j.status === 'done'
                      ? 'qr-badge qr-badge--success'
                      : j.status === 'failed'
                        ? 'qr-badge qr-badge--danger'
                        : 'qr-badge qr-badge--plain'
              const statusText =
                j.status === 'running'
                  ? t('Merender')
                  : j.status === 'queued'
                    ? t('Mengantre')
                    : j.status === 'done'
                      ? t('Selesai')
                      : j.status === 'failed'
                        ? t('Gagal')
                        : t('Dibatalkan')
              return (
                <li key={j.id} className="rq-row">
                  <div className="rq-row__head">
                    <strong className="rq-row__title">{j.projectTitle || t('Proyek tanpa judul')}</strong>
                    <span className={badge}>{statusText}</span>
                  </div>
                  {active && <JobProgress job={j} label={j.status === 'queued' ? t('Menunggu giliran render…') : t('Mengekspor video')} />}
                  {j.status === 'done' && j.message && (
                    <div className="rq-row__foot">
                      <span className="muted rq-row__path">{j.message}</span>
                      <button
                        type="button"
                        className="qr-btn qr-btn--secondary qr-btn--sm"
                        onClick={() => void window.api.exporter.reveal(j.message!).catch((e) => toast('error', errorText(e)))}
                      >
                        <Icon name="folder-open" size="sm" />
                        {t('Buka folder')}
                      </button>
                    </div>
                  )}
                  {j.status === 'failed' && j.error && <p className="qr-error">{j.error}</p>}
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </Sheet>
  )
}
