import { useEffect, useMemo, useRef, useState } from 'react'
import { Player } from '@remotion/player'
import { Thumbnail } from '@video/Thumbnail'
import {
  THUMBNAIL_ACCENTS,
  THUMBNAIL_MAX_BYTES,
  THUMBNAIL_TITLE_MAX,
  defaultThumbnail,
  gridBands,
  thumbnailSize,
  type ThumbnailProps,
  type ThumbnailSpec
} from '@shared/thumbnail'
import { msg, t } from '@shared/i18n'
import { Icon, JobProgress, Segmented, Sheet } from '../../components/ui'
import { errorText, formatMs } from '../../lib/format'
import { useSurahs } from '../../lib/quran'
import { toast } from '../../store/app'
import { useActiveJob, useProject } from '../../store/project'
import { Slider } from './editor/controls'

const POSITIONS: { value: ThumbnailSpec['position']; label: string }[] = [
  { value: 'top', label: msg('Atas') },
  { value: 'center', label: msg('Tengah') },
  { value: 'bottom', label: msg('Bawah') }
]

/** Thumbnail / cover for Shorts, Reels and TikTok: a picture from the project plus words the app draws itself. */
export function ThumbnailDialog({ onClose }: { onClose: () => void }) {
  const project = useProject((s) => s.project!)
  const assets = useProject((s) => s.assets)
  const jobs = useProject((s) => s.jobs)
  const surahs = useSurahs()
  const job = useActiveJob('thumbnail')
  const surahName = surahs.find((s) => s.id === project.surah)?.nameLatin ?? null
  const spec = project.thumbnail ?? defaultThumbnail(project, surahName)
  const [guides, setGuides] = useState(true)
  const [frameMs, setFrameMs] = useState(0)
  const [frameFrom, setFrameFrom] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [saved, setSaved] = useState<{ spec: string; path: string } | null>(null)
  const pending = useRef<{ jobId: string; spec: string } | null>(null)

  const setSpec = (patch: Partial<ThumbnailSpec>, key?: string): void => useProject.getState().update({ thumbnail: { ...spec, ...patch } }, key)

  // The dialog can open before the surah list has arrived; the default title then lacks the name. Fill it once, unedited.
  useEffect(() => {
    if (!project.thumbnail && surahName) useProject.getState().applyPatch({ thumbnail: defaultThumbnail(project, surahName) })
    // Only when the name first becomes known.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [surahName])

  // Remember which version of the thumbnail a finished save holds, to tell "Tersimpan" from "Belum disimpan".
  useEffect(() => {
    const p = pending.current
    const j = p ? jobs[p.jobId] : undefined
    if (p && j?.status === 'done' && j.message) {
      setSaved({ spec: p.spec, path: j.message })
      pending.current = null
    }
  }, [jobs])

  const images = Object.values(assets)
    .filter((a) => a.kind === 'image')
    .sort((a, b) => b.createdAt - a.createdAt)
  const videos = Object.values(assets).filter((a) => a.kind === 'video' && (a.id === project.background.assetId || a.id === project.sourceAssetId))
  const frameVideo = videos.find((v) => v.id === frameFrom) ?? videos[0]
  const image = spec.assetId ? assets[spec.assetId] : undefined

  const size = thumbnailSize(project.aspect)
  const props: ThumbnailProps = useMemo(
    () => ({ spec, imageSrc: image?.url ?? null, color: project.background.color, ...size, fontBase: 'studio://fonts/' }),
    [spec, image?.url, project.background.color, size.width, size.height] // eslint-disable-line react-hooks/exhaustive-deps
  )
  const bands = gridBands(project.aspect)
  const specJson = JSON.stringify(spec)

  const save = async (saveAs: boolean) => {
    setBusy(true)
    try {
      await useProject.getState().flush()
      const j = await window.api.publish.thumbnail(project.id, saveAs)
      if (j) pending.current = { jobId: j.id, spec: specJson }
    } catch (e) {
      toast('error', errorText(e))
    } finally {
      setBusy(false)
    }
  }

  const takeFrame = async () => {
    if (!frameVideo) return
    setBusy(true)
    try {
      const a = await window.api.publish.frame(project.id, frameVideo.id, frameMs)
      setSpec({ assetId: a.id })
    } catch (e) {
      toast('error', errorText(e))
    } finally {
      setBusy(false)
    }
  }

  const importImage = async () => {
    try {
      const a = await window.api.sources.importMedia(project.id, 'image')
      if (a) setSpec({ assetId: a.id })
    } catch (e) {
      toast('error', errorText(e))
    }
  }

  const working = busy || !!job
  const status = job ? t('Menyimpan…') : saved && saved.spec === specJson ? t('Tersimpan di {file}', { file: saved.path.split('/').pop() ?? '' }) : t('Belum disimpan')

  return (
    <Sheet
      title={t('Thumbnail dan cover')}
      size="lg"
      onClose={onClose}
      footer={
        <>
          <span className="qr-sheet__note" role="status">
            {status}
          </span>
          <button type="button" className="qr-btn qr-btn--secondary" disabled={working} onClick={() => void save(true)}>
            <Icon name="download" />
            {t('Simpan salinan…')}
          </button>
          <button type="button" className="qr-btn qr-btn--primary" disabled={working} onClick={() => void save(false)}>
            <Icon name="save" />
            {t('Simpan thumbnail')}
          </button>
        </>
      }
    >
      <p className="qr-help">
        {t('{width}×{height} ({aspect}), JPG di bawah {mb} MB. Teksnya digambar oleh aplikasi, jadi hurufnya selalu benar. Gambar latar diambil dari proyekmu.', { width: size.width, height: size.height, aspect: project.aspect, mb: THUMBNAIL_MAX_BYTES / 1024 / 1024 })}
      </p>
      <JobProgress job={job} label={t('Menyimpan thumbnail')} />
      <div className="th-body">
        <div className="th-preview">
          <div className="th-frame" style={{ aspectRatio: `${size.width} / ${size.height}`, ['--ratio' as string]: size.width / size.height }}>
            <Player
              component={Thumbnail as never}
              inputProps={props as never}
              durationInFrames={1}
              compositionWidth={size.width}
              compositionHeight={size.height}
              fps={30}
              controls={false}
              acknowledgeRemotionLicense
              style={{ width: '100%', height: '100%' }}
            />
            {bands && guides && (
              <>
                <span className="th-guide" style={{ top: `${bands.top * 100}%` }} aria-hidden="true" />
                <span className="th-guide" style={{ bottom: `${bands.bottom * 100}%` }} aria-hidden="true" />
              </>
            )}
          </div>
          {bands && (
            <label className="qr-choice">
              <input type="checkbox" className="qr-check" checked={guides} onChange={(e) => setGuides(e.target.checked)} />
              <span>{t('Tampilkan batas grid profil Instagram')}</span>
            </label>
          )}
          {bands && <span className="qr-help">{t('Garis putus-putus: bagian yang tampil di grid profil Instagram. Tidak ikut tersimpan di berkas.')}</span>}
        </div>

        <div className="th-controls">
          <div className="qr-fieldset">
            <label className="qr-label" htmlFor="th-title">
              {t('Teks utama')}
            </label>
            <span className="qr-field">
              <input id="th-title" value={spec.title} maxLength={THUMBNAIL_TITLE_MAX} onChange={(e) => setSpec({ title: e.target.value }, 'thTitle')} />
            </span>
            <span className="qr-help">
              {t('{n}/{max} huruf · 2 sampai 4 kata paling terbaca. Kata terakhir diberi warna.', { n: spec.title.length, max: THUMBNAIL_TITLE_MAX })}
            </span>
          </div>
          <div className="qr-fieldset">
            <label className="qr-label" htmlFor="th-sub">
              {t('Teks kecil (opsional)')}
            </label>
            <span className="qr-field">
              <input id="th-sub" value={spec.subtitle} onChange={(e) => setSpec({ subtitle: e.target.value }, 'thSub')} />
            </span>
          </div>
          <div className="grid-2">
            <div className="qr-fieldset">
              <span className="qr-label" id="th-pos">
                {t('Posisi teks')}
              </span>
              <Segmented labelledBy="th-pos" value={spec.position} onChange={(position) => setSpec({ position })} options={POSITIONS.map((o) => ({ ...o, label: t(o.label) }))} />
            </div>
            <div className="qr-fieldset">
              <span className="qr-label" id="th-accent">
                {t('Warna aksen')}
              </span>
              <div className="th-swatches" role="group" aria-labelledby="th-accent">
                {THUMBNAIL_ACCENTS.map((c) => (
                  <button key={c} type="button" className="th-swatch" aria-label={t('Warna {color}', { color: c })} aria-pressed={spec.accent === c} style={{ background: c }} onClick={() => setSpec({ accent: c })} />
                ))}
                <input type="color" className="ed-color" aria-label={t('Warna aksen lain')} value={spec.accent} onChange={(e) => setSpec({ accent: e.target.value.toUpperCase() }, 'thAccent')} />
              </div>
            </div>
          </div>
          <Slider label={t('Gelap di belakang teks')} value={spec.dim} min={0} max={0.9} step={0.01} onChange={(dim) => setSpec({ dim }, 'thDim')} />

          <div className="qr-fieldset">
            <span className="qr-label" id="th-bg">
              {t('Gambar latar')}
            </span>
            <div className="th-bg" role="group" aria-labelledby="th-bg">
              <button type="button" className="th-bg__item" aria-pressed={spec.assetId === null} onClick={() => setSpec({ assetId: null })} title={t('Warna latar proyek')}>
                <span className="th-bg__none" style={{ background: project.background.color }} />
                <small>{t('Polos')}</small>
              </button>
              {images.map((a) => (
                <button key={a.id} type="button" className="th-bg__item" aria-pressed={spec.assetId === a.id} aria-label={a.name} title={a.name} onClick={() => setSpec({ assetId: a.id })}>
                  <img src={a.url} alt="" aria-hidden="true" />
                </button>
              ))}
              <button type="button" className="th-bg__item th-bg__add" onClick={() => void importImage()}>
                <Icon name="plus" />
                <small>{t('Impor')}</small>
              </button>
            </div>
          </div>

          {frameVideo && (
            <div className="qr-fieldset th-frame-pick">
              <span className="qr-label" id="th-vid">
                {t('Ambil bingkai dari video')}
              </span>
              {videos.length > 1 && (
                <Segmented
                  labelledBy="th-vid"
                  value={frameVideo.id}
                  onChange={(id) => {
                    setFrameFrom(id)
                    setFrameMs(0)
                  }}
                  options={videos.map((v) => ({ value: v.id, label: v.id === project.sourceAssetId ? t('Video sumber') : t('Video latar') }))}
                />
              )}
              <div className="ed-row">
                <input
                  type="range"
                  className="qr-slider"
                  aria-label={t('Posisi bingkai')}
                  min={0}
                  max={Math.max(1, (frameVideo.durationMs ?? 1000) - 100)}
                  step={100}
                  value={Math.min(frameMs, Math.max(1, (frameVideo.durationMs ?? 1000) - 100))}
                  style={{ ['--v' as string]: frameMs / Math.max(1, (frameVideo.durationMs ?? 1000) - 100) }}
                  onChange={(e) => setFrameMs(Number(e.target.value))}
                />
                <output className="ed-row__val">{formatMs(frameMs)}</output>
              </div>
              <div>
                <button type="button" className="qr-btn qr-btn--secondary qr-btn--sm" disabled={working} onClick={() => void takeFrame()}>
                  <Icon name="film" size="sm" />
                  {t('Jadikan latar thumbnail')}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </Sheet>
  )
}
