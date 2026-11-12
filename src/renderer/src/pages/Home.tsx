import { useEffect, useMemo, useState } from 'react'
import { STATUS_ORDER, type Aspect, type ArabicScript, type ProjectStatus, type ProjectSummary } from '@shared/types'
import logoDark from '../../../../design/brand/logo/playhead-lockup-dark.svg'
import logoLight from '../../../../design/brand/logo/playhead-lockup-light.svg'
import { LookThumb } from '../components/LookThumb'
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

const STATUS_LABEL: Record<ProjectStatus, string> = {
  draft: 'Draf',
  source: 'Ada audio',
  synced: 'Tersinkron',
  editing: 'Disunting',
  exported: 'Diekspor'
}
const STATUS_BADGE: Record<ProjectStatus, string> = {
  draft: 'qr-badge qr-badge--plain',
  source: 'qr-badge qr-badge--plain',
  synced: 'qr-badge qr-badge--accent',
  editing: 'qr-badge qr-badge--warning',
  exported: 'qr-badge qr-badge--success'
}

const FLOW: { icon: string; title: string; body: string }[] = [
  { icon: 'file-input', title: 'Sumber', body: 'Impor rekaman, unduh tilawah qari, atau ambil dari YouTube.' },
  { icon: 'audio-waveform', title: 'Sinkron', body: 'AI mengenali ayat dan waktu tiap kata. Rapikan bila perlu.' },
  { icon: 'languages', title: 'Teks', body: 'Pilih terjemahan; ayat yang terpotong dirapikan otomatis.' },
  { icon: 'layout-template', title: 'Editor', body: 'Pilih preset, latar, dan overlay. Pratinjau sama dengan hasil.' },
  { icon: 'file-output', title: 'Ekspor', body: 'MP4 sampai 4K, ditambah SRT, VTT, dan chapter YouTube.' }
]

type Filter = 'all' | 'progress' | 'synced' | 'exported'
const FILTERS: { value: Filter; label: string; match: (s: ProjectStatus) => boolean }[] = [
  { value: 'all', label: 'Semua', match: () => true },
  { value: 'progress', label: 'Dikerjakan', match: (s) => s === 'draft' || s === 'source' || s === 'editing' },
  { value: 'synced', label: 'Tersinkron', match: (s) => s === 'synced' },
  { value: 'exported', label: 'Diekspor', match: (s) => s === 'exported' }
]
type Sort = 'recent' | 'name'

export function Brand() {
  return (
    <span className="brand">
      <img className="only-light" src={logoLight} alt="Quran Render" />
      <img className="only-dark" src={logoDark} alt="Quran Render" />
    </span>
  )
}

/** Progress through Sumber → Sinkron → Teks/Editor → Ekspor, from status (step is only where the user last looked). */
function Progress({ status }: { status: ProjectStatus }) {
  const done = STATUS_ORDER.indexOf(status)
  return (
    <span className="pc-steps" role="img" aria-label={`Kemajuan: ${done} dari 4 tahap`}>
      {[1, 2, 3, 4].map((n) => (
        <i key={n} className={n <= done ? 'is-on' : undefined} />
      ))}
    </span>
  )
}

function ProjectCard({ p, onOpen, onDuplicate, onRemove }: { p: ProjectSummary; onOpen: () => void; onDuplicate: () => void; onRemove: () => void }) {
  return (
    <div className="card-wrap">
      <button type="button" className="qr-card pc" onClick={onOpen}>
        <span className="qr-card__thumb pc-thumb">
          <LookThumb style={p.style} color={p.backgroundColor} aspect={p.aspect} />
          {p.durationMs != null && <span className="qr-card__dur">{formatMs(p.durationMs)}</span>}
          <span className="pc-aspect">{p.aspect}</span>
        </span>
        <span className="qr-card__body">
          <span className="qr-card__title">{p.title}</span>
          <span className="qr-card__meta">{[p.reciter || 'Qari belum diisi', p.segmentCount > 0 ? `${p.segmentCount} segmen` : null].filter(Boolean).join(' · ')}</span>
          <Progress status={p.status} />
          <span className="qr-card__foot">
            <span className={STATUS_BADGE[p.status]}>{STATUS_LABEL[p.status]}</span>
            <span>{formatDate(p.updatedAt)}</span>
          </span>
        </span>
      </button>
      <div className="card-actions">
        <button type="button" className="qr-btn qr-btn--ghost qr-btn--sm" aria-label={`Duplikat ${p.title}`} onClick={onDuplicate}>
          <Icon name="copy" size="sm" />
          Duplikat
        </button>
        <button type="button" className="qr-btn qr-btn--ghost qr-btn--sm" aria-label={`Hapus ${p.title}`} onClick={onRemove}>
          <Icon name="trash-2" size="sm" />
          Hapus
        </button>
      </div>
    </div>
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
  const [filter, setFilter] = useState<Filter>('all')
  const [sort, setSort] = useState<Sort>('recent')
  const [query, setQuery] = useState('')

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

  const all = projects ?? []
  const recent = all.find((p) => p.status !== 'exported')
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase()
    const match = FILTERS.find((f) => f.value === filter)!.match
    const list = (projects ?? []).filter((p) => match(p.status) && (!q || `${p.title} ${p.reciter}`.toLowerCase().includes(q)))
    return sort === 'name' ? [...list].sort((a, b) => a.title.localeCompare(b.title, 'id')) : list
  }, [projects, filter, sort, query])

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
      <main className="step-scroll home-scroll">
        <div className="home-wrap">
          <section className="home-hero" aria-labelledby="new-h">
            <div className="qr-panel home-start">
              <div className="home-start__head">
                <h1 id="new-h">Buat video tilawah</h1>
                <p>Pilih surah dan format, lalu tambahkan rekaman di langkah berikutnya.</p>
              </div>
              <div className="home-start__form">
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
              </div>
              <div className="home-start__foot">
                <button type="button" className="qr-btn qr-btn--primary qr-btn--lg" disabled={busy} onClick={() => void start()}>
                  <Icon name="plus" />
                  Buat proyek
                </button>
              </div>
            </div>

            <aside className="home-side" aria-label="Panduan singkat">
              {recent && (
                <button type="button" className="qr-panel home-resume" onClick={() => go({ name: 'project', id: recent.id })}>
                  <span className="home-resume__thumb">
                    <LookThumb style={recent.style} color={recent.backgroundColor} aspect={recent.aspect} />
                  </span>
                  <span className="home-resume__body">
                    <small>Lanjutkan</small>
                    <b>{recent.title}</b>
                    <Progress status={recent.status} />
                  </span>
                  <Icon name="chevron-right" />
                </button>
              )}
              <div className="qr-panel home-flow">
                <h2 className="qr-panel__title">Cara kerja</h2>
                <ol>
                  {FLOW.map((f, i) => (
                    <li key={f.title}>
                      <span className="home-flow__n" aria-hidden="true">
                        <Icon name={f.icon} size="sm" />
                      </span>
                      <span>
                        <b>
                          {i + 1}. {f.title}
                        </b>
                        <small>{f.body}</small>
                      </span>
                    </li>
                  ))}
                </ol>
              </div>
            </aside>
          </section>

          <section className="home-projects" aria-labelledby="list-h">
            <div className="home-bar">
              <h2 id="list-h">
                Proyek <span className="muted">{all.length > 0 ? all.length : ''}</span>
              </h2>
              {all.length > 0 && (
                <>
                  <Segmented<Filter>
                    ariaLabel="Saring proyek"
                    value={filter}
                    onChange={setFilter}
                    options={FILTERS.map((f) => ({ value: f.value, label: `${f.label} ${all.filter((p) => f.match(p.status)).length}` }))}
                  />
                  <span className="spacer" />
                  <span className="qr-field">
                    <Icon name="search" />
                    <input type="search" aria-label="Cari proyek" placeholder="Cari judul atau qari" value={query} onChange={(e) => setQuery(e.target.value)} />
                  </span>
                  <span className="qr-field home-sort">
                    <select aria-label="Urutkan" value={sort} onChange={(e) => setSort(e.target.value as Sort)}>
                      <option value="recent">Terbaru</option>
                      <option value="name">Nama</option>
                    </select>
                  </span>
                </>
              )}
            </div>

            {projects && all.length === 0 && (
              <div className="qr-empty home-empty">
                <Icon name="layout-grid" size="lg" />
                <span className="qr-empty__title">Belum ada proyek</span>
                <span>Pilih surah di atas lalu klik Buat proyek. Proyek tersimpan otomatis di komputermu.</span>
              </div>
            )}
            {all.length > 0 && shown.length === 0 && (
              <div className="qr-empty home-empty">
                <Icon name="search" size="lg" />
                <span className="qr-empty__title">Tidak ada proyek yang cocok</span>
                <span>Coba kata lain, atau tampilkan semua proyek.</span>
                <button
                  type="button"
                  className="qr-btn qr-btn--secondary qr-btn--sm"
                  onClick={() => {
                    setQuery('')
                    setFilter('all')
                  }}
                >
                  Tampilkan semua
                </button>
              </div>
            )}
            <div className="grid">
              {shown.map((p) => (
                <ProjectCard key={p.id} p={p} onOpen={() => go({ name: 'project', id: p.id })} onDuplicate={() => void duplicate(p)} onRemove={() => void remove(p)} />
              ))}
            </div>
          </section>
        </div>
      </main>
    </div>
  )
}
