import { t } from '@shared/i18n'
import { safeStorage } from 'electron'
import type { KeyStatus } from '@shared/types'
import { STOCK_PROVIDERS, type StockProvider } from '@shared/stock'
import { getDb } from './db'

// One free API key per provider, kept like the AI key in settings.ts: encrypted by the OS keychain through safeStorage.

const nameOf = (p: StockProvider): string => `stock:${p}`
const encryptable = (): boolean => safeStorage.isEncryptionAvailable()

export function checkProvider(p: unknown): StockProvider {
  const info = STOCK_PROVIDERS.find((x) => x.id === p)
  if (!info) throw new Error(t('Penyedia foto stok tidak dikenal.'))
  return info.id
}

export function getStockKey(p: StockProvider): string | null {
  const row = getDb().prepare('SELECT value FROM secrets WHERE name = ?').get(nameOf(p)) as { value: Buffer } | undefined
  if (!row) return null
  try {
    return encryptable() ? safeStorage.decryptString(row.value) : row.value.toString('utf8')
  } catch {
    throw new Error(t('Kunci tersimpan tapi tidak bisa dibuka lagi. Silakan masukkan ulang kuncinya.'))
  }
}

export function setStockKey(p: StockProvider, key: string): void {
  const value = encryptable() ? safeStorage.encryptString(key) : Buffer.from(key, 'utf8')
  getDb().prepare('INSERT INTO secrets (name, value) VALUES (?, ?) ON CONFLICT(name) DO UPDATE SET value = excluded.value').run(nameOf(p), value)
}

export function clearStockKey(p: StockProvider): void {
  getDb().prepare('DELETE FROM secrets WHERE name = ?').run(nameOf(p))
}

export function stockKeyStatus(p: StockProvider): KeyStatus {
  try {
    const key = getStockKey(p)
    return { configured: !!key, preview: key ? `${key.slice(0, 4)}••••${key.slice(-3)}` : null }
  } catch {
    return { configured: true, preview: t('tidak terbaca') }
  }
}

export function allStockKeyStatus(): Record<StockProvider, KeyStatus> {
  return Object.fromEntries(STOCK_PROVIDERS.map((p) => [p.id, stockKeyStatus(p.id)])) as Record<StockProvider, KeyStatus>
}
