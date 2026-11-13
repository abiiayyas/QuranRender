/** Loudness of the source audio per video frame in `SPECTRUM_BANDS` bands, for the audio-reactive visualizer overlay. */
export const SPECTRUM_BANDS = 32
/** Frames per second of the table; the composition looks a frame up by time, so this is independent of the video's fps. */
export const SPECTRUM_FPS = 30
/** Part of the cache file name: bump it when the analysis changes so old tables are not reused. */
export const SPECTRUM_VERSION = 2
/** The analysis runs on 16 kHz mono audio: enough for the voice, and a long recitation stays cheap to decode. */
export const SPECTRUM_RATE = 16000

const WINDOW = 1024
const LOW_HZ = 90
const HIGH_HZ = 4800
/** How fast a bar rises and falls per frame (share of the distance covered), so motion reads as a level meter, not noise. */
const ATTACK = 0.7
const RELEASE = 0.25
/** A band's own ceiling never drops more than this below the loudest band's, in dB. */
const BAND_REACH_DB = 30

/** In-place radix-2 FFT. */
function fft(re: Float64Array, im: Float64Array): void {
  const n = re.length
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1
    for (; j & bit; bit >>= 1) j ^= bit
    j ^= bit
    if (i < j) {
      ;[re[i], re[j]] = [re[j], re[i]]
      ;[im[i], im[j]] = [im[j], im[i]]
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len
    const wr = Math.cos(ang)
    const wi = Math.sin(ang)
    for (let i = 0; i < n; i += len) {
      let cr = 1
      let ci = 0
      for (let k = 0; k < len / 2; k++) {
        const a = i + k
        const b = a + len / 2
        const tr = re[b] * cr - im[b] * ci
        const ti = re[b] * ci + im[b] * cr
        re[b] = re[a] - tr
        im[b] = im[a] - ti
        re[a] += tr
        im[a] += ti
        const nr = cr * wr - ci * wi
        ci = cr * wi + ci * wr
        cr = nr
      }
    }
  }
}

/** FFT bin range [from, to) of each band: log-spaced between LOW_HZ and HIGH_HZ, at least one bin wide. */
export function bandBins(rate = SPECTRUM_RATE, bands = SPECTRUM_BANDS): [number, number][] {
  const hz = (f: number): number => (f * WINDOW) / rate
  const out: [number, number][] = []
  let prev = Math.max(1, Math.floor(hz(LOW_HZ)))
  for (let b = 0; b < bands; b++) {
    const edge = LOW_HZ * (HIGH_HZ / LOW_HZ) ** ((b + 1) / bands)
    const to = Math.max(prev + 1, Math.round(hz(edge)))
    out.push([prev, to])
    prev = to
  }
  return out
}

const percentile = (sorted: Float32Array, p: number): number => sorted[Math.min(sorted.length - 1, Math.floor(p * (sorted.length - 1)))]

/**
 * Band levels 0..255 for every 1/SPECTRUM_FPS second, frame-major (`frame * SPECTRUM_BANDS + band`). Levels are scaled to
 * the recording itself, band by band (a quiet recitation still moves), smoothed with a fast rise and a slower fall, and silence is 0.
 */
export function computeSpectrum(samples: ArrayLike<number>, rate = SPECTRUM_RATE): Uint8Array {
  const hop = rate / SPECTRUM_FPS
  const frames = Math.max(1, Math.ceil(samples.length / hop))
  const bins = bandBins(rate)
  const db = new Float32Array(frames * SPECTRUM_BANDS)
  const re = new Float64Array(WINDOW)
  const im = new Float64Array(WINDOW)
  const hann = new Float64Array(WINDOW).map((_, i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (WINDOW - 1)))
  const eps = 1e-9

  for (let f = 0; f < frames; f++) {
    const start = Math.round(f * hop) - WINDOW / 2
    for (let i = 0; i < WINDOW; i++) {
      const s = samples[start + i]
      re[i] = (s === undefined ? 0 : s) * hann[i]
      im[i] = 0
    }
    fft(re, im)
    for (let b = 0; b < SPECTRUM_BANDS; b++) {
      const [from, to] = bins[b]
      let sum = 0
      for (let k = from; k < to; k++) sum += re[k] * re[k] + im[k] * im[k]
      db[f * SPECTRUM_BANDS + b] = 10 * Math.log10(sum / (to - from) + eps)
    }
  }

  // Each band is scaled to its own range, or the bars on the high side would sit still: a voice carries far less energy
  // up there. The loudest band's ceiling keeps a band that is nearly empty from being blown up into noise.
  const column = (b: number): Float32Array => Float32Array.from({ length: frames }, (_, f) => db[f * SPECTRUM_BANDS + b])
  const floors: number[] = []
  const ceils: number[] = []
  for (let b = 0; b < SPECTRUM_BANDS; b++) {
    const sorted = column(b).sort()
    floors.push(percentile(sorted, 0.05))
    ceils.push(percentile(sorted, 0.99))
  }
  const loudest = Math.max(...ceils)
  const out = new Uint8Array(db.length)
  for (let b = 0; b < SPECTRUM_BANDS; b++) {
    const floor = floors[b]
    const ceil = Math.max(ceils[b], loudest - BAND_REACH_DB)
    // No range to scale to (silence, or a steady hum): bars would only show noise.
    if (!(ceil - floor > 6)) continue
    let level = 0
    for (let f = 0; f < frames; f++) {
      const v = Math.min(1, Math.max(0, (db[f * SPECTRUM_BANDS + b] - floor) / (ceil - floor)))
      level += (v - level) * (v > level ? ATTACK : RELEASE)
      out[f * SPECTRUM_BANDS + b] = Math.round(level * 255)
    }
  }
  return out
}

/** The bands of the table at `ms`, or null before it exists or past its end. */
export function bandsAt(table: Uint8Array, ms: number): Uint8Array | null {
  const frame = Math.floor((ms / 1000) * SPECTRUM_FPS)
  const start = frame * SPECTRUM_BANDS
  if (frame < 0 || start + SPECTRUM_BANDS > table.length) return null
  return table.subarray(start, start + SPECTRUM_BANDS)
}
