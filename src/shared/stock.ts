import { msg } from './i18n'
export type StockProvider = 'pexels' | 'unsplash' | 'pixabay'
export type StockKind = 'photo' | 'video'
export type StockOrientation = 'portrait' | 'landscape' | 'square'

export interface StockProviderInfo {
  id: StockProvider
  label: string
  /** Where a person gets a free API key. */
  keyUrl: string
  kinds: StockKind[]
  /** Credit line shown with a picked item, as the provider's terms ask. */
  creditNote: string
}

export const STOCK_PROVIDERS: StockProviderInfo[] = [
  { id: 'pexels', label: 'Pexels', keyUrl: 'https://www.pexels.com/api/new/', kinds: ['photo', 'video'], creditNote: msg('Foto/video dari Pexels. Mencantumkan fotografer dianjurkan.') },
  { id: 'unsplash', label: 'Unsplash', keyUrl: 'https://unsplash.com/oauth/applications', kinds: ['photo'], creditNote: msg('Foto dari Unsplash. Pencantuman fotografer dan Unsplash diwajibkan.') },
  { id: 'pixabay', label: 'Pixabay', keyUrl: 'https://pixabay.com/api/docs/', kinds: ['photo', 'video'], creditNote: msg('Gambar/video dari Pixabay. Boleh dipakai bebas.') }
]

export interface StockQuery {
  provider: StockProvider
  kind: StockKind
  query: string
  orientation: StockOrientation
  page: number
}

export interface StockItem {
  id: string
  provider: StockProvider
  kind: StockKind
  /** Small picture for the result grid. */
  thumbUrl: string
  /** What gets saved into the project: a photo sized for a video frame, or an MP4 file. */
  downloadUrl: string
  width: number
  height: number
  durationSec: number | null
  author: string
  authorUrl: string
  /** The item's page on the provider, for credit. */
  sourceUrl: string
  /** Unsplash asks apps to call this when a photo is used. */
  downloadPing: string | null
}

export interface StockPage {
  items: StockItem[]
  hasMore: boolean
}
