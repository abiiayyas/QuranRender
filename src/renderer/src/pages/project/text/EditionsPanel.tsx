import { useState, type CSSProperties } from 'react'
import { t } from '@shared/i18n'
import { Icon } from '../../../components/ui'
import { useProject } from '../../../store/project'
import { EditionPicker } from './EditionPicker'
import { languageName, useEditions } from './editions'

/** The project's editions in order (the first is primary), with install state and the catalog picker. */
export function EditionsPanel() {
  const isDua = useProject((s) => !!s.project?.dua)
  const editions = useProject((s) => s.project?.editions) ?? []
  const list = useEditions((s) => s.list)
  const error = useEditions((s) => s.error)
  const installs = useEditions((s) => s.installs)
  const [picking, setPicking] = useState(false)

  if (isDua) {
    return (
      <aside className="st-left" aria-label={t('Terjemahan proyek')}>
        <div className="st-left__body">
          <h2 className="pn-h">{t('Terjemahan proyek')}</h2>
          <ol className="ed-order">
            <li className="ed-row">
              <span className="ed-row__name">
                OpenDua English
                <small>{`${languageName('en')} · ${t('Utama')}`}</small>
              </span>
            </li>
          </ol>
          <p className="pn-note">{t('Terjemahan doa diambil dari OpenDua. Bila doa panjang dibelah, Anda bisa menyunting atau memotong terjemahannya dengan AI per segmen.')}</p>
        </div>
      </aside>
    )
  }

  const set = (next: string[]) => useProject.getState().update({ editions: next })
  const move = (from: number, to: number) => {
    const next = [...editions]
    const [item] = next.splice(from, 1)
    next.splice(to, 0, item)
    set(next)
  }

  return (
    <aside className="st-left" aria-label={t('Terjemahan proyek')}>
      <div className="st-left__body">
        <h2 className="pn-h">{t('Terjemahan proyek')}</h2>
        {editions.length === 0 ? (
          <p className="pn-note">{t('Belum ada terjemahan. Video hanya akan menampilkan teks Arab.')}</p>
        ) : (
          <ol className="ed-order">
            {editions.map((id, i) => {
              const e = list?.find((x) => x.id === id)
              const name = e?.name ?? id
              const job = installs[id]
              return (
                <li key={id} className="ed-row">
                  <span className="ed-row__name" title={name}>
                    {name}
                    <small>
                      {e ? languageName(e.language) : id}
                      {i === 0 ? ` · ${t('Utama')}` : ''}
                    </small>
                  </span>
                  <span className="ed-row__actions">
                    <button
                      type="button"
                      className="qr-btn qr-btn--ghost qr-btn--icon qr-btn--sm"
                      aria-label={t('Naikkan {name}', { name })}
                      disabled={i === 0}
                      onClick={() => move(i, i - 1)}
                    >
                      <Icon name="chevron-up" size="sm" />
                    </button>
                    <button
                      type="button"
                      className="qr-btn qr-btn--ghost qr-btn--icon qr-btn--sm"
                      aria-label={t('Turunkan {name}', { name })}
                      disabled={i === editions.length - 1}
                      onClick={() => move(i, i + 1)}
                    >
                      <Icon name="chevron-down" size="sm" />
                    </button>
                    <button
                      type="button"
                      className="qr-btn qr-btn--ghost qr-btn--icon qr-btn--sm"
                      aria-label={t('Lepas {name} dari proyek', { name })}
                      onClick={() => set(editions.filter((x) => x !== id))}
                    >
                      <Icon name="x" size="sm" />
                    </button>
                  </span>
                  {job ? (
                    <span
                      className={job.status === 'queued' ? 'qr-progress is-indeterminate tx-ed-progress' : 'qr-progress tx-ed-progress'}
                      style={{ '--v': job.progress } as CSSProperties}
                      role="progressbar"
                      aria-label={t('Memasang {name}', { name })}
                      aria-valuenow={Math.round(job.progress * 100)}
                      aria-valuemin={0}
                      aria-valuemax={100}
                    />
                  ) : (
                    list !== null &&
                    !e?.installed && (
                      <button
                        type="button"
                        className="qr-btn qr-btn--secondary qr-btn--sm tx-ed-install"
                        aria-label={t('Pasang {name}', { name })}
                        onClick={() => void useEditions.getState().install(id)}
                      >
                        <Icon name="download" size="sm" />
                        {t('Belum terpasang, pasang sekarang')}
                      </button>
                    )
                  )}
                </li>
              )
            })}
          </ol>
        )}
        {error && list === null && (
          <p className="qr-error" role="alert">
            <Icon name="circle-alert" size="sm" />
            {t('Daftar terjemahan belum bisa dimuat.')}
            <button type="button" className="qr-btn qr-btn--ghost qr-btn--sm" onClick={() => void useEditions.getState().load()}>
              {t('Coba lagi')}
            </button>
          </p>
        )}
        <p className="pn-note">{t('Terjemahan teratas menjadi terjemahan utama di video dan subtitle.')}</p>
      </div>
      <div className="st-left__foot">
        <button type="button" className="qr-btn qr-btn--secondary" onClick={() => setPicking(true)}>
          <Icon name="plus" />
          {t('Tambah terjemahan')}
        </button>
      </div>
      {picking && <EditionPicker onClose={() => setPicking(false)} />}
    </aside>
  )
}
