import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { app } from 'electron'
import ffmpegStatic from 'ffmpeg-static'
import ffprobeStatic from 'ffprobe-static'

export const dataDir = (): string => app.getPath('userData')

export const dbPath = (): string => join(dataDir(), 'studio.db')

function ensure(dir: string): string {
  mkdirSync(dir, { recursive: true })
  return dir
}

export const projectsRoot = (): string => ensure(join(dataDir(), 'projects'))
export const projectDir = (projectId: string): string => ensure(join(projectsRoot(), projectId))
/** Downloaded tools (yt-dlp) and cached fonts live here, outside any project. */
export const toolsDir = (): string => ensure(join(dataDir(), 'tools'))
export const cacheDir = (): string => ensure(join(dataDir(), 'cache'))
export const tmpDir = (): string => ensure(join(dataDir(), 'tmp'))

export const assetAbsPath = (projectId: string, path: string): string => join(projectsRoot(), projectId, path)

/** studio://asset/<project>/<path> */
export function assetUrl(projectId: string, path: string): string {
  return `studio://asset/${`${projectId}/${path}`.split(/[\\/]/).map(encodeURIComponent).join('/')}`
}

const resource = (name: string): string =>
  app.isPackaged ? join(process.resourcesPath, name) : join(app.getAppPath(), name)

/** Bundled Quran dataset (read-only). */
export const quranDbPath = (): string => (app.isPackaged ? resource('quran.db') : resource('resources/quran.db'))
/** Bundled Arabic fonts (LPMQ, Amiri). Uthmani and QPC page fonts are downloaded into `qpcFontsDir()`. */
export const fontsDir = (): string => (app.isPackaged ? resource('fonts') : resource('assets/fonts/quran'))
export const uiFontPath = (): string =>
  app.isPackaged ? join(fontsDir(), 'Inter-Variable.ttf') : resource('assets/fonts/ui/Inter-Variable.ttf')
export const qpcFontsDir = (): string => ensure(join(cacheDir(), 'qpc'))

/** Installed, binaries live in app.asar.unpacked (asarUnpack in electron-builder.yml). */
const unpacked = (p: string): string => p.replace('app.asar', 'app.asar.unpacked')
export const ffmpegPath = (): string => unpacked(ffmpegStatic as unknown as string)
export const ffprobePath = (): string => unpacked(ffprobeStatic.path)
