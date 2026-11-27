import { useEffect, useId, useMemo, useState } from 'react'
import type { OpenDuaEntry } from '@shared/dua'
import { t } from '@shared/i18n'
import { ErrorAlert, Icon } from '../../../components/ui'
import { errorText, formatMs } from '../../../lib/format'
import { useProject } from '../../../store/project'
import { prepareReplace } from './replace'

let cache: Promise<OpenDuaEntry[]> | null = null

function loadDuas(): Promise<OpenDuaEntry[]> {
  if (!cache) {
    cache = window.api.sources.duas()
    cache.catch(() => {
      cache = null
    })
  }
  return cache
}

/** "Doa (OpenDua)": search Hisn al-Muslim entries with audio and download one into the project. */
export function DuaPanel({ busy }: { busy: boolean }) {
  const project = useProject((s) => s.project)!
  const searchId = useId()
  const [entries, setEntries] = useState<OpenDuaEntry[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [picked, setPicked] = useState<string | null>(project.dua?.entryId ?? null)
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    let live = true
    setError(null)
    loadDuas().then(
      (list) => live && setEntries(list),
      (e) => live && setError(errorText(e))
    )
    return () => {
      live = false
    }
  }, [attempt])

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase()
    return (entries ?? []).filter(
      (e) =>
        !q ||
        e.title.toLowerCase().includes(q) ||
        e.chapterTitle.toLowerCase().includes(q) ||
        e.clips.some((c) => c.arabic.includes(query.trim()) || c.translation.toLowerCase().includes(q))
    )
  }, [entries, query])

  const chosen = shown.find((e) => e.id === picked) ?? entries?.find((e) => e.id === picked) ?? null

  const download = async () => {
    if (!chosen || !(await prepareReplace())) return
    try {
      await window.api.sources.downloadDua(project.id, chosen.id)
    } catch (e) {
      setError(errorText(e))
    }
  }

  return (
    <div className="import-form">
      <p className="pn-h">{t('Doa (OpenDua)')}</p>
      <label className="sr-only" htmlFor={searchId}>
        {t('Cari doa')}
      </label>
      <span className="qr-field">
        <Icon name="search" />
        <input id={searchId} type="search" placeholder={t('Cari judul atau bab doa')} value={query} onChange={(e) => setQuery(e.target.value)} />
      </span>
      {error && <ErrorAlert title={t('Daftar doa tidak bisa dimuat')} message={error} onClose={() => setAttempt((n) => n + 1)} />}
      {!entries && !error && (
        <span className="qr-help" role="status">
          <span className="qr-spin" /> {t('Memuat daftar doa…')}
        </span>
      )}
      {entries && (
        <div className="src-reciters" role="listbox" aria-label={t('Daftar doa')}>
          {shown.length === 0 && <span className="pn-note">{t('Tidak ada doa yang cocok.')}</span>}
          {shown.map((e) => (
            <button
              key={e.id}
              type="button"
              role="option"
              aria-selected={e.id === picked}
              className={e.id === picked ? 'qr-item src-reciter is-selected' : 'qr-item src-reciter'}
              onClick={() => setPicked(e.id)}
              onDoubleClick={() => void download()}
            >
              <span className="qr-item__name">
                {e.title}
                {e.chapterTitle && <small className="muted">{e.chapterTitle}</small>}
              </span>
              {e.durationSeconds > 0 && <span className="qr-badge qr-badge--plain">{formatMs(e.durationSeconds * 1000).replace(/,\d$/, '')}</span>}
            </button>
          ))}
        </div>
      )}
      {chosen && (
        <div className="dua-preview">
          <p className="dua-preview__ar" dir="rtl" lang="ar">
            {chosen.clips[0]?.arabic}
          </p>
          {chosen.clips[0]?.translation && <p className="dua-preview__tr">{chosen.clips[0].translation}</p>}
        </div>
      )}
      <button type="button" className="qr-btn qr-btn--primary" disabled={!chosen || busy} onClick={() => void download()}>
        <Icon name="download" />
        {t('Unduh doa')}
      </button>
      <span className="qr-help">{t('Data & audio Hisn al-Muslim dari OpenDua (CC BY 4.0) oleh Muhammad Jumah.')}</span>
    </div>
  )
}
