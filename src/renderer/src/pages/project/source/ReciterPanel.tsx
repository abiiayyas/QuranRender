import { useEffect, useId, useMemo, useState } from 'react'
import type { Reciter } from '@shared/types'
import { ErrorAlert, Icon, RangePicker, Segmented } from '../../../components/ui'
import { errorText } from '../../../lib/format'
import { rangeLabel, useSurahs } from '../../../lib/quran'
import { useProject } from '../../../store/project'
import { prepareReplace } from './replace'

type Provider = Reciter['provider']

const PROVIDERS: { value: Provider; label: string }[] = [
  { value: 'mp3quran', label: 'MP3Quran' },
  { value: 'qdc', label: 'Quran.com' }
]

const lists = new Map<Provider, Promise<Reciter[]>>()

function loadReciters(p: Provider): Promise<Reciter[]> {
  let l = lists.get(p)
  if (!l) {
    l = window.api.sources.reciters(p)
    l.catch(() => lists.delete(p))
    lists.set(p, l)
  }
  return l
}

/** "Tilawah qari": pick a provider and reciter, then download the project's surah + range. */
export function ReciterPanel({ busy }: { busy: boolean }) {
  const project = useProject((s) => s.project)!
  const surahs = useSurahs()
  const searchId = useId()
  const [provider, setProvider] = useState<Provider>('qdc')
  const [reciters, setReciters] = useState<Reciter[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [picked, setPicked] = useState<string | null>(null)
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    let live = true
    setReciters(null)
    setError(null)
    loadReciters(provider).then(
      (l) => live && setReciters(l),
      (e) => live && setError(errorText(e))
    )
    return () => {
      live = false
    }
  }, [provider, attempt])

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase()
    return (reciters ?? []).filter(
      (r) => (!project.surah || r.surahs.includes(project.surah)) && (!q || r.name.toLowerCase().includes(q) || r.style.toLowerCase().includes(q))
    )
  }, [reciters, query, project.surah])

  const chosen = shown.find((r) => r.id === picked) ?? null

  const download = async () => {
    if (!chosen || !(await prepareReplace())) return
    try {
      await window.api.sources.download(project.id, chosen.id)
    } catch (e) {
      setError(errorText(e))
    }
  }

  return (
    <div className="import-form">
      <p className="pn-h">Tilawah qari</p>
      <Segmented options={PROVIDERS} value={provider} onChange={setProvider} ariaLabel="Penyedia tilawah" />
      {!project.surah ? (
        <>
          <span className="qr-help">Silakan pilih surah dan rentang ayat terlebih dahulu.</span>
          <RangePicker
            surahs={surahs}
            surah={null}
            from={null}
            to={null}
            onChange={(v) => useProject.getState().update({ surah: v.surah, ayahFrom: v.from, ayahTo: v.to }, 'range')}
          />
        </>
      ) : (
        <>
          <span className="qr-help">Yang diunduh: {rangeLabel(surahs, project.surah, project.ayahFrom, project.ayahTo)}.</span>
          <label className="sr-only" htmlFor={searchId}>
            Cari qari
          </label>
          <span className="qr-field">
            <Icon name="search" />
            <input id={searchId} type="search" placeholder="Cari qari" value={query} onChange={(e) => setQuery(e.target.value)} />
          </span>
          {error && (
            <ErrorAlert title="Daftar qari tidak bisa dimuat" message={error} onClose={() => setAttempt((n) => n + 1)} />
          )}
          {!reciters && !error && (
            <span className="qr-help" role="status">
              <span className="qr-spin" /> Memuat daftar qari…
            </span>
          )}
          {reciters && (
            <div className="src-reciters" role="listbox" aria-label="Daftar qari">
              {shown.length === 0 && <span className="pn-note">Tidak ada qari yang cocok.</span>}
              {shown.map((r) => (
                <button
                  key={r.id}
                  type="button"
                  role="option"
                  aria-selected={r.id === picked}
                  className={r.id === picked ? 'qr-item src-reciter is-selected' : 'qr-item src-reciter'}
                  onClick={() => setPicked(r.id)}
                  onDoubleClick={() => void download()}
                >
                  <span className="qr-item__name">
                    {r.name}
                    {r.style && (
                      <small dir="auto" className="muted">
                        {r.style}
                      </small>
                    )}
                  </span>
                  {r.timed && <span className="qr-badge qr-badge--success">tersinkron otomatis</span>}
                </button>
              ))}
            </div>
          )}
          <button type="button" className="qr-btn qr-btn--primary" disabled={!chosen || busy} onClick={() => void download()}>
            <Icon name="download" />
            Unduh tilawah
          </button>
          {chosen && (
            <span className="qr-help">
              {chosen.timed
                ? 'Waktu tiap ayat ikut diunduh, jadi rekaman langsung tersinkron.'
                : 'Qari ini belum punya data waktu ayat. Satu surah penuh akan diunduh, lalu disinkronkan di langkah berikutnya.'}
            </span>
          )}
        </>
      )}
    </div>
  )
}
