import React, { useId, useState } from "react";
import type { AssetRef, AudioInfo } from "../bindings";
import { fileName, formatTime } from "../format";
import { useI18n } from "../i18n";
import { ErrorAlert, Icon } from "../ui";
import { Summary } from "./parts";
import { ayahCount, SURAH_COUNT } from "./surahs";
import type { Project } from "./model";

export type AyahRange = { surah: number; from: number; to: number };

/** Panel kiri langkah Sumber: aset proyek dan impor audio (path teks: pemilih berkas bawaan belum ada). */
export function SourcePanel({
  assets,
  importing,
  error,
  onDismissError,
  onImport,
}: {
  assets: AssetRef[];
  importing: boolean;
  error: string | null;
  onDismissError: () => void;
  onImport: (path: string) => void;
}): React.ReactElement {
  const { t } = useI18n();
  const [path, setPath] = useState("");
  const inputId = useId();
  const helpId = useId();
  const valid = path.trim().length > 0;

  return (
    <div className="st-left__body">
      <p className="pn-h">{t("studio.source.assets")}</p>
      {assets.length === 0 ? (
        <div className="qr-empty">
          <Icon name="file-input" />
          <span>{t("studio.source.noAssets")}</span>
        </div>
      ) : (
        assets.map((a) => (
          <div key={a.id} className="qr-item">
            <Icon name={a.kind === "Audio" ? "audio-waveform" : a.kind === "Video" ? "film" : "image"} />
            <span className="qr-item__name" title={a.path}>
              {fileName(a.path)}
            </span>
            <span className="qr-item__meta">{a.kind}</span>
          </div>
        ))
      )}

      <form
        className="import-form"
        onSubmit={(e) => {
          e.preventDefault();
          if (valid && !importing) onImport(path.trim());
        }}
      >
        <p className="pn-h">{t("studio.source.importTitle")}</p>
        {error && <ErrorAlert title={t("studio.source.importError")} message={error} onClose={onDismissError} />}
        <div className="qr-fieldset">
          <label className="qr-label" htmlFor={inputId}>
            {t("studio.source.pathLabel")}
          </label>
          <span className="qr-field">
            <input
              id={inputId}
              value={path}
              placeholder={t("studio.source.pathPlaceholder")}
              autoComplete="off"
              spellCheck={false}
              aria-describedby={helpId}
              onChange={(e) => setPath(e.target.value)}
            />
          </span>
          <span className="qr-help" id={helpId}>
            {t("studio.source.pathHelp")}
          </span>
        </div>
        <button
          type="submit"
          className={importing ? "qr-btn qr-btn--secondary is-loading" : "qr-btn qr-btn--secondary"}
          disabled={!valid || importing}
        >
          {importing ? <span className="qr-spin" /> : <Icon name="file-input" />}
          {t("studio.source.importButton")}
        </button>
      </form>
    </div>
  );
}

function parseInt10(text: string): number | null {
  return /^\d+$/.test(text.trim()) ? Number(text) : null;
}

/** Pemilih rentang surah/ayat; hanya meneruskan nilai yang valid ke atas. */
function RangeForm({
  range,
  onChange,
}: {
  range: AyahRange;
  onChange: (range: AyahRange) => void;
}): React.ReactElement {
  const { t } = useI18n();
  const ids = [useId(), useId(), useId()];
  const [draft, setDraft] = useState({
    surah: String(range.surah),
    from: String(range.from),
    to: String(range.to),
  });

  const surah = parseInt10(draft.surah);
  const count = surah === null ? null : ayahCount(surah);
  const from = parseInt10(draft.from);
  const to = parseInt10(draft.to);
  const surahError = count === null ? t("studio.range.surahInvalid", { max: SURAH_COUNT }) : null;
  const fromError =
    count !== null && (from === null || from < 1 || from > count)
      ? t("studio.range.ayahInvalid", { max: count })
      : null;
  const toError =
    count !== null && !fromError && (to === null || to < (from ?? 1) || to > count)
      ? t("studio.range.toInvalid", { max: count })
      : null;

  const update = (next: { surah: string; from: string; to: string }) => {
    setDraft(next);
    const s = parseInt10(next.surah);
    const n = s === null ? null : ayahCount(s);
    const f = parseInt10(next.from);
    const e = parseInt10(next.to);
    if (s !== null && n !== null && f !== null && e !== null && f >= 1 && f <= e && e <= n) {
      onChange({ surah: s, from: f, to: e });
    }
  };

  const fields: ReadonlyArray<{
    key: "surah" | "from" | "to";
    label: string;
    error: string | null;
    min: number;
    max: number;
  }> = [
    { key: "surah", label: t("studio.range.surah"), error: surahError, min: 1, max: SURAH_COUNT },
    { key: "from", label: t("studio.range.from"), error: fromError, min: 1, max: count ?? 286 },
    { key: "to", label: t("studio.range.to"), error: toError, min: 1, max: count ?? 286 },
  ];

  return (
    <div className="insp-pad range-form">
      {fields.map((f, i) => (
        <div key={f.key} className="qr-fieldset">
          <label className="qr-label" htmlFor={ids[i]}>
            {f.label}
          </label>
          <span className={f.error ? "qr-field is-invalid" : "qr-field"}>
            <input
              id={ids[i]}
              type="number"
              inputMode="numeric"
              min={f.min}
              max={f.max}
              step={1}
              value={draft[f.key]}
              aria-invalid={f.error !== null}
              onChange={(e) => update({ ...draft, [f.key]: e.target.value })}
            />
          </span>
          {f.error && <span className="qr-error">{f.error}</span>}
        </div>
      ))}
      {count !== null && <span className="qr-help">{t("studio.range.count", { surah: surah ?? 0, count })}</span>}
      <span className="qr-help">{t("studio.range.note")}</span>
    </div>
  );
}

/** Inspector langkah Sumber: ringkasan proyek, audio, dan rentang ayat. */
export function SourceInspector({
  project,
  assets,
  audio,
  range,
  onRange,
}: {
  project: Project;
  assets: AssetRef[];
  audio: AudioInfo | null;
  range: AyahRange;
  onRange: (range: AyahRange) => void;
}): React.ReactElement {
  const { t } = useI18n();
  const canvas = project.canvas;
  const audioAsset = assets.find((a) => a.kind === "Audio");
  return (
    <>
      <div className="qr-panel__head">
        <span className="qr-panel__title">{t("studio.source.project")}</span>
      </div>
      <div className="insp-pad">
        <Summary
          rows={[
            [t("studio.sum.name"), project.name],
            [t("studio.sum.reciter"), project.reciter ?? "—"],
            [t("studio.sum.canvas"), `${canvas.width} × ${canvas.height}`],
            [t("studio.sum.ratio"), canvas.aspect_ratio],
            [t("studio.sum.fps"), `${(canvas.fps_num / canvas.fps_den).toFixed(2)} fps`],
            [t("studio.sum.assets"), String(assets.length)],
            [t("studio.sum.segments"), String(project.segments.length)],
          ]}
        />
      </div>
      <div className="qr-panel__head">
        <span className="qr-panel__title">{t("studio.source.audio")}</span>
      </div>
      <div className="insp-pad">
        {audio ? (
          <Summary
            rows={[
              [t("studio.audio.duration"), audio.duration_ticks === null ? "—" : formatTime(audio.duration_ticks)],
              [t("studio.audio.sampleRate"), `${audio.sample_rate} Hz`],
              [t("studio.audio.channels"), String(audio.channels)],
            ]}
          />
        ) : audioAsset ? (
          <span className="qr-help">{t("studio.audio.noPeaks")}</span>
        ) : (
          <span className="qr-help">{t("studio.audio.none")}</span>
        )}
      </div>
      <div className="qr-panel__head">
        <span className="qr-panel__title">{t("studio.range.title")}</span>
      </div>
      <RangeForm range={range} onChange={onRange} />
    </>
  );
}
