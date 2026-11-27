import { useEffect, useId, useState } from 'react'
import { t } from '@shared/i18n'
import { type AfterExport, type RenderMode } from '@shared/renderPlan'
import type { ExportOptions, ProjectSummary } from '@shared/types'
import { Icon, Segmented, Sheet } from '../components/ui'
import { errorText, formatDuration } from '../lib/format'
import { toast } from '../store/app'
import { useJobs } from '../store/jobs'

type Height = ExportOptions['height']
type Fps = ExportOptions['fps']

const HEIGHTS: { value: `${Height}`; label: string }[] = [
  { value: '720', label: '720p' },
  { value: '1080', label: '1080p' },
  { value: '2160', label: '4K' }
]
const FPS: Fps[] = [15, 24, 30, 60]

export function BatchExportDialog({ projects, onClose }: { projects: ProjectSummary[]; onClose: () => void }) {
  const ids = { res: useId(), fps: useId(), mode: useId(), after: useId(), folder: useId() }
  const ready = projects.filter((p) => p.segmentCount > 0 && (p.durationMs ?? 0) > 0)
  const [selected, setSelected] = useState<string[]>(() => ready.map((p) => p.id))
  const [height, setHeight] = useState<Height>(1080)
  const [fps, setFps] = useState<Fps>(24)
  const [mode, setMode] = useState<RenderMode>('auto')
  const [after, setAfter] = useState<AfterExport>('none')
  const [srt, setSrt] = useState(false)
  const [vtt, setVtt] = useState(false)
  const [chapters, setChapters] = useState(false)
  const [folder, setFolder] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    void window.api.exporter.defaultFolder().then(setFolder, (e) => toast('error', errorText(e)))
  }, [])

  const toggle = (id: string) => {
    setSelected((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]))
  }

  const pickFolder = async () => {
    try {
      const f = await window.api.exporter.pickFolder()
      if (f) setFolder(f)
    } catch (e) {
      toast('error', errorText(e))
    }
  }

  const start = async () => {
    if (selected.length === 0 || !folder) return
    setBusy(true)
    try {
      const res = await window.api.exporter.batchStart(selected, { height, fps, mode, after, folder, srt, vtt, chapters })
      for (const j of res.queued) useJobs.getState().upsert(j)
      if (res.queued.length > 0) {
        toast(
          'success',
          res.skipped.length > 0
            ? t('{n} proyek masuk antrean render ({skipped} dilewati karena belum siap).', { n: res.queued.length, skipped: res.skipped.length })
            : t('{n} proyek masuk antrean render.', { n: res.queued.length })
        )
        onClose()
        useJobs.getState().openQueue()
      } else if (res.skipped.length > 0) {
        toast('error', `${res.skipped[0].title}: ${res.skipped[0].reason}`)
      }
    } catch (e) {
      toast('error', errorText(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Sheet
      title={t('Ekspor batch')}
      size="lg"
      onClose={onClose}
      footer={
        <>
          <button type="button" className="qr-btn qr-btn--secondary" onClick={onClose}>
            {t('Tutup')}
          </button>
          <button type="button" className="qr-btn qr-btn--primary" disabled={selected.length === 0 || !folder || busy} onClick={() => void start()}>
            <Icon name="film" />
            {t('Masukkan {n} ke antrean', { n: selected.length })}
          </button>
        </>
      }
    >
      <div className="stack">
        <div className="be-head">
          <span className="qr-label">{t('Pilih proyek yang akan dirender berurutan')}</span>
          <div className="card-actions">
            <button type="button" className="qr-btn qr-btn--ghost qr-btn--sm" onClick={() => setSelected(ready.map((p) => p.id))}>
              {t('Pilih semua yang siap')}
            </button>
            <button type="button" className="qr-btn qr-btn--ghost qr-btn--sm" onClick={() => setSelected([])}>
              {t('Kosongkan')}
            </button>
          </div>
        </div>
        <ul className="be-list">
          {projects.map((p) => {
            const canExport = p.segmentCount > 0 && (p.durationMs ?? 0) > 0
            const checked = selected.includes(p.id)
            return (
              <li key={p.id}>
                <label className={canExport ? 'be-row' : 'be-row is-disabled'}>
                  <input type="checkbox" className="qr-check" disabled={!canExport || busy} checked={checked} onChange={() => toggle(p.id)} />
                  <span className="be-row__main">
                    <b>{p.title}</b>
                    <small className="muted">
                      {canExport ? `${p.aspect} · ${formatDuration(p.durationMs ?? 0)}` : t('Belum siap diekspor')}
                    </small>
                  </span>
                </label>
              </li>
            )
          })}
        </ul>

        <div className="grid-2">
          <div className="qr-fieldset">
            <span className="qr-label" id={ids.res}>
              {t('Resolusi')}
            </span>
            <Segmented<`${Height}`> labelledBy={ids.res} value={`${height}`} onChange={(v) => setHeight(Number(v) as Height)} options={HEIGHTS.map((h) => ({ ...h, disabled: busy }))} />
          </div>
          <div className="qr-fieldset">
            <span className="qr-label" id={ids.fps}>
              {t('Frame per detik')}
            </span>
            <Segmented<`${Fps}`>
              labelledBy={ids.fps}
              value={`${fps}`}
              onChange={(v) => setFps(Number(v) as Fps)}
              options={FPS.map((f) => ({ value: `${f}` as `${Fps}`, label: `${f}`, disabled: busy }))}
            />
          </div>
        </div>

        <div className="grid-2">
          <div className="qr-fieldset">
            <span className="qr-label" id={ids.mode}>
              {t('Cara render')}
            </span>
            <Segmented<RenderMode>
              labelledBy={ids.mode}
              value={mode}
              onChange={setMode}
              options={[
                { value: 'auto', label: t('Otomatis'), disabled: busy },
                { value: 'direct', label: t('Langsung'), disabled: busy },
                { value: 'chunked', label: t('Per potongan'), disabled: busy }
              ]}
            />
          </div>
          <div className="qr-fieldset">
            <span className="qr-label" id={ids.after}>
              {t('Setelah selesai')}
            </span>
            <Segmented<AfterExport>
              labelledBy={ids.after}
              value={after}
              onChange={setAfter}
              options={[
                { value: 'none', label: t('Tidak ada'), disabled: busy },
                { value: 'sleep', label: t('Tidur'), disabled: busy },
                { value: 'quit', label: t('Tutup aplikasi'), disabled: busy }
              ]}
            />
          </div>
        </div>

        <div className="qr-fieldset">
          <span className="qr-label">{t('Berkas tambahan')}</span>
          <div className="exp-checks">
            <label className="qr-choice">
              <input type="checkbox" className="qr-check" checked={srt} disabled={busy} onChange={(e) => setSrt(e.target.checked)} />
              {t('Subtitle SRT')}
            </label>
            <label className="qr-choice">
              <input type="checkbox" className="qr-check" checked={vtt} disabled={busy} onChange={(e) => setVtt(e.target.checked)} />
              {t('Subtitle VTT')}
            </label>
            <label className="qr-choice">
              <input type="checkbox" className="qr-check" checked={chapters} disabled={busy} onChange={(e) => setChapters(e.target.checked)} />
              {t('Chapter YouTube')}
            </label>
          </div>
        </div>

        <div className="qr-fieldset">
          <label className="qr-label" htmlFor={ids.folder}>
            {t('Folder tujuan')}
          </label>
          <div className="exp-folder">
            <span className="qr-field">
              <input id={ids.folder} readOnly value={folder} />
            </span>
            <button type="button" className="qr-btn qr-btn--secondary" disabled={busy} onClick={() => void pickFolder()}>
              {t('Ganti')}
            </button>
          </div>
        </div>
      </div>
    </Sheet>
  )
}
