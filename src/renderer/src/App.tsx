import { msg, t } from '@shared/i18n'
import { useEffect } from 'react'
import { ConfirmHost, Toasts } from './components/ui'
import { RenderQueueDialog } from './components/RenderQueueDialog'
import { SupportDialog } from './components/SupportDialog'
import { errorText } from './lib/format'
import { Home } from './pages/Home'
import { ProjectPage } from './pages/project/ProjectPage'
import { Settings } from './pages/Settings'
import { useApp } from './store/app'
import { useJobs } from './store/jobs'
import { useProject } from './store/project'
import { useUpdater } from './store/updater'

const KIND_LABEL: Record<string, string> = {
  download: msg('Unduh tilawah'),
  youtube: msg('Unduh YouTube'),
  trim: msg('Potong audio'),
  align: msg('Sinkron AI'),
  translate: msg('Pasang terjemahan'),
  aitrim: msg('AI trim'),
  export: msg('Ekspor'),
  ytdlp: msg('Unduh yt-dlp'),
  thumbnail: msg('Thumbnail')
}

export function App() {
  const route = useApp((s) => s.route)

  useEffect(() => {
    const p = useProject.getState
    void useJobs.getState().load()
    void useUpdater.getState().load()
    const offs = [
      window.api.on.job((job) => {
        p().upsertJob(job)
        useJobs.getState().upsert(job)
        const { toast } = useApp.getState()
        if (job.status === 'failed' && job.error) toast('error', t('{kind} gagal: {error}', { kind: t(KIND_LABEL[job.kind] ?? msg('Proses')), error: errorText(job.error) }))
        if (job.status === 'done' && (job.kind === 'export' || job.kind === 'thumbnail') && job.message) {
          const path = job.message
          toast('success', job.kind === 'export' ? t('Video selesai diekspor.') : t('Thumbnail tersimpan.'), { label: t('Buka folder'), run: () => void window.api.exporter.reveal(path) })
          if (job.kind === 'export') useApp.getState().promptSupportAfterExport()
        }
      }),
      window.api.on.project((e) => {
        if (e.projectId === p().project?.id) p().applyPatch(e.patch)
      }),
      window.api.on.asset((a) => p().addAsset(a)),
      window.api.on.update((st) => {
        const prev = useUpdater.getState().state
        useUpdater.getState().setState(st)
        if (st.status === 'available' && prev.status !== 'available' && st.info?.available && useApp.getState().route.name !== 'home') {
          useApp.getState().toast('info', t('Versi baru tersedia: v{version}', { version: st.info.latestVersion }), {
            label: t('Unduh & pasang'),
            run: () => void useUpdater.getState().download()
          })
        }
      })
    ]
    return () => offs.forEach((off) => off())
  }, [])

  // Finish a pending save before the window closes.
  useEffect(() => {
    const onBeforeUnload = (e: BeforeUnloadEvent): void => {
      const s = useProject.getState()
      if (s.saveState === 'dirty' || s.saveState === 'saving') {
        e.preventDefault()
        void s.flush().then(() => window.close())
      }
    }
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => window.removeEventListener('beforeunload', onBeforeUnload)
  }, [])

  return (
    <>
      {route.name === 'home' && <Home />}
      {route.name === 'settings' && <Settings />}
      {route.name === 'project' && <ProjectPage key={route.id} id={route.id} />}
      <Toasts />
      <ConfirmHost />
      <SupportDialog />
      <RenderQueueDialog />
    </>
  )
}
