import { useEffect, useId, useState } from 'react'
import { t } from '@shared/i18n'
import { formatTime, rangeLengthMs, resolveRangeInput } from '@shared/exportRange'
import { estimateRenderMs, useChunks, type AfterExport, type RenderMode } from '@shared/renderPlan'
import type { ExportOptions, PolicyIssue } from '@shared/types'
import { canvasSize } from '@shared/video'
import { ErrorAlert, Icon, JobProgress, Segmented, Sheet } from '../../components/ui'
import { computeFitReport } from '../../lib/fit'
import { errorText, formatDuration } from '../../lib/format'
import { toast } from '../../store/app'
import { useJobs } from '../../store/jobs'
import { useProject } from '../../store/project'
import { ExportRangeFields, type RangeInput } from './ExportRangeFields'

type Height = ExportOptions['height']
type Fps = ExportOptions['fps']

const FPS: Fps[] = [15, 24, 30, 60]

const HEIGHTS: { value: `${Height}`; label: string }[] = [
  { value: '720', label: '720p' },
  { value: '1080', label: '1080p' },
  { value: '2160', label: '4K' }
]

export function ExportDialog({ onClose }: { onClose: () => void }) {
  const projectId = useProject((s) => s.project!.id)
  const [height, setHeight] = useState<Height>(1080)
  const [fps, setFps] = useState<Fps>(30)
  const [mode, setMode] = useState<RenderMode>('auto')
  const [after, setAfter] = useState<AfterExport>('none')
  const [fresh, setFresh] = useState(false)
  const [partial, setPartial] = useState<{ done: number; total: number } | null>(null)
  const [speed, setSpeed] = useState<number | null>(null)
  const project = useProject((s) => s.project!)
  const source = useProject((s) => (s.project!.sourceAssetId ? s.assets[s.project!.sourceAssetId] : undefined))
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
  const activeJob = useProject((s) => Object.values(s.jobs).find((j) => j.kind === 'export' && (j.status === 'queued' || j.status === 'running')) ?? null)
  const job = useProject((s) => (jobId ? (s.jobs[jobId] ?? null) : activeJob))
  const ids = { res: useId(), fps: useId(), mode: useId(), after: useId(), folder: useId(), issues: useId() }
  const sourceMs = source?.durationMs ?? 0
  const [rangeInput, setRangeInput] = useState<RangeInput>({ scope: 'all', fromText: '0:00', toText: '' })
  // The end field starts at the end of the recording once its length is known.
  const toText = rangeInput.toText || formatTime(sourceMs)
  const resolved = rangeInput.scope === 'range' ? resolveRangeInput(rangeInput.fromText, toText, sourceMs) : { range: null, problem: null }
  const range = resolved.range
  const rangeKey = range ? `${range.fromMs}-${range.toMs}` : ''
  // The length of the video being made: what the time estimate, the render mode and the sizes follow.
  const durationMs = range ? rangeLengthMs(range, sourceMs, fps) : sourceMs
  const size = canvasSize(project.aspect, height)
  const chunked = useChunks(mode, durationMs)
  const estimateMs = durationMs > 0 ? estimateRenderMs({ durationMs, fps, width: size.width, height: size.height, motion: project.background.kind === 'motion', msPerMpFrame: speed }) : null

  const runCheck = async (): Promise<void> => {
    // A range that is wrong cannot be checked; the field says what is wrong with it.
    if (rangeInput.scope === 'range' && !range) return
    setCheckError(null)
    try {
      await useProject.getState().flush()
      setIssues(await window.api.exporter.check(projectId, range))
      const p = useProject.getState().project
      if (p) {
        const report = await computeFitReport(p).catch(() => ({}) as Awaited<ReturnType<typeof computeFitReport>>)
        setTooLong(
          p.segments
            .filter((seg) => (!range || (seg.endMs > range.fromMs && seg.startMs < range.toMs)) && report[seg.id]?.overflow)
            .map((seg) => ({
              segmentId: seg.id,
              severity: 'warning' as const,
              message:
                seg.kind === 'ayah'
                  ? t('QS {surah}:{ayah} ({sec} dtk) terlalu panjang untuk satu layar; tulisannya akan sangat kecil atau menutupi bagian lain.', { surah: seg.surah, ayah: seg.ayah, sec: (seg.startMs / 1000).toFixed(0) })
                  : t('Segmen ({sec} dtk) terlalu panjang untuk satu layar; tulisannya akan sangat kecil atau menutupi bagian lain.', { sec: (seg.startMs / 1000).toFixed(0) })
            }))
        )
      }
    } catch (e) {
      setCheckError(errorText(e))
    }
  }

  useEffect(() => {
    window.api.exporter.defaultFolder().then(setFolder, (e) => toast('error', errorText(e)))
    window.api.settings.get().then((st) => setSpeed(st.renderMsPerMpFrame), () => undefined)
  }, [projectId])

  // Checked on open and whenever the stretch changes (only its own segments can hold the export back); "Periksa ulang" repeats it.
  useEffect(() => {
    void runCheck()
  }, [projectId, rangeInput.scope, rangeKey])

  // Pieces from an interrupted run of these same settings: offered for resuming instead of starting over.
  useEffect(() => {
    setFresh(false)
    if (!chunked) {
      setPartial(null)
      return
    }
    let live = true
    window.api.exporter.partial({ projectId, height, fps, mode, after, fresh: false, range, folder, srt, vtt, chapters }).then(
      (r) => live && setPartial(r),
      () => live && setPartial(null)
    )
    return () => {
      live = false
    }
    // The pieces depend on the video's settings only, not on the files chosen to go with it.
  }, [projectId, height, fps, mode, chunked, rangeKey])

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
      const j = await window.api.exporter.start({ projectId, height, fps, mode, after, fresh, range, folder, srt, vtt, chapters })
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
  const rangeOk = rangeInput.scope === 'all' || range !== null
  const canStart = issues !== null && errors === 0 && !!folder && !busy && rangeOk

  return (
    <Sheet
      title={t('Ekspor video')}
      size="md"
      onClose={onClose}
      footer={
        <>
          <button type="button" className="qr-btn qr-btn--secondary" onClick={onClose}>
            {running ? t('Tutup, biarkan berjalan') : t('Tutup')}
          </button>
          {done ? (
            <button type="button" className="qr-btn qr-btn--primary" onClick={() => void window.api.exporter.reveal(done).catch((e) => toast('error', errorText(e)))}>
              <Icon name="folder-open" />
              {t('Buka folder')}
            </button>
          ) : (
            <button type="button" className="qr-btn qr-btn--primary" disabled={!canStart} aria-describedby={ids.issues} onClick={() => void start()}>
              <Icon name="film" />
              {t('Mulai ekspor')}
            </button>
          )}
        </>
      }
    >
      <div className="stack exp-dialog">
        <ExportRangeFields
          value={{ ...rangeInput, toText }}
          onChange={setRangeInput}
          range={range}
          problem={resolved.problem}
          durationMs={sourceMs}
          fps={fps}
          segments={project.segments}
          overlays={project.overlays}
          disabled={busy}
        />
        <div className="qr-fieldset">
          <span className="qr-label" id={ids.res}>
            {t('Resolusi')}
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
            {t('Frame per detik')}
          </span>
          <Segmented<`${Fps}`>
            labelledBy={ids.fps}
            value={`${fps}`}
            onChange={(v) => setFps(Number(v) as Fps)}
            options={FPS.map((f) => ({ value: `${f}` as `${Fps}`, label: `${f} fps`, disabled: busy }))}
          />
          <span className="qr-help">{t('Lebih sedikit bingkai membuat render lebih cepat; sorotan kata jadi kurang halus. 24 fps umum untuk video tilawah.')}</span>
        </div>
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
          <span className="qr-help">
            {chunked
              ? t('Dirender per potongan sekitar 10 menit, lalu digabung. Kalau terputus, render bisa dilanjutkan dari potongan yang sudah jadi. Butuh ruang disk sementara: potongan sebesar videonya, ditambah suara sekitar 11 MB per menit.')
              : t('Dirender sekali jalan. Video yang lebih dari 15 menit otomatis dirender per potongan.')}
          </span>
          {partial && !busy && (
            <label className="qr-choice">
              <input type="checkbox" className="qr-check" checked={fresh} onChange={(e) => setFresh(e.target.checked)} />
              {fresh
                ? t('Mulai dari awal; potongan sebelumnya dibuang')
                : t('Melanjutkan: {done} dari {total} potongan sudah jadi. Centang untuk mulai dari awal.', { done: partial.done, total: partial.total })}
            </label>
          )}
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
          <span className="qr-help">{after === 'none' ? t('Mac tidak tidur selama ekspor berjalan.') : t('Dijalankan hanya bila ekspor berhasil, setelah hitung mundur 1 menit yang bisa dibatalkan.')}</span>
        </div>
        <fieldset className="qr-fieldset exp-extras">
          <legend className="qr-label">{t('Berkas tambahan')}</legend>
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
        </fieldset>
        <div className="qr-fieldset">
          <label className="qr-label" htmlFor={ids.folder}>
            {t('Folder tujuan')}
          </label>
          <div className="exp-folder-row">
            <span className="qr-field exp-folder">
              <input id={ids.folder} type="text" value={folder} readOnly title={folder} />
            </span>
            <button type="button" className="qr-btn qr-btn--secondary" disabled={busy} onClick={() => void pickFolder()}>
              <Icon name="folder" />
              {t('Ganti')}
            </button>
          </div>
        </div>

        <section className="stack" aria-labelledby={ids.issues}>
          <div className="exp-issues__head">
            <span className="qr-label" id={ids.issues}>
              {issues === null
                ? t('Memeriksa proyek…')
                : issues.length === 0 && tooLong.length === 0
                  ? t('Proyek siap diekspor.')
                  : errors > 0
                    ? t('{n} masalah perlu diperbaiki sebelum ekspor', { n: errors })
                    : t('Ada beberapa catatan, ekspor tetap bisa dilanjutkan')}
            </span>
            <button type="button" className="qr-btn qr-btn--ghost qr-btn--sm" disabled={busy} onClick={() => void runCheck()}>
              <Icon name="rotate-ccw" size="sm" />
              {t('Periksa ulang')}
            </button>
          </div>
          {checkError && <ErrorAlert title={t('Pemeriksaan gagal')} message={checkError} />}
          {rows.length > 0 && (
            <ul className="exp-issues">
              {rows.map(({ issue, step }, i) => (
                <li key={i}>
                  <button
                    type="button"
                    className={`qr-item exp-issue is-${issue.severity}`}
                    disabled={!issue.segmentId}
                    onClick={() => goToIssue(issue, step)}
                    title={issue.segmentId ? (step === 3 ? t('Buka langkah Teks untuk membelah segmen ini') : t('Buka segmen ini di langkah Sinkron')) : undefined}
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

        <JobProgress job={job} label={t('Mengekspor video')} />
        {running && (
          <p className="qr-help">
            {t('Kamu bisa menutup jendela ini; render tetap berjalan di latar belakang dan progresnya tampil di bar atas.')}{' '}
            <button
              type="button"
              className="bp-link"
              onClick={() => {
                onClose()
                useJobs.getState().openQueue()
              }}
            >
              {t('Buka antrean render')}
            </button>
          </p>
        )}
        {done && (
          <div className="qr-alert qr-alert--success" role="status">
            <Icon name="circle-check" />
            <div className="qr-alert__content">
              <span className="qr-alert__title">{t('Video sudah selesai diekspor.')}</span>
              <span className="qr-alert__body exp-path">{done}</span>
            </div>
          </div>
        )}
        {job?.status === 'failed' && <ErrorAlert title={t('Ekspor gagal')} message={errorText(job.error ?? '')} />}
        {job?.status === 'canceled' && <p className="qr-help">{t('Ekspor dibatalkan. Silakan mulai lagi bila sudah siap.')}</p>}
        {!done && estimateMs !== null && (
          <p className="qr-help">
            {t('Perkiraan lama render: {time}.', { time: formatDuration(estimateMs) })}{' '}
            {speed === null ? t('Ini perkiraan kasar; setelah ekspor pertama, angkanya menyesuaikan dengan komputermu.') : t('Disesuaikan dengan kecepatan ekspor sebelumnya di komputer ini.')}
          </p>
        )}
      </div>
    </Sheet>
  )
}
