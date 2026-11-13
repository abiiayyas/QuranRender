import { useId, type CSSProperties, type ReactNode } from 'react'
import { overlayLabel } from '@shared/overlay'
import type { Background, Project } from '@shared/types'
import type { StyleSettings } from '@shared/style'
import { useProject } from '../../../store/project'

/** Style edit; `key` coalesces a slider drag into one undo step. */
export function setStyle(patch: Partial<StyleSettings>, key?: string): void {
  const p = useProject.getState().project
  if (p) useProject.getState().update({ style: { ...p.style, ...patch } }, key)
}

export function setBackground(patch: Partial<Background>, key?: string): void {
  const p = useProject.getState().project
  if (p) useProject.getState().update({ background: { ...p.background, ...patch } }, key)
}

export function setOverlay(id: string, patch: Partial<Project['overlays'][number]>, key?: string): void {
  const p = useProject.getState().project
  if (p) useProject.getState().update({ overlays: p.overlays.map((o) => (o.id === id ? { ...o, ...patch } : o)) }, key)
}

/** Overlay name for lists: images show their file name, empty text a placeholder. */
export function overlayName(o: Pick<Project['overlays'][number], 'kind' | 'text'>, assetName?: string): string {
  if (o.kind === 'image') return assetName || overlayLabel(o)
  return overlayLabel(o) || '(kosong)'
}

export const pct = (v: number): string => `${Math.round(v * 100)}%`

export function Slider({
  label,
  value,
  min,
  max,
  step,
  onChange,
  format = pct
}: {
  label: string
  value: number
  min: number
  max: number
  step: number
  onChange: (v: number) => void
  format?: (v: number) => string
}) {
  const id = useId()
  const v = Math.min(Math.max((value - min) / (max - min), 0), 1)
  return (
    <div className="ed-row">
      <label className="ed-row__lbl" htmlFor={id}>
        {label}
      </label>
      <input
        id={id}
        type="range"
        className="qr-slider"
        min={min}
        max={max}
        step={step}
        value={value}
        style={{ '--v': v } as CSSProperties}
        onChange={(e) => onChange(Number(e.target.value))}
      />
      <output className="ed-row__val" htmlFor={id}>
        {format(value)}
      </output>
    </div>
  )
}

export function ColorRow({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  const id = useId()
  return (
    <div className="ed-row">
      <label className="ed-row__lbl" htmlFor={id}>
        {label}
      </label>
      <input id={id} type="color" className="ed-color" value={value} onChange={(e) => onChange(e.target.value.toUpperCase())} />
      <span className="ed-row__val mono">{value.toUpperCase()}</span>
    </div>
  )
}

export function SwitchRow({ label, checked, onChange, disabled }: { label: string; checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  const id = useId()
  return (
    <div className="ed-row ed-row--switch">
      <label className="ed-row__lbl" htmlFor={id}>
        {label}
      </label>
      <input id={id} type="checkbox" role="switch" className="qr-switch" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
    </div>
  )
}

export function SelectRow<T extends string>({
  label,
  value,
  options,
  onChange
}: {
  label: string
  value: T
  options: ReadonlyArray<{ value: T; label: string }>
  onChange: (v: T) => void
}) {
  const id = useId()
  return (
    <div className="ed-row ed-row--wide">
      <label className="ed-row__lbl" htmlFor={id}>
        {label}
      </label>
      <span className="qr-field">
        <select id={id} value={value} onChange={(e) => onChange(e.target.value as T)}>
          {options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </span>
    </div>
  )
}

export function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="ed-sec">
      <h3 className="pn-h">{title}</h3>
      {children}
    </section>
  )
}
