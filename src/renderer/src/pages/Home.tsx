import { useEffect, useMemo, useState } from 'react'
import { msg, t } from '@shared/i18n'
import { STATUS_ORDER, type Aspect, type ArabicScript, type ProjectStatus, type ProjectSummary, type SurahInfo } from '@shared/types'
import logoDark from '../../../../design/brand/logo/playhead-lockup-dark.svg'
import logoLight from '../../../../design/brand/logo/playhead-lockup-light.svg'
import { LookThumb } from '../components/LookThumb'
import { RenderStatusPill } from '../components/RenderStatusPill'
import { UpdateBanner } from '../components/UpdateBanner'
import { Icon, RangePicker, Segmented, Sheet } from '../components/ui'
import { errorText, formatDate, formatMs } from '../lib/format'
import { rangeLabel, useSurahs } from '../lib/quran'
import { confirmDialog, toast, useApp } from '../store/app'
import { useJobs } from '../store/jobs'
import { BatchExportDialog } from './BatchExportDialog'

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
  draft: msg('Draf'),
  source: msg('Ada audio'),
  synced: msg('Tersinkron'),
  editing: msg('Disunting'),
  exported: msg('Diekspor')
}
const STATUS_BADGE: Record<ProjectStatus, string> = {
  draft: 'qr-badge qr-badge--plain',
  source: 'qr-badge qr-badge--plain',
  synced: 'qr-badge qr-badge--accent',
  editing: 'qr-badge qr-badge--warning',
  exported: 'qr-badge qr-badge--success'
}

/** What a project needs next, by status: the one thing to do when picking it up again. */
const NEXT_STEP: Record<ProjectStatus, string> = {
  draft: msg('Tambahkan rekaman'),
  source: msg('Sinkronkan ayat'),
  synced: msg('Pilih terjemahan'),
  editing: msg('Atur tampilan lalu ekspor'),
  exported: msg('Buat thumbnail dan teks publikasi')
}

/** Shown only until the first project exists: after that the list and the next-step card say where each project stands. */
const FLOW: { icon: string; title: string; body: string }[] = [
  { icon: 'file-input', title: msg('Sumber'), body: msg('Impor rekaman, unduh tilawah qari, atau ambil dari YouTube.') },
  { icon: 'audio-waveform', title: msg('Sinkron'), body: msg('AI mengenali ayat dan waktu tiap kata. Rapikan bila perlu.') },
  { icon: 'languages', title: msg('Teks'), body: msg('Pilih terjemahan; ayat yang terpotong dirapikan otomatis.') },
  { icon: 'layout-template', title: msg('Editor'), body: msg('Pilih preset, latar, dan overlay. Pratinjau sama dengan hasil.') },
  { icon: 'file-output', title: msg('Ekspor'), body: msg('MP4 sampai 4K, ditambah SRT, VTT, dan chapter YouTube.') }
]

type Filter = 'all' | 'progress' | 'synced' | 'exported'
const FILTERS: { value: Filter; label: string; match: (s: ProjectStatus) => boolean }[] = [
  { value: 'all', label: msg('Semua'), match: () => true },
  { value: 'progress', label: msg('Dikerjakan'), match: (s) => s === 'draft' || s === 'source' || s === 'editing' },
  { value: 'synced', label: msg('Tersinkron'), match: (s) => s === 'synced' },
  { value: 'exported', label: msg('Diekspor'), match: (s) => s === 'exported' }
]
type Sort = 'recent' | 'surah' | 'name'

/** Part of the day, from the local clock. */
function dayPart(hour: number): string {
  if (hour >= 4 && hour < 11) return t(msg('pagi'))
  if (hour < 15) return t(msg('siang'))
  if (hour < 18) return t(msg('sore'))
  return t(msg('malam'))
}

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
    <span className="pc-steps" role="img" aria-label={t('Kemajuan: {done} dari 4 tahap', { done })}>
      {[1, 2, 3, 4].map((n) => (
        <i key={n} className={n <= done ? 'is-on' : undefined} />
      ))}
    </span>
  )
}

/** Which surah and verses a project covers, so a list of projects can be told apart at a glance. */
function SurahLine({ p, surah, surahs }: { p: ProjectSummary; surah: SurahInfo | undefined; surahs: SurahInfo[] }) {
  if (p.duaTitle) {
    return (
      <span className="pl-surah">
        <span className="pl-surah__no">{t('Doa')}</span>
        <b>{p.duaTitle}</b>
      </span>
    )
  }
  if (!p.surah) return <span className="pl-surah pl-surah--none">{t('Surah belum dipilih')}</span>
  if (p.surahTo) {
    // A recording that runs through several surahs: name both ends, and say how many it covers.
    const last = surahs.find((s) => s.id === p.surahTo)
    return (
      <span className="pl-surah">
        <span className="pl-surah__no">{`${p.surah}–${p.surahTo}`}</span>
        <b>{`${surah?.nameLatin ?? p.surah} – ${last?.nameLatin ?? p.surahTo}`}</b>
        <span className="pl-surah__verses">{t('{n} surah', { n: p.surahCount })}</span>
      </span>
    )
  }
  const verses = !p.ayahFrom ? t('Semua ayat') : !p.ayahTo || p.ayahTo === p.ayahFrom ? t('Ayat {from}', { from: p.ayahFrom }) : t('Ayat {from}–{to}', { from: p.ayahFrom, to: p.ayahTo })
  return (
    <span className="pl-surah">
      <span className="pl-surah__no">{p.surah}</span>
      <b>{surah?.nameLatin ?? t('Surah {n}', { n: p.surah })}</b>
      {surah && (
        <span className="pl-surah__ar" lang="ar" dir="rtl">
          {surah.nameArabic}
        </span>
      )}
      <span className="pl-surah__verses">{verses}</span>
    </span>
  )
}

function ProjectRow({ p, surah, surahs, onOpen, onDuplicate, onRemove }: { p: ProjectSummary; surah: SurahInfo | undefined; surahs: SurahInfo[]; onOpen: () => void; onDuplicate: () => void; onRemove: () => void }) {
  return (
    <li className="pl-row">
      <button type="button" className="pl-open" onClick={onOpen}>
        <span className="pl-thumb">
          <LookThumb style={p.style} color={p.backgroundColor} aspect={p.aspect} />
          <span className="pc-aspect">{p.aspect}</span>
        </span>
        <span className="pl-main">
          <span className="pl-title">{p.title}</span>
          <SurahLine p={p} surah={surah} surahs={surahs} />
          <span className="pl-sub">{[p.reciter || t('Qari belum diisi'), p.segmentCount > 0 ? t('{n} segmen', { n: p.segmentCount }) : null].filter(Boolean).join(' · ')}</span>
        </span>
        <span className="pl-stage">
          <span className="pl-stage__top">
            <span className={STATUS_BADGE[p.status]}>{t(STATUS_LABEL[p.status])}</span>
            <Progress status={p.status} />
          </span>
          <span className="pl-next">{p.status === 'exported' ? t(NEXT_STEP.exported) : t('Berikutnya: {step}', { step: t(NEXT_STEP[p.status]).toLowerCase() })}</span>
        </span>
        <span className="pl-when">
          <span>{p.durationMs != null ? formatMs(p.durationMs) : '–'}</span>
          <small>{formatDate(p.updatedAt)}</small>
        </span>
      </button>
      <span className="pl-actions">
        <button type="button" className="qr-btn qr-btn--ghost qr-btn--icon" aria-label={t('Duplikat {title}', { title: p.title })} title={t('Duplikat')} onClick={onDuplicate}>
          <Icon name="copy" size="sm" />
        </button>
        <button type="button" className="qr-btn qr-btn--ghost qr-btn--icon" aria-label={t('Hapus {title}', { title: p.title })} title={t('Hapus')} onClick={onRemove}>
          <Icon name="trash-2" size="sm" />
        </button>
      </span>
    </li>
  )
}

/** The quickest start: a name and a surah. Audio, translation and the rest come in the steps that follow. */
function BlankProjectSheet({ aspect, script, onClose }: { aspect: Aspect; script: ArabicScript; onClose: () => void }) {
  const go = useApp((s) => s.go)
  const surahs = useSurahs()
  const [name, setName] = useState('')
  const [surah, setSurah] = useState<number | null>(null)
  const [busy, setBusy] = useState(false)

  const create = async () => {
    setBusy(true)
    try {
      const info = surahs.find((x) => x.id === surah)
      const p = await window.api.projects.create({
        title: name.trim() || info?.nameLatin || t('Proyek tanpa judul'),
        aspect,
        script,
        reciter: '',
        surah,
        ayahFrom: info ? 1 : null,
        ayahTo: info?.ayahCount ?? null
      })
      go({ name: 'project', id: p.id })
    } catch (e) {
      toast('error', errorText(e))
      setBusy(false)
    }
  }

  return (
    <Sheet
      title={t('Proyek kosong')}
      size="sm"
      onClose={onClose}
      footer={
        <>
          <button type="button" className="qr-btn qr-btn--secondary" onClick={onClose}>
            {t('Batal')}
          </button>
          <button type="button" className="qr-btn qr-btn--primary" disabled={busy} onClick={() => void create()}>
            <Icon name="plus" />
            {t('Buat proyek')}
          </button>
        </>
      }
    >
      <p className="qr-help">{t('Cukup nama dan surah. Rekaman, terjemahan, dan tampilan bisa disiapkan setelahnya, langkah demi langkah.')}</p>
      <div className="qr-fieldset">
        <label className="qr-label" htmlFor="blank-name">
          {t('Nama proyek')}
        </label>
        <span className="qr-field">
          <input
            id="blank-name"
            data-autofocus
            value={name}
            placeholder={t('Contoh: Tilawah Subuh Jumat')}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !busy) void create()
            }}
          />
        </span>
      </div>
      <div className="qr-fieldset">
        <label className="qr-label" htmlFor="blank-surah">
          {t('Surah')}
        </label>
        <span className="qr-field">
          <select id="blank-surah" value={surah ?? ''} onChange={(e) => setSurah(e.target.value ? Number(e.target.value) : null)}>
            <option value="">{t('Belum dipilih')}</option>
            {surahs.map((x) => (
              <option key={x.id} value={x.id}>
                {`${x.id}. ${x.nameLatin} (${x.nameArabic})`}
              </option>
            ))}
          </select>
        </span>
      </div>
    </Sheet>
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
  const [name, setName] = useState('')
  const [blankOpen, setBlankOpen] = useState(false)
  const batchOpen = useJobs((s) => s.batchOpen)
  const openBatch = useJobs((s) => s.openBatch)
  const closeBatch = useJobs((s) => s.closeBatch)
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
      const title = name.trim() || (range.surah ? rangeLabel(surahs, range.surah, range.from, range.to) : t('Proyek tanpa judul'))
      const p = await window.api.projects.create({ title, aspect, script, reciter: reciter.trim(), surah: range.surah, ayahFrom: range.from, ayahTo: range.to })
      go({ name: 'project', id: p.id })
    } catch (e) {
      toast('error', errorText(e))
      setBusy(false)
    }
  }

  const remove = async (p: ProjectSummary) => {
    const ok = await confirmDialog({
      title: t('Hapus proyek ini?'),
      body: t('“{title}” beserta berkas di dalamnya akan dihapus dari komputer ini dan tidak bisa dikembalikan.', { title: p.title }),
      confirmLabel: t('Hapus'),
      danger: true
    })
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
  const focus = recent ?? all[0]
  const surahOf = (p: ProjectSummary): SurahInfo | undefined => surahs.find((s) => s.id === p.surah)
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase()
    const match = FILTERS.find((f) => f.value === filter)!.match
    const list = (projects ?? []).filter((p) => match(p.status) && (!q || `${p.title} ${p.reciter} ${surahs.find((s) => s.id === p.surah)?.nameLatin ?? ''}`.toLowerCase().includes(q)))
    if (sort === 'name') return [...list].sort((a, b) => a.title.localeCompare(b.title, undefined, { sensitivity: 'base' }))
    // Same surah together, in verse order: a long surah recorded in parts reads as one run.
    if (sort === 'surah') return [...list].sort((a, b) => (a.surah ?? 999) - (b.surah ?? 999) || (a.ayahFrom ?? 0) - (b.ayahFrom ?? 0))
    return list
  }, [projects, surahs, filter, sort, query])

  return (
    <div className="home">
      <header className="app-hd">
        <Brand />
        <span className="spacer" />
        <RenderStatusPill />
        <button type="button" className="qr-btn qr-btn--ghost" onClick={() => useApp.getState().openSupport()}>
          <Icon name="heart" />
          {t('Dukung')}
        </button>
        <button type="button" className="qr-btn qr-btn--ghost" onClick={() => go({ name: 'settings', back: { name: 'home' } })}>
          <Icon name="settings" />
          {t('Pengaturan')}
        </button>
      </header>
      <main className="step-scroll home-scroll">
        <div className="home-wrap">
          <UpdateBanner />
          <div className="home-greet">
            <p className="home-greet__hi">{t('Assalamu’alaikum, selamat {part}.', { part: dayPart(new Date().getHours()) })}</p>
            <p className="home-greet__sub">
              {recent
                ? t('Silakan lanjutkan “{title}”, atau mulai tilawah yang baru.', { title: recent.title })
                : all.length === 0
                  ? t('Mari buat video tilawah pertamamu. Cukup beberapa langkah dari rekaman sampai video siap unggah.')
                  : t('Mau membuat video tilawah yang baru hari ini?')}
            </p>
          </div>
          <section className="home-hero" aria-labelledby="new-h">
            <div className="qr-panel home-start">
              <div className="home-start__head">
                <h1 id="new-h">{t('Buat video tilawah')}</h1>
                <p>{t('Pilih surah dan format, lalu tambahkan rekaman di langkah berikutnya.')}</p>
              </div>
              <div className="home-start__form">
                <div className="qr-fieldset">
                  <label className="qr-label" htmlFor="proj-name">
                    {t('Nama proyek (opsional)')}
                  </label>
                  <span className="qr-field">
                    <input id="proj-name" value={name} placeholder={t('Kosongkan untuk memakai nama surah')} onChange={(e) => setName(e.target.value)} />
                  </span>
                </div>
                <RangePicker surahs={surahs} surah={range.surah} from={range.from} to={range.to} onChange={(v) => setRange(v)} />
                <span className="qr-help">{t('Rentang ayat boleh dikosongkan: sinkron AI bisa mengenali ayatnya dari audio.')}</span>
                <div className="qr-fieldset">
                  <label className="qr-label" htmlFor="reciter">
                    {t('Qari')}
                  </label>
                  <span className="qr-field">
                    <input id="reciter" value={reciter} placeholder={t('Nama qari (bisa diisi nanti)')} onChange={(e) => setReciter(e.target.value)} />
                  </span>
                </div>
                <div className="field-row">
                  <span className="lbl">{t('Format')}</span>
                  <Segmented ariaLabel={t('Format video')} value={aspect} onChange={setAspect} options={ASPECTS} />
                </div>
                <div className="field-row">
                  <span className="lbl">{t('Teks Arab')}</span>
                  <Segmented ariaLabel={t('Teks Arab')} value={script} onChange={setScript} options={SCRIPTS} />
                </div>
              </div>
              <div className="home-start__foot">
                <button type="button" className="qr-btn qr-btn--secondary qr-btn--lg" onClick={() => setBlankOpen(true)}>
                  {t('Proyek kosong')}
                </button>
                <button type="button" className="qr-btn qr-btn--primary qr-btn--lg" disabled={busy} onClick={() => void start()}>
                  <Icon name="plus" />
                  {t('Buat proyek')}
                </button>
              </div>
            </div>

            <aside className="home-side" aria-label={t('Lanjutkan')}>
              {focus ? (
                <div className="qr-panel home-next">
                  <span className="home-next__label">{recent ? t('Lanjutkan') : t('Terakhir dikerjakan')}</span>
                  <div className="home-next__top">
                    <span className="home-resume__thumb">
                      <LookThumb style={focus.style} color={focus.backgroundColor} aspect={focus.aspect} />
                    </span>
                    <span className="home-resume__body">
                      <b>{focus.title}</b>
                      <SurahLine p={focus} surah={surahOf(focus)} surahs={surahs} />
                    </span>
                  </div>
                  <div className="home-next__stage">
                    <Progress status={focus.status} />
                    <span className={STATUS_BADGE[focus.status]}>{t(STATUS_LABEL[focus.status])}</span>
                  </div>
                  <p className="home-next__todo">{t(NEXT_STEP[focus.status])}</p>
                  <button type="button" className="qr-btn qr-btn--primary" onClick={() => go({ name: 'project', id: focus.id })}>
                    {recent ? t('Lanjutkan') : t('Buka proyek')}
                    <Icon name="chevron-right" />
                  </button>
                </div>
              ) : (
                <div className="qr-panel home-flow">
                  <h2 className="qr-panel__title">{t('Mulai dari sini')}</h2>
                  <ol>
                    {FLOW.map((f) => (
                      <li key={f.title}>
                        <span className="home-flow__n">
                          <Icon name={f.icon} size="sm" />
                        </span>
                        <span>
                          <b>{t(f.title)}</b>
                          <small>{t(f.body)}</small>
                        </span>
                      </li>
                    ))}
                  </ol>
                </div>
              )}
            </aside>
          </section>

          <section className="home-projects" aria-labelledby="projects-h">
            <div className="home-bar">
              <h2 id="projects-h">
                {t('Proyek')} <span className="muted">{all.length}</span>
              </h2>
              {all.length > 0 && (
                <>
                  <Segmented ariaLabel={t('Saring proyek')} value={filter} onChange={setFilter} options={FILTERS.map((f) => ({ value: f.value, label: `${t(f.label)} ${all.filter((p) => f.match(p.status)).length}` }))} />
                  <span className="spacer" />
                  <span className="qr-field">
                    <Icon name="search" size="sm" />
                    <input type="search" aria-label={t('Cari proyek')} placeholder={t('Cari judul, surah, atau qari')} value={query} onChange={(e) => setQuery(e.target.value)} />
                  </span>
                  <span className="qr-field home-sort">
                    <select aria-label={t('Urutkan proyek')} value={sort} onChange={(e) => setSort(e.target.value as Sort)}>
                      <option value="recent">{t('Terbaru')}</option>
                      <option value="surah">{t('Surah')}</option>
                      <option value="name">{t('Nama')}</option>
                    </select>
                  </span>
                  <button type="button" className="qr-btn qr-btn--secondary qr-btn--sm" onClick={openBatch}>
                    <Icon name="film" size="sm" />
                    {t('Ekspor batch')}
                  </button>
                </>
              )}
            </div>

            {projects && all.length === 0 && (
              <div className="qr-empty home-empty">
                <Icon name="layout-grid" size="lg" />
                <span className="qr-empty__title">{t('Belum ada proyek')}</span>
                <span>{t('Pilih surah di atas lalu klik Buat proyek, atau mulai dari Proyek kosong. Proyek tersimpan otomatis di komputermu.')}</span>
              </div>
            )}
            {all.length > 0 && shown.length === 0 && (
              <div className="qr-empty home-empty">
                <Icon name="search" size="lg" />
                <span className="qr-empty__title">{t('Tidak ada proyek yang cocok')}</span>
                <span>{t('Coba kata lain, atau tampilkan semua proyek.')}</span>
                <button
                  type="button"
                  className="qr-btn qr-btn--secondary qr-btn--sm"
                  onClick={() => {
                    setQuery('')
                    setFilter('all')
                  }}
                >
                  {t('Tampilkan semua')}
                </button>
              </div>
            )}
            {shown.length > 0 && (
              <ul className="pl">
                {shown.map((p) => (
                  <ProjectRow key={p.id} p={p} surah={surahOf(p)} surahs={surahs} onOpen={() => go({ name: 'project', id: p.id })} onDuplicate={() => void duplicate(p)} onRemove={() => void remove(p)} />
                ))}
              </ul>
            )}
          </section>
        </div>
      </main>
      {blankOpen && <BlankProjectSheet aspect={aspect} script={script} onClose={() => setBlankOpen(false)} />}
      {batchOpen && projects && <BatchExportDialog projects={projects} onClose={closeBatch} />}
    </div>
  )
}
