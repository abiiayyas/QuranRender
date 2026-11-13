import { useEffect, useRef, useState, type ReactNode } from 'react'
import { CLAUDE_MODEL_ALIASES, CLI_IMAGE_TOOLS, CLI_TOOLS } from '@shared/aiTools'
import type { CliStatus, CliToolInfo } from '@shared/aiTools'
import { LANGS, msg, t } from '@shared/i18n'
import { SUPPORT_LINKS } from '@shared/support'
import type { KeyStatus, Settings as SettingsT } from '@shared/types'
import { Icon, Segmented } from '../components/ui'
import { errorText } from '../lib/format'
import { applyLanguage } from '../lib/language'
import { applyTheme } from '../lib/theme'
import { toast, useApp } from '../store/app'
import { SCRIPTS } from './Home'
import { StorageSection } from './StorageSection'

/** OpenAI-compatible endpoints the user is likely to have a key for. */
const AI_PRESETS = [
  { label: 'OpenAI', url: 'https://api.openai.com/v1', model: 'gpt-4o-mini' },
  { label: 'Gemini', url: 'https://generativelanguage.googleapis.com/v1beta/openai', model: 'gemini-2.5-flash' },
  { label: 'OpenRouter', url: 'https://openrouter.ai/api/v1', model: 'openai/gpt-4o-mini' },
  { label: 'Groq', url: 'https://api.groq.com/openai/v1', model: 'llama-3.3-70b-versatile' },
  { label: 'DeepSeek', url: 'https://api.deepseek.com/v1', model: 'deepseek-chat' },
  { label: msg('Ollama (lokal)'), url: 'http://localhost:11434/v1', model: 'qwen2.5:7b' }
]

type SectionId = 'general' | 'ai' | 'image' | 'storage' | 'support' | 'about'

const SECTIONS: { id: SectionId; label: string; icon: string }[] = [
  { id: 'general', label: msg('Umum'), icon: 'settings-2' },
  { id: 'ai', label: msg('Layanan AI'), icon: 'languages' },
  { id: 'image', label: msg('Pembuat gambar'), icon: 'image' },
  { id: 'storage', label: msg('Penyimpanan'), icon: 'hard-drive' },
  { id: 'support', label: msg('Dukungan'), icon: 'heart' },
  { id: 'about', label: msg('Tentang'), icon: 'info' }
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
        {tools.map((tool) => {
          const found = tool.bin ? status[tool.id as keyof CliStatus] : undefined
          return (
            <div key={tool.id} className="stack">
              <label className="qr-choice">
                <input type="radio" className="qr-radio" name={name} checked={value === tool.id} onChange={() => onChange(tool.id)} />
                {t(tool.name)}
                {found !== undefined && <span className={found ? 'qr-badge qr-badge--success' : 'qr-badge qr-badge--warning'}>{found ? t('terpasang') : t('tidak ditemukan')}</span>}
              </label>
              <span className="qr-help">{t(tool.note)}</span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function Section({ id, title, lead, children }: { id: SectionId; title: string; lead?: string; children: ReactNode }) {
  return (
    <section id={`st-${id}`} className="qr-panel st-section" aria-labelledby={`st-${id}-h`}>
      <div className="st-section__head">
        <h2 id={`st-${id}-h`} className="qr-panel__title">
          {title}
        </h2>
        {lead && <p>{lead}</p>}
      </div>
      <div className="insp-pad">{children}</div>
    </section>
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
  const [active, setActive] = useState<SectionId>('general')
  const scroller = useRef<HTMLElement>(null)
  // A click on the nav owns the highlight until its scroll settles: the last sections are too short to ever reach the top.
  const holdUntil = useRef(0)

  useEffect(() => {
    void window.api.settings.get().then(setS)
    void window.api.settings.cliStatus().then(setCli, () => undefined)
    void window.api.settings.aiKey().then(setKey)
    void window.api.app.version().then(setVersion)
  }, [])

  // The nav follows the page: the current section is the last one whose top has reached the top of the scroll area, or the
  // last section once the page cannot scroll any further.
  useEffect(() => {
    const root = scroller.current
    if (!s || !root) return
    const update = (): void => {
      if (Date.now() < holdUntil.current) return
      const top = root.getBoundingClientRect().top
      const atEnd = root.scrollTop + root.clientHeight >= root.scrollHeight - 2
      let current: SectionId = SECTIONS[0].id
      for (const x of SECTIONS) {
        const el = document.getElementById(`st-${x.id}`)
        if (el && el.getBoundingClientRect().top - top <= 96) current = x.id
      }
      setActive(atEnd ? SECTIONS[SECTIONS.length - 1].id : current)
    }
    update()
    root.addEventListener('scroll', update, { passive: true })
    return () => root.removeEventListener('scroll', update)
  }, [s])

  const set = async (patch: Partial<SettingsT>) => {
    try {
      const next = await window.api.settings.set(patch)
      setS(next)
      if (patch.theme) applyTheme(next.theme)
      // Last: it remounts the whole app, this page included, in the new language.
      if (patch.language) applyLanguage(next.language)
    } catch (e) {
      toast('error', errorText(e))
    }
  }

  const jump = (id: SectionId) => {
    setActive(id)
    holdUntil.current = Date.now() + 800
    document.getElementById(`st-${id}`)?.scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' })
  }

  const runTest = () => {
    setTesting(true)
    void window.api.settings
      .testAi()
      .then((m) => toast('success', m), (e) => toast('error', errorText(e)))
      .finally(() => setTesting(false))
  }

  const back = route.name === 'settings' && route.back ? route.back : { name: 'home' as const }
  if (!s) return null
  return (
    <div className="home">
      <header className="app-hd">
        <button type="button" className="qr-btn qr-btn--ghost" onClick={() => go(back)}>
          <Icon name="chevron-left" />
          {t('Kembali')}
        </button>
        <h1 className="st-name">{t('Pengaturan')}</h1>
      </header>
      <main className="step-scroll" ref={scroller}>
        <div className="st-layout">
          <nav className="st-nav" aria-label={t('Bagian pengaturan')}>
            {SECTIONS.map((x) => (
              <button key={x.id} type="button" className={x.id === active ? 'st-nav__item is-active' : 'st-nav__item'} aria-current={x.id === active ? 'true' : undefined} onClick={() => jump(x.id)}>
                <Icon name={x.icon} size="sm" />
                {t(x.label)}
              </button>
            ))}
          </nav>

          <div className="st-content">
            <Section id="general" title={t('Umum')}>
              <div className="field-row">
                <span className="lbl" id="st-lang">
                  {t('Bahasa')}
                </span>
                <Segmented labelledBy="st-lang" value={s.language} onChange={(language) => void set({ language })} options={LANGS} />
              </div>
              <span className="qr-help">{t('Bahasa aplikasi, pesan dari aplikasi, dan teks yang ikut tergambar di video. Terjemahan ayat dipilih terpisah di langkah Teks.')}</span>
              <div className="field-row">
                <span className="lbl">{t('Tema')}</span>
                <Segmented
                  ariaLabel={t('Tema')}
                  value={s.theme}
                  onChange={(theme) => void set({ theme })}
                  options={[
                    { value: 'system', label: t('Sistem') },
                    { value: 'light', label: t('Terang') },
                    { value: 'dark', label: t('Gelap') }
                  ]}
                />
              </div>
              <div className="field-row">
                <span className="lbl">{t('Teks Arab')}</span>
                <Segmented ariaLabel={t('Teks Arab bawaan')} value={s.script} onChange={(script) => void set({ script })} options={SCRIPTS} />
              </div>
              <span className="qr-help">{t('Teks Arab bawaan untuk proyek baru. Uthmani dan QPC diunduh dari Quran.com saat pertama dipakai.')}</span>
            </Section>

            <Section id="ai" title={t('Layanan AI')} lead={t('Dipakai untuk AI trim terjemahan dan teks publikasi.')}>
              <div className="field-row">
                <span className="lbl">{t('Penyedia')}</span>
                <Segmented
                  ariaLabel={t('Penyedia AI')}
                  value={s.aiProvider}
                  onChange={(aiProvider) => void set({ aiProvider })}
                  options={[
                    { value: 'api', label: t('API (kunci sendiri)') },
                    { value: 'cli', label: t('AI CLI di komputer') }
                  ]}
                />
              </div>

              {s.aiProvider === 'cli' && (
                <>
                  <span className="qr-help">
                    {t(
                      'Memakai AI CLI yang sudah terpasang dan login di komputer ini, jadi tanpa kunci API. Setiap permintaan menjalankan CLI itu sekali sehingga butuh sekitar satu menit; AI trim mengirim banyak segmen sekaligus agar tidak terlalu lama. Aplikasi tidak pernah meminta izin tambahan atau melewati izin CLI.'
                    )}
                  </span>
                  <ToolPicker name="cli-tool" label={t('AI CLI')} tools={CLI_TOOLS} value={s.cliTool} status={cli} onChange={(cliTool) => void set({ cliTool, cliModel: '' })} />
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
                      {checking ? t('Memeriksa…') : t('Periksa ulang CLI')}
                    </button>
                  </div>
                  {s.cliTool === 'custom' && (
                    <div className="qr-fieldset">
                      <label className="qr-label" htmlFor="cli-command">
                        {t('Perintah')}
                      </label>
                      <span className="qr-field">
                        <input id="cli-command" defaultValue={s.cliCommand} key={s.cliCommand} placeholder={t('contoh: mycli --quiet')} onBlur={(e) => void set({ cliCommand: e.target.value.trim() })} />
                      </span>
                      <span className="qr-help">
                        {t('Perintah dijalankan lewat shell di komputer ini. Prompt dikirim lewat stdin (bukan argumen), dan balasan dibaca dari stdout. Tulis {model} jika perintah butuh nama model.')}
                      </span>
                    </div>
                  )}
                  <div className="qr-fieldset">
                    <label className="qr-label" htmlFor="cli-model">
                      {t('Model (opsional)')}
                    </label>
                    <span className="qr-field">
                      <input
                        id="cli-model"
                        list={s.cliTool === 'claude' ? 'cli-model-options' : undefined}
                        defaultValue={s.cliModel}
                        key={`${s.cliTool}:${s.cliModel}`}
                        placeholder={t('kosongkan untuk model bawaan CLI')}
                        onBlur={(e) => void set({ cliModel: e.target.value.trim() })}
                      />
                    </span>
                    <datalist id="cli-model-options">
                      {CLAUDE_MODEL_ALIASES.map((m) => (
                        <option key={m} value={m} />
                      ))}
                    </datalist>
                    <span className="qr-help">
                      {s.cliTool === 'claude' && `${t('Claude Code menerima opus, sonnet, atau haiku.')} `}
                      {s.cliTool === 'opencode' && `${t('Tulis sebagai penyedia/model, misalnya anthropic/claude-sonnet-4.')} `}
                      {t('Kosong berarti CLI memakai modelnya sendiri.')}
                    </span>
                  </div>
                  <div className="card-actions">
                    <button type="button" className="qr-btn qr-btn--secondary qr-btn--sm" disabled={testing} onClick={runTest}>
                      {testing ? t('Menguji… (bisa sampai satu menit)') : t('Uji CLI')}
                    </button>
                  </div>
                </>
              )}

              {(s.aiProvider === 'api' || s.imageProvider === 'openai') && (
                <>
                  <span className="qr-help">
                    {s.aiProvider === 'api'
                      ? t('Semua layanan yang kompatibel dengan API OpenAI bisa dipakai. Kunci disimpan terenkripsi di Keychain.')
                      : t('Alamat dan kunci API ini dipakai pembuat gambar "API kompatibel OpenAI" di bawah. Kunci disimpan terenkripsi di Keychain.')}
                  </span>
                  <div className="card-actions">
                    {AI_PRESETS.map((p) => (
                      <button key={p.url} type="button" className="qr-btn qr-btn--secondary qr-btn--sm" onClick={() => void set({ aiBaseUrl: p.url, aiModel: p.model })}>
                        {t(p.label)}
                      </button>
                    ))}
                  </div>
                  <div className="qr-fieldset">
                    <label className="qr-label" htmlFor="ai-url">
                      {t('Alamat API')}
                    </label>
                    <span className="qr-field">
                      <input id="ai-url" defaultValue={s.aiBaseUrl} key={s.aiBaseUrl} onBlur={(e) => void set({ aiBaseUrl: e.target.value.trim() })} />
                    </span>
                  </div>
                  {s.aiProvider === 'api' && (
                    <div className="qr-fieldset">
                      <label className="qr-label" htmlFor="ai-model">
                        {t('Model')}
                      </label>
                      <span className="qr-field">
                        <input id="ai-model" defaultValue={s.aiModel} key={s.aiModel} onBlur={(e) => void set({ aiModel: e.target.value.trim() })} />
                      </span>
                    </div>
                  )}
                  <div className="qr-fieldset">
                    <label className="qr-label" htmlFor="ai-key">
                      {t('Kunci API')} {key?.configured && <span className="muted">{t('(tersimpan: {preview})', { preview: key.preview ?? '' })}</span>}
                    </label>
                    <span className="qr-field">
                      <input id="ai-key" type="password" value={newKey} placeholder={t('Tempel kunci baru')} onChange={(e) => setNewKey(e.target.value)} />
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
                            toast('success', t('Kunci AI disimpan.'))
                          },
                          (e) => toast('error', errorText(e))
                        )
                      }
                    >
                      {t('Simpan kunci')}
                    </button>
                    {key?.configured && (
                      <button type="button" className="qr-btn qr-btn--ghost qr-btn--sm" onClick={() => void window.api.settings.clearAiKey().then(setKey)}>
                        {t('Hapus kunci')}
                      </button>
                    )}
                    {s.aiProvider === 'api' && (
                      <button type="button" className="qr-btn qr-btn--secondary qr-btn--sm" disabled={testing} onClick={runTest}>
                        {testing ? t('Menguji…') : t('Uji koneksi')}
                      </button>
                    )}
                  </div>
                </>
              )}
            </Section>

            <Section id="image" title={t('Pembuat gambar')} lead={t('Untuk latar yang dibuat AI di Editor.')}>
              <div className="field-row">
                <span className="lbl">{t('Penyedia')}</span>
                <Segmented
                  ariaLabel={t('Pembuat gambar')}
                  value={s.imageProvider}
                  onChange={(imageProvider) => void set({ imageProvider })}
                  options={[
                    { value: 'pollinations', label: t('Pollinations (gratis)') },
                    { value: 'openai', label: t('API kompatibel OpenAI') },
                    { value: 'cli', label: t('AI CLI') }
                  ]}
                />
              </div>

              {s.imageProvider === 'pollinations' && (
                <span className="qr-help">
                  {t(
                    'Pollinations adalah layanan publik gratis tanpa akun, dengan syarat penggunaan sendiri (pollinations.ai/terms). Deskripsi gambar dikirim ke layanan itu. Mutu dan ketersediaannya bisa berubah: satu gambar per 45 detik, ukuran paling besar sekitar 768 piksel, dan layanan ini membubuhkan logo kecil di pojok kanan bawah gambar; aplikasi memangkas tepi gambar (sekitar 7%) untuk membuangnya. Untuk gambar yang lebih tajam dan tanpa logo, pilih penyedia lain.'
                  )}
                </span>
              )}

              {s.imageProvider === 'openai' && (
                <div className="qr-fieldset">
                  <label className="qr-label" htmlFor="image-model">
                    {t('Model gambar')}
                  </label>
                  <span className="qr-field">
                    <input id="image-model" defaultValue={s.imageModel} key={s.imageModel} placeholder="gpt-image-1" onBlur={(e) => void set({ imageModel: e.target.value.trim() })} />
                  </span>
                  <span className="qr-help">
                    {t(
                      'Memakai alamat API dan kunci dari bagian Layanan AI di atas, lewat /images/generations. Nama model bergantung pada layanan (misalnya gpt-image-1 atau dall-e-3). Setiap gambar ditagih penyedia.'
                    )}
                  </span>
                </div>
              )}

              {s.imageProvider === 'cli' && (
                <>
                  <span className="qr-help">
                    {t(
                      'Menjalankan CLI yang sudah login di komputer ini dan memakai alat gambar bawaannya, jadi memakai kuota akun CLI itu. Claude Code dan OpenCode tidak punya alat gambar. Satu gambar sekitar satu menit.'
                    )}
                  </span>
                  <ToolPicker name="image-cli-tool" label={t('CLI untuk gambar')} tools={CLI_IMAGE_TOOLS} value={s.imageCliTool} status={cli} onChange={(imageCliTool) => void set({ imageCliTool })} />
                  {s.imageCliTool === 'custom' && (
                    <div className="qr-fieldset">
                      <label className="qr-label" htmlFor="image-cli-command">
                        {t('Perintah gambar')}
                      </label>
                      <span className="qr-field">
                        <input
                          id="image-cli-command"
                          defaultValue={s.imageCliCommand}
                          key={s.imageCliCommand}
                          placeholder={t('contoh: mygen --out {output}')}
                          onBlur={(e) => void set({ imageCliCommand: e.target.value.trim() })}
                        />
                      </span>
                      <span className="qr-help">
                        {t('Prompt dikirim lewat stdin. Perintah harus menulis satu berkas gambar (PNG, JPEG, atau WebP) ke {output}; {aspect} berisi 9:16, 16:9, atau 1:1.')}
                      </span>
                    </div>
                  )}
                </>
              )}
            </Section>

            <Section id="storage" title={t('Penyimpanan')} lead={t('Bersihkan data yang bisa dibuat ulang dan hapus berkas proyek yang tidak terpakai.')}>
              <StorageSection />
            </Section>

            <Section id="support" title={t('Dukungan')} lead={t('Quran Render gratis dan terbuka. Kalau aplikasi ini membantumu, donasi membantu menjaga dan mengembangkannya.')}>
              <div className="st-support">
                {SUPPORT_LINKS.filter((l) => l.url).map((l) => (
                  <button
                    key={l.id}
                    type="button"
                    className="qr-btn qr-btn--secondary st-support__btn"
                    onClick={() => void window.api.app.openExternal(l.url).catch((e: unknown) => toast('error', errorText(e)))}
                  >
                    <Icon name={l.icon} />
                    {t('Donasi via {name}', { name: l.label })}
                    <Icon name="external-link" size="sm" />
                  </button>
                ))}
              </div>
              <span className="qr-help">{t('Donasi bersifat sukarela dan tidak membuka fitur apa pun. Semua fitur tetap bisa dipakai tanpa donasi.')}</span>
            </Section>

            <Section id="about" title={t('Tentang')}>
              <span>{t('Quran Render {version}. Lisensi GPL-3.0.', { version })}</span>
              <span className="qr-help">
                {t(
                  "Teks dan terjemahan Kemenag dari Lajnah Pentashihan Mushaf Al-Qur'an. Uthmani, QPC, dan terjemahan lain dari Quran.com. Ekspor video memakai Remotion (gratis untuk individu dan organisasi sampai 3 karyawan) dan FFmpeg."
                )}
              </span>
            </Section>
          </div>
        </div>
      </main>
    </div>
  )
}
