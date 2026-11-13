import type { AssetKind } from './types'

/**
 * What the Settings > Storage section can clear.
 * temp: leftovers of renders and downloads (Remotion's folders in the system temp dir, the app's tmp folder);
 * render-parts: finished pieces of a chunked export that was interrupted (kept so it can resume);
 * spectrum: the loudness tables of the visualizer (rebuilt on demand);
 * fonts: Uthmani and QPC fonts downloaded from Quran.com (need internet to fetch again).
 */
export type CacheId = 'temp' | 'render-parts' | 'spectrum' | 'fonts'

export interface CacheEntry {
  id: CacheId
  bytes: number
  files: number
}

export interface StorageUsage {
  entries: CacheEntry[]
  /** Everything under the projects folder: the user's recordings and media. Shown for information, never cleared here. */
  projectsBytes: number
  exportFolder: string
  exportBytes: number
  /** A job is running or queued: nothing can be cleared or deleted until it ends. */
  busy: boolean
}

/** What a project points at an asset for. An asset with no use is safe to delete. */
export type AssetUse = 'source' | 'background' | 'overlay' | 'thumbnail'

export interface StorageAsset {
  id: string
  name: string
  kind: AssetKind
  bytes: number
  uses: AssetUse[]
}

export interface StorageProject {
  id: string
  title: string
  assets: StorageAsset[]
  /** Sum of `assets` bytes. */
  bytes: number
}
