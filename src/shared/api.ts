import type { PlatformId, PublishFacts, PublishKit } from './publish'
import type {
  Asset,
  Edition,
  ExportOptions,
  Job,
  KeyStatus,
  PolicyIssue,
  Project,
  ProjectBundle,
  ProjectInit,
  ProjectPatchEvent,
  ProjectSummary,
  Reciter,
  Settings,
  SurahInfo,
  ArabicScript,
  Verse
} from './types'

/**
 * window.api. Every method is the IPC channel `${group}:${method}` (preload builds them from `CHANNELS`), handled in
 * src/main. Handlers throw Error with an Indonesian message; the renderer shows it as a toast.
 */
export interface StudioApi {
  projects: {
    list(): Promise<ProjectSummary[]>
    create(init: ProjectInit): Promise<Project>
    get(id: string): Promise<ProjectBundle>
    save(project: Project): Promise<void>
    remove(id: string): Promise<void>
    duplicate(id: string): Promise<ProjectSummary>
  }
  quran: {
    surahs(): Promise<SurahInfo[]>
    /** Ayahs from..to of one surah in a script. QPC/Uthmani are fetched from Quran.com once and cached. */
    verses(surah: number, from: number, to: number, script: ArabicScript): Promise<Verse[]>
  }
  sources: {
    /** Import a local audio/video file as the project source. No path: open a dialog (null when canceled). */
    importFile(projectId: string, path?: string): Promise<Asset | null>
    reciters(provider: Reciter['provider']): Promise<Reciter[]>
    /** Download a reciter's recitation of the project's surah + ayah range. Timed providers also fill `segments`. */
    download(projectId: string, reciterId: string): Promise<Job>
    youtube(projectId: string, url: string): Promise<Job>
    /** Cut the source to [inMs, outMs] into a new asset and make it the source; segments shift with it. */
    trim(projectId: string, inMs: number, outMs: number): Promise<Job>
    /** Peaks 0..1 for drawing, `count` buckets over the whole asset. */
    waveform(projectId: string, assetId: string, count: number): Promise<number[]>
    /** Image or video for the background/overlay. No path: dialog. */
    importMedia(projectId: string, kind: 'image' | 'video' | 'any', path?: string): Promise<Asset | null>
  }
  sync: {
    /** Cloud aligner over the source; result arrives as a project patch with `segments`. */
    align(projectId: string, model: 'base' | 'large'): Promise<Job>
  }
  text: {
    editions(): Promise<Edition[]>
    install(editionId: string): Promise<Job>
    remove(editionId: string): Promise<void>
    /** Whole-ayah texts of an installed edition, keyed `${surah}:${ayah}`. */
    verses(editionId: string, surah: number, from: number, to: number): Promise<Record<string, string>>
    /** AI trim of partial-ayah segments (all partial ones when `segmentIds` is omitted); result arrives as a patch. */
    aiTrim(projectId: string, editionId: string, segmentIds?: string[]): Promise<Job>
  }
  exporter: {
    check(projectId: string): Promise<PolicyIssue[]>
    start(options: ExportOptions): Promise<Job>
    defaultFolder(): Promise<string>
    pickFolder(): Promise<string | null>
    reveal(path: string): Promise<void>
  }
  settings: {
    get(): Promise<Settings>
    set(patch: Partial<Settings>): Promise<Settings>
    aiKey(): Promise<KeyStatus>
    setAiKey(key: string): Promise<KeyStatus>
    clearAiKey(): Promise<KeyStatus>
    /** Sends a tiny request with the saved URL, model and key; resolves with a short status text. */
    testAi(): Promise<string>
  }
  jobs: {
    cancel(id: string): Promise<void>
  }
  publish: {
    /** The facts upload copy is written from (surah, reciter, translation and audio credits). */
    facts(projectId: string): Promise<PublishFacts>
    /** Cuts one frame of a video asset of the project (background or source) into a new image asset. */
    frame(projectId: string, assetId: string, ms: number): Promise<Asset>
    /** Draws the project's thumbnail to a JPG under 2 MB. `saveAs` opens a save dialog first (null when canceled); otherwise it goes to the export folder. The path is the finished job's message. */
    thumbnail(projectId: string, saveAs: boolean): Promise<Job | null>
    /** AI-written drafts for the platforms, from the project's facts only; platforms the AI gets wrong keep the plain draft. */
    generate(projectId: string, platforms: PlatformId[]): Promise<PublishKit>
    /** Save dialog, then writes `text`; null when canceled. */
    saveText(defaultName: string, text: string): Promise<string | null>
  }
  app: {
    openExternal(url: string): Promise<void>
    copyText(text: string): Promise<void>
    version(): Promise<string>
  }
  files: {
    /** Path of a dropped File (the sandboxed renderer cannot read it itself). Empty when the File has no path. */
    pathOf(file: File): string
  }
  on: {
    job(cb: (job: Job) => void): () => void
    project(cb: (e: ProjectPatchEvent) => void): () => void
    asset(cb: (asset: Asset) => void): () => void
  }
}

export const EVENTS = { job: 'event:job', project: 'event:project', asset: 'event:asset' } as const

type Group = Exclude<keyof StudioApi, 'files' | 'on'>
/** Invoke channels, in the order preload exposes them. Adding a method: add it to StudioApi, here, and a handler in main. */
export const CHANNELS: { [G in Group]: (keyof StudioApi[G])[] } = {
  projects: ['list', 'create', 'get', 'save', 'remove', 'duplicate'],
  quran: ['surahs', 'verses'],
  sources: ['importFile', 'reciters', 'download', 'youtube', 'trim', 'waveform', 'importMedia'],
  sync: ['align'],
  text: ['editions', 'install', 'remove', 'verses', 'aiTrim'],
  exporter: ['check', 'start', 'defaultFolder', 'pickFolder', 'reveal'],
  settings: ['get', 'set', 'aiKey', 'setAiKey', 'clearAiKey', 'testAi'],
  publish: ['facts', 'frame', 'thumbnail', 'generate', 'saveText'],
  jobs: ['cancel'],
  app: ['openExternal', 'copyText', 'version']
}
