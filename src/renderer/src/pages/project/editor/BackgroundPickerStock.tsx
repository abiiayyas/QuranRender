import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { STOCK_PROVIDERS, type StockItem, type StockKind, type StockOrientation, type StockProvider } from '@shared/stock'
import { stockCredit } from '@shared/stockParse'
import type { Asset, KeyStatus } from '@shared/types'
import { ErrorAlert, Icon, Segmented } from '../../../components/ui'
import { errorText } from '../../../lib/format'
import { confirmDialog, toast } from '../../../store/app'
import { useProject } from '../../../store/project'

const SUGGESTIONS = ['Langit malam', 'Hutan berkabut', 'Masjid', 'Gurun', 'Laut tenang', 'Gunung', 'Hujan', 'Senja']

const ORIENTATIONS: { value: StockOrientation; label: string }[] = [
  { value: 'portrait', label: 'Tegak' },
  { value: 'landscape', label: 'Mendatar' },
  { value: 'square', label: 'Persegi' }
]

const ORIENTATION_OF_ASPECT = { '9:16': 'portrait', '16:9': 'landscape', '1:1': 'square' } as const

const clock = (sec: number): string => `${Math.floor(sec / 60)}:${String(Math.round(sec % 60)).padStart(2, '0')}`

function openLink(url: string): void {
  window.api.app.openExternal(url).catch((e: unknown) => toast('error', errorText(e)))
}

/** First run for a provider: explains the free key and takes it. */
function KeyForm({ provider, onSaved }: { provider: StockProvider; onSaved: (s: KeyStatus) => void }) {
  const info = STOCK_PROVIDERS.find((p) => p.id === provider)!
  const inputId = useId()
  const [key, setKey] = useState('')
  const [busy, setBusy] = useState(false)

  const save = async () => {
    setBusy(true)
    try {
      onSaved(await window.api.stock.setKey(provider, key))
      setKey('')
    } catch (e) {
      toast('error', errorText(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <form
      className="bp-key"
      onSubmit={(e) => {
        e.preventDefault()
        void save()
      }}
    >
      <div className="qr-alert qr-alert--info">
        <Icon name="key-round" />
        <div className="qr-alert__content">
          <span className="qr-alert__title">Perlu kunci {info.label} (gratis)</span>
          <span className="qr-alert__body">
            {info.label} memberi kunci API tanpa biaya. Silakan buat akun di situsnya, salin kuncinya, lalu tempel di bawah. Kunci disimpan terenkripsi di komputer ini dan hanya dipakai untuk mencari dan mengunduh.
          </span>
        </div>
        <span className="qr-alert__actions">
          <button type="button" className="qr-btn qr-btn--secondary qr-btn--sm" onClick={() => openLink(info.keyUrl)}>
            <Icon name="external-link" size="sm" />
            Buka halaman kunci {info.label}
          </button>
        </span>
      </div>
      <div className="qr-fieldset">
        <label className="qr-label" htmlFor={inputId}>
          Kunci API {info.label}
        </label>
        <div className="bp-key__row">
          <div className="qr-field">
            <input id={inputId} type="password" autoComplete="off" spellCheck={false} placeholder="Tempel kunci di sini" value={key} onChange={(e) => setKey(e.target.value)} />
          </div>
          <button type="submit" className="qr-btn qr-btn--primary" disabled={busy || !key.trim()}>
            {busy ? 'Menyimpan…' : 'Simpan'}
          </button>
        </div>
        <span className="qr-help">{info.creditNote}</span>
      </div>
    </form>
  )
}

function ResultCard({ item, busy, disabled, onUse }: { item: StockItem; busy: boolean; disabled: boolean; onUse: () => void }) {
  const credit = stockCredit(item)
  return (
    <li className="bp-card">
      <div className="bp-card__thumb">
        <img src={item.thumbUrl} alt="" aria-hidden="true" loading="lazy" decoding="async" />
        {item.durationSec != null && <span className="bp-card__dur">{clock(item.durationSec)}</span>}
      </div>
      <div className="bp-card__body">
        {item.authorUrl ? (
          <button type="button" className="bp-link" title="Buka profil di situs penyedia" onClick={() => openLink(item.authorUrl)}>
            {credit}
          </button>
        ) : (
          <span className="bp-credit">{credit}</span>
        )}
        <button type="button" className="qr-btn qr-btn--secondary qr-btn--sm" disabled={disabled} aria-label={`Gunakan ${credit} sebagai latar`} onClick={onUse}>
          {busy ? 'Mengunduh…' : 'Gunakan sebagai latar'}
        </button>
      </div>
    </li>
  )
}

/** Search Pexels, Unsplash, and Pixabay; a pick is downloaded into the project and handed to `onUse`. */
export function StockTab({ onUse }: { onUse: (asset: Asset) => void }) {
  const project = useProject((s) => s.project!)
  const searchId = useId()
  const [keys, setKeys] = useState<Record<StockProvider, KeyStatus> | null>(null)
  const [provider, setProvider] = useState<StockProvider>('pexels')
  const [kind, setKind] = useState<StockKind>('photo')
  const [orientation, setOrientation] = useState<StockOrientation>(ORIENTATION_OF_ASPECT[project.aspect])
  const [text, setText] = useState('')
  const [searched, setSearched] = useState('')
  const [items, setItems] = useState<StockItem[]>([])
  const [page, setPage] = useState(1)
  const [hasMore, setHasMore] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  // A slow answer for an older search must not overwrite a newer one.
  const ticket = useRef(0)

  const info = STOCK_PROVIDERS.find((p) => p.id === provider)!
  const hasKey = keys ? keys[provider].configured : null

  useEffect(() => {
    window.api.stock.keys().then(setKeys, (e: unknown) => toast('error', errorText(e)))
  }, [])

  const run = useCallback(
    async (query: string, pageNo: number, p: StockProvider, k: StockKind, o: StockOrientation) => {
      const mine = ++ticket.current
      setLoading(true)
      setError(null)
      if (pageNo === 1) setItems([])
      try {
        const res = await window.api.stock.search({ provider: p, kind: k, query, orientation: o, page: pageNo })
        if (mine !== ticket.current) return
        setItems((cur) => (pageNo === 1 ? res.items : [...cur, ...res.items.filter((n) => !cur.some((c) => c.id === n.id))]))
        setPage(pageNo)
        setHasMore(res.hasMore)
      } catch (e) {
        if (mine === ticket.current) setError(errorText(e))
      } finally {
        if (mine === ticket.current) setLoading(false)
      }
    },
    []
  )

  // Changing provider, kind, or orientation repeats the current search instead of leaving stale results.
  const first = useRef(true)
  useEffect(() => {
    if (first.current) {
      first.current = false
      return
    }
    if (searched && hasKey) void run(searched, 1, provider, kind, orientation)
    // `searched` and `hasKey` are read at change time on purpose; a new search goes through `submit`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [provider, kind, orientation])

  const submit = (q: string) => {
    const query = q.trim()
    if (!query) return
    setText(query)
    setSearched(query)
    void run(query, 1, provider, kind, orientation)
  }

  const pickProvider = (p: StockProvider) => {
    ticket.current++
    setProvider(p)
    setItems([])
    setHasMore(false)
    setLoading(false)
    setError(null)
  }

  const keySaved = (s: KeyStatus) => {
    setKeys((k) => (k ? { ...k, [provider]: s } : k))
    if (searched) void run(searched, 1, provider, kind, orientation)
  }

  const use = async (item: StockItem) => {
    setBusyId(item.id)
    try {
      onUse(await window.api.stock.download(project.id, item))
    } catch (e) {
      toast('error', errorText(e))
    } finally {
      setBusyId(null)
    }
  }

  const removeKey = async () => {
    const ok = await confirmDialog({
      title: `Hapus kunci ${info.label}?`,
      body: 'Kunci dihapus dari komputer ini. Latar yang sudah diunduh tetap ada di proyek. Anda bisa memasukkan kunci lagi kapan saja.',
      confirmLabel: 'Hapus kunci',
      danger: true
    })
    if (!ok) return
    try {
      const status = await window.api.stock.clearKey(provider)
      setKeys((k) => (k ? { ...k, [provider]: status } : k))
      ticket.current++
      setItems([])
      setSearched('')
      setLoading(false)
      toast('success', `Kunci ${info.label} dihapus.`)
    } catch (e) {
      toast('error', errorText(e))
    }
  }

  return (
    <div className="bp-pane">
      <div className="bp-bar">
        <Segmented<StockProvider>
          ariaLabel="Penyedia foto"
          value={provider}
          onChange={pickProvider}
          options={STOCK_PROVIDERS.map((p) => ({
            value: p.id,
            label: p.label,
            disabled: !p.kinds.includes(kind),
            title: p.kinds.includes(kind) ? undefined : `${p.label} hanya menyediakan foto`
          }))}
        />
        <Segmented<StockKind>
          ariaLabel="Foto atau video"
          value={kind}
          onChange={setKind}
          options={[
            { value: 'photo', label: 'Foto' },
            { value: 'video', label: 'Video', disabled: !info.kinds.includes('video'), title: info.kinds.includes('video') ? undefined : `${info.label} hanya menyediakan foto` }
          ]}
        />
        <Segmented<StockOrientation> ariaLabel="Orientasi" value={orientation} onChange={setOrientation} options={ORIENTATIONS} />
      </div>

      {hasKey === false && <KeyForm provider={provider} onSaved={keySaved} />}

      {hasKey && (
        <>
          <form
            className="bp-search"
            role="search"
            onSubmit={(e) => {
              e.preventDefault()
              submit(text)
            }}
          >
            <label className="sr-only" htmlFor={searchId}>
              Kata kunci
            </label>
            <div className="qr-field">
              <Icon name="search" size="sm" />
              <input id={searchId} type="search" placeholder="Cari, misalnya: langit malam" value={text} onChange={(e) => setText(e.target.value)} />
            </div>
            <button type="submit" className="qr-btn qr-btn--primary" disabled={loading || !text.trim()}>
              Cari
            </button>
          </form>
          <div className="bp-chips" role="group" aria-label="Saran kata kunci">
            {SUGGESTIONS.map((s) => (
              <button key={s} type="button" className="qr-btn qr-btn--ghost qr-btn--sm" onClick={() => submit(s)}>
                {s}
              </button>
            ))}
          </div>

          {error && <ErrorAlert title="Pencarian belum berhasil" message={error} onClose={() => setError(null)} />}

          {!searched && !error && <p className="qr-help">Silakan ketik kata kunci atau pilih salah satu saran di atas. Kata Indonesia seperti “masjid” atau “senja” ikut dicari dalam bahasa Inggris.</p>}
          {searched && !loading && !error && items.length === 0 && <p className="qr-help">Belum ada hasil untuk “{searched}”. Silakan coba kata lain, atau ganti orientasi.</p>}

          {items.length > 0 && (
            <ul className="bp-grid" aria-label="Hasil pencarian">
              {items.map((item) => (
                <ResultCard key={`${item.provider}:${item.id}`} item={item} busy={busyId === item.id} disabled={busyId !== null} onUse={() => void use(item)} />
              ))}
            </ul>
          )}
          {loading && (
            <p className="qr-help" role="status">
              Mencari…
            </p>
          )}
          {hasMore && !loading && (
            <div>
              <button type="button" className="qr-btn qr-btn--secondary" onClick={() => void run(searched, page + 1, provider, kind, orientation)}>
                Muat lebih banyak
              </button>
            </div>
          )}

          <p className="bp-foot qr-help">
            {info.creditNote}
            <button type="button" className="bp-link" onClick={() => void removeKey()}>
              Hapus kunci {info.label}
            </button>
          </p>
        </>
      )}
    </div>
  )
}
