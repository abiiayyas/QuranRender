import { useId, useState } from 'react'
import { t } from '@shared/i18n'
import { ErrorAlert, Icon } from '../../../components/ui'
import { errorText } from '../../../lib/format'
import { useProject } from '../../../store/project'
import { prepareReplace } from './replace'

const YT = /^https:\/\/((www|m|music)\.)?(youtube\.com|youtu\.be)\//i

/** "YouTube": audio of a video via yt-dlp (downloaded on first use). */
export function YoutubePanel({ busy }: { busy: boolean }) {
  const id = useId()
  const [url, setUrl] = useState('')
  const [error, setError] = useState<string | null>(null)
  const valid = YT.test(url.trim())

  const start = async () => {
    const projectId = useProject.getState().project?.id
    if (!projectId || !valid || !(await prepareReplace())) return
    setError(null)
    try {
      await window.api.sources.youtube(projectId, url.trim())
      setUrl('')
    } catch (e) {
      setError(errorText(e))
    }
  }

  return (
    <form
      className="import-form"
      onSubmit={(e) => {
        e.preventDefault()
        void start()
      }}
    >
      <p className="pn-h">YouTube</p>
      {error && <ErrorAlert title={t('Unduhan gagal')} message={error} onClose={() => setError(null)} />}
      <div className="qr-fieldset">
        <label className="qr-label" htmlFor={id}>
          {t('Alamat video')}
        </label>
        <span className={url && !valid ? 'qr-field is-invalid' : 'qr-field'}>
          <input id={id} type="url" inputMode="url" placeholder="https://youtu.be/…" value={url} onChange={(e) => setUrl(e.target.value)} />
        </span>
        {url && !valid && <span className="qr-error">{t('Silakan masukkan alamat https dari youtube.com atau youtu.be.')}</span>}
      </div>
      <button type="submit" className="qr-btn qr-btn--primary" disabled={!valid || busy}>
        <Icon name="download" />
        {t('Unduh audio')}
      </button>
      <span className="qr-help">{t('Hanya suaranya yang diunduh. Pada pemakaian pertama, aplikasi mengunduh alat yt-dlp terlebih dahulu.')}</span>
      <span className="qr-help">{t('Pastikan Anda berhak memakai rekaman tersebut.')}</span>
    </form>
  )
}
