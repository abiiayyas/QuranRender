import React, { useState } from "react";
import { commands, type SubtitleFormat, type SubtitleTrackSelection } from "../bindings";
import { useI18n, type PlainKey } from "../i18n";
import { errorText, unwrap } from "../tauri";
import { ErrorAlert, Icon, Segmented, Sheet } from "../ui";
import type { Project } from "./model";

const TRACK_OPTIONS: ReadonlyArray<{ id: SubtitleTrackSelection; label: PlainKey }> = [
  { id: "AyahOnly", label: "studio.subtitle.ayahOnly" },
  { id: "TranslationOnly", label: "studio.subtitle.translationOnly" },
  { id: "Bilingual", label: "studio.subtitle.bilingual" },
];

const FORMATS: ReadonlyArray<SubtitleFormat> = ["Srt", "Vtt", "Ass"];

/** Ekspor subtitle: teks dibuat lalu disalin (menyimpan ke berkas belum tersedia). */
export function SubtitleSheet({
  project,
  onClose,
}: {
  project: Project;
  onClose: () => void;
}): React.ReactElement {
  const { t } = useI18n();
  const [format, setFormat] = useState<SubtitleFormat>("Srt");
  const [track, setTrack] = useState<SubtitleTrackSelection>("AyahOnly");
  const [includeNumber, setIncludeNumber] = useState(false);
  const [output, setOutput] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);

  const invalidate = () => {
    setOutput(null);
    setCopied(false);
  };

  const generate = async () => {
    setBusy(true);
    setError(null);
    invalidate();
    try {
      setOutput(
        await unwrap(
          commands.subtitleExport(project, {
            format,
            track,
            include_ayah_number: includeNumber,
            include_footnotes: false,
          })
        )
      );
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
    } catch (e) {
      setError(errorText(e));
    }
  };

  return (
    <Sheet
      title={t("studio.subtitle.title")}
      onClose={onClose}
      footer={
        <>
          <span className="qr-sheet__note">
            {t("common.unavailableNote", { what: t("studio.subtitle.saveToFile") })}
          </span>
          <button type="button" className="qr-btn qr-btn--secondary" onClick={onClose}>
            {t("common.close")}
          </button>
          <button
            type="button"
            className={busy ? "qr-btn qr-btn--primary is-loading" : "qr-btn qr-btn--primary"}
            disabled={busy}
            onClick={() => void generate()}
          >
            {busy && <span className="qr-spin" />}
            {t("studio.subtitle.generate")}
          </button>
        </>
      }
    >
      {error && <ErrorAlert title={t("studio.subtitle.error")} message={error} />}
      <div className="field-row">
        <span className="lbl" id="sub-format">
          {t("studio.subtitle.format")}
        </span>
        <Segmented<SubtitleFormat>
          labelledBy="sub-format"
          value={format}
          onChange={(f) => {
            setFormat(f);
            invalidate();
          }}
          options={FORMATS.map((f) => ({ value: f, label: f.toUpperCase() }))}
        />
      </div>
      <div className="field-row">
        <span className="lbl" id="sub-track">
          {t("studio.subtitle.content")}
        </span>
        <div className="opt-list" role="radiogroup" aria-labelledby="sub-track">
          {TRACK_OPTIONS.map((o) => (
            <label key={o.id} className="qr-opt">
              <input
                type="radio"
                className="qr-radio"
                name="subtitle-track"
                checked={track === o.id}
                onChange={() => {
                  setTrack(o.id);
                  invalidate();
                }}
              />
              <span>{t(o.label)}</span>
              <span />
            </label>
          ))}
        </div>
      </div>
      <div className="field-row">
        <span className="lbl">{t("studio.subtitle.numbers")}</span>
        <label className="qr-choice">
          <input
            type="checkbox"
            role="switch"
            className="qr-switch"
            checked={includeNumber}
            onChange={(e) => {
              setIncludeNumber(e.target.checked);
              invalidate();
            }}
          />
          {t("studio.subtitle.embedNumbers")}
        </label>
      </div>
      <div className="field-row">
        <span className="lbl">{t("studio.subtitle.footnotes")}</span>
        <label className="qr-choice is-disabled">
          <input type="checkbox" role="switch" className="qr-switch" disabled />
          {t("common.unavailable")}
        </label>
      </div>
      {output !== null && (
        <div className="qr-copy">
          <span className="qr-label">{t("studio.subtitle.result")}</span>
          <div className="qr-copy__box">
            <pre className="qr-copy__text">{output}</pre>
            <button type="button" className="qr-btn qr-btn--secondary qr-btn--sm" onClick={() => void copy(output)}>
              <Icon name="copy" size="sm" />
              {copied ? t("common.copied") : t("common.copy")}
            </button>
          </div>
        </div>
      )}
    </Sheet>
  );
}
