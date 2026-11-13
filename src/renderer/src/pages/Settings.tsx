import { useEffect, useState } from 'react'
import { CLAUDE_MODEL_ALIASES, CLI_IMAGE_TOOLS, CLI_TOOLS } from '@shared/aiTools'
import type { CliStatus, CliToolInfo } from '@shared/aiTools'
import type { KeyStatus, Settings as SettingsT } from '@shared/types'
import { Icon, Segmented } from '../components/ui'
import { errorText } from '../lib/format'
import { applyTheme } from '../lib/theme'
import { toast, useApp } from '../store/app'
import { SCRIPTS } from './Home'

/** OpenAI-compatible endpoints the user is likely to have a key for. */
const AI_PRESETS = [
  { label: 'OpenAI', url: 'https://api.openai.com/v1', model: 'gpt-4o-mini' },
  { label: 'Gemini', url: 'https://generativelanguage.googleapis.com/v1beta/openai', model: 'gemini-2.5-flash' },
  { label: 'OpenRouter', url: 'https://openrouter.ai/api/v1', model: 'openai/gpt-4o-mini' },
  { label: 'Groq', url: 'https://api.groq.com/openai/v1', model: 'llama-3.3-70b-versatile' },
  { label: 'DeepSeek', url: 'https://api.deepseek.com/v1', model: 'deepseek-chat' },
  { label: 'Ollama (lokal)', url: 'http://localhost:11434/v1', model: 'qwen2.5:7b' }
]

/** One row per CLI: radio, whether it was found on this computer, and what it does. */
function ToolPicker<T extends string>({
  name,
  label,
  tools,
  value,
  status,
  onChange
}: {
  name: string
  label: string
  tools: CliToolInfo<T>[]
  value: T
  status: CliStatus
  onChange: (id: T) => void
}) {
  return (
    <div className="qr-fieldset" role="radiogroup" aria-label={label}>
      <span className="qr-label">{label}</span>
      <div className="opt-list">
        {tools.map((t) => {
          const found = t.bin ? status[t.id as keyof CliStatus] : undefined
          return (
            <div key={t.id} className="stack">
              <label className="qr-choice">
                <input type="radio" className="qr-radio" name={name} checked={value === t.id} onChange={() => onChange(t.id)} />
                {t.name}
                {found !== undefined && <span className={found ? 'qr-badge qr-badge--success' : 'qr-badge qr-badge--warning'}>{found ? 'terpasang' : 'tidak ditemukan'}</span>}
              </label>
              <span className="qr-help">{t.note}</span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

export function Settings() {
  const route = useApp((s) => s.route)
  const go = useApp((s) => s.go)
  const [s, setS] = useState<SettingsT | null>(null)
  const [key, setKey] = useState<KeyStatus | null>(null)
  const [newKey, setNewKey] = useState('')
  const [cli, setCli] = useState<CliStatus>({})
  const [checking, setChecking] = useState(false)
  const [testing, setTesting] = useState(false)
  const [version, setVersion] = useState('')

  useEffect(() => {
    void window.api.settings.get().then(setS)
    void window.api.settings.cliStatus().then(setCli, () => undefined)
    void window.api.settings.aiKey().then(setKey)
    void window.api.app.version().then(setVersion)
  }, [])

  const set = async (patch: Partial<SettingsT>) => {
    try {
      const next = await window.api.settings.set(patch)
      setS(next)
      if (patch.theme) applyTheme(next.theme)
    } catch (e) {
      toast('error', errorText(e))
    }
  }

  const back = route.name === 'settings' && route.back ? route.back : { name: 'home' as const }
  if (!s) return null
  return (
    <div className="home">
      <header className="app-hd">
        <button type="button" className="qr-btn qr-btn--ghost" onClick={() => go(back)}>
          <Icon name="chevron-left" />
          Kembali
        </button>
        <h1 className="st-name">Pengaturan</h1>
      </header>
      <main className="step-scroll">
        <div className="step-narrow">
          <section className="qr-panel">
            <div className="qr-panel__head">
              <h2 className="qr-panel__title">Tampilan</h2>
            </div>
            <div className="insp-pad">
              <div className="field-row">
                <span className="lbl">Tema</span>
                <Segmented
                  ariaLabel="Tema"
                  value={s.theme}
                  onChange={(theme) => void set({ theme })}
                  options={[
                    { value: 'system', label: 'Sistem' },
                    { value: 'light', label: 'Terang' },
                    { value: 'dark', label: 'Gelap' }
                  ]}
                />
              </div>
              <div className="field-row">
                <span className="lbl">Teks Arab</span>
                <Segmented ariaLabel="Teks Arab bawaan" value={s.script} onChange={(script) => void set({ script })} options={SCRIPTS} />
              </div>
              <span className="qr-help">Teks Arab bawaan untuk proyek baru. Uthmani dan QPC diunduh dari Quran.com saat pertama dipakai.</span>
            </div>
          </section>

          <section className="qr-panel">
            <div className="qr-panel__head">
              <h2 className="qr-panel__title">Layanan AI (AI trim terjemahan dan teks publikasi)</h2>
            </div>
            <div className="insp-pad">
              <div className="field-row">
                <span className="lbl">Dipakai</span>
                <Segmented
                  ariaLabel="Penyedia AI"
                  value={s.aiProvider}
                  onChange={(aiProvider) => void set({ aiProvider })}
                  options={[
                    { value: 'api', label: 'API (kunci sendiri)' },
                    { value: 'cli', label: 'AI CLI di komputer' }
                  ]}
                />
              </div>

              {s.aiProvider === 'cli' && (
                <>
                  <span className="qr-help">
                    Memakai AI CLI yang sudah terpasang dan login di komputer ini, jadi tanpa kunci API. Setiap permintaan menjalankan CLI itu sekali sehingga butuh sekitar satu menit; AI trim
                    mengirim banyak segmen sekaligus agar tidak terlalu lama. Aplikasi tidak pernah meminta izin tambahan atau melewati izin CLI.
                  </span>
                  <ToolPicker name="cli-tool" label="AI CLI" tools={CLI_TOOLS} value={s.cliTool} status={cli} onChange={(cliTool) => void set({ cliTool, cliModel: '' })} />
                  <div className="card-actions">
                    <button
                      type="button"
                      className="qr-btn qr-btn--ghost qr-btn--sm"
                      disabled={checking}
                      onClick={() => {
                        setChecking(true)
                        void window.api.settings
                          .cliStatus()
                          .then(setCli, (e) => toast('error', errorText(e)))
                          .finally(() => setChecking(false))
                      }}
                    >
                      {checking ? 'Memeriksa…' : 'Periksa ulang CLI'}
                    </button>
                  </div>
                  {s.cliTool === 'custom' && (
                    <div className="qr-fieldset">
                      <label className="qr-label" htmlFor="cli-command">
                        Perintah
                      </label>
                      <span className="qr-field">
                        <input id="cli-command" defaultValue={s.cliCommand} key={s.cliCommand} placeholder="contoh: mycli --quiet" onBlur={(e) => void set({ cliCommand: e.target.value.trim() })} />
                      </span>
                      <span className="qr-help">
                        Perintah dijalankan lewat shell di komputer ini. Prompt dikirim lewat stdin (bukan argumen), dan balasan dibaca dari stdout. Tulis {'{model}'} jika perintah butuh nama model.
                      </span>
                    </div>
                  )}
                  <div className="qr-fieldset">
                    <label className="qr-label" htmlFor="cli-model">
                      Model (opsional)
                    </label>
                    <span className="qr-field">
                      <input
                        id="cli-model"
                        list={s.cliTool === 'claude' ? 'cli-model-options' : undefined}
                        defaultValue={s.cliModel}
                        key={`${s.cliTool}:${s.cliModel}`}
                        placeholder="kosongkan untuk model bawaan CLI"
                        onBlur={(e) => void set({ cliModel: e.target.value.trim() })}
                      />
                    </span>
                    <datalist id="cli-model-options">
                      {CLAUDE_MODEL_ALIASES.map((m) => (
                        <option key={m} value={m} />
                      ))}
                    </datalist>
                    <span className="qr-help">
                      {s.cliTool === 'claude' && 'Claude Code menerima opus, sonnet, atau haiku. '}
                      {s.cliTool === 'opencode' && 'Tulis sebagai penyedia/model, misalnya anthropic/claude-sonnet-4. '}
                      Kosong berarti CLI memakai modelnya sendiri.
                    </span>
                  </div>
                  <div className="card-actions">
                    <button
                      type="button"
                      className="qr-btn qr-btn--secondary qr-btn--sm"
                      disabled={testing}
                      onClick={() => {
                        setTesting(true)
                        void window.api.settings
                          .testAi()
                          .then((m) => toast('success', m), (e) => toast('error', errorText(e)))
                          .finally(() => setTesting(false))
                      }}
                    >
                      {testing ? 'Menguji… (bisa sampai satu menit)' : 'Uji CLI'}
                    </button>
                  </div>
                </>
              )}

              {(s.aiProvider === 'api' || s.imageProvider === 'openai') && (
                <>
                  <span className="qr-help">
                    {s.aiProvider === 'api'
                      ? 'Semua layanan yang kompatibel dengan API OpenAI bisa dipakai. Kunci disimpan terenkripsi di Keychain.'
                      : 'Alamat dan kunci API ini dipakai pembuat gambar "API kompatibel OpenAI" di bawah. Kunci disimpan terenkripsi di Keychain.'}
                  </span>
                  <div className="card-actions">
                    {AI_PRESETS.map((p) => (
                      <button key={p.label} type="button" className="qr-btn qr-btn--secondary qr-btn--sm" onClick={() => void set({ aiBaseUrl: p.url, aiModel: p.model })}>
                        {p.label}
                      </button>
                    ))}
                  </div>
                  <div className="qr-fieldset">
                    <label className="qr-label" htmlFor="ai-url">
                      Alamat API
                    </label>
                    <span className="qr-field">
                      <input id="ai-url" defaultValue={s.aiBaseUrl} key={s.aiBaseUrl} onBlur={(e) => void set({ aiBaseUrl: e.target.value.trim() })} />
                    </span>
                  </div>
                  {s.aiProvider === 'api' && (
                    <div className="qr-fieldset">
                      <label className="qr-label" htmlFor="ai-model">
                        Model
                      </label>
                      <span className="qr-field">
                        <input id="ai-model" defaultValue={s.aiModel} key={s.aiModel} onBlur={(e) => void set({ aiModel: e.target.value.trim() })} />
                      </span>
                    </div>
                  )}
                  <div className="qr-fieldset">
                    <label className="qr-label" htmlFor="ai-key">
                      Kunci API {key?.configured && <span className="muted">(tersimpan: {key.preview})</span>}
                    </label>
                    <span className="qr-field">
                      <input id="ai-key" type="password" value={newKey} placeholder="Tempel kunci baru" onChange={(e) => setNewKey(e.target.value)} />
                    </span>
                  </div>
                  <div className="card-actions">
                    <button
                      type="button"
                      className="qr-btn qr-btn--primary qr-btn--sm"
                      disabled={!newKey.trim()}
                      onClick={() =>
                        void window.api.settings.setAiKey(newKey).then(
                          (k) => {
                            setKey(k)
                            setNewKey('')
                            toast('success', 'Kunci AI disimpan.')
                          },
                          (e) => toast('error', errorText(e))
                        )
                      }
                    >
                      Simpan kunci
                    </button>
                    {key?.configured && (
                      <button type="button" className="qr-btn qr-btn--ghost qr-btn--sm" onClick={() => void window.api.settings.clearAiKey().then(setKey)}>
                        Hapus kunci
                      </button>
                    )}
                    {s.aiProvider === 'api' && (
                      <button
                        type="button"
                        className="qr-btn qr-btn--secondary qr-btn--sm"
                        disabled={testing}
                        onClick={() => {
                          setTesting(true)
                          void window.api.settings
                            .testAi()
                            .then((m) => toast('success', m), (e) => toast('error', errorText(e)))
                            .finally(() => setTesting(false))
                        }}
                      >
                        {testing ? 'Menguji…' : 'Uji koneksi'}
                      </button>
                    )}
                  </div>
                </>
              )}
            </div>
          </section>

          <section className="qr-panel">
            <div className="qr-panel__head">
              <h2 className="qr-panel__title">Pembuat gambar (latar dari AI)</h2>
            </div>
            <div className="insp-pad">
              <div className="field-row">
                <span className="lbl">Dipakai</span>
                <Segmented
                  ariaLabel="Pembuat gambar"
                  value={s.imageProvider}
                  onChange={(imageProvider) => void set({ imageProvider })}
                  options={[
                    { value: 'pollinations', label: 'Pollinations (gratis)' },
                    { value: 'openai', label: 'API kompatibel OpenAI' },
                    { value: 'cli', label: 'AI CLI' }
                  ]}
                />
              </div>

              {s.imageProvider === 'pollinations' && (
                <span className="qr-help">
                  Pollinations adalah layanan publik gratis tanpa akun, dengan syarat penggunaan sendiri (pollinations.ai/terms). Deskripsi gambar dikirim ke layanan itu. Mutu dan ketersediaannya bisa
                  berubah: satu gambar per 45 detik, ukuran paling besar sekitar 768 piksel, dan layanan ini membubuhkan logo kecil di pojok kanan bawah gambar (tidak dihapus oleh aplikasi). Untuk gambar yang lebih tajam dan tanpa logo, pilih penyedia lain.
                </span>
              )}

              {s.imageProvider === 'openai' && (
                <div className="qr-fieldset">
                  <label className="qr-label" htmlFor="image-model">
                    Model gambar
                  </label>
                  <span className="qr-field">
                    <input id="image-model" defaultValue={s.imageModel} key={s.imageModel} placeholder="gpt-image-1" onBlur={(e) => void set({ imageModel: e.target.value.trim() })} />
                  </span>
                  <span className="qr-help">
                    Memakai alamat API dan kunci dari bagian Layanan AI di atas, lewat /images/generations. Nama model bergantung pada layanan (misalnya gpt-image-1 atau dall-e-3). Setiap gambar
                    ditagih penyedia.
                  </span>
                </div>
              )}

              {s.imageProvider === 'cli' && (
                <>
                  <span className="qr-help">
                    Menjalankan CLI yang sudah login di komputer ini dan memakai alat gambar bawaannya, jadi memakai kuota akun CLI itu. Claude Code dan OpenCode tidak punya alat gambar. Satu gambar
                    sekitar satu menit.
                  </span>
                  <ToolPicker name="image-cli-tool" label="CLI gambar" tools={CLI_IMAGE_TOOLS} value={s.imageCliTool} status={cli} onChange={(imageCliTool) => void set({ imageCliTool })} />
                  {s.imageCliTool === 'custom' && (
                    <div className="qr-fieldset">
                      <label className="qr-label" htmlFor="image-cli-command">
                        Perintah gambar
                      </label>
                      <span className="qr-field">
                        <input
                          id="image-cli-command"
                          defaultValue={s.imageCliCommand}
                          key={s.imageCliCommand}
                          placeholder="contoh: mygen --out {output}"
                          onBlur={(e) => void set({ imageCliCommand: e.target.value.trim() })}
                        />
                      </span>
                      <span className="qr-help">
                        Prompt dikirim lewat stdin. Perintah harus menulis satu berkas gambar (PNG, JPEG, atau WebP) ke {'{output}'}; {'{aspect}'} berisi 9:16, 16:9, atau 1:1.
                      </span>
                    </div>
                  )}
                </>
              )}
            </div>
          </section>

          <section className="qr-panel">
            <div className="qr-panel__head">
              <h2 className="qr-panel__title">Tentang</h2>
            </div>
            <div className="insp-pad">
              <span>Quran Render {version}. Lisensi GPL-3.0.</span>
              <span className="qr-help">
                Teks dan terjemahan Kemenag dari Lajnah Pentashihan Mushaf Al-Qur'an. Uthmani, QPC, dan terjemahan lain dari Quran.com. Ekspor video memakai
                Remotion (gratis untuk individu dan organisasi sampai 3 karyawan) dan FFmpeg.
              </span>
            </div>
          </section>
        </div>
      </main>
    </div>
  )
}
