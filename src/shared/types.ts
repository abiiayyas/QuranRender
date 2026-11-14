import type { AiProvider, CliImageTool, CliTool, ImageProvider } from './aiTools'
import type { AmbientSettings } from './ambient'
import type { Lang } from './i18n'
import type { Edge } from './placement'
import type { LoopMode, MotionSpec } from './motion'
import type { PublishKit } from './publish'
import type { ExportRange } from './exportRange'
import type { AfterExport, RenderMode } from './renderPlan'
import type { StyleSettings } from './style'
import type { ThumbnailSpec } from './thumbnail'

export type Aspect = '16:9' | '9:16' | '1:1'
export type Step = 1 | 2 | 3 | 4
/** Only moves forward (see `advanceStatus`). */
export type ProjectStatus = 'draft' | 'source' | 'synced' | 'editing' | 'exported'
export type ArabicScript = 'kemenag' | 'uthmani' | 'qpc'

/**
 * Word numbers are canonical: 1-based word position in the ayah as Quran.com / QPC / Digital Khatt count it (ayah-end
 * marker excluded). Every script's `Verse.words` has exactly that many entries, so timings and word ranges work for all.
 */
export interface Verse {
  surah: number
  ayah: number
  /** One entry per canonical word. An empty string means "joined to the previous word" in this script (draw nothing, keep its highlight). */
  words: string[]
  /** QPC only: mushaf page, which selects the per-page font `QPC-p{page}`. */
  page?: number
  /** QPC only: ayah-end glyph for the page font. */
  end?: string
}

export interface SurahInfo {
  id: number
  nameLatin: string
  nameArabic: string
  meaning: string
  ayahCount: number
}

export type SegmentKind = 'ayah' | 'basmalah' | 'istiadzah'
export type SegmentSource = 'aligner' | 'qdc' | 'mp3quran' | 'manual'
/** full: whole-ayah text; auto: cut by rule; ai: cut by AI; manual: typed by the user; review: needs a look before export. */
export type TranslationStatus = 'full' | 'auto' | 'ai' | 'manual' | 'review'

export interface WordTiming {
  /** Canonical word number (see `Verse`). */
  idx: number
  startMs: number
  endMs: number
}

export interface SegmentTranslation {
  edition: string
  text: string
  status: TranslationStatus
}

/** All times are ms on the project's audio (the source asset), which is also video time. */
export interface Segment {
  id: string
  kind: SegmentKind
  /** For basmalah / isti'adzah: 0. */
  surah: number
  ayah: number
  /** Inclusive canonical word range shown by this segment; 0..0 for basmalah / isti'adzah. */
  wordFrom: number
  wordTo: number
  startMs: number
  endMs: number
  /** 0..1, null when unknown (manual). */
  confidence: number | null
  source: SegmentSource
  words: WordTiming[]
  translations: SegmentTranslation[]
}

export interface Background {
  /** source: the source video itself plays behind the text. motion: an animated background drawn by the composition. */
  kind: 'color' | 'image' | 'video' | 'source' | 'motion'
  motion?: MotionSpec
  /** What a video background does once it is shorter than the recitation; absent = 'repeat'. */
  loop?: LoopMode
  color: string
  assetId: string | null
  /** 0..1 black dimmer over media. */
  dim: number
  /** px at 1080p width, scaled with the canvas. */
  blur: number
}

export interface Overlay {
  id: string
  /** qari: reciter name and surah as an animated lower third; progress: a thin bar over the recitation; cta: a short call to action in `text`; visualizer: audio-reactive bars or wave drawn from the source audio (`variant`); prompt: a subscribe or follow button that comes and goes (`variant`, `cycle`). */
  kind: 'text' | 'image' | 'qari' | 'progress' | 'cta' | 'visualizer' | 'prompt'
  /** visualizer: 'bars' (default) or 'wave'. prompt: 'subscribe' (default) or 'follow'. */
  variant?: 'bars' | 'wave' | 'subscribe' | 'follow'
  /** prompt only: it shows for `showMs` at the overlay's start and again every `everyMs` until the overlay ends. */
  cycle?: { everyMs: number; showMs: number }
  text: string
  assetId: string | null
  /** The point on the canvas (fractions, 0..1) that the overlay's anchor stands on: its middle unless `anchorX`/`anchorY` say otherwise. */
  x: number
  y: number
  /** Which part of the overlay stands on x/y: 0 = left/top edge, 0.5 = middle (default), 1 = right/bottom edge. See placement.ts. */
  anchorX?: Edge
  anchorY?: Edge
  /** Text: font size; image: width. Fraction of canvas width. */
  size: number
  color: string
  opacity: number
  startMs: number
  /** null = until the end. */
  endMs: number | null
}

export interface Project {
  id: string
  title: string
  step: Step
  status: ProjectStatus
  aspect: Aspect
  surah: number | null
  ayahFrom: number | null
  ayahTo: number | null
  reciter: string
  script: ArabicScript
  /** Installed translation edition ids; the first is primary. */
  editions: string[]
  /** The audio (or video) the video is built on. Trimming replaces it with a new asset, so time 0 is always its start. */
  sourceAssetId: string | null
  segments: Segment[]
  style: StyleSettings
  background: Background
  overlays: Overlay[]
  /** Nature sound under the recitation; absent or null = none. */
  ambient?: AmbientSettings | null
  /** Cover image for Shorts, Reels and TikTok; absent until the Thumbnail dialog is first edited. */
  thumbnail?: ThumbnailSpec
  /** Upload copy the user edited, per platform; platforms without an entry show a fresh draft. */
  publish?: PublishKit
  createdAt: number
  updatedAt: number
}

export type ProjectInit = Pick<Project, 'title' | 'aspect' | 'surah' | 'ayahFrom' | 'ayahTo' | 'reciter' | 'script'>

export interface ProjectSummary {
  id: string
  title: string
  step: Step
  status: ProjectStatus
  aspect: Aspect
  /** What the recording actually holds (from its verse segments), else what the project was created for. */
  surah: number | null
  ayahFrom: number | null
  ayahTo: number | null
  /** Set when the segments run through more than one surah: the last one (`surah` is the first). */
  surahTo: number | null
  /** How many different surahs the segments cover (0 when there are no verse segments). */
  surahCount: number
  reciter: string
  durationMs: number | null
  segmentCount: number
  /** For the card thumbnail. */
  style: StyleSettings
  backgroundColor: string
  updatedAt: number
}

export type AssetKind = 'audio' | 'video' | 'image'
export type AssetSource = 'local' | 'mp3quran' | 'qdc' | 'youtube' | 'trim' | 'frame' | 'stock' | 'ai'

/** Owned by the main process: the renderer never writes asset rows. */
export interface Asset {
  id: string
  projectId: string
  kind: AssetKind
  /** Relative to the project folder. */
  path: string
  /** Display name (original file name or reciter + surah). */
  name: string
  durationMs: number | null
  width: number | null
  height: number | null
  source: AssetSource
  meta: Record<string, unknown>
  createdAt: number
  /** studio://asset/... URL for the renderer. */
  url: string
}

export type JobKind = 'download' | 'youtube' | 'trim' | 'align' | 'translate' | 'aitrim' | 'export' | 'ytdlp' | 'thumbnail' | 'imagegen'
export type JobStatus = 'queued' | 'running' | 'done' | 'failed' | 'canceled'

export interface Job {
  id: string
  projectId: string | null
  kind: JobKind
  status: JobStatus
  progress: number
  message: string | null
  error: string | null
  createdAt: number
  updatedAt: number
}

export interface ProjectBundle {
  project: Project
  assets: Asset[]
  jobs: Job[]
}

/** Main changed project fields (job results). The renderer merges them into its state; autosave then keeps them. */
export interface ProjectPatchEvent {
  projectId: string
  patch: Partial<Project>
}

export interface Settings {
  theme: 'system' | 'light' | 'dark'
  /** Interface language; also the language of messages from the main process and of text drawn into videos. */
  language: Lang
  /** Default script for new projects. */
  script: ArabicScript
  /** OpenAI-compatible base URL, e.g. https://api.openai.com/v1 */
  aiBaseUrl: string
  aiModel: string
  exportFolder: string
  /** Text AI: an OpenAI-compatible API (aiBaseUrl/aiModel + key) or an AI CLI installed on this computer. */
  aiProvider: AiProvider
  cliTool: CliTool
  /** Empty = the CLI's own default model. */
  cliModel: string
  /** Shell command of cliTool 'custom'; the prompt arrives on stdin, the reply is read from stdout. */
  cliCommand: string
  imageProvider: ImageProvider
  /** Model for the 'openai' image provider (and Pollinations when set); empty = the service's default. */
  imageModel: string
  imageCliTool: CliImageTool
  /** Shell command of imageCliTool 'custom': writes one picture to {output}. */
  imageCliCommand: string
  /** Measured render speed of this computer (ms per megapixel of one frame, still background); null until the first export. Feeds the time estimate. */
  renderMsPerMpFrame: number | null
}

/** Whether AI features can run: through an API key (or a local endpoint), or through an AI CLI installed on this computer. */
export interface AiReady {
  ready: boolean
  via: 'api' | 'cli' | null
  /** Indonesian one-liner for what is missing, shown when not ready. */
  hint: string
}

export interface KeyStatus {
  configured: boolean
  preview: string | null
}

export interface Reciter {
  /** Provider-scoped id, e.g. "mp3quran:123:5" (reciter:moshaf) or "qdc:7". */
  id: string
  provider: 'mp3quran' | 'qdc'
  name: string
  style: string
  /** Surahs this reciter has. */
  surahs: number[]
  /** True when the provider gives ayah/word timings, so sync needs no aligner. */
  timed: boolean
}

export interface Edition {
  id: string
  language: string
  name: string
  author: string
  installed: boolean
  /** Bundled editions (Kemenag) cannot be removed. */
  bundled: boolean
}

export interface ExportOptions {
  projectId: string
  height: 720 | 1080 | 2160
  fps: 15 | 24 | 30 | 60
  /** How the video is drawn: see renderPlan.ts. */
  mode: RenderMode
  /** Done only when the export succeeds. */
  after: AfterExport
  /** Only this stretch of the timeline is drawn (null or absent = the whole video). Validated again in main. */
  range?: ExportRange | null
  /** Chunked renders reuse pieces left by an earlier, interrupted run of the same project; true discards them first. */
  fresh?: boolean
  folder: string
  srt: boolean
  vtt: boolean
  chapters: boolean
}

export interface PolicyIssue {
  segmentId: string | null
  severity: 'error' | 'warning'
  message: string
}

/** Moves status forward only. */
export const STATUS_ORDER: ProjectStatus[] = ['draft', 'source', 'synced', 'editing', 'exported']
export const advanceStatus = (cur: ProjectStatus, next: ProjectStatus): ProjectStatus =>
  STATUS_ORDER.indexOf(next) > STATUS_ORDER.indexOf(cur) ? next : cur
