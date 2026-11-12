import { contextBridge, ipcRenderer, webUtils, type IpcRendererEvent } from 'electron'
import { CHANNELS, EVENTS, type StudioApi } from '../shared/api'

const listen =
  <T>(channel: string) =>
  (cb: (payload: T) => void): (() => void) => {
    const handler = (_e: IpcRendererEvent, payload: T): void => cb(payload)
    ipcRenderer.on(channel, handler)
    return () => ipcRenderer.removeListener(channel, handler)
  }

const groups = Object.fromEntries(
  Object.entries(CHANNELS).map(([group, methods]) => [
    group,
    Object.fromEntries((methods as string[]).map((m) => [m, (...args: unknown[]) => ipcRenderer.invoke(`${group}:${m}`, ...args)]))
  ])
)

const api = {
  ...groups,
  files: {
    // The sandboxed renderer's File has no path; this is the supported way to read it.
    pathOf: (file: File) => {
      try {
        return webUtils.getPathForFile(file)
      } catch {
        return ''
      }
    }
  },
  on: { job: listen(EVENTS.job), project: listen(EVENTS.project), asset: listen(EVENTS.asset) }
} as StudioApi

contextBridge.exposeInMainWorld('api', api)
