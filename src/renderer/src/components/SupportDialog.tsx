import { t } from '@shared/i18n'
import { SUPPORT_LINKS } from '@shared/support'
import { errorText } from '../lib/format'
import { toast, useApp } from '../store/app'
import { Icon, Sheet } from './ui'

/** Voluntary donation prompt shown from Home or periodically after a successful video export. */
export function SupportDialog() {
  const supportOpen = useApp((s) => s.supportOpen)
  const closeSupport = useApp((s) => s.closeSupport)
  const links = SUPPORT_LINKS.filter((l) => l.url)

  if (!supportOpen || links.length === 0) return null

  return (
    <Sheet
      title={t('Dukung Quran Render')}
      size="sm"
      onClose={closeSupport}
      footer={
        <button type="button" className="qr-btn qr-btn--secondary" onClick={closeSupport}>
          {t('Nanti saja')}
        </button>
      }
    >
      <div className="stack">
        <p>{t('Quran Render gratis dan terbuka. Kalau aplikasi ini membantumu, donasi membantu menjaga dan mengembangkannya.')}</p>
        <div className="st-support">
          {links.map((l) => (
            <button
              key={l.id}
              type="button"
              className="qr-btn qr-btn--secondary st-support__btn"
              onClick={() => void window.api.app.openExternal(l.url).catch((e: unknown) => toast('error', errorText(e)))}
            >
              <Icon name={l.icon} />
              {t('Donasi via {name}', { name: l.label })}
              <Icon name="external-link" size="sm" />
            </button>
          ))}
        </div>
        <span className="qr-help">{t('Donasi bersifat sukarela dan tidak membuka fitur apa pun. Semua fitur tetap bisa dipakai tanpa donasi.')}</span>
      </div>
    </Sheet>
  )
}
