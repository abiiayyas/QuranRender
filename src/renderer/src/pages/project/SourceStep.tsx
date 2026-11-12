import { useId, useState } from 'react'
import { Icon, JobProgress, RangePicker, Segmented } from '../../components/ui'
import { formatMs } from '../../lib/format'
import { useSurahs } from '../../lib/quran'
import { useActiveJob, useProject } from '../../store/project'
import { LocalPanel } from './source/LocalPanel'
import { ReciterPanel } from './source/ReciterPanel'
import { SOURCE_LABEL, SourceCard } from './source/SourceCard'
import { YoutubePanel } from './source/YoutubePanel'

type Tab = 'file' | 'reciter' | 'youtube'

const TABS: { value: Tab; label: string }[] = [
  { value: 'file', label: 'Berkas' },
  { value: 'reciter', label: 'Qari' },
  { value: 'youtube', label: 'YouTube' }
]

export function SourceStep({ onNext }: { onNext: () => void }) {
  const project = useProject((s) => s.project)!
  const source = useProject((s) => (s.project?.sourceAssetId ? (s.assets[s.project.sourceAssetId] ?? null) : null))
  const surahs = useSurahs()
  const [tab, setTab] = useState<Tab>('file')
  const reciterId = useId()
  const jobs = [
    { job: useActiveJob('download'), label: 'Mengunduh tilawah' },
    { job: useActiveJob('ytdlp'), label: 'Menyiapkan yt-dlp' },
    { job: useActiveJob('youtube'), label: 'Mengunduh dari YouTube' },
    { job: useActiveJob('trim'), label: 'Memotong sumber' }
  ]
  const busy = jobs.some((j) => j.job)
  const timed = project.segments.length > 0 && project.segments.every((s) => s.source === 'qdc' || s.source === 'mp3quran')

  return (
    <div className="st-body src-step">
      <aside className="st-left" aria-label="Pilihan sumber">
        <div className="st-left__body">
          <p className="pn-h">Ambil rekaman dari</p>
          <Segmented options={TABS} value={tab} onChange={setTab} ariaLabel="Asal rekaman" />
          {tab === 'file' && <LocalPanel busy={busy} />}
          {tab === 'reciter' && <ReciterPanel busy={busy} />}
          {tab === 'youtube' && <YoutubePanel busy={busy} />}
        </div>
      </aside>

      <section className="src-center" aria-label="Sumber proyek">
        <div className="src-main">
          {jobs.map(({ job, label }) => job && <JobProgress key={job.id} job={job} label={label} />)}
          {source ? (
            <SourceCard asset={source} busy={busy} />
          ) : (
            <div className="qr-empty">
              <span className="qr-empty__title">Belum ada rekaman</span>
              <span>Silakan impor berkas audio atau video, unduh tilawah qari, atau ambil dari YouTube melalui panel di kiri.</span>
            </div>
          )}
        </div>
        <div className="src-foot">
          <span className="muted" role="status">
            {!source
              ? 'Tambahkan rekaman terlebih dahulu.'
              : timed
                ? `${project.segments.length} segmen sudah siap dari waktu bawaan qari. Silakan periksa di langkah Sinkron.`
                : 'Rekaman siap disinkronkan dengan ayat.'}
          </span>
          <button type="button" className="qr-btn qr-btn--primary" disabled={!source} onClick={onNext}>
            Lanjut ke Sinkron
            <Icon name="chevron-right" />
          </button>
        </div>
      </section>

      <aside className="st-insp" aria-label="Detail proyek">
        <div className="qr-panel__head">
          <span className="qr-panel__title">Rentang ayat</span>
        </div>
        <div className="insp-pad">
          <RangePicker
            surahs={surahs}
            surah={project.surah}
            from={project.ayahFrom}
            to={project.ayahTo}
            onChange={(v) => useProject.getState().update({ surah: v.surah, ayahFrom: v.from, ayahTo: v.to }, 'range')}
          />
          <span className="qr-help">Rentang dipakai saat mengunduh tilawah qari dan saat sinkronisasi. Mengubahnya tidak memotong rekaman.</span>
        </div>
        <div className="qr-panel__head">
          <span className="qr-panel__title">Qari</span>
        </div>
        <div className="insp-pad">
          <div className="qr-fieldset">
            <label className="qr-label" htmlFor={reciterId}>
              Nama qari
            </label>
            <span className="qr-field">
              <input
                id={reciterId}
                value={project.reciter}
                placeholder="Contoh: Mishary Rashid Alafasy"
                onChange={(e) => useProject.getState().update({ reciter: e.target.value }, 'reciter')}
              />
            </span>
            <span className="qr-help">Ditampilkan di video bila gaya memakai nama qari.</span>
          </div>
        </div>
        {source && (
          <>
            <div className="qr-panel__head">
              <span className="qr-panel__title">Rekaman</span>
            </div>
            <div className="insp-pad">
              <dl className="sum">
                <dt>Jenis</dt>
                <dd>{source.kind === 'video' ? 'Video' : 'Audio'}</dd>
                <dt>Durasi</dt>
                <dd>{formatMs(source.durationMs)}</dd>
                <dt>Asal</dt>
                <dd>{SOURCE_LABEL[source.source]}</dd>
                {source.width && source.height && (
                  <>
                    <dt>Ukuran</dt>
                    <dd>{`${source.width} × ${source.height}`}</dd>
                  </>
                )}
                <dt>Segmen</dt>
                <dd>{project.segments.length}</dd>
              </dl>
            </div>
          </>
        )}
      </aside>
    </div>
  )
}
