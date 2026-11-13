import { useState } from 'react'
import type { Edition } from '@shared/types'
import { locale, t } from '@shared/i18n'
import { Icon, Sheet } from '../../../components/ui'
import { errorText } from '../../../lib/format'
import { confirmDialog, toast } from '../../../store/app'
import { useProject } from '../../../store/project'
import { languageName, useEditions } from './editions'

/** Indonesian and English first; the rest by name. */
const FIRST = ['id', 'en']

export function EditionPicker({ onClose }: { onClose: () => void }) {
  const list = useEditions((s) => s.list)
  const error = useEditions((s) => s.error)
  const installs = useEditions((s) => s.installs)
  const projectEditions = useProject((s) => s.project?.editions) ?? []
  const [query, setQuery] = useState('')
  const [lang, setLang] = useState('')

  const all = list ?? []
  const languages = [...new Set(all.map((e) => e.language))].sort((a, b) => {
    const fa = FIRST.indexOf(a)
    const fb = FIRST.indexOf(b)
    if (fa >= 0 || fb >= 0) return (fa < 0 ? 99 : fa) - (fb < 0 ? 99 : fb)
    return languageName(a).localeCompare(languageName(b), locale())
  })
  const q = query.trim().toLocaleLowerCase(locale())
  const shown = all.filter(
    (e) =>
      (lang === '' || e.language === lang) &&
      (q === '' || [e.name, e.author, languageName(e.language)].some((v) => v.toLocaleLowerCase(locale()).includes(q)))
  )
  const groups = languages
    .map((code) => ({ code, items: shown.filter((e) => e.language === code).sort((a, b) => Number(b.installed) - Number(a.installed)) }))
    .filter((g) => g.items.length > 0)

  const add = (e: Edition) => {
    const p = useProject.getState().project
    if (!p || p.editions.includes(e.id)) return
    useProject.getState().update({ editions: [...p.editions, e.id] })
    if (!e.installed) void useEditions.getState().install(e.id)
  }

  const uninstall = async (e: Edition) => {
    const ok = await confirmDialog({
      title: t('Hapus {name} dari perangkat?', { name: e.name }),
      body: t('Teks terjemahan ini akan dihapus dari komputer. Terjemahan yang sudah tersimpan di proyek tetap ada, dan edisi ini bisa dipasang lagi kapan saja.'),
      confirmLabel: t('Hapus'),
      danger: true
    })
    if (!ok) return
    try {
      await window.api.text.remove(e.id)
      await useEditions.getState().load()
    } catch (err) {
      toast('error', errorText(err))
    }
  }

  return (
    <Sheet
      title={t('Tambah terjemahan')}
      onClose={onClose}
      size="md"
      footer={
        <button type="button" className="qr-btn qr-btn--primary" onClick={onClose}>
          {t('Selesai')}
        </button>
      }
    >
      <div className="stack">
        <div className="edition-filter">
          <span className="qr-field">
            <Icon name="search" size="sm" />
            <input
              type="search"
              data-autofocus
              value={query}
              aria-label={t('Cari terjemahan')}
              placeholder={t('Cari nama, penerjemah, atau bahasa')}
              onChange={(e) => setQuery(e.target.value)}
            />
          </span>
          <span className="qr-field">
            <select value={lang} aria-label={t('Bahasa')} onChange={(e) => setLang(e.target.value)}>
              <option value="">{t('Semua bahasa')}</option>
              {languages.map((code) => (
                <option key={code} value={code}>
                  {languageName(code)}
                </option>
              ))}
            </select>
          </span>
        </div>
        {error && (
          <p className="qr-error" role="alert">
            <Icon name="circle-alert" size="sm" />
            {t('Katalog Quran.com belum bisa dimuat: {error}', { error })}
          </p>
        )}
        {list === null && !error ? (
          <p className="qr-help" role="status">
            <span className="qr-spin" /> {t('Memuat katalog terjemahan…')}
          </p>
        ) : groups.length === 0 ? (
          <p className="qr-help">{t('Tidak ada terjemahan yang cocok dengan pencarian ini.')}</p>
        ) : (
          <div className="tx-pick">
            {groups.map((g) => (
              <section key={g.code} aria-label={languageName(g.code)}>
                <h3 className="pn-h">{languageName(g.code)}</h3>
                <ul className="ed-order">
                  {g.items.map((e) => {
                    const inProject = projectEditions.includes(e.id)
                    const job = installs[e.id]
                    return (
                      <li key={e.id} className="ed-row">
                        <span className="ed-row__name" title={e.name}>
                          {e.name}
                          <small>{e.author || 'Quran.com'}</small>
                        </span>
                        {e.bundled ? (
                          <span className="qr-badge qr-badge--plain">{t('Bawaan')}</span>
                        ) : e.installed ? (
                          <span className="qr-badge qr-badge--success">{t('Terpasang')}</span>
                        ) : job ? (
                          <span className="qr-badge qr-badge--accent">{t('Memasang {percent}%', { percent: Math.round(job.progress * 100) })}</span>
                        ) : null}
                        <span className="ed-row__actions">
                          {e.installed && !e.bundled && (
                            <button
                              type="button"
                              className="qr-btn qr-btn--ghost qr-btn--icon qr-btn--sm"
                              aria-label={t('Hapus {name} dari perangkat', { name: e.name })}
                              title={t('Hapus dari perangkat')}
                              onClick={() => void uninstall(e)}
                            >
                              <Icon name="trash-2" size="sm" />
                            </button>
                          )}
                          <button
                            type="button"
                            className="qr-btn qr-btn--secondary qr-btn--sm"
                            disabled={inProject}
                            aria-label={inProject ? t('{name} sudah dipakai', { name: e.name }) : t('Tambahkan {name}', { name: e.name })}
                            onClick={() => add(e)}
                          >
                            {inProject ? (
                              t('Dipakai')
                            ) : (
                              <>
                                <Icon name={e.installed ? 'plus' : 'download'} size="sm" />
                                {e.installed ? t('Tambah') : t('Pasang')}
                              </>
                            )}
                          </button>
                        </span>
                      </li>
                    )
                  })}
                </ul>
              </section>
            ))}
          </div>
        )}
        <p className="qr-help">{t('Terjemahan selain Kemenag diunduh dari Quran.com sekali, lalu bisa dipakai tanpa internet.')}</p>
      </div>
    </Sheet>
  )
}
