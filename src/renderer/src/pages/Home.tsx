import { useEffect, useState } from 'react'
import type { Aspect, ArabicScript, ProjectSummary } from '@shared/types'
import logoDark from '../../../../design/brand/logo/playhead-lockup-dark.svg'
import logoLight from '../../../../design/brand/logo/playhead-lockup-light.svg'
import { Icon, RangePicker, Segmented } from '../components/ui'
import { errorText, formatDate, formatMs } from '../lib/format'
import { rangeLabel, useSurahs } from '../lib/quran'
import { confirmDialog, toast, useApp } from '../store/app'

export const ASPECTS: { value: Aspect; label: string }[] = [
  { value: '9:16', label: '9:16 Shorts/Reels' },
  { value: '16:9', label: '16:9 YouTube' },
  { value: '1:1', label: '1:1 Feed' }
]

export const SCRIPTS: { value: ArabicScript; label: string }[] = [
  { value: 'kemenag', label: 'Kemenag (LPMQ)' },
  { value: 'uthmani', label: 'Uthmani Hafs' },
  { value: 'qpc', label: 'QPC Madinah' }
]

const STATUS_LABEL: Record<ProjectSummary['status'], string> = {
  draft: 'Draf',
  source: 'Ada audio',
  synced: 'Tersinkron',
  editing: 'Disunting',
  exported: 'Diekspor'
}

export function Brand() {
  return (
    <span className="brand">
      <img className="only-light" src={logoLight} alt="Quran Render" />
      <img className="only-dark" src={logoDark} alt="Quran Render" />
    </span>
  )
}

export function Home() {
  const go = useApp((s) => s.go)
  const surahs = useSurahs()
  const [projects, setProjects] = useState<ProjectSummary[] | null>(null)
  const [range, setRange] = useState<{ surah: number | null; from: number | null; to: number | null }>({ surah: null, from: null, to: null })
  const [reciter, setReciter] = useState('')
  const [aspect, setAspect] = useState<Aspect>('9:16')
  const [script, setScript] = useState<ArabicScript>('kemenag')
  const [busy, setBusy] = useState(false)

  const refresh = () => void window.api.projects.list().then(setProjects, (e) => toast('error', errorText(e)))
  useEffect(() => {
    refresh()
    void window.api.settings.get().then((s) => setScript(s.script))
  }, [])

  const start = async () => {
    setBusy(true)
    try {
      const title = range.surah ? rangeLabel(surahs, range.surah, range.from, range.to) : 'Proyek tanpa judul'
      const p = await window.api.projects.create({ title, aspect, script, reciter: reciter.trim(), surah: range.surah, ayahFrom: range.from, ayahTo: range.to })
      go({ name: 'project', id: p.id })
    } catch (e) {
      toast('error', errorText(e))
      setBusy(false)
    }
  }

  const remove = async (p: ProjectSummary) => {
    const ok = await confirmDialog({ title: 'Hapus proyek?', body: `"${p.title}" dan semua berkasnya akan dihapus permanen.`, confirmLabel: 'Hapus', danger: true })
    if (!ok) return
    await window.api.projects.remove(p.id).catch((e) => toast('error', errorText(e)))
    refresh()
  }

  const duplicate = async (p: ProjectSummary) => {
    await window.api.projects.duplicate(p.id).catch((e) => toast('error', errorText(e)))
    refresh()
  }

  return (
    <div className="home">
      <header className="app-hd">
        <Brand />
        <span className="spacer" />
        <button type="button" className="qr-btn qr-btn--ghost" onClick={() => go({ name: 'settings', back: { name: 'home' } })}>
          <Icon name="settings" />
          Pengaturan
        </button>
      </header>
      <main className="step-scroll">
        <div className="step-narrow">
          <section className="qr-panel" aria-labelledby="new-h">
            <div className="qr-panel__head">
              <h1 className="qr-panel__title" id="new-h">
                Video baru
              </h1>
            </div>
            <div className="insp-pad">
              <RangePicker surahs={surahs} surah={range.surah} from={range.from} to={range.to} onChange={(v) => setRange(v)} />
              <span className="qr-help">Rentang ayat boleh dikosongkan: sinkron AI bisa mengenali ayatnya dari audio.</span>
              <div className="qr-fieldset">
                <label className="qr-label" htmlFor="reciter">
                  Qari
                </label>
                <span className="qr-field">
                  <input id="reciter" value={reciter} placeholder="Nama qari (bisa diisi nanti)" onChange={(e) => setReciter(e.target.value)} />
                </span>
              </div>
              <div className="field-row">
                <span className="lbl">Format</span>
                <Segmented ariaLabel="Format video" value={aspect} onChange={setAspect} options={ASPECTS} />
              </div>
              <div className="field-row">
                <span className="lbl">Teks Arab</span>
                <Segmented ariaLabel="Teks Arab" value={script} onChange={setScript} options={SCRIPTS} />
              </div>
              <div>
                <button type="button" className="qr-btn qr-btn--primary" disabled={busy} onClick={() => void start()}>
                  <Icon name="plus" />
                  Mulai
                </button>
              </div>
            </div>
          </section>

          <section aria-labelledby="list-h" className="stack">
            <h2 className="pn-h" id="list-h">
              Proyek
            </h2>
            {projects && projects.length === 0 && <p className="muted">Belum ada proyek. Pilih surah di atas lalu klik Mulai.</p>}
            <div className="grid">
              {projects?.map((p) => (
                <div key={p.id} className="card-wrap">
                  <button type="button" className="qr-card" onClick={() => go({ name: 'project', id: p.id })}>
                    <span className="qr-card__thumb">
                      <Icon name="audio-waveform" />
                      {p.durationMs != null && <span className="qr-card__dur">{formatMs(p.durationMs)}</span>}
                    </span>
                    <span className="qr-card__body">
                      <span className="qr-card__title">{p.title}</span>
                      <span className="qr-card__meta">
                        {[p.reciter, p.aspect].filter(Boolean).join(' · ')}
                      </span>
                      <span className="qr-card__foot">
                        <span className="qr-badge qr-badge--plain">{STATUS_LABEL[p.status]}</span>
                        <span>{formatDate(p.updatedAt)}</span>
                      </span>
                    </span>
                  </button>
                  <div className="card-actions">
                    <button type="button" className="qr-btn qr-btn--ghost qr-btn--sm" aria-label={`Duplikat ${p.title}`} onClick={() => void duplicate(p)}>
                      <Icon name="copy" size="sm" />
                      Duplikat
                    </button>
                    <button type="button" className="qr-btn qr-btn--ghost qr-btn--sm" aria-label={`Hapus ${p.title}`} onClick={() => void remove(p)}>
                      <Icon name="trash-2" size="sm" />
                      Hapus
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </section>
        </div>
      </main>
    </div>
  )
}
