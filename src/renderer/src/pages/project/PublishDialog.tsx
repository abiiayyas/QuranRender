import { useEffect, useId, useMemo, useState } from 'react'
import { PLATFORMS, draftFor, kitAsText, pastedText, platformOf, type PlatformId, type PublishDraft, type PublishFacts } from '@shared/publish'
import { youtubeChapters } from '@shared/subtitles'
import { Icon, Segmented, Sheet } from '../../components/ui'
import { errorText } from '../../lib/format'
import { toast } from '../../store/app'
import { useProject } from '../../store/project'

async function copy(text: string, what: string): Promise<void> {
  try {
    await window.api.app.copyText(text)
    toast('success', `${what} disalin.`)
  } catch (e) {
    toast('error', errorText(e))
  }
}

function CopyButton({ text, what }: { text: string; what: string }) {
  return (
    <button type="button" className="qr-btn qr-btn--ghost qr-btn--sm" aria-label={`Salin ${what.toLowerCase()}`} disabled={!text.trim()} onClick={() => void copy(text, what)}>
      <Icon name="copy" size="sm" />
      Salin
    </button>
  )
}

function Count({ n, max }: { n: number; max: number }) {
  return (
    <span className={n > max ? 'pub-count is-over' : 'pub-count'} aria-label={`${n} dari ${max} karakter`}>
      {n}/{max}
    </span>
  )
}

/** Title, description, hashtags, and chapters for each platform, written from the project's facts and editable. */
export function PublishDialog({ onClose }: { onClose: () => void }) {
  const project = useProject((s) => s.project!)
  const assets = useProject((s) => s.assets)
  const ids = { title: useId(), body: useId(), tags: useId(), ready: useId() }
  const [platform, setPlatform] = useState<PlatformId>('shorts')
  const [facts, setFacts] = useState<PublishFacts | null>(null)
  const [busy, setBusy] = useState<PlatformId | 'all' | null>(null)

  useEffect(() => {
    void useProject
      .getState()
      .flush()
      .then(() => window.api.publish.facts(project.id))
      .then(setFacts, (e) => toast('error', errorText(e)))
    // Facts are read once per opening: they come from steps the dialog does not edit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const p = platformOf(platform)
  const durationMs = (project.sourceAssetId ? assets[project.sourceAssetId]?.durationMs : null) ?? undefined
  const chapters = useMemo(() => (facts ? youtubeChapters(project, facts.surahName, durationMs) : []), [project, facts, durationMs])
  const draftOf = (id: PlatformId): PublishDraft => project.publish?.[id] ?? (facts ? draftFor(id, facts) : { title: '', body: '', hashtags: '' })
  const draft = draftOf(platform)
  const ready = pastedText(platform, draft, chapters)

  const edit = (patch: Partial<PublishDraft>, key: string): void => useProject.getState().update({ publish: { ...project.publish, [platform]: { ...draft, ...patch } } }, `pub:${platform}:${key}`)

  const generate = async (which: PlatformId[]) => {
    setBusy(which.length === 1 ? which[0] : 'all')
    try {
      await useProject.getState().flush()
      const kit = await window.api.publish.generate(project.id, which)
      useProject.getState().update({ publish: { ...project.publish, ...kit } })
      toast('success', which.length === 1 ? `Draf ${platformOf(which[0]).label} diperbarui.` : 'Draf semua platform diperbarui.')
    } catch (e) {
      toast('error', errorText(e))
    } finally {
      setBusy(null)
    }
  }

  const resetDraft = () => {
    if (!facts) return
    useProject.getState().update({ publish: { ...project.publish, [platform]: draftFor(platform, facts) } })
  }

  const saveAll = async () => {
    if (!facts) return
    const kit = Object.fromEntries(PLATFORMS.map((x) => [x.id, draftOf(x.id)]))
    try {
      const path = await window.api.publish.saveText(`${project.title} - publikasi.txt`, kitAsText(kit, (id) => (id === 'youtube' ? chapters : [])))
      if (path) toast('success', 'Teks publikasi disimpan.', { label: 'Buka folder', run: () => void window.api.exporter.reveal(path) })
    } catch (e) {
      toast('error', errorText(e))
    }
  }

  return (
    <Sheet
      title="Publikasi"
      size="lg"
      onClose={onClose}
      footer={
        <>
          <button type="button" className="qr-btn qr-btn--secondary" disabled={!facts} onClick={() => void saveAll()}>
            <Icon name="download" />
            Simpan semua (.txt)…
          </button>
          <button type="button" className="qr-btn qr-btn--primary" disabled={!facts} onClick={() => void copy(ready, `Deskripsi ${p.label}`)}>
            <Icon name="copy" />
            Salin {p.hasTitle ? 'deskripsi' : 'keterangan'} {p.label}
          </button>
        </>
      }
    >
      <p className="qr-help">Judul, deskripsi, hashtag, dan bab untuk mengunggah video. Ditulis dari data proyekmu (surah, qari, terjemahan), dan bisa kamu ubah.</p>
      <div className="pub-bar">
        <Segmented<PlatformId> ariaLabel="Platform" value={platform} onChange={setPlatform} options={PLATFORMS.map((x) => ({ value: x.id, label: x.label }))} />
        <button type="button" className="qr-btn qr-btn--secondary" disabled={!facts || busy !== null} onClick={() => void generate(PLATFORMS.map((x) => x.id))}>
          <Icon name="settings-2" />
          {busy === 'all' ? 'Menulis…' : 'Tulis dengan AI untuk semua'}
        </button>
      </div>
      <p className="qr-help">{p.hint}</p>

      {!facts ? (
        <p className="muted" role="status">
          Menyiapkan draf…
        </p>
      ) : (
        <div className="pub-form">
          {p.hasTitle && (
            <div className="qr-fieldset">
              <div className="pub-head">
                <label className="qr-label" htmlFor={ids.title}>
                  Judul
                </label>
                <Count n={draft.title.length} max={p.titleMax} />
                <CopyButton text={draft.title} what="Judul" />
              </div>
              <span className="qr-field">
                <input id={ids.title} value={draft.title} onChange={(e) => edit({ title: e.target.value }, 'title')} />
              </span>
            </div>
          )}
          <div className="qr-fieldset">
            <div className="pub-head">
              <label className="qr-label" htmlFor={ids.body}>
                {p.hasTitle ? 'Isi deskripsi' : 'Isi keterangan'}
              </label>
              <CopyButton text={draft.body} what="Isi" />
            </div>
            <span className="qr-field pub-area">
              <textarea id={ids.body} rows={4} value={draft.body} onChange={(e) => edit({ body: e.target.value }, 'body')} />
            </span>
          </div>
          <div className="qr-fieldset">
            <div className="pub-head">
              <label className="qr-label" htmlFor={ids.tags}>
                Hashtag
              </label>
              {p.autoTag && <span className="qr-help">{p.autoTag} ditambahkan otomatis</span>}
              <CopyButton text={draft.hashtags} what="Hashtag" />
            </div>
            <span className="qr-field pub-area">
              <textarea id={ids.tags} rows={2} value={draft.hashtags} onChange={(e) => edit({ hashtags: e.target.value }, 'tags')} />
            </span>
          </div>
          {platform === 'youtube' && (
            <div className="qr-fieldset">
              <span className="qr-label">Bab YouTube</span>
              {chapters.length >= 3 ? (
                <pre className="pub-chapters">{chapters.join('\n')}</pre>
              ) : (
                <span className="qr-help">Bab baru muncul di pemutar bila ada minimal tiga bab, dan yang pertama dimulai pada 0:00. Video ini belum memenuhinya.</span>
              )}
            </div>
          )}
          <div className="qr-fieldset">
            <div className="pub-head">
              <label className="qr-label" htmlFor={ids.ready}>
                {p.hasTitle ? 'Deskripsi siap tempel' : 'Keterangan siap tempel'}
              </label>
              <span className="qr-help">isi{platform === 'youtube' && chapters.length >= 3 ? ' + bab' : ''} + hashtag</span>
              <Count n={ready.length} max={p.textMax} />
              <CopyButton text={ready} what="Teks siap tempel" />
            </div>
            <span className="qr-field pub-area">
              <textarea id={ids.ready} rows={5} readOnly value={ready} />
            </span>
          </div>
          <div className="pub-actions">
            <button type="button" className="qr-btn qr-btn--secondary qr-btn--sm" disabled={busy !== null} onClick={() => void generate([platform])}>
              <Icon name="settings-2" size="sm" />
              {busy === platform ? 'Menulis…' : `Tulis ulang ${p.label} dengan AI`}
            </button>
            <button type="button" className="qr-btn qr-btn--ghost qr-btn--sm" onClick={resetDraft}>
              <Icon name="rotate-ccw" size="sm" />
              Kembalikan draf awal
            </button>
          </div>
          <p className="qr-help">AI hanya diminta merapikan kalimat dari fakta di atas; ia tidak menulis atau mengutip teks Arab. Periksa hak pakai rekaman sebelum mengunggah.</p>
        </div>
      )}
    </Sheet>
  )
}
