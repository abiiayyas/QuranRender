import { join } from 'node:path'
import { app, BrowserWindow, nativeTheme, shell } from 'electron'
import { killRunningClis } from './cli'
import { closeDb, getDb } from './db'
import { registerIpc } from './ipc'
import { handleStudioProtocol, registerSchemes } from './protocol'
import { failInterruptedJobs } from './repo'
import { autoClean } from './storage'
import { applyLanguage, getSettings } from './settings'

if (!app.isPackaged && process.env.QR_USER_DATA) app.setPath('userData', process.env.QR_USER_DATA)

registerSchemes()

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1180,
    minHeight: 720,
    show: false,
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#101114' : '#f7f8fa',
    title: 'Quran Render',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false
    }
  })
  win.once('ready-to-show', () => win.show())
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https:\/\//i.test(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })
  win.webContents.on('will-navigate', (e, url) => {
    if (!url.startsWith(process.env['ELECTRON_RENDERER_URL'] ?? 'file://')) e.preventDefault()
  })
  if (!app.isPackaged && process.env['ELECTRON_RENDERER_URL']) void win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  else void win.loadFile(join(__dirname, '../renderer/index.html'))
}

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => {
    const w = BrowserWindow.getAllWindows()[0]
    if (w) {
      if (w.isMinimized()) w.restore()
      w.focus()
    }
  })
  void app.whenReady().then(() => {
    getDb()
    failInterruptedJobs()
    // Leftovers need no attention; never let cleaning get in the way of starting.
    void autoClean().catch((e) => console.warn('Storage auto-clean failed:', e))
    nativeTheme.themeSource = getSettings().theme
    applyLanguage()
    handleStudioProtocol()
    registerIpc()
    createWindow()
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow()
    })
  })
  app.on('window-all-closed', () => app.quit())
  app.on('will-quit', () => {
    killRunningClis()
    closeDb()
  })
}
