import { locale, t } from '@shared/i18n'

/** IPC errors arrive as "Error invoking remote method 'x': Error: message"; keep the message. */
export function errorText(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e)
  return msg.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')
}

/** m:ss.d (or h:mm:ss.d) */
export function formatMs(ms: number | null | undefined): string {
  if (ms == null || !Number.isFinite(ms)) return '–'
  const total = Math.max(0, ms) / 1000
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = (total % 60).toFixed(1).padStart(4, '0').replace('.', locale() === 'en-US' ? '.' : ',')
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`
}

export function formatDate(ms: number): string {
  return new Date(ms).toLocaleDateString(locale(), { dateStyle: 'medium' })
}

/** Sizes as B, KB, MB or GB (1024 steps); the decimal separator follows the language. */
export function formatBytes(n: number): string {
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let v = Math.max(0, n)
  let i = 0
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024
    i++
  }
  const digits = i === 0 || v >= 100 ? 0 : 1
  return `${new Intl.NumberFormat(locale(), { maximumFractionDigits: digits, minimumFractionDigits: digits }).format(v)} ${units[i]}`
}

/** "about 2 h 15 min" style length for estimates; rounds to the minute, and to five minutes from an hour up. */
export function formatDuration(ms: number): string {
  const minutes = Math.max(1, Math.round(ms / 60_000))
  if (minutes < 60) return t('sekitar {n} menit', { n: minutes })
  const rounded = Math.round(minutes / 5) * 5
  const h = Math.floor(rounded / 60)
  const m = rounded % 60
  return m === 0 ? t('sekitar {h} jam', { h }) : t('sekitar {h} jam {m} menit', { h, m })
}
