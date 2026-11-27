import { existsSync } from 'node:fs'
import { basename, join } from 'node:path'
import { app, shell } from 'electron'
import { t } from '@shared/i18n'
import { INITIAL_UPDATE_STATE, UPDATE_API_URL, parseRelease, type UpdateState } from '@shared/updater'
import { emit } from './events'
import { handle } from './ipc'
import { downloadFile } from './sources/net'

let state: UpdateState = { ...INITIAL_UPDATE_STATE }
let downloading: Promise<UpdateState> | null = null

function setState(patch: Partial<UpdateState>): UpdateState {
  state = { ...state, ...patch }
  emit.update(state)
  return state
}

export async function checkForUpdates(manual = true): Promise<UpdateState> {
  if (state.status === 'downloading') return state
  setState({ status: 'checking', error: null })
  try {
    const res = await fetch(UPDATE_API_URL, {
      signal: AbortSignal.timeout(15_000),
      headers: {
        Accept: 'application/vnd.github+json',
        'User-Agent': `QuranRender/${app.getVersion()}`
      }
    })
    if (!res.ok) throw new Error(t('GitHub menolak permintaan (HTTP {status}).', { status: res.status }))
    const json = (await res.json()) as unknown
    const info = parseRelease(json, app.getVersion(), process.platform, process.arch)
    if (!info) throw new Error(t('Belum ada rilis publik yang bisa diperiksa.'))
    return setState({
      status: info.available ? 'available' : 'up-to-date',
      info,
      error: null
    })
  } catch (e) {
    if (!manual) return setState({ status: 'idle', error: null })
    const msg = e instanceof Error ? e.message : String(e)
    return setState({ status: 'error', error: msg || t('Gagal memeriksa pembaruan.') })
  }
}

export async function downloadUpdate(): Promise<UpdateState> {
  if (downloading) return downloading
  downloading = (async () => {
    if (!state.info || !state.info.available) {
      const checked = await checkForUpdates(true)
      if (!checked.info?.available) return checked
    }
    const info = state.info
    if (!info?.available) return state
    if (!info.assetUrl || !info.assetName) {
      await shell.openExternal(info.releaseUrl)
      return state
    }
    const safeName = basename(info.assetName).replace(/[^a-zA-Z0-9._-]+/g, '_')
    const dest = join(app.getPath('downloads'), safeName)
    const ctrl = new AbortController()
    let lastEmit = 0
    setState({ status: 'downloading', progress: 0, downloadedPath: null, error: null })
    try {
      await downloadFile(info.assetUrl, dest, {
        signal: ctrl.signal,
        onProgress: (p) => {
          const now = Date.now()
          if (now - lastEmit > 150) {
            lastEmit = now
            setState({ progress: Math.min(0.99, Math.max(0, p)) })
          }
        }
      })
      const done = setState({ status: 'downloaded', progress: 1, downloadedPath: dest, error: null })
      const err = await shell.openPath(dest)
      if (err) throw new Error(err)
      return done
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      return setState({ status: 'error', error: msg || t('Gagal mengunduh pembaruan.') })
    }
  })().finally(() => {
    downloading = null
  })
  return downloading
}

export async function openDownloadedUpdate(): Promise<void> {
  if (!state.downloadedPath || !existsSync(state.downloadedPath)) {
    throw new Error(t('Berkas pembaruan sudah tidak ada di folder Unduhan.'))
  }
  const err = await shell.openPath(state.downloadedPath)
  if (err) throw new Error(err)
}

export function registerUpdaterIpc(): void {
  handle('updater', 'state', () => state)
  handle('updater', 'check', () => checkForUpdates(true))
  handle('updater', 'download', () => downloadUpdate())
  handle('updater', 'open', () => openDownloadedUpdate())
}
