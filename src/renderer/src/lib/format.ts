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
  const s = (total % 60).toFixed(1).padStart(4, '0').replace('.', ',')
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`
}

export function formatDate(ms: number): string {
  return new Date(ms).toLocaleDateString('id-ID', { dateStyle: 'medium' })
}
