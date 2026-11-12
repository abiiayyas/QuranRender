import { useEffect, useState } from 'react'
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

export function Settings() {
  const route = useApp((s) => s.route)
  const go = useApp((s) => s.go)
  const [s, setS] = useState<SettingsT | null>(null)
  const [key, setKey] = useState<KeyStatus | null>(null)
  const [newKey, setNewKey] = useState('')
  const [testing, setTesting] = useState(false)
  const [version, setVersion] = useState('')

  useEffect(() => {
    void window.api.settings.get().then(setS)
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
              <h2 className="qr-panel__title">Layanan AI (untuk AI trim terjemahan)</h2>
            </div>
            <div className="insp-pad">
              <span className="qr-help">Semua layanan yang kompatibel dengan API OpenAI bisa dipakai. Kunci disimpan terenkripsi di Keychain.</span>
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
              <div className="qr-fieldset">
                <label className="qr-label" htmlFor="ai-model">
                  Model
                </label>
                <span className="qr-field">
                  <input id="ai-model" defaultValue={s.aiModel} key={s.aiModel} onBlur={(e) => void set({ aiModel: e.target.value.trim() })} />
                </span>
              </div>
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
              </div>
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
