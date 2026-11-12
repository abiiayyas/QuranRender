import { useState } from 'react'
import { ErrorAlert, Icon, JobProgress, Segmented } from '../../../components/ui'
import { errorText } from '../../../lib/format'
import { confirmDialog, toast } from '../../../store/app'
import { useActiveJob, useProject } from '../../../store/project'

type Model = 'base' | 'large'

/** "Sinkron otomatis (AI)": runs the cloud aligner over the source and shows its progress or last failure. */
export function AlignPanel() {
  const [model, setModel] = useState<Model>('base')
  const [dismissed, setDismissed] = useState<string | null>(null)
  const active = useActiveJob('align')
  const last = useProject((s) =>
    Object.values(s.jobs)
      .filter((j) => j.kind === 'align')
      .sort((a, b) => b.createdAt - a.createdAt)[0]
  )

  const start = async () => {
    const st = useProject.getState()
    if (!st.project) return
    if (st.project.segments.length > 0) {
      const ok = await confirmDialog({
        title: 'Ganti segmen yang ada?',
        body: `Proyek ini sudah punya ${st.project.segments.length} segmen. Sinkron otomatis akan menggantinya dengan hasil baru, termasuk suntingan waktu dan terjemahan per segmen. Anda masih bisa membatalkannya dengan Urungkan.`,
        confirmLabel: 'Ganti segmen',
        danger: true
      })
      if (!ok) return
    }
    try {
      await st.flush()
      const job = await window.api.sync.align(st.project.id, model)
      useProject.getState().upsertJob(job)
    } catch (e) {
      toast('error', errorText(e))
    }
  }

  const failed = last && last.status === 'failed' && last.id !== dismissed ? last : null
  const done = last && last.status === 'done' && last.message && last.id !== dismissed ? last : null

  return (
    <section className="sync-ai stack" aria-labelledby="sync-ai-title">
      <h2 className="pn-h" id="sync-ai-title">
        Sinkron otomatis (AI)
      </h2>
      <Segmented<Model>
        ariaLabel="Model penyelaras"
        value={model}
        onChange={setModel}
        options={[
          { value: 'base', label: 'Base', title: 'Lebih cepat, cukup untuk tilawah yang jelas' },
          { value: 'large', label: 'Large', title: 'Lebih teliti, lebih lama' }
        ]}
      />
      <p className="pn-note">Audio dikirim ke layanan publik Hugging Face Space (Quranic Universal Aligner) untuk dikenali ayat dan waktu katanya.</p>
      <button type="button" className="qr-btn qr-btn--primary" disabled={!!active} onClick={() => void start()}>
        <Icon name="audio-waveform" />
        Mulai sinkron otomatis
      </button>
      <JobProgress job={active} label="Menyinkronkan" />
      {!active && failed && <ErrorAlert title="Sinkron otomatis gagal" message={failed.error ?? 'Terjadi kesalahan.'} onClose={() => setDismissed(failed.id)} />}
      {!active && done && (
        <div className="qr-alert qr-alert--success" role="status">
          <Icon name="circle-check" />
          <div className="qr-alert__content">
            <span className="qr-alert__body">{done.message}</span>
          </div>
          <span className="qr-alert__actions">
            <button type="button" className="qr-btn qr-btn--ghost qr-btn--sm" onClick={() => setDismissed(done.id)}>
              Tutup
            </button>
          </span>
        </div>
      )}
    </section>
  )
}
