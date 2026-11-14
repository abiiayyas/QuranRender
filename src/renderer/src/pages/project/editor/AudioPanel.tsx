import { AMBIENT_DEFAULT_FADE_MS, AMBIENT_MAX_LEVEL_DB, AMBIENT_MIN_LEVEL_DB, AMBIENT_SOUNDS, AMBIENT_SUGGESTED_MAX_DB, defaultAmbient, type AmbientId } from '@shared/ambient'
import { t } from '@shared/i18n'
import { useProject } from '../../../store/project'
import { Section, Slider } from './controls'

/** The nature sound under the recitation: which one, how far under the reciter, and how it fades. */
export function AudioPanel() {
  const ambient = useProject((s) => s.project!.ambient ?? null)
  const hasSource = useProject((s) => !!s.project!.sourceAssetId)

  const choose = (id: AmbientId | null): void => {
    const cur = useProject.getState().project?.ambient
    // Changing the sound keeps the level and fade the user already set.
    useProject.getState().update({ ambient: id ? { ...defaultAmbient(id), ...(cur ? { levelDb: cur.levelDb, fadeMs: cur.fadeMs } : {}) } : null })
  }
  const set = (patch: Partial<NonNullable<typeof ambient>>, key: string): void => {
    if (ambient) useProject.getState().update({ ambient: { ...ambient, ...patch } }, key)
  }

  return (
    <div className="ed-panel-body">
      <Section title={t('Suara latar')}>
        <div className="opt-list" role="radiogroup" aria-label={t('Suara latar')}>
          <div className="stack">
            <label className="qr-choice">
              <input type="radio" className="qr-radio" name="ambient" checked={ambient === null} onChange={() => choose(null)} />
              {t('Tanpa suara latar')}
            </label>
          </div>
          {AMBIENT_SOUNDS.map((s) => (
            <div key={s.id} className="stack">
              <label className="qr-choice">
                <input type="radio" className="qr-radio" name="ambient" checked={ambient?.id === s.id} onChange={() => choose(s.id)} />
                {t(s.label)}
              </label>
              <span className="qr-help">{t(s.note)}</span>
            </div>
          ))}
        </div>
        {!hasSource && <p className="pn-note">{t('Tambahkan rekaman di langkah Sumber dulu: tingkat suara latar disesuaikan dengan suara qari.')}</p>}
      </Section>

      {ambient && (
        <Section title={t('Volume')}>
          <Slider
            label={t('Tingkat suara')}
            value={ambient.levelDb}
            min={AMBIENT_MIN_LEVEL_DB}
            max={AMBIENT_MAX_LEVEL_DB}
            step={1}
            format={(v) => `${v} dB`}
            onChange={(v) => set({ levelDb: v }, 'ambientLevel')}
          />
          <p className="pn-note">
            {ambient.levelDb > AMBIENT_SUGGESTED_MAX_DB
              ? t('Lebih keras dari {max} dB di bawah suara qari: suara latar mulai bersaing dengan bacaan.', { max: -AMBIENT_SUGGESTED_MAX_DB })
              : t('Dihitung dari kenyaringan rekaman qari, jadi tetap pas untuk rekaman yang pelan maupun keras. Bawaannya 24 dB di bawah suara qari.')}
          </p>
          <Slider
            label={t('Pudar')}
            value={ambient.fadeMs}
            min={0}
            max={8000}
            step={100}
            format={(v) => (v === 0 ? t('Tanpa pudar') : `${(v / 1000).toFixed(1)} ${t('dtk')}`)}
            onChange={(v) => set({ fadeMs: v }, 'ambientFade')}
          />
          <button type="button" className="qr-btn qr-btn--ghost qr-btn--sm" onClick={() => set({ levelDb: defaultAmbient(ambient.id).levelDb, fadeMs: AMBIENT_DEFAULT_FADE_MS }, 'ambientReset')}>
            {t('Kembalikan ke bawaan')}
          </button>
        </Section>
      )}
    </div>
  )
}
