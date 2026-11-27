import { useCallback, useEffect, useMemo, useState, Fragment } from 'react'
import { duaVerses } from '@shared/dua'
import { t } from '@shared/i18n'
import { manualSegment, MIN_SEGMENT_MS, needsReview, newSegmentId, segmentAt, segmentLabel, segmentWordTexts, setEdge, sortSegments, wordAt, type Edge } from '@shared/segments'
import type { Asset, Project, Segment } from '@shared/types'
import { verseKey } from '@shared/video'
import { Icon, isModalOpen, isTypingTarget } from '../../components/ui'
import { errorText } from '../../lib/format'
import { useArabicFont } from '../../lib/arabic'
import { useVerses, useSurahs } from '../../lib/quran'
import { useAudio } from '../../lib/useAudio'
import { toast } from '../../store/app'
import { useProject } from '../../store/project'
import { AlignPanel } from './sync/AlignPanel'
import { fetchVerse, SegmentInspector, verseOf } from './sync/SegmentInspector'
import { SegmentList } from './sync/SegmentList'
import { SyncTimeline } from './sync/SyncTimeline'

const PEAKS = 3000
const NEW_SEGMENT_MS = 5000

export function SyncStep({ onNext }: { onNext: () => void }) {
  const project = useProject((s) => s.project)
  const asset = useProject((s) => (s.project?.sourceAssetId ? s.assets[s.project.sourceAssetId] : undefined))
  if (!project) return null
  if (!asset)
    return (
      <div className="center-fill">
        <div className="qr-empty">
          <Icon name="audio-waveform" size="lg" />
          <span className="qr-empty__title">{t('Belum ada audio')}</span>
          <span>{t('Sinkron membutuhkan rekaman tilawah. Silakan tambahkan sumber audio atau video terlebih dahulu.')}</span>
          <button type="button" className="qr-btn qr-btn--primary" onClick={() => useProject.getState().applyPatch({ step: 1 })}>
            <Icon name="chevron-left" />
            {t('Ke langkah Sumber')}
          </button>
        </div>
      </div>
    )
  return <SyncWorkspace project={project} asset={asset} onNext={onNext} />
}

function SyncWorkspace({ project, asset, onNext }: { project: Project; asset: Asset; onNext: () => void }) {
  const list = useMemo(() => sortSegments(project.segments), [project.segments])
  // QPC words are glyph codes that need per-page fonts; Uthmani has the same canonical words and plain Unicode.
  const script = project.script === 'qpc' ? 'uthmani' : project.script
  const wanted = useMemo<Pick<Segment, 'kind' | 'surah' | 'ayah'>[]>(
    () => (project.dua ? [] : list.some((s) => s.kind === 'basmalah') ? [...list, { kind: 'ayah', surah: 1, ayah: 1 }] : list),
    [list, project.dua]
  )
  const quranVerses = useVerses(wanted, script, project.dua ? undefined : { surah: project.surah, from: project.ayahFrom, to: project.ayahTo })
  const verses = useMemo(() => ({ ...quranVerses, ...duaVerses(project.dua) }), [quranVerses, project.dua])
  const surahs = useSurahs()
  const audio = useAudio(asset.url)
  const durationMs = asset.durationMs ?? audio.durationMs
  const [peaks, setPeaks] = useState<number[]>([])
  const [peaksError, setPeaksError] = useState(false)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const selected = list.find((s) => s.id === selectedId) ?? null

  useEffect(() => {
    let live = true
    setPeaks([])
    setPeaksError(false)
    window.api.sources.waveform(project.id, asset.id, PEAKS).then(
      (p) => live && setPeaks(p),
      () => live && setPeaksError(true)
    )
    return () => {
      live = false
    }
  }, [project.id, asset.id])

  // A new aligner result or a deletion can drop the selected id.
  useEffect(() => {
    if (!selected && list.length > 0) setSelectedId(list[0].id)
  }, [selected, list])

  // While playing, the selection follows the audio.
  const { t: now, playing, seek, toggle, playRange } = audio
  useEffect(() => {
    if (!playing) return
    const at = segmentAt(list, now)
    if (at && at.id !== selectedId) setSelectedId(at.id)
  }, [now, playing, list, selectedId])

  const select = useCallback(
    (id: string) => {
      const s = list.find((x) => x.id === id)
      if (!s) return
      setSelectedId(id)
      if (!playing || now < s.startMs || now >= s.endMs) seek(s.startMs)
    },
    [list, playing, now, seek]
  )

  const commit = (next: Segment[], key?: string, selectId?: string) => {
    useProject.getState().update({ segments: sortSegments(next) }, key)
    if (selectId) setSelectedId(selectId)
  }

  const onEdge = (id: string, edge: Edge, ms: number) => {
    const r = setEdge(list, id, edge, ms, durationMs)
    if (r) commit(r.segments, `edge:${id}:${edge}`)
  }

  const addAtPlayhead = async () => {
    const at = Math.round(now)
    const inside = segmentAt(list, at)
    if (inside) {
      toast('info', t('Posisi pemutar ada di dalam segmen {label}. Silakan pindahkan pemutar ke bagian yang belum bersegmen.', { label: segmentLabel(inside) }))
      return
    }
    const nextStart = list.find((s) => s.startMs > at)?.startMs ?? durationMs
    const end = Math.min(nextStart, at + NEW_SEGMENT_MS)
    if (end - at < MIN_SEGMENT_MS) {
      toast('info', t('Ruang kosong di posisi pemutar terlalu sempit untuk segmen baru.'))
      return
    }
    if (project.dua) {
      const prevDua = [...list].reverse().find((s) => s.kind === 'dua' && s.endMs <= at)
      const items = project.dua.items
      const prevItem = prevDua ? items.find((x) => x.id === prevDua.duaId) : undefined
      let item = items[0]
      let wordFrom = 1
      if (prevDua && prevItem && prevDua.wordTo < prevItem.words.length) {
        item = prevItem
        wordFrom = prevDua.wordTo + 1
      } else if (prevDua) {
        const idx = items.findIndex((x) => x.id === prevDua.duaId)
        item = items[Math.min(items.length - 1, Math.max(0, idx + 1))] ?? items[0]
      }
      if (!item) return
      const seg: Segment = {
        id: newSegmentId(),
        kind: 'dua',
        duaId: item.id,
        surah: 0,
        ayah: 0,
        wordFrom: Math.min(wordFrom, item.words.length),
        wordTo: item.words.length,
        startMs: at,
        endMs: end,
        confidence: null,
        source: 'manual',
        words: [],
        translations: []
      }
      commit([...list, seg], undefined, seg.id)
      return
    }
    // Continue after the last ayah heard before this point: the rest of a partial ayah, else the next ayah.
    const prev = [...list].reverse().find((s) => s.kind === 'ayah' && s.endMs <= at)
    let surah = project.surah ?? 1
    let ayah = project.ayahFrom ?? 1
    let from = 1
    if (prev) {
      const count = verses[verseKey(prev.surah, prev.ayah)]?.words.length
      const ayahCount = surahs.find((s) => s.id === prev.surah)?.ayahCount ?? Infinity
      if (count && prev.wordTo < count) [surah, ayah, from] = [prev.surah, prev.ayah, prev.wordTo + 1]
      else if (prev.ayah < ayahCount) [surah, ayah] = [prev.surah, prev.ayah + 1]
      else [surah, ayah] = [Math.min(114, prev.surah + 1), 1]
    }
    try {
      const verse = verses[verseKey(surah, ayah)] ?? (await fetchVerse(surah, ayah, script))
      const to = verse?.words.length ?? from
      const seg = manualSegment({ surah, ayah, wordFrom: Math.min(from, to), wordTo: to, startMs: at, endMs: end, verse })
      commit([...list, seg], undefined, seg.id)
    } catch (e) {
      toast('error', errorText(e))
    }
  }

  const reviewCount = list.filter(needsReview).length
  const nextReview = () => {
    const i = list.findIndex((s) => s.id === selectedId)
    const order = [...list.slice(i + 1), ...list.slice(0, i + 1)]
    const s = order.find(needsReview)
    if (s) select(s.id)
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || isTypingTarget(e.target) || isModalOpen()) return
      if (e.target instanceof HTMLElement && e.target.closest('[role="radiogroup"]')) return
      if (e.key === ' ') {
        e.preventDefault()
        toggle()
      } else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        const i = list.findIndex((s) => s.id === selectedId)
        const s = list[e.key === 'ArrowLeft' ? Math.max(0, i - 1) : Math.min(list.length - 1, i + 1)]
        if (s) {
          e.preventDefault()
          select(s.id)
        }
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [list, selectedId, select, toggle])

  const arFont = useArabicFont(script, Object.keys(verses).length > 0)
  const stageWords = selected ? segmentWordTexts(selected, verseOf(selected, verses)) : []
  const current = selected && selected.kind !== 'dua' && now >= selected.startMs && now < selected.endMs ? wordAt(selected, now) : null
  const surahName =
    selected?.kind === 'dua'
      ? project.dua?.title
      : selected?.kind === 'ayah'
        ? surahs.find((s) => s.id === selected.surah)?.nameLatin
        : undefined

  return (
    <div className="st-body sync-body">
      <aside className="st-left" aria-label={t('Segmen')}>
        <div className="st-left__body">
          <AlignPanel />
          <div className="sync-summary">
            <h2 className="pn-h">{t('Segmen')}</h2>
            <span className="muted">
              {t('{n} segmen', { n: list.length })}
              {reviewCount > 0 ? ` · ${t('{n} perlu dicek', { n: reviewCount })}` : ''}
            </span>
          </div>
          <SegmentList segments={list} verses={verses} selectedId={selectedId} onSelect={select} />
        </div>
        <div className="st-left__foot">
          <button type="button" className="qr-btn qr-btn--secondary" disabled={reviewCount === 0} onClick={nextReview}>
            <Icon name="triangle-alert" />
            {t('Berikutnya yang perlu dicek')}
          </button>
          <button type="button" className="qr-btn qr-btn--primary" onClick={onNext}>
            {t('Lanjut ke Teks')}
            <Icon name="chevron-right" />
          </button>
        </div>
      </aside>

      <main className="sync-center">
        <div className="sync-stage">
          {selected ? (
            <>
              <p className="sync-stage__code">
                {surahName ? `${surahName} · ` : ''}
                {segmentLabel(selected, verseOf(selected, verses)?.words.length)}
              </p>
              {stageWords.length > 0 ? (
                <p className="sync-ayah" dir="rtl" lang="ar" style={{ fontFamily: arFont }}>
                  {stageWords
                    .filter((w) => w.text)
                    .map((w, i) => (
                      <Fragment key={w.idx}>
                        {/* A real space between spans: without it Arabic letters join across word boundaries. */}
                        {i > 0 && ' '}
                        <span className={w.idx === current ? 'is-current' : undefined}>{w.text}</span>
                      </Fragment>
                    ))}
                </p>
              ) : (
                <p className="muted">{t('Memuat teks ayat…')}</p>
              )}
            </>
          ) : (
            <p className="muted">{t('Pilih segmen untuk melihat teksnya.')}</p>
          )}
        </div>
        <div className="sync-transport qr-transport">
          <button type="button" className="qr-btn qr-btn--ghost qr-btn--icon" aria-label={t('Mundur 2 detik')} title={t('Mundur 2 detik')} onClick={() => seek(Math.max(0, now - 2000))}>
            <Icon name="skip-back" />
          </button>
          <button type="button" className="qr-btn qr-btn--secondary qr-btn--icon" aria-label={playing ? t('Jeda') : t('Putar')} title={t('Putar/jeda (Spasi)')} onClick={toggle}>
            <Icon name={playing ? 'pause' : 'play'} />
          </button>
          <button
            type="button"
            className="qr-btn qr-btn--ghost qr-btn--icon"
            aria-label={t('Maju 2 detik')}
            title={t('Maju 2 detik')}
            onClick={() => seek(Math.min(durationMs || Infinity, now + 2000))}
          >
            <Icon name="step-forward" />
          </button>
          <button type="button" className="qr-btn qr-btn--ghost" disabled={!selected} onClick={() => selected && playRange(selected.startMs, selected.endMs)}>
            <Icon name="play" />
            {t('Putar segmen')}
          </button>
          <span className="spacer" />
          <span className="muted sync-keys">{t('Spasi: putar/jeda · ←/→: segmen sebelum/berikutnya')}</span>
        </div>
        <SyncTimeline
          segments={list}
          verses={verses}
          durationMs={durationMs}
          peaks={peaks}
          peaksError={peaksError}
          now={now}
          playing={playing}
          selectedId={selectedId}
          onSelect={select}
          onSeek={seek}
          onEdge={onEdge}
        />
      </main>

      <aside className="st-insp" aria-label={t('Detail segmen')}>
        {selected ? (
          <SegmentInspector
            seg={selected}
            list={list}
            verses={verses}
            surahs={surahs}
            script={script}
            now={now}
            durationMs={durationMs}
            commit={commit}
            playRange={playRange}
            onAdd={() => void addAtPlayhead()}
          />
        ) : (
          <div className="insp-pad">
            <p className="insp-empty">{t('Belum ada segmen yang dipilih.')}</p>
            <button type="button" className="qr-btn qr-btn--secondary" onClick={() => void addAtPlayhead()}>
              <Icon name="plus" />
              {t('Tambah segmen di pemutar')}
            </button>
          </div>
        )}
      </aside>
    </div>
  )
}
