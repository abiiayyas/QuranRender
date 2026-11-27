import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { OPENDUA_EDITION, duaTexts, duaVerses, segmentVerseKey } from '@shared/dua'
import { t } from '@shared/i18n'
import { segmentArabic } from '@shared/subtitles'
import { isPartial } from '@shared/translation'
import type { Segment } from '@shared/types'
import { Icon, JobProgress } from '../../components/ui'
import { errorText } from '../../lib/format'
import { splitLongSegments, useFitReport } from '../../lib/fit'
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
  const [noKey, setNoKey] = useState<string | false>(false)
  const [whole, setWhole] = useState<Record<string, string>>({})
  const [splitting, setSplitting] = useState(false)
  const fit = useFitReport(project)

  const segments = useMemo(() => [...project.segments].sort((a, b) => a.startMs - b.startMs), [project.segments])
  const isDua = !!project.dua
  const primary = project.editions[0] ?? null
  const hasBasmalah = segments.some((s) => s.kind === 'basmalah')
  const ayahVerses = useVerses(isDua ? NONE : segments, 'kemenag')
  const basmalahVerse = useVerses(hasBasmalah ? BASMALAH_VERSE : NONE, 'kemenag')
  const verses = useMemo(() => ({ ...basmalahVerse, ...ayahVerses, ...duaVerses(project.dua) }), [ayahVerses, basmalahVerse, project.dua])
  const source = project.sourceAssetId ? assets[project.sourceAssetId] : undefined
  const audio = useAudio(source?.url ?? null)

  useEffect(() => {
    if (!isDua && useEditions.getState().list === null) void useEditions.getState().load()
  }, [isDua])

  const installed = useMemo(
    () => project.editions.filter((id) => (isDua && id === OPENDUA_EDITION) || catalog?.some((e) => e.id === id && e.installed)),
    [project.editions, catalog, isDua]
  )

  const fill = useCallback(async (editionIds: string[], announce: boolean) => {
    setFilling(true)
    try {
      const changed = await fillProject(editionIds)
      if (announce) toast('info', changed > 0 ? t('Terjemahan {n} segmen sudah diisi.', { n: changed }) : t('Semua terjemahan sudah terisi.'))
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
    if (isDua) {
      setWhole(duaTexts(project.dua))
      return
    }
    if (primary && installed.includes(primary))
      void editionTexts(primary, JSON.parse(spanKey) as AyahSpan[]).then(
        (t) => live && setWhole(t),
        () => live && setWhole({})
      )
    else setWhole({})
    return () => {
      live = false
    }
  }, [isDua, project.dua, primary, installed, spanKey])

  const counts = (seg: Segment): number => verses[segmentVerseKey(seg)]?.words.length ?? 0
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
      const ai = await window.api.settings.aiReady()
      if (!ai.ready) {
        setNoKey(ai.hint || t('AI belum siap.'))
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

  const tooLong = useMemo(() => segments.filter((x) => fit[x.id]?.overflow), [segments, fit])
  const needTrim = tooLong.filter((x) => fit[x.id]?.cause === 'translation').length

  /** Cuts the segments that cannot fit one screen at natural pauses, then fills each new part's translation. */
  const splitLong = useCallback(
    async (ids?: string[]) => {
      const p = useProject.getState().project
      if (!p) return
      const only = new Set(ids ?? Object.entries(fit).filter(([, f]) => f.overflow).map(([id]) => id))
      if (only.size === 0) return
      setSplitting(true)
      try {
        const ed = p.editions[0]
        const texts = ed === OPENDUA_EDITION && p.dua ? duaTexts(p.dua) : ed ? await editionTexts(ed, spansOf(p.segments)).catch(() => ({})) : {}
        const { segments: next, cuts, trimNeeded } = await splitLongSegments(p, texts, only)
        if (cuts === 0) {
          toast(
            'info',
            trimNeeded > 0
              ? t('{n} segmen terlalu panjang karena terjemahannya belum dipotong sesuai kata yang dibaca. Silakan pakai AI trim, atau ketik potongannya.', { n: trimNeeded })
              : t('Segmen ini tidak bisa dibelah lagi tanpa memotong di tengah kata. Silakan kecilkan ukuran Arab di Editor.')
          )
          return
        }
        useProject.getState().update({ segments: next })
        await fillProject(installed)
        toast('success', t('Dibelah menjadi {n} bagian tambahan. Terjemahan tiap bagian dipotong otomatis; gunakan AI trim untuk hasil yang lebih halus.', { n: cuts }))
      } catch (e) {
        toast('error', errorText(e))
      } finally {
        setSplitting(false)
      }
    },
    [fit, installed]
  )
  const onSplit = useCallback((segId: string) => void splitLong([segId]), [splitLong])

  const { playing, t: time, playRange, pause } = audio
  // Read through a ref so the callback stays stable and rows do not re-render on every audio frame.
  const now = useRef({ playing, t: time })
  now.current = { playing, t: time }
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
    if (seg.kind === 'istiadzah') return t("Isti'adzah")
    if (seg.kind === 'dua') {
      const name = project.dua?.title ?? t('Doa')
      const n = counts(seg)
      return isPartial(seg, n) ? t('{name} · kata {from}–{to} dari {total}', { name, from: seg.wordFrom, to: seg.wordTo, total: n }) : name
    }
    const name = surahs.find((s) => s.id === seg.surah)?.nameLatin ?? t('Surah {id}', { id: seg.surah })
    const n = counts(seg)
    return isPartial(seg, n)
      ? t('{name} {ayah} · kata {from}–{to} dari {total}', { name, ayah: seg.ayah, from: seg.wordFrom, to: seg.wordTo, total: n })
      : `${name} ${seg.ayah}`
  }

  return (
    <div className="tx-body">
      <EditionsPanel />
      <section className="tx-main" aria-label={t('Teks dan terjemahan')}>
        <div className="tx-bar">
          <div className="tx-bar__info">
            <b>{t('{n} segmen', { n: segments.length })}</b>
            {primary && <span className="muted">{reviewCount > 0 ? t('{n} perlu dicek', { n: reviewCount }) : t('Semua sudah siap')}</span>}
          </div>
          <label className="tx-filter">
            <input type="checkbox" className="qr-check" checked={onlyReview} onChange={(e) => setOnlyReview(e.target.checked)} />
            {t('Hanya yang perlu dicek')}
          </label>
          <button
            type="button"
            className="qr-btn qr-btn--secondary"
            disabled={filling || installed.length === 0 || segments.length === 0}
            onClick={() => void fill(installed, true)}
          >
            {filling ? <span className="qr-spin" /> : <Icon name="languages" />}
            {t('Isi terjemahan')}
          </button>
          <button
            type="button"
            className="qr-btn qr-btn--secondary"
            disabled={!!aiJob || !primary || partialCount === 0}
            title={partialCount === 0 ? t('Tidak ada ayat yang terpotong.') : undefined}
            onClick={() => void startAi()}
          >
            <Icon name="scissors" />
            {t('AI trim ayat terpotong')}
          </button>
        </div>
        <JobProgress job={aiJob} label={t('AI trim ayat terpotong')} />
        {tooLong.length > 0 && (
          <div className="qr-alert qr-alert--warning tx-alert" role="status">
            <Icon name="triangle-alert" />
            <div className="qr-alert__content">
              <span className="qr-alert__title">{t('{n} segmen terlalu panjang untuk satu layar', { n: tooLong.length })}</span>
              <span className="qr-alert__body">
                {t('Tulisannya akan mengecil sampai sulit dibaca, atau menutupi nama surah dan qari.')}
                {tooLong.length - needTrim > 0 && ` ${t('Ayat yang panjang bisa dibelah di jeda yang wajar; terjemahan tiap bagian ikut dipotong.')}`}
                {needTrim > 0 && ` ${t('{n} segmen panjang karena terjemahannya belum dipotong sesuai kata yang dibaca: pakai AI trim.', { n: needTrim })}`}
              </span>
            </div>
            <span className="qr-alert__actions">
              <button type="button" className="qr-btn qr-btn--secondary qr-btn--sm" disabled={splitting} onClick={() => void splitLong()}>
                {splitting ? <span className="qr-spin" /> : <Icon name="scissors" size="sm" />}
                {t('Belah otomatis')}
              </button>
              {needTrim > 0 && (
                <button type="button" className="qr-btn qr-btn--secondary qr-btn--sm" disabled={!!aiJob} onClick={() => void startAi()}>
                  <Icon name="languages" size="sm" />
                  {t('AI trim')}
                </button>
              )}
            </span>
          </div>
        )}
        {noKey && (
          <div className="qr-alert qr-alert--warning tx-alert" role="alert">
            <Icon name="key-round" />
            <div className="qr-alert__content">
              <span className="qr-alert__title">{t('AI belum siap')}</span>
              <span className="qr-alert__body">{t('{hint} Silakan atur kunci layanan atau AI CLI di Pengaturan agar ayat yang terpotong bisa dipotong terjemahannya secara otomatis.', { hint: noKey })}</span>
            </div>
            <span className="qr-alert__actions">
              <button type="button" className="qr-btn qr-btn--secondary qr-btn--sm" onClick={() => void openSettings()}>
                {t('Buka Pengaturan')}
              </button>
              <button type="button" className="qr-btn qr-btn--ghost qr-btn--sm" onClick={() => setNoKey(false)}>
                {t('Tutup')}
              </button>
            </span>
          </div>
        )}
        {primary && catalog !== null && !installed.includes(primary) && (
          <div className="qr-alert qr-alert--warning tx-alert" role="status">
            <Icon name="triangle-alert" />
            <div className="qr-alert__content">
              <span className="qr-alert__body">{t('Terjemahan utama belum terpasang di perangkat ini. Silakan pasang dari panel kiri.')}</span>
            </div>
          </div>
        )}
        <div className="tx-list">
          {segments.length === 0 ? (
            <div className="center-fill">
              <div className="qr-empty">
                <Icon name="list" size="lg" />
                <span className="qr-empty__title">{t('Belum ada segmen')}</span>
                <span>{t('Silakan sinkronkan audio di langkah Sinkron dulu, lalu terjemahan bisa diisi di sini.')}</span>
              </div>
            </div>
          ) : shown.length === 0 ? (
            <p className="pn-note">{t('Tidak ada segmen yang perlu dicek. Terima kasih sudah memeriksa.')}</p>
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
                    whole={partial ? (whole[segmentVerseKey(seg)] ?? null) : null}
                    partial={partial}
                    secondaries={secondaries}
                    playing={playing && time >= seg.startMs && time < seg.endMs}
                    aiBusy={!!aiJob}
                    tooLong={!!fit[seg.id]?.overflow}
                    splitBusy={splitting}
                    onPlay={onPlay}
                    onEdit={onEdit}
                    onAccept={onAccept}
                    onAi={onAi}
                    onSplit={onSplit}
                  />
                )
              })}
            </ol>
          )}
        </div>
        <div className="tx-foot">
          {primary && reviewCount > 0 && <span className="muted">{t('Masih ada {n} segmen yang perlu dicek sebelum ekspor.', { n: reviewCount })}</span>}
          <span className="spacer" />
          <button type="button" className="qr-btn qr-btn--primary" onClick={onNext}>
            {t('Lanjut ke Editor')}
            <Icon name="chevron-right" />
          </button>
        </div>
      </section>
    </div>
  )
}
