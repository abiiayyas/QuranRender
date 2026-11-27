import { create } from 'zustand'
import type { ExportJobItem, Job } from '@shared/types'

interface JobsState {
  items: Record<string, ExportJobItem>
  dismissed: Record<string, true>
  queueOpen: boolean
  batchOpen: boolean
  load(): Promise<void>
  upsert(job: Job): void
  openQueue(): void
  closeQueue(): void
  openBatch(): void
  closeBatch(): void
  clearFinished(): void
}

export const useJobs = create<JobsState>((set, get) => ({
  items: {},
  dismissed: {},
  queueOpen: false,
  batchOpen: false,
  load: async () => {
    const list = await window.api.jobs.list().catch(() => [])
    set({ items: Object.fromEntries(list.map((j) => [j.id, j])) })
  },
  upsert: (job) => {
    if (job.kind !== 'export') return
    const cur = get().items[job.id]
    const dismissed = { ...get().dismissed }
    delete dismissed[job.id]
    set({
      items: {
        ...get().items,
        [job.id]: { ...job, projectTitle: cur?.projectTitle ?? null }
      },
      dismissed
    })
    if (!cur?.projectTitle && job.projectId) {
      void get().load()
    }
  },
  openQueue: () => set({ queueOpen: true }),
  closeQueue: () => set({ queueOpen: false }),
  openBatch: () => set({ batchOpen: true }),
  closeBatch: () => set({ batchOpen: false }),
  clearFinished: () => {
    const next = { ...get().dismissed }
    for (const j of Object.values(get().items)) {
      if (j.status !== 'queued' && j.status !== 'running') next[j.id] = true
    }
    set({ dismissed: next })
  }
}))
