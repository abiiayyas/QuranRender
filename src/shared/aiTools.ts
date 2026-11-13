import type { Aspect } from './types'

/** AI CLIs that are installed and logged in on this computer (or a command the user wrote). */
export type CliTool = 'claude' | 'codex' | 'agy' | 'opencode' | 'custom'
/** CLIs that can draw: Claude Code and OpenCode have no image tool. */
export type CliImageTool = 'agy' | 'codex' | 'custom'
export type AiProvider = 'api' | 'cli'
export type ImageProvider = 'pollinations' | 'openai' | 'cli'
/** Which known CLIs were found on PATH (custom has no program to look for). */
export type CliStatus = Partial<Record<CliTool, boolean>>

export interface CliToolInfo<T extends string = CliTool> {
  id: T
  name: string
  /** Executable looked up on PATH; null for a user-written command. */
  bin: string | null
  note: string
}

export const CLI_TOOLS: CliToolInfo[] = [
  { id: 'claude', name: 'Claude Code', bin: 'claude', note: 'Perintah `claude`, memakai login Claude di komputer ini.' },
  { id: 'codex', name: 'Codex CLI', bin: 'codex', note: 'Perintah `codex exec`, memakai login ChatGPT di komputer ini.' },
  { id: 'agy', name: 'Antigravity', bin: 'agy', note: 'Perintah `agy`, memakai login Google Antigravity di komputer ini.' },
  { id: 'opencode', name: 'OpenCode', bin: 'opencode', note: 'Perintah `opencode run`, memakai penyedia yang sudah diatur di OpenCode. Model ditulis `penyedia/model`.' },
  { id: 'custom', name: 'Perintah sendiri', bin: null, note: 'CLI lain. Prompt dikirim lewat stdin, balasan dibaca dari stdout.' }
]

export const CLI_IMAGE_TOOLS: CliToolInfo<CliImageTool>[] = [
  { id: 'agy', name: 'Antigravity', bin: 'agy', note: 'Memakai alat gambar bawaan Antigravity. Satu gambar sekitar 1 menit.' },
  { id: 'codex', name: 'Codex (ChatGPT)', bin: 'codex', note: 'Memakai alat gambar bawaan Codex dan memakai kuota paket ChatGPT-mu.' },
  { id: 'custom', name: 'Perintah sendiri', bin: null, note: 'Prompt masuk lewat stdin; perintah harus menulis satu file gambar ke {output}.' }
]

export const cliToolName = (tool: CliTool): string => CLI_TOOLS.find((t) => t.id === tool)?.name ?? tool
export const cliImageToolName = (tool: CliImageTool): string => CLI_IMAGE_TOOLS.find((t) => t.id === tool)?.name ?? tool

/** Aliases Claude Code accepts; they always point at the newest model of a tier. */
export const CLAUDE_MODEL_ALIASES = ['opus', 'sonnet', 'haiku']

/** Model names end up on a command line, so only characters that need no quoting are allowed. */
const SAFE_MODEL = /^[A-Za-z0-9._:/@+-]+$/

export function checkModel(model: string): void {
  if (model && !SAFE_MODEL.test(model)) throw new Error('Nama model hanya boleh berisi huruf, angka, dan tanda . _ : / @ + -')
}

/** Fills `{model}` of a user command; a command that needs a model cannot run without one (the flag would dangle). */
export function fillCommand(command: string, model: string): string {
  if (!command.trim()) throw new Error('Perintah CLI belum diisi. Buka Pengaturan untuk menambahkannya.')
  if (command.includes('{model}') && !model) throw new Error('Perintah memakai {model}, tapi kolom Model belum diisi. Isi modelnya di Pengaturan.')
  return command.replaceAll('{model}', model)
}

// ---------- text prompts ----------

export interface PromptMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

/**
 * A CLI takes one prompt on stdin, so system and user messages are merged. The closing lines keep an agent runtime
 * (which would happily open files or run tools) to a plain answer.
 */
export function buildCliPrompt(messages: PromptMessage[], json: boolean): string {
  const system = messages.filter((m) => m.role === 'system').map((m) => m.content.trim())
  const rest = messages.filter((m) => m.role !== 'system')
  const body = rest.length === 1 && rest[0].role === 'user' ? rest[0].content.trim() : rest.map((m) => `[${m.role}]\n${m.content.trim()}`).join('\n\n')
  const tail = ['Answer directly from the text above. Do not use tools, do not read or write files.']
  if (json) tail.push('Reply with JSON only: ONE JSON object, no markdown fences, no commentary before or after it.')
  return [...system, body, tail.join(' ')].filter(Boolean).join('\n\n---\n\n')
}

/** Pulls a JSON value out of a reply that may carry think tags, code fences or prose. Throws when there is none. */
export function extractJson(text: string): unknown {
  const t = text.replace(/<think>[\s\S]*?<\/think>/gi, '').trim()
  const attempts = [t]
  const fence = /```(?:json)?\s*([\s\S]*?)```/i.exec(t)
  if (fence) attempts.push(fence[1].trim())
  for (const a of attempts) {
    try {
      return JSON.parse(a)
    } catch {
      // try the next shape
    }
  }
  const start = t.indexOf('{')
  const end = t.lastIndexOf('}')
  if (start >= 0 && end > start) {
    try {
      return JSON.parse(t.slice(start, end + 1))
    } catch {
      // fall through
    }
  }
  throw new Error('Balasan bukan JSON.')
}

// ---------- Antigravity (agy) ----------

interface AgyResult {
  status?: string
  response?: string
  error?: string
  denied_actions?: { action?: string; display_name?: string }[]
}

export const AGY_STREAM_ARGS = ['--input-format', 'stream-json', '--output-format', 'stream-json']

/** Antigravity takes one `user` event on stdin. */
export const agyInput = (prompt: string): string => `${JSON.stringify({ event: 'user', message: { content: prompt } })}\n`

/** Antigravity answers with NDJSON events; the last `result` event holds the reply. */
export function agyReply(stdout: string): string {
  let result: AgyResult | null = null
  for (const line of stdout.split('\n')) {
    if (!line.startsWith('{')) continue
    try {
      const e = JSON.parse(line) as { event?: string; result?: AgyResult }
      if (e.event === 'result' && e.result) result = e.result
    } catch {
      // not an event line
    }
  }
  if (!result) throw new Error('Antigravity selesai tanpa mengirim hasil. Coba lagi.')
  if (result.status !== 'SUCCESS') throw new Error(`Antigravity gagal: ${result.error || result.status}`)
  const denied = (result.denied_actions ?? []).map((d) => d.display_name || d.action).filter(Boolean)
  if (denied.length > 0 && !(result.response ?? '').trim()) {
    throw new Error(
      `Antigravity menolak menjalankan ${denied.join(', ')} karena butuh izin yang tidak bisa ditanyakan dari aplikasi. Aplikasi sengaja tidak memakai --dangerously-skip-permissions. Beri izin sempit di pengaturan Antigravity, atau pilih CLI lain.`
    )
  }
  return result.response ?? ''
}

/** Antigravity ends its image reply with the file path in <path> tags, after some progress lines. */
export function agyImagePath(reply: string): string | null {
  const tagged = [...reply.matchAll(/<path>\s*([\s\S]*?)\s*<\/path>/gi)].at(-1)?.[1]
  const loose = [...reply.matchAll(/(\/[^\s"'`<>|*?]+\.(?:png|jpe?g|webp))/gi)].at(-1)?.[1]
  return tagged || loose || null
}

// ---------- quota messages of image CLIs ----------

export const QUOTA_WORDS = /RESOURCE_EXHAUSTED|quota|usage limit|rate limit|capacity exhausted|\b429\b/i

/** "resets after approximately 2 hours and 42 minutes" / "try again in 3 hours" -> milliseconds; null when no time is named. */
export function resetDelayMs(text: string): number | null {
  const hours = Number(/(\d+)\s*hours?/i.exec(text)?.[1] ?? 0)
  const minutes = Number(/(\d+)\s*min/i.exec(text)?.[1] ?? 0)
  return hours || minutes ? (hours * 60 + minutes) * 60_000 : null
}

// ---------- image sizes ----------

/** Pollinations' free tier caps the area at 768 x 768 and keeps the aspect ratio. */
export function pollinationsSize(aspect: Aspect): { width: number; height: number } {
  if (aspect === '9:16') return { width: 576, height: 1024 }
  if (aspect === '16:9') return { width: 1024, height: 576 }
  return { width: 768, height: 768 }
}

/**
 * Pollinations' anonymous endpoint. `model` is only sent when the user chose one (the free tier serves a single model and
 * ignores it); `seed` makes every request a new picture, since the same URL is cached for everyone.
 */
export function pollinationsUrl(prompt: string, aspect: Aspect, model: string, seed: number): string {
  const { width, height } = pollinationsSize(aspect)
  const q = new URLSearchParams({ width: String(width), height: String(height), nologo: 'true', seed: String(seed) })
  if (model.trim()) q.set('model', model.trim())
  return `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}?${q}`
}

/** `Retry-After` in seconds (the form Pollinations uses) to milliseconds; null when absent or not a number. */
export function parseRetryAfterMs(header: string | null): number | null {
  if (!header) return null
  const s = Number(header)
  return Number.isFinite(s) && s >= 0 ? Math.ceil(s * 1000) : null
}

/** The sizes OpenAI-style image endpoints accept: DALL-E 3 and the GPT image models differ. */
export function openaiImageSize(model: string, aspect: Aspect): string {
  if (aspect === '1:1') return '1024x1024'
  const dalle3 = /dall-e-3/i.test(model)
  if (aspect === '9:16') return dalle3 ? '1024x1792' : '1024x1536'
  return dalle3 ? '1792x1024' : '1536x1024'
}

/** What an agent CLI is told about the shape of the image. */
export function cliImageShape(aspect: Aspect): string {
  if (aspect === '9:16') return 'vertical portrait 9:16'
  if (aspect === '16:9') return 'landscape 16:9'
  return 'square 1:1'
}

/** Image type by magic bytes; the bytes decide, not a file name or Content-Type. */
export function sniffImage(bytes: Uint8Array): { ext: 'png' | 'jpg' | 'webp'; contentType: string } | null {
  if (bytes.length > 12 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return { ext: 'png', contentType: 'image/png' }
  if (bytes.length > 12 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return { ext: 'jpg', contentType: 'image/jpeg' }
  const ascii = (from: number, to: number): string => String.fromCharCode(...bytes.slice(from, to))
  if (bytes.length > 12 && ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP') return { ext: 'webp', contentType: 'image/webp' }
  return null
}
