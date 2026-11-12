import { BrowserWindow } from 'electron'
import { EVENTS } from '@shared/api'
import type { Asset, Job, ProjectPatchEvent } from '@shared/types'

function send(channel: string, payload: unknown): void {
  for (const w of BrowserWindow.getAllWindows()) if (!w.isDestroyed()) w.webContents.send(channel, payload)
}

export const emit = {
  job: (job: Job): void => send(EVENTS.job, job),
  project: (e: ProjectPatchEvent): void => send(EVENTS.project, e),
  asset: (asset: Asset): void => send(EVENTS.asset, asset)
}
