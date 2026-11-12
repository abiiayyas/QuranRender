import { spawn } from 'node:child_process'
import { ffmpegPath, ffprobePath } from './paths'

export interface Probe {
  durationMs: number | null
  width: number | null
  height: number | null
  hasVideo: boolean
  hasAudio: boolean
  videoCodec: string | null
  audioCodec: string | null
}

function run(bin: string, args: string[], o: { signal?: AbortSignal; onStderr?: (chunk: string) => void } = {}): Promise<{ stdout: Buffer; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { signal: o.signal, windowsHide: true })
    const out: Buffer[] = []
    let err = ''
    child.stdout.on('data', (d: Buffer) => out.push(d))
    child.stderr.on('data', (d: Buffer) => {
      const s = d.toString()
      err = (err + s).slice(-8000)
      o.onStderr?.(s)
    })
    child.on('error', reject)
    child.on('close', (code) => {
      if (code === 0) resolve({ stdout: Buffer.concat(out), stderr: err })
      else reject(new Error(`${bin.split(/[\\/]/).pop()} gagal (kode ${code}): ${err.trim().split('\n').slice(-3).join(' ')}`))
    })
  })
}

export async function probe(path: string): Promise<Probe> {
  const { stdout } = await run(ffprobePath(), ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', path]).catch(() => {
    throw new Error('Berkas ini tidak bisa dibaca sebagai audio atau video.')
  })
  const data = JSON.parse(stdout.toString()) as {
    format?: { duration?: string }
    streams?: { codec_type?: string; codec_name?: string; width?: number; height?: number; disposition?: { attached_pic?: number }; side_data_list?: { rotation?: number }[] }[]
  }
  // Cover art in MP3/M4A shows up as a video stream; it is not video.
  const video = data.streams?.find((s) => s.codec_type === 'video' && !s.disposition?.attached_pic)
  const audio = data.streams?.find((s) => s.codec_type === 'audio')
  const dur = Number(data.format?.duration)
  // Phone video recorded upright is stored landscape with a quarter-turn flag.
  const turned = Math.abs(video?.side_data_list?.find((d) => d.rotation != null)?.rotation ?? 0) % 180 === 90
  return {
    durationMs: Number.isFinite(dur) ? Math.round(dur * 1000) : null,
    width: video ? ((turned ? video.height : video.width) ?? null) : null,
    height: video ? ((turned ? video.width : video.height) ?? null) : null,
    hasVideo: !!video,
    hasAudio: !!audio,
    videoCodec: video?.codec_name ?? null,
    audioCodec: audio?.codec_name ?? null
  }
}

/**
 * Runs ffmpeg (always with -y, -hide_banner). With `durationMs`, reports progress 0..1 from its `time=` output.
 */
export async function ffmpeg(args: string[], o: { signal?: AbortSignal; durationMs?: number | null; onProgress?: (p: number) => void } = {}): Promise<Buffer> {
  const { stdout } = await run(ffmpegPath(), ['-hide_banner', '-y', ...args], {
    signal: o.signal,
    onStderr: (s) => {
      if (!o.durationMs || !o.onProgress) return
      const m = /time=(\d+):(\d+):(\d+(?:\.\d+)?)/.exec(s)
      if (m) o.onProgress(Math.min(1, ((+m[1] * 3600 + +m[2] * 60 + +m[3]) * 1000) / o.durationMs))
    }
  })
  return stdout
}

/** `count` peaks (0..1) over the whole file, from 8 kHz mono PCM. */
export async function waveform(path: string, count: number): Promise<number[]> {
  const pcm = await ffmpeg(['-i', path, '-vn', '-ac', '1', '-ar', '8000', '-f', 's16le', '-'])
  const samples = new Int16Array(pcm.buffer, pcm.byteOffset, Math.floor(pcm.byteLength / 2))
  const per = Math.max(1, Math.floor(samples.length / count))
  const peaks: number[] = []
  for (let i = 0; i < count; i++) {
    let max = 0
    const end = Math.min(samples.length, (i + 1) * per)
    for (let j = i * per; j < end; j++) {
      const v = Math.abs(samples[j])
      if (v > max) max = v
    }
    peaks.push(max / 32768)
  }
  return peaks
}
