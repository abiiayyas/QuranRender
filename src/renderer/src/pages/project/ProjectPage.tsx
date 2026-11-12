import { useEffect, useState } from 'react'
import { advanceStatus, type Project, type Step } from '@shared/types'
import { Icon } from '../../components/ui'
import { errorText } from '../../lib/format'
import { toast, useApp } from '../../store/app'
import { useProject } from '../../store/project'
import { EditorStep } from './EditorStep'
import { ExportDialog } from './ExportDialog'
import { SourceStep } from './SourceStep'
import { SyncStep } from './SyncStep'
import { TextStep } from './TextStep'

const STEPS: { n: Step; label: string; status: Project['status'] }[] = [
  { n: 1, label: 'Sumber', status: 'draft' },
  { n: 2, label: 'Sinkron', status: 'source' },
  { n: 3, label: 'Teks', status: 'synced' },
  { n: 4, label: 'Editor', status: 'editing' }
]

/** A step shows a check when its own work is complete; every step stays clickable. */
function stepDone(p: Project, n: Step): boolean {
  if (n === 1) return !!p.sourceAssetId
  if (n === 2) return p.segments.length > 0 && p.segments.every((s) => s.endMs > s.startMs)
  if (n === 3)
    return p.segments.length > 0 && p.segments.every((s) => s.kind !== 'ayah' || s.translations.some((t) => t.edition === p.editions[0] && t.status !== 'review'))
  return p.status === 'exported'
}

export function ProjectPage({ id }: { id: string }) {
  const go = useApp((s) => s.go)
  const project = useProject((s) => s.project)
  const saveState = useProject((s) => s.saveState)
  const saveError = useProject((s) => s.saveError)
  const [exportOpen, setExportOpen] = useState(false)

  useEffect(() => {
    void window.api.projects.get(id).then(
      (b) => useProject.getState().load(b),
      (e) => {
        toast('error', errorText(e))
        go({ name: 'home' })
      }
    )
    return () => useProject.getState().unload()
  }, [id])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey
      if (!mod) return
      const typing = e.target instanceof HTMLElement && (e.target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName))
      if (e.key === 's') {
        e.preventDefault()
        void useProject.getState().save()
      } else if (e.key === 'z' && !typing) {
        e.preventDefault()
        if (e.shiftKey) useProject.getState().redo()
        else useProject.getState().undo()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  if (!project) return null

  const setStep = (n: Step) => {
    const status = STEPS[n - 1].status
    useProject.getState().applyPatch({ step: n, status: advanceStatus(project.status, status) })
  }

  const leave = async () => {
    await useProject.getState().flush()
    go({ name: 'home' })
  }

  const saveLabel = saveState === 'saved' ? 'Tersimpan' : saveState === 'saving' ? 'Menyimpan…' : saveState === 'dirty' ? 'Belum disimpan' : 'Gagal menyimpan'

  return (
    <div className="project">
      <header className="st-hd">
        <div className="l">
          <button type="button" className="qr-btn qr-btn--ghost" onClick={() => void leave()}>
            <Icon name="chevron-left" />
            Beranda
          </button>
          <span className="st-name">
            <input
              className="title-input"
              aria-label="Judul proyek"
              value={project.title}
              onChange={(e) => useProject.getState().update({ title: e.target.value }, 'title')}
            />
          </span>
          <span className={saveState === 'dirty' ? 'save is-dirty' : saveState === 'error' ? 'save is-error' : 'save'} role="status" title={saveError ?? undefined}>
            <Icon name={saveState === 'saved' ? 'check' : 'circle-alert'} />
            {saveLabel}
            {saveState === 'error' && (
              <button type="button" className="qr-btn qr-btn--ghost qr-btn--sm" onClick={() => void useProject.getState().save()}>
                Coba lagi
              </button>
            )}
          </span>
        </div>
        <ol className="qr-flow" aria-label="Langkah">
          {STEPS.map(({ n, label }, i) => {
            const cur = n === project.step
            const done = stepDone(project, n)
            return (
              <li key={n} className={cur ? 'is-current' : done ? 'is-done' : undefined}>
                {i > 0 && (
                  <span className="qr-flow__sep" aria-hidden="true">
                    <Icon name="chevron-right" size="sm" />
                  </span>
                )}
                <button type="button" aria-current={cur ? 'step' : undefined} onClick={() => setStep(n)}>
                  <span className="qr-flow__n">{done && !cur ? <Icon name="check" size="sm" /> : n}</span>
                  <span>{label}</span>
                </button>
              </li>
            )
          })}
        </ol>
        <div className="r">
          <button
            type="button"
            className="qr-btn qr-btn--ghost qr-btn--icon"
            aria-label="Pengaturan"
            onClick={() => void useProject.getState().flush().then(() => go({ name: 'settings', back: { name: 'project', id } }))}
          >
            <Icon name="settings" />
          </button>
          <button type="button" className="qr-btn qr-btn--primary" disabled={!project.sourceAssetId || project.segments.length === 0} onClick={() => setExportOpen(true)}>
            <Icon name="file-output" />
            Ekspor
          </button>
        </div>
      </header>
      <div className="step-body">
        {project.step === 1 && <SourceStep onNext={() => setStep(2)} />}
        {project.step === 2 && <SyncStep onNext={() => setStep(3)} />}
        {project.step === 3 && <TextStep onNext={() => setStep(4)} />}
        {project.step === 4 && <EditorStep />}
      </div>
      {exportOpen && <ExportDialog onClose={() => setExportOpen(false)} />}
    </div>
  )
}
