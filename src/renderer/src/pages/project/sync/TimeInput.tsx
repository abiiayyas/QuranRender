import { useEffect, useState } from 'react'
import { locale } from '@shared/i18n'

/** m:ss,cc (m:ss.cc in English) — hundredths, because word and ayah boundaries need finer steps than formatMs gives. */
export function formatTime(ms: number): string {
  const cs = Math.round(Math.max(0, ms) / 10)
  const m = Math.floor(cs / 6000)
  const s = Math.floor((cs % 6000) / 100)
  const sep = locale() === 'en-US' ? '.' : ','
  return `${m}:${String(s).padStart(2, '0')}${sep}${String(cs % 100).padStart(2, '0')}`
}

/** Accepts `ss`, `m:ss`, `h:mm:ss`, with `,` or `.` decimals. Null when it is not a time. */
export function parseTime(text: string): number | null {
  const parts = text.trim().replace(',', '.').split(':')
  if (parts.length > 3 || parts.some((p) => !/^\d+(\.\d*)?$/.test(p))) return null
  const sec = parts.reduce((acc, p) => acc * 60 + Number(p), 0)
  return Number.isFinite(sec) ? Math.round(sec * 1000) : null
}

/** Time text field: commits on Enter or blur, reverts on Escape or invalid input. */
export function TimeInput({ id, label, value, onCommit }: { id?: string; label: string; value: number; onCommit: (ms: number) => void }) {
  const [text, setText] = useState(formatTime(value))
  useEffect(() => setText(formatTime(value)), [value])
  const commit = () => {
    const ms = parseTime(text)
    if (ms == null || ms === value) setText(formatTime(value))
    else onCommit(ms)
  }
  return (
    <span className="qr-field">
      <input
        id={id}
        aria-label={id ? undefined : label}
        inputMode="decimal"
        className="sync-time"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit()
          else if (e.key === 'Escape') setText(formatTime(value))
        }}
      />
    </span>
  )
}
