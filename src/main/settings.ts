import { nativeTheme, safeStorage } from 'electron'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { KeyStatus, Settings } from '@shared/types'
import { getDb } from './db'

const DEFAULTS: Settings = {
  theme: 'system',
  script: 'kemenag',
  aiBaseUrl: 'https://api.openai.com/v1',
  aiModel: 'gpt-4o-mini',
  exportFolder: join(homedir(), 'Movies', 'Quran Render')
}

export function getSettings(): Settings {
  const rows = getDb().prepare('SELECT key, value FROM settings').all() as { key: string; value: string }[]
  const saved = Object.fromEntries(rows.map((r) => [r.key, JSON.parse(r.value) as unknown]))
  return { ...DEFAULTS, ...saved }
}

export function setSettings(patch: Partial<Settings>): Settings {
  const stmt = getDb().prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
  for (const [k, v] of Object.entries(patch)) if (k in DEFAULTS && v !== undefined) stmt.run(k, JSON.stringify(v))
  const s = getSettings()
  if (patch.theme) nativeTheme.themeSource = s.theme
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
    throw new Error('Kunci AI tersimpan tapi tidak bisa dibuka lagi. Masukkan ulang kuncinya di Pengaturan.')
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
    return { configured: true, preview: 'tidak terbaca' }
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
