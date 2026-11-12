import { useEffect, useId, useState } from 'react'
import {
  canMerge,
  mergeSegments,
  needsReview,
  proportionalWords,
  relabel,
  segmentLabel,
  segmentWordTexts,
  setEdge,
  setWordStart,
  splitSegmentAt,
  type Edge
} from '@shared/segments'
import type { ArabicScript, Segment, SegmentKind, SurahInfo, Verse } from '@shared/types'
import { verseKey } from '@shared/video'
import { Icon, Segmented } from '../../../components/ui'
import { useArabicFont } from '../../../lib/arabic'
import { errorText, formatMs } from '../../../lib/format'
import { toast } from '../../../store/app'
import { ConfidenceBadge } from './SegmentList'
import { TimeInput } from './TimeInput'

/** One ayah in the review script, fetched when a label points at an ayah not loaded yet. */
export async function fetchVerse(surah: number, ayah: number, script: ArabicScript): Promise<Verse | null> {
  const [v] = await window.api.quran.verses(surah, ayah, ayah, script)
  return v ?? null
}

export const verseOf = (seg: Segment, verses: Record<string, Verse>): Verse | undefined =>
  seg.kind === 'basmalah' ? verses[verseKey(1, 1)] : verses[verseKey(seg.surah, seg.ayah)]

const KINDS: { value: SegmentKind; label: string }[] = [
  { value: 'ayah', label: 'Ayat' },
  { value: 'basmalah', label: 'Basmalah' },
  { value: 'istiadzah', label: "Isti'adzah" }
]

interface Props {
  seg: Segment
  /** All segments, time order. */
  list: ReadonlyArray<Segment>
  verses: Record<string, Verse>
  surahs: ReadonlyArray<SurahInfo>
  script: ArabicScript
  t: number
  durationMs: number
  /** Replaces the segment list (one undo step, or joined by `key`), then selects `selectId` when given. */
  commit: (next: Segment[], key?: string, selectId?: string) => void
  playRange: (from: number, to: number) => void
  onAdd: () => void
}

export function SegmentInspector({ seg, list, verses, surahs, script, t, durationMs, commit, playRange, onAdd }: Props) {
  const ids = { start: useId(), end: useId(), surah: useId(), ayah: useId(), from: useId(), to: useId() }
  const verse = verseOf(seg, verses)
  const arFont = useArabicFont(script, Object.keys(verses).length > 0)
  const count = seg.kind === 'ayah' ? verse?.words.length : undefined
  const i = list.findIndex((s) => s.id === seg.id)
  const next = list[i + 1]
  const split = splitSegmentAt(seg, t, count)
  const replace = (s: Segment, key?: string) => commit(list.map((x) => (x.id === s.id ? s : x)), key)

  // Label form: applied with a button so word timings are not re-spread on every keystroke.
  const [form, setForm] = useState({ kind: seg.kind, surah: seg.surah, ayah: seg.ayah, wordFrom: seg.wordFrom, wordTo: seg.wordTo })
  useEffect(() => {
    setForm({ kind: seg.kind, surah: seg.surah, ayah: seg.ayah, wordFrom: seg.wordFrom, wordTo: seg.wordTo })
  }, [seg.id, seg.kind, seg.surah, seg.ayah, seg.wordFrom, seg.wordTo])
  const surahInfo = surahs.find((s) => s.id === form.surah)
  const formCount = verses[verseKey(form.surah, form.ayah)]?.words.length
  const dirty =
    form.kind !== seg.kind ||
    (form.kind === 'ayah' && (form.surah !== seg.surah || form.ayah !== seg.ayah || form.wordFrom !== seg.wordFrom || form.wordTo !== seg.wordTo))

  const applyLabel = async () => {
    try {
      if (form.kind === 'ayah') {
        if (!surahInfo || form.ayah < 1 || form.ayah > surahInfo.ayahCount) throw new Error('Nomor ayat tidak ada di surah ini.')
        const v = verses[verseKey(form.surah, form.ayah)] ?? (await fetchVerse(form.surah, form.ayah, script))
        const n = v?.words.length ?? form.wordTo
        const from = Math.min(Math.max(1, form.wordFrom), n)
        const to = Math.min(Math.max(from, form.wordTo), n)
        replace(relabel(seg, { kind: 'ayah', surah: form.surah, ayah: form.ayah, wordFrom: from, wordTo: to }, v))
      } else {
        const v = form.kind === 'basmalah' ? (verses[verseKey(1, 1)] ?? (await fetchVerse(1, 1, script))) : null
        replace(relabel(seg, { kind: form.kind, surah: 0, ayah: 0, wordFrom: 0, wordTo: 0 }, v))
      }
    } catch (e) {
      toast('error', errorText(e))
    }
  }

  const edge = (which: Edge, ms: number) => {
    const r = setEdge(list, seg.id, which, ms, durationMs)
    if (r) commit(r.segments)
  }

  const words = segmentWordTexts(seg, verse)
  const timing = new Map(seg.words.map((w) => [w.idx, w]))
  const current = seg.words.find((w) => t >= w.startMs && t < w.endMs)?.idx

  return (
    <div className="sync-insp">
      <div className="qr-panel__head">
        <span className="qr-panel__title">Segmen {segmentLabel(seg, count)}</span>
        <span className="qr-panel__actions">
          <ConfidenceBadge seg={seg} />
        </span>
      </div>
      <div className="insp-pad">
        {needsReview(seg) && (
          <div className="qr-alert qr-alert--warning">
            <Icon name="triangle-alert" />
            <div className="qr-alert__content">
              <span className="qr-alert__body">
                {seg.words.length === 0
                  ? 'Segmen ini belum punya waktu per kata. Silakan periksa batasnya, lalu ratakan waktu kata.'
                  : 'Keyakinan penyelaras rendah, atau ada kata yang terlewat atau terulang. Silakan dengarkan dan periksa batasnya.'}
              </span>
            </div>
          </div>
        )}
        {needsReview(seg) && (
          <button
            type="button"
            className="qr-btn qr-btn--secondary"
            onClick={() => replace({ ...seg, confidence: 1, words: seg.words.length ? seg.words : proportionalWords(seg, verse) })}
          >
            <Icon name="check" />
            Tandai sudah dicek
          </button>
        )}

        <div className="stack">
          <div className="field-row">
            <label className="lbl" htmlFor={ids.start}>
              Mulai
            </label>
            <div className="sync-time-row">
              <TimeInput id={ids.start} label="Waktu mulai" value={seg.startMs} onCommit={(ms) => edge('start', ms)} />
              <button type="button" className="qr-btn qr-btn--ghost qr-btn--sm" aria-label="Mulai dari pemutar" onClick={() => edge('start', Math.round(t))}>
                Dari pemutar
              </button>
            </div>
          </div>
          <div className="field-row">
            <label className="lbl" htmlFor={ids.end}>
              Selesai
            </label>
            <div className="sync-time-row">
              <TimeInput id={ids.end} label="Waktu selesai" value={seg.endMs} onCommit={(ms) => edge('end', ms)} />
              <button type="button" className="qr-btn qr-btn--ghost qr-btn--sm" aria-label="Selesai dari pemutar" onClick={() => edge('end', Math.round(t))}>
                Dari pemutar
              </button>
            </div>
          </div>
          <p className="pn-note">Durasi {formatMs(seg.endMs - seg.startMs)}. Tepi segmen juga bisa diseret di gelombang suara.</p>
        </div>

        <fieldset className="sync-label stack">
          <legend className="pn-h">Isi segmen</legend>
          <Segmented<SegmentKind> ariaLabel="Jenis segmen" value={form.kind} onChange={(kind) => setForm({ ...form, kind })} options={KINDS} />
          {form.kind === 'ayah' && (
            <>
              <div className="qr-fieldset">
                <label className="qr-label" htmlFor={ids.surah}>
                  Surah
                </label>
                <span className="qr-field">
                  <select id={ids.surah} value={form.surah || ''} onChange={(e) => setForm({ ...form, surah: Number(e.target.value), ayah: 1, wordFrom: 1, wordTo: 1 })}>
                    <option value="" disabled>
                      Pilih surah
                    </option>
                    {surahs.map((s) => (
                      <option key={s.id} value={s.id}>
                        {`${s.id}. ${s.nameLatin}`}
                      </option>
                    ))}
                  </select>
                </span>
              </div>
              <div className="grid-2">
                <div className="qr-fieldset">
                  <label className="qr-label" htmlFor={ids.ayah}>
                    Ayat
                  </label>
                  <span className="qr-field">
                    <input
                      id={ids.ayah}
                      type="number"
                      min={1}
                      max={surahInfo?.ayahCount}
                      value={form.ayah || ''}
                      onChange={(e) => setForm({ ...form, ayah: Number(e.target.value) })}
                    />
                  </span>
                </div>
                <div />
                <div className="qr-fieldset">
                  <label className="qr-label" htmlFor={ids.from}>
                    Dari kata
                  </label>
                  <span className="qr-field">
                    <input id={ids.from} type="number" min={1} max={formCount} value={form.wordFrom || ''} onChange={(e) => setForm({ ...form, wordFrom: Number(e.target.value) })} />
                  </span>
                </div>
                <div className="qr-fieldset">
                  <label className="qr-label" htmlFor={ids.to}>
                    Sampai kata
                  </label>
                  <span className="qr-field">
                    <input id={ids.to} type="number" min={1} max={formCount} value={form.wordTo || ''} onChange={(e) => setForm({ ...form, wordTo: Number(e.target.value) })} />
                  </span>
                </div>
              </div>
              {formCount != null && <p className="pn-note">Ayat ini terdiri dari {formCount} kata.</p>}
            </>
          )}
          <button type="button" className="qr-btn qr-btn--secondary" disabled={!dirty} onClick={() => void applyLabel()}>
            Terapkan
          </button>
        </fieldset>

        <div className="sync-actions">
          <button
            type="button"
            className="qr-btn qr-btn--secondary qr-btn--sm"
            disabled={!split}
            title={split ? undefined : 'Letakkan pemutar di dalam segmen ayat, di antara dua kata'}
            onClick={() => split && commit(list.flatMap((x) => (x.id === seg.id ? split : [x])), undefined, split[1].id)}
          >
            <Icon name="scissors" size="sm" />
            Belah di pemutar
          </button>
          <button
            type="button"
            className="qr-btn qr-btn--secondary qr-btn--sm"
            disabled={!next || !canMerge(seg, next)}
            title={next && canMerge(seg, next) ? undefined : 'Hanya bagian dari ayat yang sama yang bisa digabung'}
            onClick={() => {
              const m = next && mergeSegments(seg, next)
              if (m) commit(list.filter((x) => x.id !== next.id).map((x) => (x.id === seg.id ? m : x)), undefined, m.id)
            }}
          >
            <Icon name="group" size="sm" />
            Gabung dengan berikutnya
          </button>
          <button type="button" className="qr-btn qr-btn--secondary qr-btn--sm" onClick={onAdd}>
            <Icon name="plus" size="sm" />
            Tambah di pemutar
          </button>
          <button
            type="button"
            className="qr-btn qr-btn--danger qr-btn--sm"
            onClick={() => commit(list.filter((x) => x.id !== seg.id), undefined, (list[i + 1] ?? list[i - 1])?.id)}
          >
            <Icon name="trash-2" size="sm" />
            Hapus
          </button>
        </div>

        <section className="stack" aria-labelledby={`${ids.start}-words`}>
          <div className="sync-words-head">
            <h3 className="pn-h" id={`${ids.start}-words`}>
              Waktu per kata
            </h3>
            <button type="button" className="qr-btn qr-btn--ghost qr-btn--sm" disabled={words.length === 0} onClick={() => replace({ ...seg, words: proportionalWords(seg, verse) })}>
              Ratakan waktu kata
            </button>
          </div>
          {words.length === 0 && <p className="pn-note">Teks ayat belum dimuat.</p>}
          <ol className="sync-words">
            {words.map((w) => {
              const tm = timing.get(w.idx)
              return (
                <li key={w.idx} className={w.idx === current ? 'is-current' : undefined}>
                  <span className="sync-words__n">{w.idx}</span>
                  <span className="sync-words__ar" dir="rtl" lang="ar" style={{ fontFamily: arFont }}>
                    {w.text || '·'}
                  </span>
                  {tm ? (
                    <>
                      <TimeInput label={`Mulai kata ${w.idx}`} value={tm.startMs} onCommit={(ms) => replace(setWordStart(seg, w.idx, ms), `word:${seg.id}`)} />
                      <button
                        type="button"
                        className="qr-btn qr-btn--ghost qr-btn--icon qr-btn--sm"
                        aria-label={`Putar kata ${w.idx}`}
                        onClick={() => playRange(tm.startMs, tm.endMs)}
                      >
                        <Icon name="play" size="sm" />
                      </button>
                    </>
                  ) : (
                    <span className="muted sync-words__none">tanpa waktu</span>
                  )}
                </li>
              )
            })}
          </ol>
        </section>
      </div>
    </div>
  )
}
