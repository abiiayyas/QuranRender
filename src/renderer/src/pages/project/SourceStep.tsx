import { useId, useState } from 'react'
import { t } from '@shared/i18n'
import { Icon, JobProgress, RangePicker, Segmented } from '../../components/ui'
import { formatMs } from '../../lib/format'
import { useSurahs } from '../../lib/quran'
import { useActiveJob, useProject } from '../../store/project'
import { LocalPanel } from './source/LocalPanel'
import { DuaPanel } from './source/DuaPanel'
import { ReciterPanel } from './source/ReciterPanel'
import { SOURCE_LABEL, SourceCard } from './source/SourceCard'
import { YoutubePanel } from './source/YoutubePanel'

type Tab = 'file' | 'reciter' | 'youtube' | 'dua'

export function SourceStep({ onNext }: { onNext: () => void }) {
  const project = useProject((s) => s.project)!
  const source = useProject((s) => (s.project?.sourceAssetId ? (s.assets[s.project.sourceAssetId] ?? null) : null))
  const surahs = useSurahs()
  const [tab, setTab] = useState<Tab>(project.dua ? 'dua' : 'file')
  const reciterId = useId()
  const tabs: { value: Tab; label: string }[] = [
    { value: 'file', label: t('Berkas') },
    { value: 'reciter', label: t('Qari') },
    { value: 'youtube', label: 'YouTube' },
    { value: 'dua', label: t('Doa') }
  ]
  const jobs = [
    { job: useActiveJob('download'), label: project.dua || tab === 'dua' ? t('Mengunduh doa') : t('Mengunduh tilawah') },
    { job: useActiveJob('ytdlp'), label: t('Menyiapkan yt-dlp') },
    { job: useActiveJob('youtube'), label: t('Mengunduh dari YouTube') },
    { job: useActiveJob('trim'), label: t('Memotong sumber') }
  ]
  const busy = jobs.some((j) => j.job)
  const timed = project.segments.length > 0 && project.segments.every((s) => s.source === 'qdc' || s.source === 'mp3quran' || s.source === 'opendua')

  return (
    <div className="st-body src-step">
      <aside className="st-left" aria-label={t('Pilihan sumber')}>
        <div className="st-left__body">
          <p className="pn-h">{t('Ambil rekaman dari')}</p>
          <div className="src-tabs">
            <Segmented options={tabs} value={tab} onChange={setTab} ariaLabel={t('Asal rekaman')} />
          </div>
          {tab === 'file' && <LocalPanel busy={busy} />}
          {tab === 'reciter' && <ReciterPanel busy={busy} />}
          {tab === 'youtube' && <YoutubePanel busy={busy} />}
          {tab === 'dua' && <DuaPanel busy={busy} />}
        </div>
      </aside>

      <section className="src-center" aria-label={t('Sumber proyek')}>
        <div className="src-main">
          {jobs.map(({ job, label }) => job && <JobProgress key={job.id} job={job} label={label} />)}
          {source ? (
            <SourceCard asset={source} busy={busy} />
          ) : (
            <div className="qr-empty">
              <span className="qr-empty__title">{t('Belum ada rekaman')}</span>
              <span>{t('Silakan impor berkas audio atau video, unduh tilawah qari, ambil dari YouTube, atau pilih doa OpenDua melalui panel di kiri.')}</span>
            </div>
          )}
        </div>
        <div className="src-foot">
          <span className="muted" role="status">
            {!source
              ? t('Tambahkan rekaman terlebih dahulu.')
              : project.dua
                ? t('{n} segmen doa siap. Silakan periksa di langkah Sinkron.', { n: project.segments.length })
                : timed
                  ? t('{n} segmen sudah siap dari waktu bawaan qari. Silakan periksa di langkah Sinkron.', { n: project.segments.length })
                  : t('Rekaman siap disinkronkan dengan ayat.')}
          </span>
          <button type="button" className="qr-btn qr-btn--primary" disabled={!source} onClick={onNext}>
            {t('Lanjut ke Sinkron')}
            <Icon name="chevron-right" />
          </button>
        </div>
      </section>

      <aside className="st-insp" aria-label={t('Detail proyek')}>
        {project.dua ? (
          <>
            <div className="qr-panel__head">
              <span className="qr-panel__title">{t('Doa')}</span>
            </div>
            <div className="insp-pad">
              <dl className="sum">
                <dt>{t('Judul')}</dt>
                <dd>{project.dua.title}</dd>
                {project.dua.chapterTitle && (
                  <>
                    <dt>{t('Bab')}</dt>
                    <dd>{project.dua.chapterTitle}</dd>
                  </>
                )}
              </dl>
              <span className="qr-help">{t('Teks Arab dan terjemahan Inggris diambil langsung dari OpenDua (Hisn al-Muslim).')}</span>
            </div>
          </>
        ) : (
          <>
            <div className="qr-panel__head">
              <span className="qr-panel__title">{t('Rentang ayat')}</span>
            </div>
            <div className="insp-pad">
              <RangePicker
                surahs={surahs}
                surah={project.surah}
                from={project.ayahFrom}
                to={project.ayahTo}
                onChange={(v) => useProject.getState().update({ surah: v.surah, ayahFrom: v.from, ayahTo: v.to }, 'range')}
              />
              <span className="qr-help">{t('Rentang dipakai saat mengunduh tilawah qari dan saat sinkronisasi. Mengubahnya tidak memotong rekaman.')}</span>
            </div>
          </>
        )}
        <div className="qr-panel__head">
          <span className="qr-panel__title">{t('Qari')}</span>
        </div>
        <div className="insp-pad">
          <div className="qr-fieldset">
            <label className="qr-label" htmlFor={reciterId}>
              {t('Nama qari')}
            </label>
            <span className="qr-field">
              <input
                id={reciterId}
                value={project.reciter}
                placeholder={t('Contoh: Mishary Rashid Alafasy')}
                onChange={(e) => useProject.getState().update({ reciter: e.target.value }, 'reciter')}
              />
            </span>
            <span className="qr-help">{t('Ditampilkan di video bila gaya memakai nama qari.')}</span>
          </div>
        </div>
        {source && (
          <>
            <div className="qr-panel__head">
              <span className="qr-panel__title">{t('Rekaman')}</span>
            </div>
            <div className="insp-pad">
              <dl className="sum">
                <dt>{t('Jenis')}</dt>
                <dd>{source.kind === 'video' ? t('Video') : t('Audio')}</dd>
                <dt>{t('Durasi')}</dt>
                <dd>{formatMs(source.durationMs)}</dd>
                <dt>{t('Asal')}</dt>
                <dd>{t(SOURCE_LABEL[source.source])}</dd>
                {source.width && source.height && (
                  <>
                    <dt>{t('Ukuran')}</dt>
                    <dd>{`${source.width} × ${source.height}`}</dd>
                  </>
                )}
                <dt>{t('Segmen')}</dt>
                <dd>{project.segments.length}</dd>
              </dl>
            </div>
          </>
        )}
      </aside>
    </div>
  )
}
