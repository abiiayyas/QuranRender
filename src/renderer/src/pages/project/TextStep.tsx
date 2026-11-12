import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { segmentArabic } from '@shared/subtitles'
import { isPartial } from '@shared/translation'
import type { Segment } from '@shared/types'
import { Icon, JobProgress } from '../../components/ui'
import { errorText } from '../../lib/format'
import { useVerses, useSurahs } from '../../lib/quran'
import { useAudio } from '../../lib/useAudio'
import { toast, useApp } from '../../store/app'
import { useActiveJob, useProject } from '../../store/project'
import { EditionsPanel } from './text/EditionsPanel'
import { SegmentRow } from './text/SegmentRow'
import { useEditions } from './text/editions'
import { editionTexts, fillProject, spansOf, type AyahSpan } from './text/fill'

const BASMALAH_VERSE = [{ kind: 'ayah' as const, surah: 1, ayah: 1 }]
const NONE: never[] = []

/** Needs a look: no primary entry, or one marked for review. */
const needsReview = (seg: Segment, primary: string | null): boolean => {
  if (!primary) return false
  const t = seg.translations.find((x) => x.edition === primary)
  return !t || !t.text.trim() || t.status === 'review'
}

export function TextStep({ onNext }: { onNext: () => void }) {
  const project = useProject((s) => s.project)!
  const assets = useProject((s) => s.assets)
  const aiJob = useActiveJob('aitrim')
  const catalog = useEditions((s) => s.list)
  const surahs = useSurahs()
  const [filling, setFilling] = useState(false)
  const [onlyReview, setOnlyReview] = useState(false)
  const [noKey, setNoKey] = useState(false)
  const [whole, setWhole] = useState<Record<string, string>>({})

  const segments = useMemo(() => [...project.segments].sort((a, b) => a.startMs - b.startMs), [project.segments])
  const primary = project.editions[0] ?? null
  const hasBasmalah = segments.some((s) => s.kind === 'basmalah')
  const ayahVerses = useVerses(segments, 'kemenag')
  const basmalahVerse = useVerses(hasBasmalah ? BASMALAH_VERSE : NONE, 'kemenag')
  const verses = useMemo(() => ({ ...basmalahVerse, ...ayahVerses }), [ayahVerses, basmalahVerse])
  const source = project.sourceAssetId ? assets[project.sourceAssetId] : undefined
  const audio = useAudio(source?.url ?? null)

  useEffect(() => {
    if (useEditions.getState().list === null) void useEditions.getState().load()
  }, [])

  const installed = useMemo(
    () => project.editions.filter((id) => catalog?.some((e) => e.id === id && e.installed)),
    [project.editions, catalog]
  )

  const fill = useCallback(async (editionIds: string[], announce: boolean) => {
    setFilling(true)
    try {
      const changed = await fillProject(editionIds)
      if (announce) toast('info', changed > 0 ? `Terjemahan ${changed} segmen sudah diisi.` : 'Semua terjemahan sudah terisi.')
    } catch (e) {
      toast('error', errorText(e))
    } finally {
      setFilling(false)
    }
  }, [])

  // Entering the step (or installing an edition) fills editions some segment still lacks.
  const lacking = installed.filter((id) => project.segments.some((s) => !s.translations.some((t) => t.edition === id)))
  const lackingKey = lacking.join('|')
  useEffect(() => {
    if (lacking.length > 0) void fill(lacking, false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lackingKey])

  // Whole primary texts as a reference under partial segments.
  const spanKey = JSON.stringify(spansOf(segments))
  useEffect(() => {
    let live = true
    if (primary && installed.includes(primary))
      void editionTexts(primary, JSON.parse(spanKey) as AyahSpan[]).then(
        (t) => live && setWhole(t),
        () => live && setWhole({})
      )
    else setWhole({})
    return () => {
      live = false
    }
  }, [primary, installed, spanKey])

  const counts = (seg: Segment): number => verses[`${seg.surah}:${seg.ayah}`]?.words.length ?? 0
  const partialCount = segments.filter((s) => isPartial(s, counts(s))).length
  const reviewCount = segments.filter((s) => needsReview(s, primary)).length
  const shown = onlyReview ? segments.filter((s) => needsReview(s, primary)) : segments

  const setEntry = useCallback((segId: string, text: string | null, key?: string) => {
    const p = useProject.getState().project
    const ed = p?.editions[0]
    if (!p || !ed) return
    const next = p.segments.map((s) => {
      if (s.id !== segId) return s
      const cur = s.translations.find((t) => t.edition === ed)
      const entry = { edition: ed, text: text ?? cur?.text ?? '', status: 'manual' as const }
      return { ...s, translations: cur ? s.translations.map((t) => (t.edition === ed ? entry : t)) : [...s.translations, entry] }
    })
    useProject.getState().update({ segments: next }, key)
  }, [])
  const onEdit = useCallback((segId: string, text: string) => setEntry(segId, text, `tr:${segId}`), [setEntry])
  const onAccept = useCallback((segId: string) => setEntry(segId, null), [setEntry])

  const startAi = useCallback(async (segmentIds?: string[]) => {
    const p = useProject.getState().project
    const ed = p?.editions[0]
    if (!p || !ed) return
    try {
      const [key, settings] = await Promise.all([window.api.settings.aiKey(), window.api.settings.get()])
      const local = /^https?:\/\/(localhost|127\.0\.0\.1)(:|\/|$)/i.test(settings.aiBaseUrl)
      if (!key.configured && !local) {
        setNoKey(true)
        return
      }
      setNoKey(false)
      await useProject.getState().flush()
      await window.api.text.aiTrim(p.id, ed, segmentIds)
    } catch (e) {
      toast('error', errorText(e))
    }
  }, [])
  const onAi = useCallback((segId: string) => void startAi([segId]), [startAi])

  const { playing, t, playRange, pause } = audio
  // Read through a ref so the callback stays stable and rows do not re-render on every audio frame.
  const now = useRef({ playing, t })
  now.current = { playing, t }
  const onPlay = useCallback(
    (seg: Segment) => {
      const { playing: on, t: at } = now.current
      if (on && at >= seg.startMs && at < seg.endMs) pause()
      else playRange(seg.startMs, seg.endMs)
    },
    [playRange, pause]
  )

  const openSettings = async () => {
    await useProject.getState().flush()
    useApp.getState().go({ name: 'settings', back: { name: 'project', id: project.id } })
  }

  const secondaries = useMemo(
    () => project.editions.slice(1).map((id) => ({ id, name: catalog?.find((e) => e.id === id)?.name ?? id })),
    [project.editions, catalog]
  )

  const label = (seg: Segment): string => {
    if (seg.kind === 'basmalah') return 'Basmalah'
    if (seg.kind === 'istiadzah') return "Isti'adzah"
    const name = surahs.find((s) => s.id === seg.surah)?.nameLatin ?? `Surah ${seg.surah}`
    const n = counts(seg)
    return isPartial(seg, n) ? `${name} ${seg.ayah} · kata ${seg.wordFrom}–${seg.wordTo} dari ${n}` : `${name} ${seg.ayah}`
  }

  return (
    <div className="tx-body">
      <EditionsPanel />
      <section className="tx-main" aria-label="Teks dan terjemahan">
        <div className="tx-bar">
          <div className="tx-bar__info">
            <b>{segments.length} segmen</b>
            {primary && <span className="muted">{reviewCount > 0 ? `${reviewCount} perlu dicek` : 'Semua sudah siap'}</span>}
          </div>
          <label className="tx-filter">
            <input type="checkbox" className="qr-check" checked={onlyReview} onChange={(e) => setOnlyReview(e.target.checked)} />
            Hanya yang perlu dicek
          </label>
          <button
            type="button"
            className="qr-btn qr-btn--secondary"
            disabled={filling || installed.length === 0 || segments.length === 0}
            onClick={() => void fill(installed, true)}
          >
            {filling ? <span className="qr-spin" /> : <Icon name="languages" />}
            Isi terjemahan
          </button>
          <button
            type="button"
            className="qr-btn qr-btn--secondary"
            disabled={!!aiJob || !primary || partialCount === 0}
            title={partialCount === 0 ? 'Tidak ada ayat yang terpotong.' : undefined}
            onClick={() => void startAi()}
          >
            <Icon name="scissors" />
            AI trim ayat terpotong
          </button>
        </div>
        <JobProgress job={aiJob} label="AI trim ayat terpotong" />
        {noKey && (
          <div className="qr-alert qr-alert--warning tx-alert" role="alert">
            <Icon name="key-round" />
            <div className="qr-alert__content">
              <span className="qr-alert__title">Kunci AI belum diatur</span>
              <span className="qr-alert__body">Silakan tambahkan kunci layanan AI di Pengaturan agar ayat yang terpotong bisa dipotong terjemahannya secara otomatis.</span>
            </div>
            <span className="qr-alert__actions">
              <button type="button" className="qr-btn qr-btn--secondary qr-btn--sm" onClick={() => void openSettings()}>
                Buka Pengaturan
              </button>
              <button type="button" className="qr-btn qr-btn--ghost qr-btn--sm" onClick={() => setNoKey(false)}>
                Tutup
              </button>
            </span>
          </div>
        )}
        {primary && catalog !== null && !installed.includes(primary) && (
          <div className="qr-alert qr-alert--warning tx-alert" role="status">
            <Icon name="triangle-alert" />
            <div className="qr-alert__content">
              <span className="qr-alert__body">Terjemahan utama belum terpasang di perangkat ini. Silakan pasang dari panel kiri.</span>
            </div>
          </div>
        )}
        <div className="tx-list">
          {segments.length === 0 ? (
            <div className="center-fill">
              <div className="qr-empty">
                <Icon name="list" size="lg" />
                <span className="qr-empty__title">Belum ada segmen</span>
                <span>Silakan sinkronkan audio di langkah Sinkron dulu, lalu terjemahan bisa diisi di sini.</span>
              </div>
            </div>
          ) : shown.length === 0 ? (
            <p className="pn-note">Tidak ada segmen yang perlu dicek. Terima kasih sudah memeriksa.</p>
          ) : (
            <ol className="tx-rows">
              {shown.map((seg) => {
                const n = counts(seg)
                const partial = isPartial(seg, n)
                return (
                  <SegmentRow
                    key={seg.id}
                    seg={seg}
                    label={label(seg)}
                    arabic={segmentArabic(seg, verses)}
                    primary={primary}
                    whole={partial ? (whole[`${seg.surah}:${seg.ayah}`] ?? null) : null}
                    partial={partial}
                    secondaries={secondaries}
                    playing={playing && t >= seg.startMs && t < seg.endMs}
                    aiBusy={!!aiJob}
                    onPlay={onPlay}
                    onEdit={onEdit}
                    onAccept={onAccept}
                    onAi={onAi}
                  />
                )
              })}
            </ol>
          )}
        </div>
        <div className="tx-foot">
          {primary && reviewCount > 0 && <span className="muted">Masih ada {reviewCount} segmen yang perlu dicek sebelum ekspor.</span>}
          <span className="spacer" />
          <button type="button" className="qr-btn qr-btn--primary" onClick={onNext}>
            Lanjut ke Editor
            <Icon name="chevron-right" />
          </button>
        </div>
      </section>
    </div>
  )
}
