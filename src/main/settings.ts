import { isLang, msg, setLang, t } from '@shared/i18n'
import { app, nativeTheme, safeStorage } from 'electron'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { CLI_IMAGE_TOOLS, CLI_TOOLS } from '@shared/aiTools'
import type { KeyStatus, Settings } from '@shared/types'
import { getDb } from './db'

const DEFAULTS: Settings = {
  theme: 'system',
  language: 'id',
  script: 'kemenag',
  aiBaseUrl: 'https://api.openai.com/v1',
  aiModel: 'gpt-4o-mini',
  exportFolder: join(homedir(), 'Movies', 'Quran Render'),
  aiProvider: 'api',
  cliTool: 'claude',
  cliModel: '',
  cliCommand: '',
  // Free and keyless, so a first-time user can make a background without any account.
  imageProvider: 'pollinations',
  imageModel: '',
  imageCliTool: 'codex',
  imageCliCommand: '',
  renderMsPerMpFrame: null,
  autoCheckUpdates: true
}

export function getSettings(): Settings {
  const rows = getDb().prepare('SELECT key, value FROM settings').all() as { key: string; value: string }[]
  const saved = Object.fromEntries(rows.map((r) => [r.key, JSON.parse(r.value) as unknown]))
  const s: Settings = { ...DEFAULTS, language: defaultLanguage(), ...saved }
  // A CLI that was removed from the app (Antigravity, 'agy') may still be saved: fall back instead of failing at its first use.
  if (!CLI_TOOLS.some((x) => x.id === s.cliTool)) s.cliTool = DEFAULTS.cliTool
  if (!CLI_IMAGE_TOOLS.some((x) => x.id === s.imageCliTool)) s.imageCliTool = DEFAULTS.imageCliTool
  return s
}

/**
 * Before the user picks one: Indonesian for anyone who already has projects (the app was Indonesian-only until now), else
 * the system's language, English unless it is Indonesian.
 */
function defaultLanguage(): Settings['language'] {
  const hasProjects = getDb().prepare('SELECT 1 FROM projects LIMIT 1').get() !== undefined
  return hasProjects || app.getLocale().toLowerCase().startsWith('id') ? 'id' : 'en'
}

/** Messages built in the main process follow the chosen language. */
export function applyLanguage(): void {
  setLang(getSettings().language)
}

/** The renderer is not trusted to send a value the main process has no code for. */
function checkChoices(patch: Partial<Settings>): void {
  const bad = (label: string): never => {
    throw new Error(t('Pilihan {label} tidak dikenal.', { label: t(label) }))
  }
  if (patch.language !== undefined && !isLang(patch.language)) bad(msg('bahasa'))
  if (patch.aiProvider !== undefined && !['api', 'cli'].includes(patch.aiProvider)) bad(msg('penyedia AI'))
  if (patch.cliTool !== undefined && !CLI_TOOLS.some((t) => t.id === patch.cliTool)) bad(msg('CLI'))
  if (patch.imageProvider !== undefined && !['pollinations', 'openai', 'cli'].includes(patch.imageProvider)) bad(msg('pembuat gambar'))
  if (patch.imageCliTool !== undefined && !CLI_IMAGE_TOOLS.some((t) => t.id === patch.imageCliTool)) bad(msg('CLI gambar'))
}

export function setSettings(patch: Partial<Settings>): Settings {
  checkChoices(patch)
  const stmt = getDb().prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
  for (const [k, v] of Object.entries(patch)) if (k in DEFAULTS && v !== undefined) stmt.run(k, JSON.stringify(v))
  const s = getSettings()
  if (patch.theme) nativeTheme.themeSource = s.theme
  if (patch.language) setLang(s.language)
  return s
}

// The AI key (OpenAI-compatible) is the only secret; it is encrypted with the macOS Keychain via safeStorage.

const encryptable = (): boolean => safeStorage.isEncryptionAvailable()

export function getAiKey(): string | null {
  const row = getDb().prepare(`SELECT value FROM secrets WHERE name = 'ai'`).get() as { value: Buffer } | undefined
  if (!row) return null
  try {
    return encryptable() ? safeStorage.decryptString(row.value) : row.value.toString('utf8')
  } catch {
    throw new Error(t('Kunci AI tersimpan tapi tidak bisa dibuka lagi. Masukkan ulang kuncinya di Pengaturan.'))
  }
}

export function setAiKey(key: string): void {
  const value = encryptable() ? safeStorage.encryptString(key) : Buffer.from(key, 'utf8')
  getDb().prepare(`INSERT INTO secrets (name, value) VALUES ('ai', ?) ON CONFLICT(name) DO UPDATE SET value = excluded.value`).run(value)
}

export function clearAiKey(): void {
  getDb().prepare(`DELETE FROM secrets WHERE name = 'ai'`).run()
}

export function aiKeyStatus(): KeyStatus {
  let key: string | null = null
  try {
    key = getAiKey()
  } catch {
    return { configured: true, preview: t('tidak terbaca') }
  }
  return { configured: !!key, preview: key ? `${key.slice(0, 6)}••••${key.slice(-4)}` : null }
}

/** Local endpoints (Ollama, LM Studio) work without a key. */
export function isLocalEndpoint(url: string): boolean {
  try {
    return ['localhost', '127.0.0.1', '::1'].includes(new URL(url).hostname)
  } catch {
    return false
  }
}
