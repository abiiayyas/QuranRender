import { useId, useState } from 'react'
import { t } from '@shared/i18n'
import { IMAGE_THEMES } from '@shared/imageThemes'
import type { Asset } from '@shared/types'
import { ErrorAlert, Icon, JobProgress } from '../../../components/ui'
import { errorText } from '../../../lib/format'
import { toast } from '../../../store/app'
import { useActiveJob, useProject } from '../../../store/project'

/** Make a background picture from a theme and/or a few words. The finished job's message is the new asset's id. */
export function AiTab({ onUse }: { onUse: (asset: Asset) => void }) {
  const project = useProject((s) => s.project!)
  const assets = useProject((s) => s.assets)
  const active = useActiveJob('imagegen')
  const promptId = useId()
  const [themeId, setThemeId] = useState<string | null>(null)
  const [prompt, setPrompt] = useState('')
  const [starting, setStarting] = useState(false)
  const [startedId, setStartedId] = useState<string | null>(null)
  const started = useProject((s) => (startedId ? s.jobs[startedId] : undefined))

  const job = active ?? started
  const done = job?.status === 'done' && job.message ? assets[job.message] : undefined
  const busy = starting || !!active
  const canMake = !busy && (!!themeId || !!prompt.trim())

  const make = async () => {
    setStarting(true)
    try {
      await useProject.getState().flush()
      const j = await window.api.ai.generateImage(project.id, { prompt: prompt.trim(), themeId, aspect: project.aspect })
      useProject.getState().upsertJob(j)
      setStartedId(j.id)
    } catch (e) {
      toast('error', errorText(e))
    } finally {
      setStarting(false)
    }
  }

  return (
    <div className="bp-pane">
      <p className="qr-help">
        {t('Gambar dibuat sesuai ukuran proyek ({aspect}). Penyedia gratis bawaan (Pollinations) tidak memerlukan kunci, tetapi dibatasi satu gambar per 45 detik, berukuran sedang, dan membubuhkan logo kecil di pojok kanan bawah (dipangkas otomatis, sekitar 7% tepi gambar). Untuk gambar yang lebih tajam, ganti penyedia di Pengaturan > Pembuat gambar (API kompatibel OpenAI atau AI CLI).', { aspect: project.aspect })}
      </p>

      <div className="qr-fieldset">
        <span className="qr-label" id={`${promptId}-themes`}>
          {t('Pilih suasana')}
        </span>
        <div className="bp-themes" role="group" aria-labelledby={`${promptId}-themes`}>
          {IMAGE_THEMES.map((theme) => (
            <button key={theme.id} type="button" className="bp-theme" aria-pressed={themeId === theme.id} disabled={busy} onClick={() => setThemeId(themeId === theme.id ? null : theme.id)}>
              <span className="bp-theme__label">{t(theme.label)}</span>
              <span className="bp-theme__hint">{t(theme.hint)}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="qr-fieldset">
        <label className="qr-label" htmlFor={promptId}>
          {t('Tambahan (opsional)')}
        </label>
        <div className="qr-field bp-prompt">
          <textarea id={promptId} rows={2} maxLength={300} disabled={busy} placeholder={t('Contoh: kabut tipis di pagi hari')} value={prompt} onChange={(e) => setPrompt(e.target.value)} />
        </div>
        <span className="qr-help">{t('Cukup tulis pemandangan atau suasananya. Gambar dibuat tanpa orang, hewan, dan tulisan.')}</span>
      </div>

      <div className="card-actions">
        <button type="button" className="qr-btn qr-btn--primary" disabled={!canMake} onClick={() => void make()}>
          <Icon name="image" size="sm" />
          {starting ? t('Memulai…') : t('Buat gambar')}
        </button>
      </div>

      <JobProgress job={active} label={t('Membuat gambar')} />

      {!active && job?.status === 'failed' && <ErrorAlert title={t('Gambar belum jadi')} message={job.error ?? t('Terjadi kesalahan saat membuat gambar. Silakan coba lagi.')} onClose={() => setStartedId(null)} />}
      {!active && job?.status === 'canceled' && <p className="qr-help">{t('Pembuatan gambar dibatalkan.')}</p>}

      {done && (
        <div className="bp-result">
          <img src={done.url} alt={t('Gambar yang baru dibuat')} />
          <div className="card-actions">
            <button type="button" className="qr-btn qr-btn--primary" onClick={() => onUse(done)}>
              {t('Gunakan sebagai latar')}
            </button>
            <button type="button" className="qr-btn qr-btn--secondary" onClick={() => setStartedId(null)}>
              {t('Buat lagi')}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
