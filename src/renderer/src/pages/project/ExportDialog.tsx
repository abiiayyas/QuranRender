import { useEffect, useId, useState } from 'react'
import type { ExportOptions, PolicyIssue } from '@shared/types'
import { ErrorAlert, Icon, JobProgress, Segmented, Sheet } from '../../components/ui'
import { computeFitReport } from '../../lib/fit'
import { errorText } from '../../lib/format'
import { toast } from '../../store/app'
import { useProject } from '../../store/project'

type Height = ExportOptions['height']
type Fps = ExportOptions['fps']

const HEIGHTS: { value: `${Height}`; label: string }[] = [
  { value: '720', label: '720p' },
  { value: '1080', label: '1080p' },
  { value: '2160', label: '4K' }
]

export function ExportDialog({ onClose }: { onClose: () => void }) {
  const projectId = useProject((s) => s.project!.id)
  const [height, setHeight] = useState<Height>(1080)
  const [fps, setFps] = useState<Fps>(30)
  const [srt, setSrt] = useState(false)
  const [vtt, setVtt] = useState(false)
  const [chapters, setChapters] = useState(false)
  const [folder, setFolder] = useState('')
  const [issues, setIssues] = useState<PolicyIssue[] | null>(null)
  const [checkError, setCheckError] = useState<string | null>(null)
  /** Segments whose text cannot fit one screen: a warning that opens the Teks step, where they can be split. */
  const [tooLong, setTooLong] = useState<PolicyIssue[]>([])
  const [jobId, setJobId] = useState<string | null>(null)
  const [starting, setStarting] = useState(false)
  const job = useProject((s) => (jobId ? (s.jobs[jobId] ?? null) : null))
  const ids = { res: useId(), fps: useId(), folder: useId(), issues: useId() }

  const runCheck = async (): Promise<void> => {
    setCheckError(null)
    try {
      await useProject.getState().flush()
      setIssues(await window.api.exporter.check(projectId))
      const p = useProject.getState().project
      if (p) {
        const report = await computeFitReport(p).catch(() => ({}) as Awaited<ReturnType<typeof computeFitReport>>)
        setTooLong(
          p.segments
            .filter((seg) => report[seg.id]?.overflow)
            .map((seg) => ({ segmentId: seg.id, severity: 'warning' as const, message: `${seg.kind === 'ayah' ? `QS ${seg.surah}:${seg.ayah}` : 'Segmen'} (${(seg.startMs / 1000).toFixed(0)} dtk) terlalu panjang untuk satu layar; tulisannya akan sangat kecil atau menutupi bagian lain.` }))
        )
      }
    } catch (e) {
      setCheckError(errorText(e))
    }
  }

  useEffect(() => {
    void runCheck()
    window.api.exporter.defaultFolder().then(setFolder, (e) => toast('error', errorText(e)))
    // Checked once on open; "Periksa ulang" repeats it.
  }, [projectId])

  const pickFolder = async (): Promise<void> => {
    try {
      const f = await window.api.exporter.pickFolder()
      if (f) setFolder(f)
    } catch (e) {
      toast('error', errorText(e))
    }
  }

  const start = async (): Promise<void> => {
    setStarting(true)
    try {
      await useProject.getState().flush()
      const j = await window.api.exporter.start({ projectId, height, fps, folder, srt, vtt, chapters })
      useProject.getState().upsertJob(j)
      setJobId(j.id)
    } catch (e) {
      toast('error', errorText(e))
      void runCheck()
    } finally {
      setStarting(false)
    }
  }

  const goToIssue = (issue: PolicyIssue, step: 2 | 3): void => {
    if (!issue.segmentId) return
    useProject.getState().applyPatch({ step })
    onClose()
  }
  const rows = [...(issues ?? []).map((issue) => ({ issue, step: 2 as const })), ...tooLong.map((issue) => ({ issue, step: 3 as const }))]

  const errors = issues?.filter((i) => i.severity === 'error').length ?? 0
  const running = job?.status === 'queued' || job?.status === 'running'
  const done = job?.status === 'done' && job.message ? job.message : null
  const busy = running || starting
  const canStart = issues !== null && errors === 0 && !!folder && !busy

  return (
    <Sheet
      title="Ekspor video"
      size="md"
      onClose={onClose}
      footer={
        <>
          <button type="button" className="qr-btn qr-btn--secondary" onClick={onClose}>
            {running ? 'Tutup, biarkan berjalan' : 'Tutup'}
          </button>
          {done ? (
            <button type="button" className="qr-btn qr-btn--primary" onClick={() => void window.api.exporter.reveal(done).catch((e) => toast('error', errorText(e)))}>
              <Icon name="folder-open" />
              Buka folder
            </button>
          ) : (
            <button type="button" className="qr-btn qr-btn--primary" disabled={!canStart} aria-describedby={ids.issues} onClick={() => void start()}>
              <Icon name="film" />
              Mulai ekspor
            </button>
          )}
        </>
      }
    >
      <div className="stack exp-dialog">
        <div className="qr-fieldset">
          <span className="qr-label" id={ids.res}>
            Resolusi
          </span>
          <Segmented<`${Height}`>
            labelledBy={ids.res}
            value={`${height}`}
            onChange={(v) => setHeight(Number(v) as Height)}
            options={HEIGHTS.map((h) => ({ ...h, disabled: busy }))}
          />
        </div>
        <div className="qr-fieldset">
          <span className="qr-label" id={ids.fps}>
            Frame per detik
          </span>
          <Segmented<`${Fps}`>
            labelledBy={ids.fps}
            value={`${fps}`}
            onChange={(v) => setFps(Number(v) as Fps)}
            options={[
              { value: '30', label: '30 fps', disabled: busy },
              { value: '60', label: '60 fps', disabled: busy }
            ]}
          />
        </div>
        <fieldset className="qr-fieldset exp-extras">
          <legend className="qr-label">Berkas tambahan</legend>
          <label className="qr-choice">
            <input type="checkbox" className="qr-check" checked={srt} disabled={busy} onChange={(e) => setSrt(e.target.checked)} />
            Subtitle SRT
          </label>
          <label className="qr-choice">
            <input type="checkbox" className="qr-check" checked={vtt} disabled={busy} onChange={(e) => setVtt(e.target.checked)} />
            Subtitle VTT
          </label>
          <label className="qr-choice">
            <input type="checkbox" className="qr-check" checked={chapters} disabled={busy} onChange={(e) => setChapters(e.target.checked)} />
            Chapter YouTube
          </label>
        </fieldset>
        <div className="qr-fieldset">
          <label className="qr-label" htmlFor={ids.folder}>
            Folder tujuan
          </label>
          <div className="exp-folder-row">
            <span className="qr-field exp-folder">
              <input id={ids.folder} type="text" value={folder} readOnly title={folder} />
            </span>
            <button type="button" className="qr-btn qr-btn--secondary" disabled={busy} onClick={() => void pickFolder()}>
              <Icon name="folder" />
              Ganti
            </button>
          </div>
        </div>

        <section className="stack" aria-labelledby={ids.issues}>
          <div className="exp-issues__head">
            <span className="qr-label" id={ids.issues}>
              {issues === null
                ? 'Memeriksa proyek…'
                : issues.length === 0 && tooLong.length === 0
                  ? 'Proyek siap diekspor.'
                  : errors > 0
                    ? `${errors} masalah perlu diperbaiki sebelum ekspor`
                    : 'Ada beberapa catatan, ekspor tetap bisa dilanjutkan'}
            </span>
            <button type="button" className="qr-btn qr-btn--ghost qr-btn--sm" disabled={busy} onClick={() => void runCheck()}>
              <Icon name="rotate-ccw" size="sm" />
              Periksa ulang
            </button>
          </div>
          {checkError && <ErrorAlert title="Pemeriksaan gagal" message={checkError} />}
          {rows.length > 0 && (
            <ul className="exp-issues">
              {rows.map(({ issue, step }, i) => (
                <li key={i}>
                  <button
                    type="button"
                    className={`qr-item exp-issue is-${issue.severity}`}
                    disabled={!issue.segmentId}
                    onClick={() => goToIssue(issue, step)}
                    title={issue.segmentId ? (step === 3 ? 'Buka langkah Teks untuk membelah segmen ini' : 'Buka segmen ini di langkah Sinkron') : undefined}
                  >
                    <Icon name={issue.severity === 'error' ? 'circle-alert' : 'triangle-alert'} size="sm" />
                    <span className="exp-issue__text">{issue.message}</span>
                    {issue.segmentId && <Icon name="chevron-right" size="sm" />}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        <JobProgress job={job} label="Mengekspor video" />
        {done && (
          <div className="qr-alert qr-alert--success" role="status">
            <Icon name="circle-check" />
            <div className="qr-alert__content">
              <span className="qr-alert__title">Video sudah selesai diekspor.</span>
              <span className="qr-alert__body exp-path">{done}</span>
            </div>
          </div>
        )}
        {job?.status === 'failed' && <ErrorAlert title="Ekspor gagal" message={errorText(job.error ?? '')} />}
        {job?.status === 'canceled' && <p className="qr-help">Ekspor dibatalkan. Silakan mulai lagi bila sudah siap.</p>}
        {!done && <p className="qr-help">Lama render kira-kira 1–3 kali durasi video.</p>}
      </div>
    </Sheet>
  )
}
