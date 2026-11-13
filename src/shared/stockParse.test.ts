import { describe, expect, it } from 'vitest'
import {
  expandQuery,
  parsePexelsPhotos,
  parsePexelsVideos,
  parsePixabayPhotos,
  parsePixabayVideos,
  parseUnsplash,
  pickPexelsVideoFile,
  stockCredit,
  stockHttpError,
  stockRequest
} from './stockParse'

// Fixtures are the sample responses printed in each provider's official docs (trimmed of unused fields).

const pexelsPhotos = {
  total_results: 10000,
  page: 1,
  per_page: 1,
  photos: [
    {
      id: 3573351,
      width: 3066,
      height: 3968,
      url: 'https://www.pexels.com/photo/trees-during-day-3573351/',
      photographer: 'Lukas Rodriguez',
      photographer_url: 'https://www.pexels.com/@lukas-rodriguez-1845331',
      photographer_id: 1845331,
      src: {
        original: 'https://images.pexels.com/photos/3573351/pexels-photo-3573351.png',
        large2x: 'https://images.pexels.com/photos/3573351/pexels-photo-3573351.png?auto=compress&cs=tinysrgb&dpr=2&h=650&w=940',
        medium: 'https://images.pexels.com/photos/3573351/pexels-photo-3573351.png?auto=compress&cs=tinysrgb&h=350',
        small: 'https://images.pexels.com/photos/3573351/pexels-photo-3573351.png?auto=compress&cs=tinysrgb&h=130'
      }
    }
  ],
  next_page: 'https://api.pexels.com/v1/search/?page=2&per_page=1&query=nature'
}

const pexelsVideos = {
  page: 1,
  per_page: 1,
  total_results: 4089,
  url: 'https://www.pexels.com/search/videos/Nature/',
  videos: [
    {
      id: 1093662,
      width: 1920,
      height: 1080,
      url: 'https://www.pexels.com/video/water-crashing-over-the-rocks-1093662/',
      image: 'https://images.pexels.com/videos/1093662/free-video-1093662.jpg?fit=crop&w=1200&h=630&auto=compress&cs=tinysrgb',
      duration: 8,
      user: { id: 417939, name: 'Peter Fowler', url: 'https://www.pexels.com/@peter-fowler-417939' },
      video_files: [
        { id: 37101, quality: 'hd', file_type: 'video/mp4', width: 1280, height: 720, link: 'https://player.vimeo.com/external/269971860.hd.mp4?profile_id=174' },
        { id: 37102, quality: 'sd', file_type: 'video/mp4', width: 640, height: 360, link: 'https://player.vimeo.com/external/269971860.sd.mp4?profile_id=164' },
        { id: 37103, quality: 'hd', file_type: 'video/mp4', width: 1920, height: 1080, link: 'https://player.vimeo.com/external/269971860.hd.mp4?profile_id=175' },
        { id: 37105, quality: 'hls', file_type: 'video/mp4', width: null, height: null, link: 'https://player.vimeo.com/external/269971860.m3u8?s=ac08' }
      ],
      video_pictures: [{ id: 79696, picture: 'https://static-videos.pexels.com/videos/1093662/pictures/preview-0.jpg', nr: 0 }]
    }
  ]
}

const unsplash = {
  total: 133,
  total_pages: 7,
  results: [
    {
      id: 'eOLpJytrbsQ',
      width: 4000,
      height: 3000,
      user: { id: 'Ul0QVz12Goo', username: 'ugmonk', name: 'Jeff Sheldon', links: { html: 'http://unsplash.com/@ugmonk' } },
      urls: {
        raw: 'https://images.unsplash.com/photo-1416339306562-f3d12fefd36f?ixid=abc',
        regular: 'https://images.unsplash.com/photo-1416339306562-f3d12fefd36f?ixid=abc&w=1080&fit=max',
        small: 'https://images.unsplash.com/photo-1416339306562-f3d12fefd36f?ixid=abc&w=400&fit=max',
        thumb: 'https://images.unsplash.com/photo-1416339306562-f3d12fefd36f?ixid=abc&w=200&fit=max'
      },
      links: {
        self: 'https://api.unsplash.com/photos/eOLpJytrbsQ',
        html: 'http://unsplash.com/photos/eOLpJytrbsQ',
        download: 'http://unsplash.com/photos/eOLpJytrbsQ/download',
        download_location: 'https://api.unsplash.com/photos/eOLpJytrbsQ/download'
      }
    }
  ]
}

const pixabayPhotos = {
  total: 4692,
  totalHits: 500,
  hits: [
    {
      id: 195893,
      pageURL: 'https://pixabay.com/en/blossom-bloom-flower-195893/',
      type: 'photo',
      previewURL: 'https://cdn.pixabay.com/photo/2013/10/15/09/12/flower-195893_150.jpg',
      webformatURL: 'https://pixabay.com/get/35bbf209e13e39d2_640.jpg',
      webformatWidth: 640,
      webformatHeight: 360,
      largeImageURL: 'https://pixabay.com/get/ed6a99fd0a76647_1280.jpg',
      imageWidth: 4000,
      imageHeight: 2250,
      user_id: 48777,
      user: 'Josch13'
    }
  ]
}

const pixabayVideos = {
  total: 42,
  totalHits: 42,
  hits: [
    {
      id: 125,
      pageURL: 'https://pixabay.com/videos/id-125/',
      type: 'film',
      duration: 12,
      videos: {
        large: { url: '', width: 0, height: 0, size: 0, thumbnail: '' },
        medium: { url: 'https://cdn.pixabay.com/video/2015/08/08/125-135736646_medium.mp4', width: 1280, height: 720, size: 3562083, thumbnail: 'https://cdn.pixabay.com/video/2015/08/08/125-135736646_medium.jpg' },
        small: { url: 'https://cdn.pixabay.com/video/2015/08/08/125-135736646_small.mp4', width: 640, height: 360, size: 1030736, thumbnail: 'https://cdn.pixabay.com/video/2015/08/08/125-135736646_small.jpg' },
        tiny: { url: 'https://cdn.pixabay.com/video/2015/08/08/125-135736646_tiny.mp4', width: 480, height: 270, size: 426799, thumbnail: 'https://cdn.pixabay.com/video/2015/08/08/125-135736646_tiny.jpg' }
      },
      user_id: 1281706,
      user: 'Coverr-Free-Footage'
    }
  ]
}

describe('Pexels', () => {
  it('reads a photo and keeps the original when it is not oversized', () => {
    const page = parsePexelsPhotos(pexelsPhotos)
    expect(page.hasMore).toBe(true)
    expect(page.items).toHaveLength(1)
    const p = page.items[0]!
    expect(p).toMatchObject({ id: '3573351', provider: 'pexels', kind: 'photo', author: 'Lukas Rodriguez', sourceUrl: 'https://www.pexels.com/photo/trees-during-day-3573351/' })
    expect(p.thumbUrl).toContain('h=350')
    // 3968 px tall: asks the CDN for a 2400 px height instead of the full-size file
    expect(p.downloadUrl).toBe('https://images.pexels.com/photos/3573351/pexels-photo-3573351.png?auto=compress&cs=tinysrgb&h=2400')
  })

  it('handles an empty page and a photo missing its sizes', () => {
    expect(parsePexelsPhotos({ photos: [], page: 1, per_page: 15, total_results: 0 })).toEqual({ items: [], hasMore: false })
    expect(parsePexelsPhotos({ photos: [{ id: 1, src: {} }] }).items).toEqual([])
    expect(parsePexelsPhotos(null)).toEqual({ items: [], hasMore: false })
  })

  it('reads a video, picking the 1080p MP4 and ignoring HLS', () => {
    const page = parsePexelsVideos(pexelsVideos)
    expect(page.hasMore).toBe(false)
    expect(page.items[0]).toMatchObject({
      id: '1093662',
      kind: 'video',
      downloadUrl: 'https://player.vimeo.com/external/269971860.hd.mp4?profile_id=175',
      width: 1920,
      height: 1080,
      durationSec: 8,
      author: 'Peter Fowler',
      thumbUrl: 'https://static-videos.pexels.com/videos/1093662/pictures/preview-0.jpg'
    })
  })

  it('picks the largest file when none reaches 1080p, and null when only HLS is offered', () => {
    const f = (w: number, h: number, link = `https://x/${w}.mp4`) => ({ file_type: 'video/mp4', width: w, height: h, link })
    expect(pickPexelsVideoFile([f(640, 360), f(1280, 720)])?.width).toBe(1280)
    // portrait: the short side decides, so 1080x1920 beats 2160x3840
    expect(pickPexelsVideoFile([f(2160, 3840), f(1080, 1920), f(720, 1280)])?.width).toBe(1080)
    expect(pickPexelsVideoFile([{ file_type: 'video/mp4', width: null, height: null, link: 'https://x/a.m3u8' }])).toBeNull()
  })
})

describe('Unsplash', () => {
  it('reads a result, sizes from raw, tags links, and keeps the download ping', () => {
    const page = parseUnsplash(unsplash, 1)
    expect(page.hasMore).toBe(true)
    const p = page.items[0]!
    expect(p).toMatchObject({ id: 'eOLpJytrbsQ', provider: 'unsplash', kind: 'photo', author: 'Jeff Sheldon', downloadPing: 'https://api.unsplash.com/photos/eOLpJytrbsQ/download' })
    expect(p.downloadUrl).toBe('https://images.unsplash.com/photo-1416339306562-f3d12fefd36f?ixid=abc&fm=jpg&q=80&fit=max&w=2400&h=2400')
    expect(p.authorUrl).toBe('https://unsplash.com/@ugmonk?utm_source=quran_render&utm_medium=referral')
    expect(p.sourceUrl).toBe('https://unsplash.com/photos/eOLpJytrbsQ?utm_source=quran_render&utm_medium=referral')
  })

  it('stops at the last page, falls back to regular without raw, and survives empty results', () => {
    expect(parseUnsplash(unsplash, 7).hasMore).toBe(false)
    const noRaw = { results: [{ ...unsplash.results[0], urls: { ...unsplash.results[0]!.urls, raw: undefined } }] }
    expect(parseUnsplash(noRaw).items[0]!.downloadUrl).toContain('w=1080')
    expect(parseUnsplash({ total: 0, total_pages: 0, results: [] })).toEqual({ items: [], hasMore: false })
  })

  it('has no ping when the photo lacks download_location (older sample shape)', () => {
    const old = { total_pages: 1, results: [{ ...unsplash.results[0], links: { html: 'http://unsplash.com/photos/x' } }] }
    expect(parseUnsplash(old).items[0]!.downloadPing).toBeNull()
  })
})

describe('Pixabay', () => {
  it('reads a photo with the contributor profile URL and paginates by totalHits', () => {
    const first = parsePixabayPhotos(pixabayPhotos, 1, 24)
    expect(first.hasMore).toBe(true)
    expect(first.items[0]).toMatchObject({
      id: '195893',
      downloadUrl: 'https://pixabay.com/get/ed6a99fd0a76647_1280.jpg',
      thumbUrl: 'https://pixabay.com/get/35bbf209e13e39d2_640.jpg',
      width: 4000,
      author: 'Josch13',
      authorUrl: 'https://pixabay.com/users/Josch13-48777/'
    })
    expect(parsePixabayPhotos(pixabayPhotos, 21, 24).hasMore).toBe(false)
  })

  it('prefers fullHDURL when the account has it', () => {
    const hit = { ...pixabayPhotos.hits[0]!, fullHDURL: 'https://pixabay.com/get/full_1920.jpg' }
    expect(parsePixabayPhotos({ totalHits: 1, hits: [hit] }).items[0]!.downloadUrl).toBe('https://pixabay.com/get/full_1920.jpg')
  })

  it('reads a video, preferring medium and never picking the empty large rendition', () => {
    const page = parsePixabayVideos(pixabayVideos)
    expect(page.hasMore).toBe(true)
    expect(page.items[0]).toMatchObject({
      kind: 'video',
      downloadUrl: 'https://cdn.pixabay.com/video/2015/08/08/125-135736646_medium.mp4',
      thumbUrl: 'https://cdn.pixabay.com/video/2015/08/08/125-135736646_small.jpg',
      durationSec: 12,
      width: 1280
    })
  })

  it('falls through an empty large rendition to the next one that has a URL', () => {
    const { large, small, tiny } = pixabayVideos.hits[0]!.videos
    const page = parsePixabayVideos({ totalHits: 1, hits: [{ ...pixabayVideos.hits[0], videos: { large, small, tiny } }] })
    expect(page.items[0]!.downloadUrl).toContain('_small.mp4')
  })

  it('puts videos of the wanted orientation first and survives an empty page', () => {
    const portrait = { ...pixabayVideos.hits[0]!, id: 2, videos: { medium: { url: 'https://cdn.pixabay.com/p.mp4', width: 1080, height: 1920, thumbnail: 'https://cdn.pixabay.com/p.jpg' } } }
    const page = parsePixabayVideos({ totalHits: 2, hits: [pixabayVideos.hits[0], portrait] }, 1, 24, 'portrait')
    expect(page.items.map((i) => i.id)).toEqual(['2', '125'])
    expect(parsePixabayVideos({ total: 0, totalHits: 0, hits: [] })).toEqual({ items: [], hasMore: false })
  })
})

describe('credit', () => {
  it('writes an Indonesian credit line, with and without a name', () => {
    expect(stockCredit({ provider: 'pexels', kind: 'photo', author: 'Lukas Rodriguez' })).toBe('Foto oleh Lukas Rodriguez di Pexels')
    expect(stockCredit({ provider: 'pixabay', kind: 'video', author: 'Coverr' })).toBe('Video oleh Coverr di Pixabay')
    expect(stockCredit({ provider: 'unsplash', kind: 'photo', author: '' })).toBe('Foto dari Unsplash')
  })
})

describe('expandQuery', () => {
  it('turns common Indonesian words into English tags and keeps unknown words', () => {
    expect(expandQuery('Hutan berkabut')).toBe('forest misty')
    expect(expandQuery('  Langit   malam ')).toBe('night sky')
    expect(expandQuery('air terjun')).toBe('waterfall')
    expect(expandQuery('masjid di kota')).toBe('mosque di city')
    expect(expandQuery('mountain')).toBe('mountain')
  })
  it('caps the length at what Pixabay accepts', () => {
    expect(expandQuery('x'.repeat(300))).toHaveLength(100)
  })
})

describe('stockRequest', () => {
  const base = { query: 'Gurun', orientation: 'portrait' as const, page: 2 }
  it('builds the Pexels photo and video requests with the key in the header', () => {
    const photo = stockRequest({ ...base, provider: 'pexels', kind: 'photo' }, 'KEY')
    expect(photo.url).toBe('https://api.pexels.com/v1/search?query=desert&orientation=portrait&per_page=24&page=2')
    expect(photo.headers).toEqual({ Authorization: 'KEY' })
    expect(stockRequest({ ...base, provider: 'pexels', kind: 'video' }, 'KEY').url).toContain('https://api.pexels.com/v1/videos/search?')
  })
  it('builds the Unsplash request with Client-ID and squarish for square', () => {
    const r = stockRequest({ ...base, orientation: 'square', provider: 'unsplash', kind: 'photo' }, 'K')
    expect(r.url).toContain('https://api.unsplash.com/search/photos?query=desert&orientation=squarish')
    expect(r.headers.Authorization).toBe('Client-ID K')
  })
  it('builds the Pixabay request with the key in the query and no orientation for videos or square', () => {
    const photo = stockRequest({ ...base, provider: 'pixabay', kind: 'photo' }, 'K')
    expect(photo.url).toContain('https://pixabay.com/api/?key=K&q=desert&image_type=photo&orientation=vertical')
    expect(stockRequest({ ...base, orientation: 'square', provider: 'pixabay', kind: 'photo' }, 'K').url).not.toContain('orientation')
    const video = stockRequest({ ...base, provider: 'pixabay', kind: 'video' }, 'K')
    expect(video.url).toContain('https://pixabay.com/api/videos/?key=K')
    expect(video.url).not.toContain('orientation')
  })
  it('encodes the key and the search term', () => {
    expect(stockRequest({ ...base, query: 'a&b', provider: 'pixabay', kind: 'photo' }, 'k e').url).toContain('key=k%20e&q=a%26b')
  })
})

describe('stockHttpError', () => {
  it('maps statuses to Indonesian messages', () => {
    expect(stockHttpError('pexels', 401)).toContain('Kunci Pexels tidak valid')
    expect(stockHttpError('unsplash', 403, 'Invalid access token')).toContain('tidak valid')
    expect(stockHttpError('pexels', 429)).toContain('Batas permintaan Pexels tercapai')
    expect(stockHttpError('unsplash', 403, 'Rate Limit Exceeded')).toContain('Batas permintaan Unsplash tercapai')
    expect(stockHttpError('pixabay', 400, '[ERROR 400] Invalid or missing API key')).toContain('Kunci Pixabay tidak valid')
    expect(stockHttpError('pixabay', 503)).toContain('sedang bermasalah')
    expect(stockHttpError('pixabay', 404)).toContain('kode 404')
  })
})
