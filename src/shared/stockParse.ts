import type { StockItem, StockOrientation, StockPage, StockProvider, StockQuery } from './stock'
import { STOCK_PROVIDERS } from './stock'
import { t } from './i18n'

// Pure request builders and response parsers for the three stock providers. The field names are the ones in each
// provider's official docs (see the notes above every parser); anything optional is read defensively, because a
// missing field must drop one item, never break the whole page.

type Json = Record<string, unknown>

const obj = (v: unknown): Json => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Json) : {})
const arr = (v: unknown): Json[] => (Array.isArray(v) ? v.map(obj) : [])
const str = (v: unknown): string => (typeof v === 'string' ? v : '')
const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0)

export const STOCK_PER_PAGE = 24

export const providerLabel = (id: StockProvider): string => STOCK_PROVIDERS.find((p) => p.id === id)?.label ?? id

// --- Indonesian queries -------------------------------------------------------------------------------------------

/** The APIs index English tags, so common Indonesian words are swapped for English ones. Unknown words pass through. */
const WORDS: Record<string, string> = {
  alam: 'nature',
  langit: 'sky',
  malam: 'night',
  masjid: 'mosque',
  gurun: 'desert',
  laut: 'sea',
  hutan: 'forest',
  gunung: 'mountain',
  bintang: 'stars',
  hujan: 'rain',
  senja: 'sunset',
  bunga: 'flower',
  awan: 'clouds',
  kota: 'city',
  berkabut: 'misty',
  kabut: 'fog',
  tenang: 'calm',
  pantai: 'beach',
  matahari: 'sun',
  bulan: 'moon',
  fajar: 'sunrise',
  subuh: 'dawn',
  pagi: 'morning',
  danau: 'lake',
  sungai: 'river',
  salju: 'snow',
  pasir: 'sand',
  taman: 'garden',
  cahaya: 'light',
  indah: 'beautiful',
  bukit: 'hill',
  daun: 'leaves',
  pohon: 'tree',
  kubah: 'dome',
  lampu: 'lights',
  api: 'fire'
}

const PHRASES: Record<string, string> = { 'air terjun': 'waterfall', 'langit malam': 'night sky' }

export function expandQuery(raw: string): string {
  let text = ` ${raw.toLowerCase().replace(/\s+/g, ' ').trim()} `
  for (const [id, en] of Object.entries(PHRASES)) text = text.split(` ${id} `).join(` ${en} `)
  return text
    .trim()
    .split(' ')
    .filter(Boolean)
    .map((w) => WORDS[w] ?? w)
    .join(' ')
    .slice(0, 100)
}

// --- Requests -----------------------------------------------------------------------------------------------------

export interface StockRequest {
  url: string
  headers: Record<string, string>
}

const ORIENTATION_UNSPLASH: Record<StockOrientation, string> = { landscape: 'landscape', portrait: 'portrait', square: 'squarish' }
const ORIENTATION_PIXABAY: Record<StockOrientation, string | null> = { landscape: 'horizontal', portrait: 'vertical', square: null }

export function stockRequest(q: StockQuery, key: string): StockRequest {
  const term = expandQuery(q.query)
  const page = Math.max(1, Math.floor(q.page) || 1)
  const params = (o: Record<string, string | number | null>): string =>
    Object.entries(o)
      .filter(([, v]) => v !== null)
      .map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`)
      .join('&')

  if (q.provider === 'pexels') {
    // Docs: GET https://api.pexels.com/v1/search and /v1/videos/search, `Authorization: <key>`, per_page max 80.
    const path = q.kind === 'video' ? 'v1/videos/search' : 'v1/search'
    return {
      url: `https://api.pexels.com/${path}?${params({ query: term, orientation: q.orientation, per_page: STOCK_PER_PAGE, page })}`,
      headers: { Authorization: key }
    }
  }
  if (q.provider === 'unsplash') {
    // Docs: GET /search/photos, `Authorization: Client-ID <key>`, per_page max 30; orientation landscape|portrait|squarish.
    // content_filter=high keeps results suitable for all audiences.
    return {
      url: `https://api.unsplash.com/search/photos?${params({ query: term, orientation: ORIENTATION_UNSPLASH[q.orientation], per_page: STOCK_PER_PAGE, page, content_filter: 'high' })}`,
      headers: { Authorization: `Client-ID ${key}`, 'Accept-Version': 'v1' }
    }
  }
  // Pixabay docs: `key` query parameter. Photos filter orientation; the videos endpoint has no orientation parameter.
  const photo = q.kind === 'photo'
  return {
    url: `https://pixabay.com/api/${photo ? '' : 'videos/'}?${params({
      key,
      q: term,
      image_type: photo ? 'photo' : null,
      orientation: photo ? ORIENTATION_PIXABAY[q.orientation] : null,
      safesearch: 'true',
      per_page: STOCK_PER_PAGE,
      page
    })}`,
    headers: {}
  }
}

/** Indonesian message for a failed provider call. `body` is the (possibly empty) response text. */
export function stockHttpError(provider: StockProvider, status: number, body = ''): string {
  const name = providerLabel(provider)
  const limited = status === 429 || (status === 403 && /rate limit/i.test(body))
  if (limited) return t('Batas permintaan {name} tercapai. Silakan coba lagi nanti.', { name })
  if (status === 401 || status === 403 || (provider === 'pixabay' && status === 400 && /key/i.test(body))) {
    return t('Kunci {name} tidak valid. Silakan periksa atau masukkan ulang kuncinya.', { name })
  }
  if (status >= 500) return t('{name} sedang bermasalah. Silakan coba lagi sebentar lagi.', { name })
  return t('{name} menolak permintaan ini (kode {status}).', { name, status })
}

// --- Orientation helper -------------------------------------------------------------------------------------------

export function orientationOf(width: number, height: number): StockOrientation {
  if (!width || !height) return 'landscape'
  const r = width / height
  return r > 1.1 ? 'landscape' : r < 0.9 ? 'portrait' : 'square'
}

/** Pixabay has no orientation filter for videos: matching ones first, the rest keep their order after them. */
function matchFirst(items: StockItem[], orientation: StockOrientation): StockItem[] {
  const fits = (i: StockItem) => orientationOf(i.width, i.height) === orientation
  return [...items.filter(fits), ...items.filter((i) => !fits(i))]
}

// --- Credits ------------------------------------------------------------------------------------------------------

/** The line for Publikasi and the picker: "Foto oleh Ana di Pexels". */
export function stockCredit(item: Pick<StockItem, 'provider' | 'kind' | 'author'>): string {
  const name = providerLabel(item.provider)
  if (item.kind === 'video') return item.author ? t('Video oleh {author} di {name}', { author: item.author, name }) : t('Video dari {name}', { name })
  return item.author ? t('Foto oleh {author} di {name}', { author: item.author, name }) : t('Foto dari {name}', { name })
}

// --- Pexels -------------------------------------------------------------------------------------------------------

/**
 * Docs (Photo resource, GET /v1/search): { photos: [{ id, width, height, url, photographer, photographer_url,
 * src: { original, large2x, medium, ... } }], next_page? }.
 */
export function parsePexelsPhotos(json: unknown): StockPage {
  const root = obj(json)
  const items: StockItem[] = []
  for (const p of arr(root.photos)) {
    const src = obj(p.src)
    const width = num(p.width)
    const height = num(p.height)
    const original = str(src.original)
    const thumbUrl = str(src.medium) || str(src.small) || str(src.large)
    if (!p.id || !thumbUrl || !(original || str(src.large2x))) continue
    items.push({
      id: String(p.id),
      provider: 'pexels',
      kind: 'photo',
      thumbUrl,
      downloadUrl: original ? pexelsSized(original, width, height) : str(src.large2x),
      width,
      height,
      durationSec: null,
      author: str(p.photographer),
      authorUrl: str(p.photographer_url),
      sourceUrl: str(p.url),
      downloadPing: null
    })
  }
  return { items, hasMore: !!str(root.next_page) }
}

/**
 * `original` can be a 24 MP file. The image CDN accepts the same `w`/`h` parameters the docs show in `src.large`
 * (`?auto=compress&cs=tinysrgb&h=650&w=940`); one side only keeps the aspect ratio.
 */
function pexelsSized(original: string, width: number, height: number): string {
  const long = Math.max(width, height)
  if (!long || long <= 2400) return original
  const side = height >= width ? 'h' : 'w'
  return `${original}${original.includes('?') ? '&' : '?'}auto=compress&cs=tinysrgb&${side}=2400`
}

/**
 * Picks an MP4 rendition near 1080p: the smallest whose short side is at least 1080, otherwise the largest. HLS entries
 * (`quality: "hls"`, null size, `.m3u8` link) are skipped, as are non-MP4 files.
 */
export function pickPexelsVideoFile(files: Json[]): { link: string; width: number; height: number } | null {
  const mp4 = files
    .map((f) => ({ link: str(f.link), width: num(f.width), height: num(f.height), type: str(f.file_type) }))
    .filter((f) => f.link && f.width && f.height && f.type === 'video/mp4' && !/\.m3u8(\?|$)/.test(f.link))
  if (!mp4.length) return null
  const short = (f: { width: number; height: number }) => Math.min(f.width, f.height)
  const enough = mp4.filter((f) => short(f) >= 1080).sort((a, b) => short(a) - short(b))
  return enough[0] ?? mp4.sort((a, b) => short(b) - short(a))[0]!
}

/**
 * Docs (Video resource, GET /v1/videos/search): { videos: [{ id, width, height, url, image, duration, user: { name, url },
 * video_files: [{ quality, file_type, width, height, link }], video_pictures: [{ picture }] }], next_page? }.
 */
export function parsePexelsVideos(json: unknown): StockPage {
  const root = obj(json)
  const items: StockItem[] = []
  for (const v of arr(root.videos)) {
    const file = pickPexelsVideoFile(arr(v.video_files))
    const thumbUrl = str(arr(v.video_pictures)[0]?.picture) || str(v.image)
    if (!v.id || !file || !thumbUrl) continue
    const user = obj(v.user)
    items.push({
      id: String(v.id),
      provider: 'pexels',
      kind: 'video',
      thumbUrl,
      downloadUrl: file.link,
      width: file.width,
      height: file.height,
      durationSec: num(v.duration) || null,
      author: str(user.name),
      authorUrl: str(user.url),
      sourceUrl: str(v.url),
      downloadPing: null
    })
  }
  return { items, hasMore: !!str(root.next_page) }
}

// --- Unsplash -----------------------------------------------------------------------------------------------------

/** Their guidelines ask for these parameters on links to the photographer and to Unsplash. */
const UTM = 'utm_source=quran_render&utm_medium=referral'
const withUtm = (url: string): string => (url ? `${url.replace(/^http:/, 'https:')}${url.includes('?') ? '&' : '?'}${UTM}` : '')

/**
 * `urls.raw` is the base photo URL that keeps the `ixid` parameter; the docs list `w`, `h`, `fit`, `fm`, `q` as supported.
 * `urls.regular` is fixed at 1080 px wide, which is too soft for a portrait frame, so the long side is asked for instead.
 */
function unsplashSized(urls: Json): string {
  const raw = str(urls.raw)
  if (!raw) return str(urls.regular)
  return `${raw}${raw.includes('?') ? '&' : '?'}fm=jpg&q=80&fit=max&w=2400&h=2400`
}

/**
 * Docs (GET /search/photos): { total, total_pages, results: [{ id, width, height, user: { name, links: { html } },
 * urls: { raw, regular, small, thumb }, links: { html, download_location } }] }.
 * `download_location` is what the "Track a photo download" endpoint is called with.
 */
export function parseUnsplash(json: unknown, page = 1): StockPage {
  const root = obj(json)
  const items: StockItem[] = []
  for (const p of arr(root.results)) {
    const urls = obj(p.urls)
    const user = obj(p.user)
    const links = obj(p.links)
    const thumbUrl = str(urls.small) || str(urls.thumb)
    const downloadUrl = unsplashSized(urls)
    if (!p.id || !thumbUrl || !downloadUrl) continue
    items.push({
      id: String(p.id),
      provider: 'unsplash',
      kind: 'photo',
      thumbUrl,
      downloadUrl,
      width: num(p.width),
      height: num(p.height),
      durationSec: null,
      author: str(user.name),
      authorUrl: withUtm(str(obj(user.links).html)),
      sourceUrl: withUtm(str(links.html)),
      downloadPing: str(links.download_location) || null
    })
  }
  return { items, hasMore: page < num(root.total_pages) }
}

// --- Pixabay ------------------------------------------------------------------------------------------------------

const pixabayAuthor = (h: Json): { author: string; authorUrl: string } => {
  const author = str(h.user)
  return { author, authorUrl: author && h.user_id ? `https://pixabay.com/users/${encodeURIComponent(author)}-${String(h.user_id)}/` : '' }
}

/**
 * Docs (GET /api/): { totalHits, hits: [{ id, pageURL, webformatURL, webformatWidth, largeImageURL, fullHDURL?, imageWidth,
 * imageHeight, user, user_id }] }. `fullHDURL` only exists for accounts with full API access; `largeImageURL` (max 1280 px)
 * is the fallback. Temporary hotlinking is allowed for result lists, so the 640 px `webformatURL` serves as the thumbnail.
 */
export function parsePixabayPhotos(json: unknown, page = 1, perPage = STOCK_PER_PAGE): StockPage {
  const root = obj(json)
  const items: StockItem[] = []
  for (const h of arr(root.hits)) {
    const downloadUrl = str(h.fullHDURL) || str(h.largeImageURL)
    const thumbUrl = str(h.webformatURL) || str(h.previewURL)
    if (!h.id || !downloadUrl || !thumbUrl) continue
    items.push({
      id: String(h.id),
      provider: 'pixabay',
      kind: 'photo',
      thumbUrl,
      downloadUrl,
      width: num(h.imageWidth) || num(h.webformatWidth),
      height: num(h.imageHeight) || num(h.webformatHeight),
      durationSec: null,
      ...pixabayAuthor(h),
      sourceUrl: str(h.pageURL),
      downloadPing: null
    })
  }
  return { items, hasMore: page * perPage < num(root.totalHits) }
}

/**
 * Docs (GET /api/videos/): { totalHits, hits: [{ id, pageURL, duration, videos: { large|medium|small|tiny: { url, width,
 * height, size, thumbnail } }, user, user_id }] }. `large` may carry an empty url (size 0) and is usually 4K, so `medium`
 * (usually 1920x1080) is preferred, then `large`, `small`, `tiny`.
 */
export function parsePixabayVideos(json: unknown, page = 1, perPage = STOCK_PER_PAGE, orientation?: StockOrientation): StockPage {
  const root = obj(json)
  let items: StockItem[] = []
  for (const h of arr(root.hits)) {
    const videos = obj(h.videos)
    const rendition = ['medium', 'large', 'small', 'tiny'].map((k) => obj(videos[k])).find((r) => str(r.url))
    const thumbUrl = str(obj(videos.small).thumbnail) || str(obj(videos.medium).thumbnail) || str(obj(videos.tiny).thumbnail) || str(rendition?.thumbnail)
    if (!h.id || !rendition || !thumbUrl) continue
    items.push({
      id: String(h.id),
      provider: 'pixabay',
      kind: 'video',
      thumbUrl,
      downloadUrl: str(rendition.url),
      width: num(rendition.width),
      height: num(rendition.height),
      durationSec: num(h.duration) || null,
      ...pixabayAuthor(h),
      sourceUrl: str(h.pageURL),
      downloadPing: null
    })
  }
  if (orientation) items = matchFirst(items, orientation)
  return { items, hasMore: page * perPage < num(root.totalHits) }
}

export function parseStockPage(q: StockQuery, json: unknown): StockPage {
  const page = Math.max(1, Math.floor(q.page) || 1)
  if (q.provider === 'pexels') return q.kind === 'video' ? parsePexelsVideos(json) : parsePexelsPhotos(json)
  if (q.provider === 'unsplash') return parseUnsplash(json, page)
  return q.kind === 'video' ? parsePixabayVideos(json, page, STOCK_PER_PAGE, q.orientation) : parsePixabayPhotos(json, page)
}
