import { app, ipcMain, shell } from 'electron'
import type { StudioApi } from '@shared/api'
import { registerExportIpc } from './exporter'
import { cancelJob } from './jobs'
import { aiReady, testAi } from './ai'
import { cliStatus } from './cli'
import { registerImageIpc } from './imagegen'
import { registerPublishIpc } from './publish'
import { registerQuranIpc } from './quran'
import { bundle, createProject, duplicateProject, listProjects, removeProject, saveProject } from './repo'
import { aiKeyStatus, clearAiKey, getSettings, setAiKey, setSettings } from './settings'
import { registerSourcesIpc } from './sources'
import { registerStockIpc } from './stock'
import { registerSyncIpc } from './sync'
import { registerTextIpc } from './text'

type Group = Exclude<keyof StudioApi, 'files' | 'on'>
type Fn = (...args: never[]) => unknown

/** Typed ipcMain.handle for `${group}:${method}`; the handler gets exactly the renderer's arguments. */
export function handle<G extends Group, M extends keyof StudioApi[G]>(
  group: G,
  method: M,
  fn: StudioApi[G][M] extends Fn ? (...args: Parameters<StudioApi[G][M]>) => ReturnType<StudioApi[G][M]> | Awaited<ReturnType<StudioApi[G][M]>> : never
): void {
  ipcMain.handle(`${group}:${String(method)}`, (_e, ...args) => (fn as unknown as (...a: unknown[]) => unknown)(...args))
}

export function registerIpc(): void {
  handle('projects', 'list', () => listProjects())
  handle('projects', 'create', (init) => createProject(init))
  handle('projects', 'get', (id) => bundle(id))
  handle('projects', 'save', (p) => saveProject(p))
  handle('projects', 'remove', (id) => removeProject(id))
  handle('projects', 'duplicate', (id) => duplicateProject(id))

  handle('settings', 'get', () => getSettings())
  handle('settings', 'set', (patch) => setSettings(patch))
  handle('settings', 'aiReady', () => aiReady())
  handle('settings', 'aiKey', () => aiKeyStatus())
  handle('settings', 'setAiKey', (key) => {
    if (!key.trim()) throw new Error('Kunci AI kosong.')
    setAiKey(key.trim())
    return aiKeyStatus()
  })
  handle('settings', 'clearAiKey', () => {
    clearAiKey()
    return aiKeyStatus()
  })
  handle('settings', 'testAi', () => testAi())
  handle('settings', 'cliStatus', () => cliStatus(true))

  handle('jobs', 'cancel', (id) => cancelJob(id))

  handle('app', 'openExternal', async (url) => {
    if (!/^https:\/\//i.test(url)) throw new Error('Hanya alamat https yang bisa dibuka.')
    await shell.openExternal(url)
  })
  handle('app', 'version', () => app.getVersion())

  registerQuranIpc()
  registerSourcesIpc()
  registerSyncIpc()
  registerTextIpc()
  registerExportIpc()
  registerPublishIpc()
  registerStockIpc()
  registerImageIpc()
}
