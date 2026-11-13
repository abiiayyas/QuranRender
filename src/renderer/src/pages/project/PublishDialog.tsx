import { useEffect, useId, useMemo, useState } from 'react'
import { PLATFORMS, draftFor, kitAsText, pastedText, platformOf, type PlatformId, type PublishDraft, type PublishFacts } from '@shared/publish'
import { youtubeChapters } from '@shared/subtitles'
import { msg, t } from '@shared/i18n'
import { Icon, Segmented, Sheet } from '../../components/ui'
import { errorText } from '../../lib/format'
import { toast } from '../../store/app'
import { useProject } from '../../store/project'

// Marks the PLATFORMS hints (shared, Indonesian) so they are translated where shown.
msg('Judul pendek dan deskripsi untuk video vertikal.')
msg('Satu keterangan pendek dengan beberapa hashtag.')
msg('Satu keterangan untuk Reels Facebook dan Instagram.')
msg('Judul, deskripsi, hashtag, dan bab untuk video panjang.')

async function copy(text: string, what: string): Promise<void> {
  try {
    await window.api.app.copyText(text)
    toast('success', t('{what} disalin.', { what }))
  } catch (e) {
    toast('error', errorText(e))
  }
}

function CopyButton({ text, what }: { text: string; what: string }) {
  return (
    <button type="button" className="qr-btn qr-btn--ghost qr-btn--sm" aria-label={t('Salin {what}', { what: what.toLowerCase() })} disabled={!text.trim()} onClick={() => void copy(text, what)}>
      <Icon name="copy" size="sm" />
      {t('Salin')}
    </button>
  )
}

function Count({ n, max }: { n: number; max: number }) {
  return (
    <span className={n > max ? 'pub-count is-over' : 'pub-count'} aria-label={t('{n} dari {max} karakter', { n, max })}>
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
      const ai = await window.api.settings.aiReady()
      if (!ai.ready) {
        toast('error', t('{hint} Silakan atur di Pengaturan.', { hint: ai.hint || t('AI belum siap.') }))
        return
      }
      if (ai.via === 'cli') toast('info', t('AI CLI sedang menulis; ini bisa memakan waktu sekitar satu menit.'))
      await useProject.getState().flush()
      const kit = await window.api.publish.generate(project.id, which)
      useProject.getState().update({ publish: { ...project.publish, ...kit } })
      toast('success', which.length === 1 ? t('Draf {label} diperbarui.', { label: platformOf(which[0]).label }) : t('Draf semua platform diperbarui.'))
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
      if (path) toast('success', t('Teks publikasi disimpan.'), { label: t('Buka folder'), run: () => void window.api.exporter.reveal(path) })
    } catch (e) {
      toast('error', errorText(e))
    }
  }

  return (
    <Sheet
      title={t('Publikasi')}
      size="lg"
      onClose={onClose}
      footer={
        <>
          <button type="button" className="qr-btn qr-btn--secondary" disabled={!facts} onClick={() => void saveAll()}>
            <Icon name="download" />
            {t('Simpan semua (.txt)…')}
          </button>
          <button type="button" className="qr-btn qr-btn--primary" disabled={!facts} onClick={() => void copy(ready, t('Deskripsi {label}', { label: p.label }))}>
            <Icon name="copy" />
            {p.hasTitle ? t('Salin deskripsi {label}', { label: p.label }) : t('Salin keterangan {label}', { label: p.label })}
          </button>
        </>
      }
    >
      <p className="qr-help">{t('Judul, deskripsi, hashtag, dan bab untuk mengunggah video. Ditulis dari data proyekmu (surah, qari, terjemahan), dan bisa kamu ubah.')}</p>
      <div className="pub-bar">
        <Segmented<PlatformId> ariaLabel={t('Platform')} value={platform} onChange={setPlatform} options={PLATFORMS.map((x) => ({ value: x.id, label: x.label }))} />
        <button type="button" className="qr-btn qr-btn--secondary" disabled={!facts || busy !== null} onClick={() => void generate(PLATFORMS.map((x) => x.id))}>
          <Icon name="settings-2" />
          {busy === 'all' ? t('Menulis…') : t('Tulis dengan AI untuk semua')}
        </button>
      </div>
      <p className="qr-help">{t(p.hint)}</p>

      {!facts ? (
        <p className="muted" role="status">
          {t('Menyiapkan draf…')}
        </p>
      ) : (
        <div className="pub-form">
          {p.hasTitle && (
            <div className="qr-fieldset">
              <div className="pub-head">
                <label className="qr-label" htmlFor={ids.title}>
                  {t('Judul')}
                </label>
                <Count n={draft.title.length} max={p.titleMax} />
                <CopyButton text={draft.title} what={t('Judul')} />
              </div>
              <span className="qr-field">
                <input id={ids.title} value={draft.title} onChange={(e) => edit({ title: e.target.value }, 'title')} />
              </span>
            </div>
          )}
          <div className="qr-fieldset">
            <div className="pub-head">
              <label className="qr-label" htmlFor={ids.body}>
                {p.hasTitle ? t('Isi deskripsi') : t('Isi keterangan')}
              </label>
              <CopyButton text={draft.body} what={t('Isi')} />
            </div>
            <span className="qr-field pub-area">
              <textarea id={ids.body} rows={4} value={draft.body} onChange={(e) => edit({ body: e.target.value }, 'body')} />
            </span>
          </div>
          <div className="qr-fieldset">
            <div className="pub-head">
              <label className="qr-label" htmlFor={ids.tags}>
                {t('Hashtag')}
              </label>
              {p.autoTag && <span className="qr-help">{t('{tag} ditambahkan otomatis', { tag: p.autoTag })}</span>}
              <CopyButton text={draft.hashtags} what={t('Hashtag')} />
            </div>
            <span className="qr-field pub-area">
              <textarea id={ids.tags} rows={2} value={draft.hashtags} onChange={(e) => edit({ hashtags: e.target.value }, 'tags')} />
            </span>
          </div>
          {platform === 'youtube' && (
            <div className="qr-fieldset">
              <span className="qr-label">{t('Bab YouTube')}</span>
              {chapters.length >= 3 ? (
                <pre className="pub-chapters">{chapters.join('\n')}</pre>
              ) : (
                <span className="qr-help">{t('Bab baru muncul di pemutar bila ada minimal tiga bab, dan yang pertama dimulai pada 0:00. Video ini belum memenuhinya.')}</span>
              )}
            </div>
          )}
          <div className="qr-fieldset">
            <div className="pub-head">
              <label className="qr-label" htmlFor={ids.ready}>
                {p.hasTitle ? t('Deskripsi siap tempel') : t('Keterangan siap tempel')}
              </label>
              <span className="qr-help">{platform === 'youtube' && chapters.length >= 3 ? t('isi + bab + hashtag') : t('isi + hashtag')}</span>
              <Count n={ready.length} max={p.textMax} />
              <CopyButton text={ready} what={t('Teks siap tempel')} />
            </div>
            <span className="qr-field pub-area">
              <textarea id={ids.ready} rows={5} readOnly value={ready} />
            </span>
          </div>
          <div className="pub-actions">
            <button type="button" className="qr-btn qr-btn--secondary qr-btn--sm" disabled={busy !== null} onClick={() => void generate([platform])}>
              <Icon name="settings-2" size="sm" />
              {busy === platform ? t('Menulis…') : t('Tulis ulang {label} dengan AI', { label: p.label })}
            </button>
            <button type="button" className="qr-btn qr-btn--ghost qr-btn--sm" onClick={resetDraft}>
              <Icon name="rotate-ccw" size="sm" />
              {t('Kembalikan draf awal')}
            </button>
          </div>
          <p className="qr-help">{t('AI hanya diminta merapikan kalimat dari fakta di atas; ia tidak menulis atau mengutip teks Arab. Periksa hak pakai rekaman sebelum mengunggah.')}</p>
        </div>
      )}
    </Sheet>
  )
}
