import { execFile, spawn } from 'node:child_process'
import { accessSync, constants, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { delimiter, join } from 'node:path'
import {
  AGY_STREAM_ARGS,
  agyImagePath,
  agyInput,
  agyReply,
  checkModel,
  CLI_TOOLS,
  cliImageShape,
  cliImageToolName,
  cliToolName,
  fillCommand,
  QUOTA_WORDS,
  resetDelayMs,
  sniffImage
} from '@shared/aiTools'
import type { CliImageTool, CliStatus, CliTool } from '@shared/aiTools'
import type { Aspect } from '@shared/types'

// No electron imports on purpose: the runner is exercised directly in tests and scripts.

/**
 * Runs AI CLIs that are already installed and logged in on this computer. The prompt goes in through stdin, so its size
 * never hits the OS argument limit. No permission-bypass flag is ever passed (`--dangerously-*`): text needs no tools, and
 * a CLI that still asks for a permission in headless mode is reported to the user instead of being given blanket access.
 */

// Each call starts an agent runtime on top of the model call: tens of seconds even for a short prompt.
export const CLI_TEXT_TIMEOUT_MS = 6 * 60 * 1000
export const CLI_TEST_TIMEOUT_MS = 90 * 1000
const MAX_OUTPUT = 8 * 1024 * 1024
const MAX_IMAGE = 40 * 1024 * 1024
/** After SIGTERM a stubborn CLI gets this long before SIGKILL. */
const KILL_GRACE_MS = 3000

// ---------- finding the program ----------

let loginPath: Promise<string> | null = null

/**
 * PATH as the user's terminal sees it. An app opened from Finder or the Dock gets a bare PATH, without ~/.local/bin,
 * Homebrew or nvm, so `claude` and `codex` would look missing. Asking the login shell fixes that.
 */
function searchPath(refresh = false): Promise<string> {
  if (refresh) loginPath = null
  if (loginPath) return loginPath
  const base = process.env.PATH ?? ''
  const { promise, resolve } = Promise.withResolvers<string>()
  loginPath = promise
  const mark = '__QR_PATH__'
  const shell = process.env.SHELL || '/bin/zsh'
  execFile(shell, ['-ilc', `printf '${mark}%s${mark}' "$PATH"`], { timeout: 5000 }, (_err, stdout) => {
    const fromShell = new RegExp(`${mark}(.*?)${mark}`, 's').exec(String(stdout ?? ''))?.[1] ?? ''
    const extra = [join(homedir(), '.local', 'bin'), '/opt/homebrew/bin', '/usr/local/bin']
    resolve([...new Set([...fromShell.split(delimiter), ...base.split(delimiter), ...extra].filter(Boolean))].join(delimiter))
  })
  return promise
}

function findBin(bin: string, path: string): string | null {
  for (const dir of path.split(delimiter)) {
    if (!dir) continue
    const file = join(dir, bin)
    try {
      if (!statSync(file).isFile()) continue
      accessSync(file, constants.X_OK)
      return file
    } catch {
      // not here
    }
  }
  return null
}

/** Which known CLIs are installed. `refresh` asks the login shell again (the user may have just installed one). */
export async function cliStatus(refresh = false): Promise<CliStatus> {
  const path = await searchPath(refresh)
  const out: CliStatus = {}
  for (const t of CLI_TOOLS) if (t.bin) out[t.id] = !!findBin(t.bin, path)
  return out
}

/** The executable's name when the tool is a known CLI that is missing from PATH; null when it can be run. */
export async function missingBin(tool: CliTool | CliImageTool): Promise<string | null> {
  const bin = CLI_TOOLS.find((t) => t.id === tool)?.bin
  if (!bin) return null
  return findBin(bin, await searchPath()) ? null : bin
}

// ---------- running it ----------

function abortError(): Error {
  return Object.assign(new Error('Dibatalkan'), { name: 'AbortError' })
}

function killTree(pid: number | undefined): void {
  if (!pid) return
  try {
    process.kill(-pid, 'SIGTERM')
  } catch {
    return
  }
  setTimeout(() => {
    try {
      process.kill(-pid, 'SIGKILL')
    } catch {
      // already gone
    }
  }, KILL_GRACE_MS).unref()
}

/** Children still running, so quitting the app does not leave an agent working on in the background. */
const running = new Set<number>()

export function killRunningClis(): void {
  for (const pid of running) killTree(pid)
  running.clear()
}

interface Spawn {
  command: string
  args: string[]
  shell: boolean
  cwd: string
  env: NodeJS.ProcessEnv
}

function run(s: Spawn, input: string, name: string, timeoutMs: number, signal?: AbortSignal, includeStderr = false): Promise<string> {
  const { promise, resolve, reject } = Promise.withResolvers<string>()
  if (signal?.aborted) {
    reject(abortError())
    return promise
  }
  const child = spawn(s.command, s.args, {
    cwd: s.cwd,
    env: s.env,
    shell: s.shell,
    // Its own process group, so a timeout stops the whole tree and not just the shell.
    detached: true,
    stdio: ['pipe', 'pipe', 'pipe']
  })
  if (child.pid) running.add(child.pid)
  let out = ''
  let err = ''
  let settled = false
  const end = (fn: () => void): void => {
    if (settled) return
    settled = true
    if (child.pid) running.delete(child.pid)
    clearTimeout(timer)
    signal?.removeEventListener('abort', onAbort)
    fn()
  }
  const stop = (e: Error): void => {
    killTree(child.pid)
    end(() => reject(e))
  }
  const onAbort = (): void => stop(abortError())
  const minutes = timeoutMs >= 60_000 ? `${Math.round(timeoutMs / 60_000)} menit` : `${Math.round(timeoutMs / 1000)} detik`
  const timer = setTimeout(() => stop(new Error(`${name} terlalu lama merespons (lebih dari ${minutes}).`)), timeoutMs)
  signal?.addEventListener('abort', onAbort, { once: true })

  child.stdout.setEncoding('utf8').on('data', (d: string) => {
    out += d
    if (out.length > MAX_OUTPUT) stop(new Error(`${name} mengirim balasan yang terlalu besar.`))
  })
  child.stderr.setEncoding('utf8').on('data', (d: string) => {
    err = (err + d).slice(-4000)
  })
  // The CLI may exit before it reads all of stdin (bad flag, not logged in); the exit code tells the story.
  child.stdin.on('error', () => {})
  child.on('error', (e) => end(() => reject(new Error(`Tidak bisa menjalankan ${name}: ${e.message}`))))
  child.on('close', (code) =>
    end(() => {
      if (code === 0) return resolve(includeStderr ? `${out}\n${err}` : out)
      // CLIs colour their errors even when piped; escape codes would show up as garbage in a toast.
      const detail = (err || out).replace(/\u001B\[[0-9;]*m/g, '').trim().split('\n').slice(-6).join('\n').slice(-400)
      reject(new Error(`${name} berhenti dengan kode ${code}${detail ? `: ${detail}` : ''}. Pastikan CLI sudah login dan bisa dipakai di Terminal.`))
    })
  )
  child.stdin.end(input)
  return promise
}

interface Workspace {
  /** An empty temp folder, so the CLI sees no project files and leaves nothing behind. */
  cwd: string
  path: string
  env: NodeJS.ProcessEnv
  cleanup: () => void
}

async function workspace(): Promise<Workspace> {
  const path = await searchPath()
  const cwd = mkdtempSync(join(tmpdir(), 'quranrender-cli-'))
  return { cwd, path, env: { ...process.env, PATH: path }, cleanup: () => rmSync(cwd, { recursive: true, force: true }) }
}

const program = (w: Workspace, bin: string, args: string[]): Spawn => ({ command: bin, args, shell: false, cwd: w.cwd, env: w.env })

function locate(w: Workspace, tool: CliTool | CliImageTool): string {
  const bin = CLI_TOOLS.find((t) => t.id === tool)?.bin
  if (!bin) throw new Error('Perintah CLI belum diisi. Buka Pengaturan untuk menambahkannya.')
  const file = findBin(bin, w.path)
  if (!file) throw new Error(`CLI ${bin} tidak ditemukan di komputer ini. Pasang ${cliToolName(tool)} dan login dulu, lalu coba lagi.`)
  return file
}

// ---------- text ----------

export interface AskOptions {
  tool: CliTool
  /** Shell command of the `custom` tool; `{model}` is replaced by `model`. */
  command: string
  /** Empty = the CLI uses its own default. */
  model: string
  prompt: string
  timeoutMs?: number
  signal?: AbortSignal
}

/** One prompt in, one reply out, through the chosen CLI. */
export async function askCli(o: AskOptions): Promise<string> {
  checkModel(o.model)
  const timeout = o.timeoutMs ?? CLI_TEXT_TIMEOUT_MS
  const w = await workspace()
  const name = cliToolName(o.tool)
  try {
    if (o.tool === 'custom') return await run({ command: fillCommand(o.command, o.model), args: [], shell: true, cwd: w.cwd, env: w.env }, o.prompt, name, timeout, o.signal)

    const bin = locate(w, o.tool)
    if (o.tool === 'agy') {
      const args = [...AGY_STREAM_ARGS, ...(o.model ? ['--model', o.model] : [])]
      return agyReply(await run(program(w, bin, args), agyInput(o.prompt), name, timeout, o.signal))
    }
    if (o.tool === 'opencode') {
      // `run` talks to a shared background service that ignores this process's environment and would run its bash and edit
      // tools on its own. --standalone starts a private server, which reads the deny-all rule, so it behaves as a text model.
      const args = ['run', '--standalone', ...(o.model ? ['-m', o.model] : [])]
      const denyAll = { ...w, env: { ...w.env, OPENCODE_CONFIG_CONTENT: JSON.stringify({ permission: { '*': 'deny' } }) } }
      return await run(program(denyAll, bin, args), o.prompt, name, timeout, o.signal)
    }

    // Read only: no tools, no saved session, no user hooks or project files, so it answers as a plain text model.
    const replyFile = join(w.cwd, 'reply.txt')
    const args =
      o.tool === 'claude'
        ? ['-p', '--output-format', 'text', '--no-session-persistence', '--tools', '', '--disable-slash-commands', '--setting-sources', '']
        : ['exec', '--skip-git-repo-check', '--ephemeral', '--sandbox', 'read-only', '--color', 'never', '-o', replyFile]
    if (o.model) args.push(o.tool === 'claude' ? '--model' : '-m', o.model)
    if (o.tool === 'codex') args.push('-')
    const stdout = await run(program(w, bin, args), o.prompt, name, timeout, o.signal)
    if (o.tool !== 'codex') return stdout
    // Codex prints progress noise on stdout; its clean reply is in the file.
    try {
      return readFileSync(replyFile, 'utf8')
    } catch {
      return stdout
    }
  } finally {
    w.cleanup()
  }
}

// ---------- images ----------

export interface CliImage {
  bytes: Buffer
  contentType: string
  ext: 'png' | 'jpg' | 'webp'
}

/** The reply only counts when it is a real image, whatever the file is called. */
function readImage(file: string, name: string): CliImage {
  let size: number
  try {
    size = statSync(file).size
  } catch {
    throw new Error(`${name} tidak menghasilkan berkas gambar.`)
  }
  if (size === 0 || size > MAX_IMAGE) throw new Error(`Berkas gambar dari ${name} tidak wajar (${size} byte).`)
  const bytes = readFileSync(file)
  const kind = sniffImage(bytes)
  if (!kind) throw new Error(`Berkas dari ${name} bukan gambar PNG, JPEG, atau WebP.`)
  return { bytes, ...kind }
}

/**
 * An image CLI that said its quota is used up, and until when. Without this every queued picture would start the CLI
 * again, wait a minute for the same refusal, and fail one by one.
 */
const imageBlocked = new Map<CliImageTool, { until: number; message: string }>()
const DEFAULT_BLOCK_MS = 30 * 60 * 1000

function quotaMessage(name: string, until: number): string {
  const mins = Math.max(1, Math.ceil((until - Date.now()) / 60_000))
  const left = mins >= 60 ? `${Math.floor(mins / 60)} jam ${mins % 60} menit` : `${mins} menit`
  return `Kuota gambar ${name} habis. Silakan coba lagi sekitar ${left} lagi, atau pilih pembuat gambar lain di Pengaturan.`
}

/** Turns an exhausted-quota reply into an error and remembers it; returns normally when the reply is something else. */
function noteQuota(tool: CliImageTool, name: string, reply: string): void {
  if (!QUOTA_WORDS.test(reply)) return
  const until = Date.now() + (resetDelayMs(reply) ?? DEFAULT_BLOCK_MS)
  const message = quotaMessage(name, until)
  imageBlocked.set(tool, { until, message })
  throw new Error(message)
}

function checkNotBlocked(tool: CliImageTool, name: string): void {
  const b = imageBlocked.get(tool)
  if (!b) return
  if (b.until <= Date.now()) imageBlocked.delete(tool)
  else throw new Error(quotaMessage(name, b.until))
}

/**
 * The image tools are agents that write the tool call themselves; without this line they summarize a long description and
 * drop the style or the "no people" clause.
 */
const VERBATIM = 'Keep the image description word for word: do not summarize, shorten, reorder, translate or add to it, and keep every line.'

function codexHome(): string {
  return process.env.CODEX_HOME || join(homedir(), '.codex')
}

/**
 * Codex draws with its built-in image tool, which saves into $CODEX_HOME/generated_images/<thread id>/. The thread id comes
 * from the run's own event stream, so two images drawn at the same time never pick up each other's file.
 */
async function codexImage(w: Workspace, bin: string, name: string, prompt: string, shape: string, timeoutMs: number, signal?: AbortSignal): Promise<CliImage> {
  // workspace-write only reaches the empty temp folder. App connectors are off: Codex would otherwise pick the Canva one,
  // which needs an approval that cannot be given from here.
  const args = ['exec', '--skip-git-repo-check', '--sandbox', 'workspace-write', '--disable', 'apps', '--enable', 'image_generation', '--color', 'never', '--json', '-']
  const instruction =
    `Use your built-in image generation tool (image_gen) to create ONE image, ${shape}, with no text or watermark in it. ${VERBATIM}\n\n` +
    `Image description:\n\n${prompt}\n\nDo not edit, move or copy the file afterwards. Reply "done" once the image exists.`
  const stdout = await run(program(w, bin, args), instruction, name, timeoutMs, signal)

  let threadId = ''
  let said = ''
  for (const line of stdout.split('\n')) {
    if (!line.startsWith('{')) continue
    try {
      const e = JSON.parse(line) as { type?: string; thread_id?: string; item?: { type?: string; text?: string } }
      if (e.type === 'thread.started' && e.thread_id) threadId = e.thread_id
      if (e.type === 'item.completed' && e.item?.type === 'agent_message' && e.item.text) said = e.item.text
    } catch {
      // not an event line
    }
  }
  const dir = /^[\w-]+$/.test(threadId) ? join(codexHome(), 'generated_images', threadId) : ''
  let files: string[] = []
  try {
    files = dir ? readdirSync(dir).filter((f) => /\.(png|jpe?g|webp)$/i.test(f)) : []
  } catch {
    // no folder: the tool never ran
  }
  if (!files.length) {
    noteQuota('codex', name, said)
    throw new Error(`${name} tidak membuat gambar${said ? `: ${said.slice(0, 240)}` : '.'} Alat gambar Codex hanya ada di paket ChatGPT yang mendukungnya.`)
  }
  const newest = files.map((f) => join(dir, f)).sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)[0]
  try {
    return readImage(newest, name)
  } finally {
    // The image is about to live in the project; Codex's copy would only pile up.
    rmSync(dir, { recursive: true, force: true })
  }
}

export interface ImageCliOptions {
  tool: CliImageTool
  /** Shell command of the `custom` tool: prompt on stdin, writes the picture to `{output}`; `{aspect}` = 9:16 / 16:9 / 1:1. */
  command: string
  prompt: string
  aspect: Aspect
  timeoutMs?: number
  signal?: AbortSignal
}

/** One picture from an image-capable CLI. Antigravity and Codex are driven non-interactively with their own image tools. */
export async function cliImage(o: ImageCliOptions): Promise<CliImage> {
  const name = cliImageToolName(o.tool)
  const timeout = o.timeoutMs ?? CLI_TEXT_TIMEOUT_MS
  checkNotBlocked(o.tool, name)
  const w = await workspace()
  try {
    if (o.tool === 'custom') {
      if (!o.command.trim()) throw new Error('Perintah gambar belum diisi. Buka Pengaturan untuk menambahkannya.')
      const out = join(w.cwd, 'image')
      // Quoted here, so a path with spaces works however the command writes {output}.
      const filled = o.command.replaceAll('{output}', `"${out}"`).replaceAll('{aspect}', o.aspect)
      await run({ command: filled, args: [], shell: true, cwd: w.cwd, env: w.env }, o.prompt, name, timeout, o.signal)
      return readImage(out, name)
    }

    const bin = locate(w, o.tool)
    const shape = cliImageShape(o.aspect)
    if (o.tool === 'codex') {
      const img = await codexImage(w, bin, name, o.prompt, shape, timeout, o.signal)
      imageBlocked.delete(o.tool)
      return img
    }
    // The main agent has no image tool of its own; it can only hand the job to its image-generator subagent, which then
    // writes the real tool call. Both hops have to be told to keep the text.
    const instruction =
      `Create ONE image, ${shape}, with no text or watermark in it. Your image tool is the image-generator subagent (do not write code and do not run commands): give it the image description below as its task and tell it to pass the text unchanged as the Prompt of generate_image. ` +
      `${VERBATIM}\n\nImage description:\n\n${o.prompt}\n\nWhen the image is ready, reply with its absolute file path inside <path></path> tags.`
    const reply = agyReply(await run(program(w, bin, AGY_STREAM_ARGS), agyInput(instruction), name, timeout, o.signal))
    const path = agyImagePath(reply)
    if (!path) {
      // Antigravity answers in prose when it cannot draw (quota, refusal); show that instead of a vague complaint.
      noteQuota(o.tool, name, reply)
      throw new Error(`${name} tidak menyebut lokasi gambar yang dibuatnya${reply.trim() ? `: ${reply.trim().slice(0, 240)}` : '.'}`)
    }
    const img = readImage(path, name)
    imageBlocked.delete(o.tool)
    return img
  } finally {
    w.cleanup()
  }
}
