import { create } from 'zustand'
import { INITIAL_UPDATE_STATE, type UpdateState } from '@shared/updater'
import { errorText } from '../lib/format'
import { toast } from './app'

interface UpdaterStore {
  state: UpdateState
  dismissedVersion: string | null
  load(): Promise<void>
  setState(state: UpdateState): void
  check(): Promise<void>
  download(): Promise<void>
  open(): Promise<void>
  dismiss(): void
}

export const useUpdater = create<UpdaterStore>((set, get) => ({
  state: { ...INITIAL_UPDATE_STATE },
  dismissedVersion: null,
  load: async () => {
    const state = await window.api.updater.state().catch(() => null)
    if (state) set({ state })
  },
  setState: (state) => set({ state }),
  check: async () => {
    const state = await window.api.updater.check().catch((e) => {
      toast('error', errorText(e))
      return null
    })
    if (state) set({ state, dismissedVersion: null })
  },
  download: async () => {
    const state = await window.api.updater.download().catch((e) => {
      toast('error', errorText(e))
      return null
    })
    if (state) set({ state })
  },
  open: async () => {
    await window.api.updater.open().catch((e) => toast('error', errorText(e)))
  },
  dismiss: () => set({ dismissedVersion: get().state.info?.latestVersion ?? null })
}))
