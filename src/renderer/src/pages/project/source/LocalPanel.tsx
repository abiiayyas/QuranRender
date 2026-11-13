import { useState, type DragEvent } from 'react'
import { t } from '@shared/i18n'
import { ErrorAlert, Icon } from '../../../components/ui'
import { errorText } from '../../../lib/format'
import { toast } from '../../../store/app'
import { useProject } from '../../../store/project'
import { prepareReplace } from './replace'

const ACCEPT = ['mp3', 'm4a', 'aac', 'wav', 'flac', 'ogg', 'opus', 'mp4', 'mov', 'mkv', 'webm']

/** "Berkas di komputer": drop zone plus the system file dialog. */
export function LocalPanel({ busy }: { busy: boolean }) {
  const [over, setOver] = useState(false)
  const [importing, setImporting] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const disabled = busy || importing !== null

  const run = async (path?: string) => {
    const id = useProject.getState().project?.id
    if (!id || !(await prepareReplace())) return
    setError(null)
    setImporting(path ? (path.split(/[\\/]/).pop() ?? path) : '')
    try {
      const asset = await window.api.sources.importFile(id, path)
      if (asset) toast('success', t('{name} sudah menjadi sumber proyek.', { name: asset.name }))
    } catch (e) {
      setError(errorText(e))
    } finally {
      setImporting(null)
    }
  }

  const onDrop = (e: DragEvent) => {
    e.preventDefault()
    setOver(false)
    if (disabled) return
    const files = [...e.dataTransfer.files]
    if (files.length !== 1) {
      setError(t('Silakan seret satu berkas saja.'))
      return
    }
    const path = window.api.files.pathOf(files[0])
    const ext = path.split('.').pop()?.toLowerCase() ?? ''
    if (!path) setError(t('Berkas ini tidak bisa dibaca. Silakan pilih lewat tombol.'))
    else if (!ACCEPT.includes(ext)) setError(t('Format .{ext} belum didukung. Silakan pakai {formats}.', { ext, formats: ACCEPT.join(', ') }))
    else void run(path)
  }

  return (
    <div className="import-form">
      <p className="pn-h">{t('Berkas di komputer')}</p>
      {error && <ErrorAlert title={t('Impor gagal')} message={error} onClose={() => setError(null)} />}
      <div
        className={over && !disabled ? 'qr-drop qr-empty import-drop is-dragover' : 'qr-drop qr-empty import-drop'}
        onDragOver={(e) => {
          e.preventDefault()
          e.dataTransfer.dropEffect = disabled ? 'none' : 'copy'
          setOver(true)
        }}
        onDragLeave={() => setOver(false)}
        onDrop={onDrop}
      >
        {importing !== null ? <span className="qr-spin" /> : <Icon name="upload" />}
        <span className="qr-empty__title" aria-live="polite">
          {importing !== null ? t('Sedang mengimpor…') : over ? t('Lepaskan untuk mengimpor') : t('Seret rekaman ke sini')}
        </span>
        <span>{importing || t('Audio (mp3, m4a, wav, flac, ogg, opus) atau video (mp4, mov, mkv, webm).')}</span>
        {importing === null && (
          <button type="button" className="qr-btn qr-btn--primary qr-btn--sm" disabled={disabled} onClick={() => void run()}>
            <Icon name="folder-open" />
            {t('Pilih berkas')}
          </button>
        )}
      </div>
      <span className="qr-help">{t('Video dipakai suaranya sebagai sumber, dan gambarnya bisa dijadikan latar di Editor.')}</span>
    </div>
  )
}
