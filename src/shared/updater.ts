export const UPDATE_REPO = 'abiiayyas/QuranRender'
export const UPDATE_API_URL = `https://api.github.com/repos/${UPDATE_REPO}/releases/latest`
export const UPDATE_RELEASES_URL = `https://github.com/${UPDATE_REPO}/releases`

export interface UpdateInfo {
  currentVersion: string
  latestVersion: string
  available: boolean
  releaseUrl: string
  assetName: string | null
  assetUrl: string | null
  assetSize: number | null
  notes: string
  publishedAt: string | null
}

export interface UpdateState {
  status: 'idle' | 'checking' | 'available' | 'up-to-date' | 'downloading' | 'downloaded' | 'error'
  info: UpdateInfo | null
  progress: number
  downloadedPath: string | null
  error: string | null
}

export const INITIAL_UPDATE_STATE: UpdateState = {
  status: 'idle',
  info: null,
  progress: 0,
  downloadedPath: null,
  error: null
}

export function normalizeVersion(v: string): [number, number, number] {
  const clean = v.trim().replace(/^v/i, '').split(/[-+]/)[0] ?? ''
  const [a = 0, b = 0, c = 0] = clean.split('.').map((p) => {
    const n = parseInt(p, 10)
    return Number.isFinite(n) && n >= 0 ? n : 0
  })
  return [a, b, c]
}

/** Returns 1 if `a > b`, -1 if `a < b`, 0 if equal. */
export function compareSemver(a: string, b: string): number {
  const pa = normalizeVersion(a)
  const pb = normalizeVersion(b)
  for (let i = 0; i < 3; i++) {
    if (pa[i] > pb[i]) return 1
    if (pa[i] < pb[i]) return -1
  }
  return 0
}

interface RawAsset {
  name?: unknown
  browser_download_url?: unknown
  size?: unknown
}

export function pickReleaseAsset(
  assets: unknown,
  platform: NodeJS.Platform,
  arch: string
): { name: string; url: string; size: number | null } | null {
  if (!Array.isArray(assets)) return null
  const valid = (assets as RawAsset[])
    .filter(
      (a) =>
        typeof a?.name === 'string' &&
        typeof a.browser_download_url === 'string' &&
        a.browser_download_url.startsWith('https://github.com/')
    )
    .map((a) => ({
      name: String(a.name),
      url: String(a.browser_download_url),
      size: typeof a.size === 'number' ? a.size : null
    }))

  const ext = platform === 'darwin' ? '.dmg' : platform === 'win32' ? '.exe' : ''
  if (!ext) return null
  const matchingExt = valid.filter((a) => a.name.toLowerCase().endsWith(ext))
  if (matchingExt.length === 0) return null
  const archMatch = matchingExt.find((a) => a.name.toLowerCase().includes(arch.toLowerCase()))
  return archMatch ?? matchingExt[0]
}

interface RawRelease {
  tag_name?: unknown
  html_url?: unknown
  body?: unknown
  published_at?: unknown
  draft?: unknown
  prerelease?: unknown
  assets?: unknown
}

export function parseRelease(
  raw: unknown,
  currentVersion: string,
  platform: NodeJS.Platform,
  arch: string
): UpdateInfo | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as RawRelease
  if (r.draft === true || r.prerelease === true) return null
  const tag = typeof r.tag_name === 'string' ? r.tag_name.trim() : ''
  if (!tag) return null
  const latestVersion = tag.replace(/^v/i, '')
  const releaseUrl =
    typeof r.html_url === 'string' && r.html_url.startsWith('https://github.com/') ? r.html_url : UPDATE_RELEASES_URL
  const picked = pickReleaseAsset(r.assets, platform, arch)
  return {
    currentVersion: currentVersion.replace(/^v/i, ''),
    latestVersion,
    available: compareSemver(latestVersion, currentVersion) > 0,
    releaseUrl,
    assetName: picked?.name ?? null,
    assetUrl: picked?.url ?? null,
    assetSize: picked?.size ?? null,
    notes: typeof r.body === 'string' ? r.body.trim() : '',
    publishedAt: typeof r.published_at === 'string' ? r.published_at : null
  }
}
