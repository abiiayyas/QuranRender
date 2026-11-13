import { create } from 'zustand'
import type { Lang } from '@shared/i18n'

export type Route = { name: 'home' } | { name: 'settings'; back?: Route } | { name: 'project'; id: string }

export interface Toast {
  id: number
  kind: 'error' | 'info' | 'success'
  text: string
  action?: { label: string; run: () => void }
}

interface Confirm {
  title: string
  body: string
  confirmLabel: string
  danger: boolean
  resolve: (ok: boolean) => void
}

interface AppState {
  /** Mirrors the saved language; changing it remounts the app (see main.tsx) so every screen redraws in it. */
  lang: Lang
  route: Route
  toasts: Toast[]
  confirm: Confirm | null
  go(route: Route): void
  toast(kind: Toast['kind'], text: string, action?: Toast['action']): void
  dismiss(id: number): void
}

let nextId = 1

export const useApp = create<AppState>((set, get) => ({
  lang: 'id',
  route: { name: 'home' },
  toasts: [],
  confirm: null,
  go: (route) => set({ route }),
  toast: (kind, text, action) => {
    const id = nextId++
    set({ toasts: [...get().toasts, { id, kind, text, action }].slice(-4) })
    setTimeout(() => get().dismiss(id), kind === 'error' ? 8000 : 4500)
  },
  dismiss: (id) => set({ toasts: get().toasts.filter((t) => t.id !== id) })
}))

/** Asks in a dialog (ConfirmHost); resolves true when confirmed. */
export function confirmDialog(o: { title: string; body: string; confirmLabel?: string; danger?: boolean }): Promise<boolean> {
  return new Promise((resolve) =>
    useApp.setState({
      confirm: { title: o.title, body: o.body, confirmLabel: o.confirmLabel ?? 'Lanjutkan', danger: o.danger ?? false, resolve }
    })
  )
}

export const toast = (kind: Toast['kind'], text: string, action?: Toast['action']): void => useApp.getState().toast(kind, text, action)
