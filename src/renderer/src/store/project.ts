import { create } from 'zustand'
import type { Asset, Job, Project, ProjectBundle } from '@shared/types'
import { errorText } from '../lib/format'

export type SaveState = 'saved' | 'dirty' | 'saving' | 'error'

interface ProjectState {
  project: Project | null
  assets: Record<string, Asset>
  jobs: Record<string, Job>
  saveState: SaveState
  saveError: string | null
  canUndo: boolean
  canRedo: boolean
  load(b: ProjectBundle): void
  unload(): void
  /** A user edit: recorded for undo (same `key` within 600 ms joins one step) and autosaved. */
  update(patch: Partial<Project>, key?: string): void
  /** Main changed these fields (job result); merged without an undo step, then saved. */
  applyPatch(patch: Partial<Project>): void
  addAsset(a: Asset): void
  upsertJob(j: Job): void
  save(): Promise<void>
  /** Writes any pending change now. Call before IPC that reads the project from the database (jobs, export). */
  flush(): Promise<void>
  undo(): void
  redo(): void
}

const AUTOSAVE_MS = 1200
const HISTORY_LIMIT = 100
const COALESCE_MS = 600
/** Navigation and main-owned fields are not edits worth undoing. */
const KEEP_ON_RESTORE = ['step', 'status', 'sourceAssetId', 'createdAt', 'updatedAt'] as const

let timer: ReturnType<typeof setTimeout> | null = null
let inFlight: Promise<void> | null = null
let changedDuringSave = false
let past: Project[] = []
let future: Project[] = []
let lastKey: string | null = null
let lastAt = 0

export const useProject = create<ProjectState>((set, get) => {
  const touch = (): void => {
    if (get().saveState === 'saving') changedDuringSave = true
    else set({ saveState: 'dirty' })
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => void get().save(), AUTOSAVE_MS)
  }
  const flags = (): void => set({ canUndo: past.length > 0, canRedo: future.length > 0 })
  const restore = (to: Project): void => {
    const cur = get().project!
    const kept = Object.fromEntries(KEEP_ON_RESTORE.map((k) => [k, cur[k]]))
    set({ project: { ...to, ...kept } })
    lastKey = null
    flags()
    touch()
  }

  return {
    project: null,
    assets: {},
    jobs: {},
    saveState: 'saved',
    saveError: null,
    canUndo: false,
    canRedo: false,

    load: (b) => {
      past = []
      future = []
      lastKey = null
      set({
        project: b.project,
        assets: Object.fromEntries(b.assets.map((a) => [a.id, a])),
        jobs: Object.fromEntries(b.jobs.map((j) => [j.id, j])),
        saveState: 'saved',
        saveError: null,
        canUndo: false,
        canRedo: false
      })
    },
    unload: () => {
      if (timer) clearTimeout(timer)
      set({ project: null, assets: {}, jobs: {} })
    },
    update: (patch, key) => {
      const before = get().project
      if (!before) return
      const now = Date.now()
      if (!(key && key === lastKey && now - lastAt < COALESCE_MS)) {
        past.push(before)
        if (past.length > HISTORY_LIMIT) past.shift()
        future = []
      }
      lastKey = key ?? null
      lastAt = now
      set({ project: { ...before, ...patch } })
      flags()
      touch()
    },
    applyPatch: (patch) => {
      const p = get().project
      if (!p) return
      set({ project: { ...p, ...patch } })
      touch()
    },
    addAsset: (a) => {
      if (a.projectId === get().project?.id) set({ assets: { ...get().assets, [a.id]: a } })
    },
    upsertJob: (j) => {
      if (j.projectId === get().project?.id) set({ jobs: { ...get().jobs, [j.id]: j } })
    },
    save: async () => {
      if (inFlight) return inFlight
      const p = get().project
      if (!p) return
      if (timer) clearTimeout(timer)
      timer = null
      changedDuringSave = false
      set({ saveState: 'saving' })
      inFlight = window.api.projects
        .save(p)
        .then(() => {
          set({ saveState: changedDuringSave ? 'dirty' : 'saved', saveError: null })
          if (changedDuringSave) timer = setTimeout(() => void get().save(), AUTOSAVE_MS)
        })
        .catch((e) => set({ saveState: 'error', saveError: errorText(e) }))
        .finally(() => {
          inFlight = null
        })
      return inFlight
    },
    flush: async () => {
      if (inFlight) await inFlight
      if (get().saveState === 'dirty' || timer) await get().save()
    },
    undo: () => {
      const prev = past.pop()
      if (!prev) return
      future.push(get().project!)
      restore(prev)
    },
    redo: () => {
      const next = future.pop()
      if (!next) return
      past.push(get().project!)
      restore(next)
    }
  }
})

/** Active (queued/running) job of a kind for the open project, if any. */
export function useActiveJob(kind: Job['kind']): Job | null {
  return useProject((s) => Object.values(s.jobs).find((j) => j.kind === kind && (j.status === 'queued' || j.status === 'running')) ?? null)
}
