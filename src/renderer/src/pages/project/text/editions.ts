import { locale } from '@shared/i18n'
import { create } from 'zustand'
import type { Edition, Job } from '@shared/types'
import { errorText } from '../../../lib/format'
import { toast } from '../../../store/app'

interface EditionsState {
  /** Bundled + installed + Quran.com catalog; null until loaded. */
  list: Edition[] | null
  error: string | null
  /** Running install jobs by edition id. Install jobs belong to no project, so the project store does not see them. */
  installs: Record<string, Job>
  load(): Promise<void>
  install(editionId: string): Promise<void>
}

const editionOfJob = new Map<string, string>()

export const useEditions = create<EditionsState>((set, get) => ({
  list: null,
  error: null,
  installs: {},
  load: async () => {
    try {
      set({ list: await window.api.text.editions(), error: null })
    } catch (e) {
      set({ error: errorText(e) })
    }
  },
  install: async (editionId) => {
    if (get().installs[editionId]) return
    try {
      const job = await window.api.text.install(editionId)
      editionOfJob.set(job.id, editionId)
      set({ installs: { ...get().installs, [editionId]: job } })
    } catch (e) {
      toast('error', errorText(e))
    }
  }
}))

window.api.on.job((job) => {
  const editionId = editionOfJob.get(job.id)
  if (!editionId) return
  const { installs } = useEditions.getState()
  if (job.status === 'queued' || job.status === 'running') {
    useEditions.setState({ installs: { ...installs, [editionId]: job } })
    return
  }
  editionOfJob.delete(job.id)
  const rest = { ...installs }
  delete rest[editionId]
  useEditions.setState({ installs: rest })
  if (job.status === 'done') {
    void useEditions.getState().load()
    if (job.message) toast('success', job.message)
  }
})

const namesByLang = new Map<string, Intl.DisplayNames>()

/** Name of a language code in the current UI language; the code itself when unknown. */
export function languageName(code: string): string {
  try {
    const tag = locale()
    let names = namesByLang.get(tag)
    if (!names) {
      names = new Intl.DisplayNames([tag], { type: 'language' })
      namesByLang.set(tag, names)
    }
    return names.of(code) ?? code
  } catch {
    return code
  }
}
