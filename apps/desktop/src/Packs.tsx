import React, { useId, useState } from "react";
import {
  commands,
  type PackSummary,
  type ProjectIndexEntry_Serialize as ProjectEntry,
  type Project_Serialize as Project,
} from "./bindings";
import { useI18n } from "./i18n";
import { errorText, unwrap } from "./tauri";
import { ErrorAlert, Icon, Sheet } from "./ui";

const PACK_EXT = ".qrpack";
const NONE = "—";
const BYTE_UNITS: ReadonlyArray<string> = ["B", "KB", "MB", "GB", "TB"];

/** Ukuran berkas dalam satuan biner (1 KB = 1024 B); `—` bila tidak diketahui. */
export function formatBytes(bytes: number | null, locale: string): string {
  if (bytes === null || !Number.isFinite(bytes) || bytes < 0) return NONE;
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < BYTE_UNITS.length - 1) {
    value /= 1024;
    unit += 1;
  }
  const num = new Intl.NumberFormat(locale, { maximumFractionDigits: unit === 0 ? 0 : 1 }).format(value);
  return `${num} ${BYTE_UNITS[unit] ?? "B"}`;
}

export function ExportPackSheet({
  entry,
  onClose,
}: {
  entry: ProjectEntry;
  onClose: () => void;
}): React.ReactElement {
  const { t, locale } = useI18n();
  const uid = useId();
  const [dest, setDest] = useState("");
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState<PackSummary | null>(null);

  const path = dest.trim();
  const problem =
    path.length === 0
      ? t("app.pack.export.destRequired")
      : !path.toLowerCase().endsWith(PACK_EXT)
        ? t("app.pack.export.destExt")
        : null;
  const showProblem = touched && problem !== null;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setTouched(true);
    if (problem !== null || busy) return;
    setBusy(true);
    setError(null);
    try {
      setSummary(await unwrap(commands.projectExportPack(entry.id, path)));
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={(e) => void submit(e)} noValidate>
      <Sheet
        title={t("app.pack.export.title")}
        size="md"
        onClose={onClose}
        footer={
          summary ? (
            <button type="button" className="qr-btn qr-btn--primary" onClick={onClose}>
              {t("common.close")}
            </button>
          ) : (
            <>
              <button type="button" className="qr-btn qr-btn--secondary" onClick={onClose}>
                {t("common.cancel")}
              </button>
              <button
                type="submit"
                className={busy ? "qr-btn qr-btn--primary is-loading" : "qr-btn qr-btn--primary"}
                disabled={busy}
              >
                {busy ? <span className="qr-spin" /> : <Icon name="download" />}
                {t("app.pack.export.submit")}
              </button>
            </>
          )
        }
      >
        <p>{t("app.pack.export.intro", { name: entry.name })}</p>
        {error && <ErrorAlert title={t("app.pack.export.failed")} message={error} />}
        {summary ? (
          <div className="qr-alert qr-alert--success" role="status">
            <Icon name="circle-check" />
            <div className="qr-alert__content">
              <span className="qr-alert__title">{t("app.pack.export.done")}</span>
              <dl className="sum pack-sum">
                <dt>{t("app.pack.summary.path")}</dt>
                <dd className="mono">{summary.path}</dd>
                <dt>{t("app.pack.summary.files")}</dt>
                <dd>{summary.files.toLocaleString(locale)}</dd>
                <dt>{t("app.pack.summary.size")}</dt>
                <dd>{formatBytes(summary.total_bytes, locale)}</dd>
              </dl>
            </div>
          </div>
        ) : (
          <div className="qr-fieldset">
            <label className="qr-label" htmlFor={`${uid}-dest`}>
              {t("app.pack.export.destLabel")}
            </label>
            <span className={showProblem ? "qr-field is-invalid" : "qr-field"}>
              <input
                id={`${uid}-dest`}
                value={dest}
                data-autofocus
                autoComplete="off"
                spellCheck={false}
                placeholder={t("app.pack.export.destPlaceholder")}
                aria-invalid={showProblem}
                aria-describedby={showProblem ? `${uid}-err` : `${uid}-help`}
                disabled={busy}
                onChange={(e) => setDest(e.target.value)}
                onBlur={() => setTouched(true)}
              />
            </span>
            {showProblem ? (
              <span className="qr-error" id={`${uid}-err`}>
                <Icon name="circle-alert" size="sm" />
                {problem}
              </span>
            ) : (
              <span className="qr-help" id={`${uid}-help`}>
                {t("app.pack.export.noOverwrite")}
              </span>
            )}
          </div>
        )}
      </Sheet>
    </form>
  );
}

export function ImportPackSheet({
  onClose,
  onImported,
}: {
  onClose: () => void;
  onImported: (project: Project) => void;
}): React.ReactElement {
  const { t } = useI18n();
  const uid = useId();
  const [src, setSrc] = useState("");
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [imported, setImported] = useState<Project | null>(null);

  const path = src.trim();
  const problem = path.length === 0 ? t("app.pack.import.srcRequired") : null;
  const showProblem = touched && problem !== null;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setTouched(true);
    if (problem !== null || busy) return;
    setBusy(true);
    setError(null);
    try {
      const project = await unwrap(commands.projectImportPack(path));
      setImported(project);
      onImported(project);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={(e) => void submit(e)} noValidate>
      <Sheet
        title={t("app.pack.import.title")}
        size="md"
        onClose={onClose}
        footer={
          imported ? (
            <button type="button" className="qr-btn qr-btn--primary" onClick={onClose}>
              {t("common.close")}
            </button>
          ) : (
            <>
              <button type="button" className="qr-btn qr-btn--secondary" onClick={onClose}>
                {t("common.cancel")}
              </button>
              <button
                type="submit"
                className={busy ? "qr-btn qr-btn--primary is-loading" : "qr-btn qr-btn--primary"}
                disabled={busy}
              >
                {busy ? <span className="qr-spin" /> : <Icon name="upload" />}
                {t("app.pack.import.submit")}
              </button>
            </>
          )
        }
      >
        <p>{t("app.pack.import.intro")}</p>
        {error && <ErrorAlert title={t("app.pack.import.failed")} message={error} />}
        {imported ? (
          <div className="qr-alert qr-alert--success" role="status">
            <Icon name="circle-check" />
            <div className="qr-alert__content">
              <span className="qr-alert__title">{t("app.pack.import.done", { name: imported.name })}</span>
              <span className="qr-alert__body">{t("app.pack.import.doneHint")}</span>
            </div>
          </div>
        ) : (
          <div className="qr-fieldset">
            <label className="qr-label" htmlFor={`${uid}-src`}>
              {t("app.pack.import.srcLabel")}
            </label>
            <span className={showProblem ? "qr-field is-invalid" : "qr-field"}>
              <input
                id={`${uid}-src`}
                value={src}
                data-autofocus
                autoComplete="off"
                spellCheck={false}
                placeholder={t("app.pack.import.srcPlaceholder")}
                aria-invalid={showProblem}
                aria-describedby={showProblem ? `${uid}-err` : `${uid}-help`}
                disabled={busy}
                onChange={(e) => setSrc(e.target.value)}
                onBlur={() => setTouched(true)}
              />
            </span>
            {showProblem ? (
              <span className="qr-error" id={`${uid}-err`}>
                <Icon name="circle-alert" size="sm" />
                {problem}
              </span>
            ) : (
              <span className="qr-help" id={`${uid}-help`}>
                {t("app.pack.import.noOverwrite")}
              </span>
            )}
          </div>
        )}
      </Sheet>
    </form>
  );
}
