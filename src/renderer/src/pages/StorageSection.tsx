import { useCallback, useEffect, useMemo, useState } from 'react'
import { msg, t } from '@shared/i18n'
import type { AssetUse, CacheId, StorageAsset, StorageProject, StorageUsage } from '@shared/storage'
import { errorText, formatBytes } from '../lib/format'
import { confirmDialog, toast } from '../store/app'
import { useProject } from '../store/project'

const CACHES: { id: CacheId; title: string; note: string }[] = [
  { id: 'temp', title: msg('Berkas sementara'), note: msg('Sisa render dan unduhan yang tidak selesai. Aman dihapus.') },
  { id: 'render-parts', title: msg('Potongan render'), note: msg('Potongan render panjang yang belum selesai. Kalau dihapus, ekspor yang terputus harus mulai dari awal.') },
  { id: 'spectrum', title: msg('Data visualizer'), note: msg('Data gelombang suara untuk visualizer. Dibuat ulang otomatis saat dibutuhkan.') },
  { id: 'fonts', title: msg('Font Quran'), note: msg('Font Uthmani dan QPC dari Quran.com. Kalau dihapus, perlu internet untuk mengunduhnya lagi.') }
]

const USE_LABEL: Record<AssetUse, string> = {
  source: msg('Sumber audio'),
  background: msg('Latar'),
  overlay: msg('Overlay'),
  thumbnail: msg('Thumbnail')
}

const USE_RESULT: Record<AssetUse, string> = {
  source: msg('Proyek kehilangan audionya dan perlu diberi rekaman baru.'),
  background: msg('Latar kembali menjadi warna polos.'),
  overlay: msg('Overlay gambar ini dihapus.'),
  thumbnail: msg('Thumbnail kehilangan gambarnya.')
}

const KIND_LABEL = { audio: msg('Audio'), video: msg('Video'), image: msg('Gambar') } as const

/** Confirms, runs, and reports one destructive storage action; returns whether it ran. */
async function toastFreed(run: () => Promise<number>): Promise<boolean> {
  try {
    const freed = await run()
    toast('success', t('{size} dibebaskan.', { size: formatBytes(freed) }))
    return true
  } catch (e) {
    toast('error', errorText(e))
    return false
  }
}

export function StorageSection() {
  const [usage, setUsage] = useState<StorageUsage | null>(null)
  const [projects, setProjects] = useState<StorageProject[] | null>(null)
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [working, setWorking] = useState(false)

  const load = useCallback(async () => {
    // Main reads projects from the database: save an edit that is still waiting first.
    await useProject.getState().flush()
    try {
      const [u, p] = await Promise.all([window.api.storage.usage(), window.api.storage.assets()])
      setUsage(u)
      setProjects(p)
      // Keep only choices that still exist and are still unused.
      const free = new Set(p.flatMap((pr) => pr.assets.filter((a) => a.uses.length === 0).map((a) => `${pr.id}:${a.id}`)))
      setPicked((old) => new Set([...old].filter((k) => free.has(k))))
    } catch (e) {
      toast('error', errorText(e))
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const busy = usage?.busy ?? true
  const freeKeys = useMemo(() => (projects ?? []).flatMap((p) => p.assets.filter((a) => a.uses.length === 0).map((a) => `${p.id}:${a.id}`)), [projects])
  const allPicked = freeKeys.length > 0 && freeKeys.every((k) => picked.has(k))

  const act = async (run: () => Promise<number>) => {
    setWorking(true)
    await toastFreed(run)
    await load()
    setWorking(false)
  }

  const clearCaches = async (ids: CacheId[]) => {
    await act(() => window.api.storage.clear(ids))
  }

  const clearOne = async (id: CacheId) => {
    if (id === 'fonts') {
      const ok = await confirmDialog({
        title: t('Hapus font Quran?'),
        body: t('Font Uthmani dan QPC akan diunduh lagi dari Quran.com saat dibutuhkan, jadi perlu internet.'),
        confirmLabel: t('Bersihkan'),
        danger: true
      })
      if (!ok) return
    } else if (id === 'render-parts') {
      const ok = await confirmDialog({
        title: t('Hapus potongan render?'),
        body: t('Ekspor yang terputus tidak bisa dilanjutkan dan harus mulai dari awal.'),
        confirmLabel: t('Bersihkan'),
        danger: true
      })
      if (!ok) return
    }
    await clearCaches([id])
  }

  const clearAll = async () => {
    const ok = await confirmDialog({
      title: t('Bersihkan semua?'),
      body: t('Font Quran akan diunduh lagi dari Quran.com, jadi perlu internet. Ekspor yang terputus harus mulai dari awal. Berkas proyek tidak disentuh.'),
      confirmLabel: t('Bersihkan semua'),
      danger: true
    })
    if (ok) await clearCaches(CACHES.map((c) => c.id))
  }

  const deletePicked = async () => {
    const items = [...picked].map((k) => {
      const [projectId, assetId] = k.split(':')
      return { projectId, assetId }
    })
    if (items.length === 0) return
    const ok = await confirmDialog({
      title: t('Hapus berkas yang dipilih?'),
      body: t('{n} berkas akan dihapus dari komputer ini dan tidak bisa dikembalikan.', { n: items.length }),
      confirmLabel: t('Hapus'),
      danger: true
    })
    if (!ok) return
    await act(() => window.api.storage.deleteAssets(items))
  }

  const deleteUsed = async (project: StorageProject, asset: StorageAsset) => {
    const uses = [...new Set(asset.uses)]
    const ok = await confirmDialog({
      title: t('Hapus berkas yang sedang dipakai?'),
      body: `${t('“{name}” di proyek “{title}” masih dipakai.', { name: asset.name, title: project.title })} ${uses.map((u) => t(USE_RESULT[u])).join(' ')} ${t('Berkas dihapus dari komputer ini dan Urungkan tidak bisa mengembalikannya.')}`,
      confirmLabel: t('Hapus'),
      danger: true
    })
    if (!ok) return
    await act(() => window.api.storage.deleteAssets([{ projectId: project.id, assetId: asset.id }]))
  }

  const reveal = () => {
    if (usage) void window.api.exporter.reveal(usage.exportFolder).catch((e) => toast('error', errorText(e)))
  }

  const toggle = (key: string, on: boolean) =>
    setPicked((old) => {
      const next = new Set(old)
      if (on) next.add(key)
      else next.delete(key)
      return next
    })

  const disabled = busy || working
  const sizeOf = (id: CacheId) => usage?.entries.find((e) => e.id === id)

  return (
    <div className="stack">
      {usage?.busy && (
        <div className="st-note" role="status">
          <span className="qr-help">{t('Masih ada proses yang berjalan. Tunggu sampai selesai, lalu coba lagi.')}</span>
        </div>
      )}
      <div className="card-actions">
        <button type="button" className="qr-btn qr-btn--ghost qr-btn--sm" disabled={working} onClick={() => void load()}>
          {t('Periksa lagi')}
        </button>
      </div>

      <ul className="st-rows" aria-label={t('Data yang bisa dibersihkan')}>
        {CACHES.map((c) => {
          const e = sizeOf(c.id)
          return (
            <li key={c.id} className="st-row">
              <div className="st-row__text">
                <span className="st-row__title">{t(c.title)}</span>
                <span className="qr-help">{t(c.note)}</span>
              </div>
              <span className="st-row__size">{e ? formatBytes(e.bytes) : '…'}</span>
              <button
                type="button"
                className="qr-btn qr-btn--secondary qr-btn--sm"
                disabled={disabled || !e || e.files === 0}
                aria-label={`${t('Bersihkan')}: ${t(c.title)}`}
                onClick={() => void clearOne(c.id)}
              >
                {t('Bersihkan')}
              </button>
            </li>
          )
        })}
      </ul>
      <div className="card-actions">
        <button type="button" className="qr-btn qr-btn--secondary qr-btn--sm" disabled={disabled || !usage} onClick={() => void clearAll()}>
          {t('Bersihkan semua')}
        </button>
      </div>

      <ul className="st-rows" aria-label={t('Ruang yang dipakai')}>
        <li className="st-row">
          <div className="st-row__text">
            <span className="st-row__title">{t('Proyek dan rekaman')}</span>
            <span className="qr-help">{t('Rekaman, gambar, dan video milik proyekmu. Tidak dihapus dari sini kecuali kamu memilihnya di bawah.')}</span>
          </div>
          <span className="st-row__size">{usage ? formatBytes(usage.projectsBytes) : '…'}</span>
        </li>
        <li className="st-row">
          <div className="st-row__text">
            <span className="st-row__title">{t('Folder ekspor')}</span>
            <span className="qr-help st-path">{usage?.exportFolder ?? ''}</span>
          </div>
          <span className="st-row__size">{usage ? formatBytes(usage.exportBytes) : '…'}</span>
          <button type="button" className="qr-btn qr-btn--ghost qr-btn--sm" disabled={!usage} aria-label={t('Buka folder ekspor')} onClick={reveal}>
            {t('Buka folder')}
          </button>
        </li>
      </ul>

      <div className="st-sub">
        <h3 className="st-sub__title">{t('Berkas proyek yang tidak terpakai')}</h3>
        <span className="qr-help">{t('Berkas yang tidak dipakai proyeknya lagi, misalnya rekaman sebelum dipotong. Yang dihapus dari sini hilang dari komputer.')}</span>
      </div>

      {projects && projects.length === 0 && <span className="qr-help">{t('Belum ada berkas proyek.')}</span>}

      {freeKeys.length > 0 && (
        <div className="card-actions">
          <label className="qr-choice">
            <input
              type="checkbox"
              className="qr-check"
              checked={allPicked}
              disabled={disabled}
              onChange={(e) => setPicked(e.target.checked ? new Set(freeKeys) : new Set())}
            />
            {t('Pilih semua yang tidak terpakai')}
          </label>
          <button type="button" className="qr-btn qr-btn--danger qr-btn--sm" disabled={disabled || picked.size === 0} onClick={() => void deletePicked()}>
            {t('Hapus yang dipilih')}
          </button>
        </div>
      )}

      {(projects ?? []).map((p) => (
        <section key={p.id} className="st-proj" aria-label={p.title}>
          <div className="st-proj__head">
            <span className="st-row__title">{p.title}</span>
            <span className="st-row__size">{formatBytes(p.bytes)}</span>
          </div>
          <ul className="st-rows">
            {p.assets.map((a) => {
              const key = `${p.id}:${a.id}`
              const used = a.uses.length > 0
              return (
                <li key={a.id} className="st-row">
                  <div className="st-row__text">
                    {used ? (
                      <span className="st-row__title">{a.name}</span>
                    ) : (
                      <label className="qr-choice">
                        <input
                          type="checkbox"
                          className="qr-check"
                          checked={picked.has(key)}
                          disabled={disabled}
                          aria-label={t('Pilih {name}', { name: a.name })}
                          onChange={(e) => toggle(key, e.target.checked)}
                        />
                        <span className="st-row__title">{a.name}</span>
                      </label>
                    )}
                    <span className="st-meta">
                      <span className="qr-help">{t(KIND_LABEL[a.kind])}</span>
                      {[...new Set(a.uses)].map((u) => (
                        <span key={u} className="qr-badge qr-badge--warning">
                          {t(USE_LABEL[u])}
                        </span>
                      ))}
                    </span>
                  </div>
                  <span className="st-row__size">{formatBytes(a.bytes)}</span>
                  {used && (
                    <button
                      type="button"
                      className="qr-btn qr-btn--ghost qr-btn--sm"
                      disabled={disabled}
                      aria-label={t('Hapus {name}', { name: a.name })}
                      onClick={() => void deleteUsed(p, a)}
                    >
                      {t('Hapus…')}
                    </button>
                  )}
                </li>
              )
            })}
          </ul>
        </section>
      ))}
    </div>
  )
}
