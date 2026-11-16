import { execFile } from 'node:child_process'
import { basename } from 'node:path'
import { app, BrowserWindow, dialog, Notification, shell } from 'electron'
import { t } from '@shared/i18n'
import type { AfterExport } from '@shared/renderPlan'

const COUNTDOWN_MS = 60_000

function perform(action: Exclude<AfterExport, 'none'>): void {
  if (action === 'quit') {
    app.quit()
    return
  }
  // pmset needs no permission, unlike telling System Events to shut down.
  if (process.platform === 'darwin') execFile('pmset', ['sleepnow'], (e) => e && console.warn('[after export] sleep failed', e.message))
}

/** A system notification, so someone who left the app during a long render still hears that the video is ready. Clicking it shows the file. */
export function notifyExportDone(outPath: string): void {
  if (!Notification.isSupported()) return
  const n = new Notification({ title: t('Ekspor selesai'), body: t('{name} sudah jadi. Klik untuk membuka folder.', { name: basename(outPath) }) })
  n.on('click', () => shell.showItemInFolder(outPath))
  n.show()
}

/**
 * Runs the choice made in the Export dialog once the export has succeeded, after a minute the user can use to cancel.
 * The dialog is a sheet on the app window, closed by a timer when the minute is up.
 */
export async function runAfterExport(action: AfterExport): Promise<void> {
  if (action === 'none') return
  if (action === 'sleep' && process.platform !== 'darwin') return
  const win = BrowserWindow.getAllWindows()[0]
  if (!win) return
  const ctrl = new AbortController()
  let timedOut = false
  const timer = setTimeout(() => {
    timedOut = true
    ctrl.abort()
  }, COUNTDOWN_MS)
  try {
    const { response } = await dialog.showMessageBox(win, {
      type: 'info',
      title: t('Ekspor selesai'),
      message: action === 'sleep' ? t('Video sudah selesai. Mac akan tidur dalam 1 menit.') : t('Video sudah selesai. Aplikasi akan ditutup dalam 1 menit.'),
      detail: t('Klik Batalkan bila kamu masih ingin memakainya.'),
      buttons: [t('Batalkan'), t('Lakukan sekarang')],
      defaultId: 0,
      cancelId: 0,
      noLink: true,
      signal: ctrl.signal
    })
    if (timedOut || response === 1) perform(action)
  } finally {
    clearTimeout(timer)
  }
}
