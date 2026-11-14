import { useEffect, useMemo, useState } from 'react'
import type { Asset, Project } from '@shared/types'
import { getLang } from '@shared/i18n'
import { canvasSize, type VideoProps } from '@shared/video'
import { useSurahs, useVerses } from './quran'

/** Props for the preview Player: the same object export builds, with files read over studio://. */
export function useVideoProps(project: Project, assets: Record<string, Asset>, fps: number): VideoProps {
  const hasBasmalah = project.segments.some((s) => s.kind === 'basmalah')
  const shown = hasBasmalah ? [...project.segments, { kind: 'ayah' as const, surah: 1, ayah: 1 }] : project.segments
  const verses = useVerses(shown, project.script)
  const surahs = useSurahs()
  const surah = surahs.find((s) => s.id === project.surah) ?? null

  const bgId = project.background.assetId
  const ids = [project.sourceAssetId, bgId, ...project.overlays.map((o) => o.assetId)].filter((x): x is string => !!x)
  const idsKey = ids.join('|')
  const used = useMemo(() => {
    const out: Record<string, Asset> = {}
    for (const id of ids) if (assets[id]) out[id] = assets[id]
    return out
    // `idsKey` captures `ids`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idsKey, assets])

  const source = project.sourceAssetId ? assets[project.sourceAssetId] : undefined
  const lastEnd = project.segments.reduce((m, s) => Math.max(m, s.endMs), 0)
  const durationMs = Math.max(source?.durationMs ?? lastEnd, 1000)
  const { width, height } = canvasSize(project.aspect, 1080)
  const lang = getLang()

  // The visualizer draws from a loudness table main makes once per source; fetched only when an overlay needs it.
  const wantsSpectrum = project.overlays.some((o) => o.kind === 'visualizer') && !!project.sourceAssetId
  const [spectrumPath, setSpectrumPath] = useState<{ source: string; path: string } | null>(null)
  useEffect(() => {
    const sourceId = project.sourceAssetId
    if (!wantsSpectrum || !sourceId) return
    let live = true
    void window.api.sources.spectrum(project.id, sourceId).then(
      (path) => live && setSpectrumPath({ source: sourceId, path }),
      () => undefined
    )
    return () => {
      live = false
    }
  }, [wantsSpectrum, project.id, project.sourceAssetId])
  // How loud the reciter is compared with the chosen sound is measured once in main; the slider then only changes a number here.
  const ambientId = project.ambient?.id ?? null
  const [ambientOffset, setAmbientOffset] = useState<{ key: string; db: number } | null>(null)
  const ambientKey = ambientId && project.sourceAssetId ? `${project.sourceAssetId}:${ambientId}` : null
  useEffect(() => {
    if (!ambientId || !ambientKey) return
    let live = true
    void window.api.sources.ambientOffset(project.id, ambientId).then(
      (db) => live && setAmbientOffset({ key: ambientKey, db }),
      () => undefined
    )
    return () => {
      live = false
    }
  }, [ambientId, ambientKey, project.id])
  const ambientOffsetDb = ambientKey && ambientOffset?.key === ambientKey ? ambientOffset.db : null
  const spectrumUrl =
    wantsSpectrum && spectrumPath?.source === project.sourceAssetId
      ? `studio://asset/${encodeURIComponent(project.id)}/${spectrumPath.path.split('/').map(encodeURIComponent).join('/')}`
      : null

  return useMemo(
    () => ({
      project,
      assets: used,
      verses,
      surah,
      width,
      height,
      fps,
      durationMs,
      lang,
      spectrumUrl,
      ambientOffsetDb,
      baseUrl: { asset: 'studio://asset/', font: 'studio://fonts/' }
    }),
    [project, used, verses, surah, width, height, fps, durationMs, lang, spectrumUrl, ambientOffsetDb]
  )
}
