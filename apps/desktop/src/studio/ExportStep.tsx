import React, { useId, useState } from "react";
import type { ExportValidationReport_Serialize as ValidationReport } from "../bindings";
import { formatTime } from "../format";
import { useI18n, type PlainKey } from "../i18n";
import { ErrorAlert, Icon, Segmented } from "../ui";
import { Summary } from "./parts";
import { templateById, segCode, type Project, type Segment } from "./model";
import type { ExportJob } from "./useExport";

/** Pesan jalan keluar untuk kode galat worker yang dikenal (docs/engineering/07 §5). */
const ERROR_HINTS: Record<string, PlainKey> = {
  OUTPUT_EXISTS: "studio.export.hint.outputExists",
  "CNT-5-OVERFLOW": "studio.export.hint.cnt5",
  AUDIO_MISSING: "studio.export.hint.audioMissing",
  MISSING_VERSE: "studio.export.hint.missingVerse",
  EXPORT_BLOCKED: "studio.export.hint.exportBlocked",
  FFMPEG_MISSING: "studio.export.hint.ffmpegMissing",
};

/** Kode kebijakan yang menolak ekspor bila ayat tidak muat satu layar. */
const OVERFLOW_CODE = "CNT-5";

const WIDTH_CHOICES = ["orig", "540", "720", "1080"] as const;
type WidthChoice = (typeof WIDTH_CHOICES)[number];

/** Panel kiri langkah Ekspor: pemeriksaan sebelum ekspor. */
export function ValidationPanel({
  report,
  error,
  validating,
  overflowCount,
  segments,
  onRevalidate,
  onSelectSegment,
  onGoSync,
}: {
  report: ValidationReport | null;
  error: string | null;
  validating: boolean;
  overflowCount: number;
  segments: Segment[];
  onRevalidate: () => void;
  onSelectSegment: (s: Segment) => void;
  onGoSync: () => void;
}): React.ReactElement {
  const { t } = useI18n();
  return (
    <>
      <div className="st-left__body">
        <p className="pn-h">{t("studio.validate.title")}</p>
        {error && <ErrorAlert title={t("studio.validate.error")} message={error} />}
        {validating && !report && (
          <div className="qr-empty" role="status">
            <span className="qr-spin" />
            <span>{t("studio.validate.checking")}</span>
          </div>
        )}
        {report && (
          <>
            <div
              className={report.is_ready ? "qr-alert qr-alert--success" : "qr-alert qr-alert--danger"}
              role="status"
            >
              <Icon name={report.is_ready ? "circle-check" : "circle-alert"} />
              <div className="qr-alert__content">
                <span className="qr-alert__title">
                  {report.is_ready ? t("studio.validate.ok") : t("studio.validate.blocked")}
                </span>
                <span className="qr-alert__body">
                  {t("studio.validate.counts", {
                    blocking: report.blocking_count ?? 0,
                    warnings: report.warning_count ?? 0,
                  })}
                </span>
              </div>
            </div>
            {overflowCount > 0 && (
              <div className="qr-check-row is-warn">
                <Icon name="triangle-alert" />
                <div>
                  <div className="qr-check-row__title">{t("studio.validate.overflowTitle", { count: overflowCount })}</div>
                  <div className="qr-check-row__detail">{t("studio.validate.overflowDetail")}</div>
                  <button type="button" className="qr-btn qr-btn--ghost qr-btn--sm" onClick={onGoSync}>
                    {t("studio.validate.goSync")}
                  </button>
                </div>
                <span className="qr-code">{OVERFLOW_CODE}</span>
              </div>
            )}
            {report.violations.map((v, i) => {
              const blocking = v.severity === "Blocking";
              const seg = v.segment_id ? segments.find((s) => s.id === v.segment_id) : undefined;
              return (
                <div key={`${v.code}-${i}`} className={blocking ? "qr-check-row is-fail" : "qr-check-row is-warn"}>
                  <Icon name={blocking ? "circle-alert" : "triangle-alert"} />
                  <div>
                    <div className="qr-check-row__title">
                      <span className="sr-only">
                        {blocking ? t("studio.validate.blockingLabel") : t("studio.validate.warningLabel")}
                      </span>
                      {v.title}
                    </div>
                    <div className="qr-check-row__detail">{v.description}</div>
                    {seg && (
                      <button
                        type="button"
                        className="qr-btn qr-btn--ghost qr-btn--sm"
                        onClick={() => onSelectSegment(seg)}
                      >
                        {t("studio.validate.showSegment", { code: segCode(seg, t) })}
                      </button>
                    )}
                  </div>
                  <span className="qr-code">{v.code}</span>
                </div>
              );
            })}
          </>
        )}
      </div>
      <div className="st-left__foot">
        <button
          type="button"
          className={validating ? "qr-btn qr-btn--secondary is-loading" : "qr-btn qr-btn--secondary"}
          disabled={validating}
          onClick={onRevalidate}
        >
          {validating && <span className="qr-spin" />}
          {t("studio.validate.recheck")}
        </button>
      </div>
    </>
  );
}

function ExportResult({ job, outputPath }: { job: ExportJob; outputPath: string }): React.ReactElement | null {
  const { t } = useI18n();
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState<string | null>(null);
  const view = job.view;
  if (view.phase !== "done") return null;

  if (view.ok) {
    const path = view.outputPath ?? outputPath;
    return (
      <div className="qr-alert qr-alert--success" role="status">
        <Icon name="circle-check" />
        <div className="qr-alert__content">
          <span className="qr-alert__title">{t("studio.export.done")}</span>
          <code className="mono export-path">{path}</code>
          <span className="qr-alert__body">{t("studio.export.openHint")}</span>
          {copyError && <span className="qr-error">{copyError}</span>}
        </div>
        <span className="qr-alert__actions">
          <button
            type="button"
            className="qr-btn qr-btn--secondary qr-btn--sm"
            onClick={() => {
              navigator.clipboard
                .writeText(path)
                .then(() => setCopied(true))
                .catch((e) => setCopyError(e instanceof Error ? e.message : String(e)));
            }}
          >
            <Icon name="copy" size="sm" />
            {copied ? t("common.copied") : t("studio.export.copyPath")}
          </button>
        </span>
      </div>
    );
  }

  if (view.errorCode === "CANCELED") {
    return (
      <div className="qr-alert qr-alert--info" role="status">
        <Icon name="info" />
        <div className="qr-alert__content">
          <span className="qr-alert__title">{t("studio.export.canceled")}</span>
          <span className="qr-alert__body">{t("studio.export.canceledBody")}</span>
        </div>
      </div>
    );
  }

  const hintKey = view.errorCode ? ERROR_HINTS[view.errorCode] : undefined;
  return (
    <div className="qr-alert qr-alert--danger" role="alert">
      <Icon name="circle-alert" />
      <div className="qr-alert__content">
        <span className="qr-alert__title">{t("studio.export.failed")}</span>
        {view.errorCode && (
          <span className="qr-alert__body">
            {t("studio.export.errorCode")} <code className="mono">{view.errorCode}</code>
          </span>
        )}
        <span className="qr-alert__body">{view.message}</span>
        {hintKey && <span className="qr-alert__body">{t(hintKey)}</span>}
      </div>
    </div>
  );
}

/** Inspector langkah Ekspor: keluaran video, progres, subtitle, batch, dan fitur yang belum tersedia. */
export function ExportInspector({
  project,
  totalTicks,
  report,
  validating,
  job,
  ensureSaved,
  onSubtitle,
  onBatch,
}: {
  project: Project;
  totalTicks: number;
  report: ValidationReport | null;
  validating: boolean;
  job: ExportJob;
  /** Menyimpan proyek bila ada perubahan (worker membaca proyek dari disk); `false` bila gagal. */
  ensureSaved: () => Promise<boolean>;
  onSubtitle: () => void;
  onBatch: () => void;
}): React.ReactElement {
  const { t } = useI18n();
  const pathId = useId();
  const pathHelpId = useId();
  const widthLabelId = useId();
  const [path, setPath] = useState("");
  const [pathTouched, setPathTouched] = useState(false);
  const [widthChoice, setWidthChoice] = useState<WidthChoice>("orig");
  const [overwrite, setOverwrite] = useState(false);
  const [preparing, setPreparing] = useState(false);

  const tpl = templateById(project.template_id);
  const trimmed = path.trim();
  const pathError =
    trimmed === ""
      ? t("studio.export.pathRequired")
      : !/\.mp4$/i.test(trimmed)
        ? t("studio.export.pathExtension")
        : null;
  const view = job.view;
  const busy = preparing || view.phase === "starting" || view.phase === "running";
  const ready = report?.is_ready === true && !validating;

  const start = async () => {
    setPathTouched(true);
    if (pathError || busy || !ready) return;
    setPreparing(true);
    const saved = await ensureSaved();
    setPreparing(false);
    if (!saved) return;
    const width = widthChoice === "orig" ? null : Number(widthChoice);
    await job.start(trimmed, width, overwrite);
  };

  const percent = view.phase === "running" && view.fraction !== null ? Math.round(view.fraction * 100) : null;
  const liveStep = percent === null ? null : Math.floor(percent / 10) * 10;
  const disabledReason = !ready
    ? validating
      ? t("studio.export.waitingValidation")
      : t("studio.export.notReady")
    : null;

  return (
    <>
      <div className="qr-panel__head">
        <span className="qr-panel__title">{t("studio.export.output")}</span>
      </div>
      <div className="insp-pad">
        <Summary
          rows={[
            [t("studio.export.size"), `${project.canvas.width} × ${project.canvas.height}`],
            [t("studio.export.duration"), formatTime(totalTicks)],
            [t("studio.style.template"), tpl ? t(tpl.name) : project.template_id],
          ]}
        />

        {job.error && <ErrorAlert title={t("studio.export.jobError")} message={job.error} onClose={job.clearError} />}

        <form
          className="export-form"
          onSubmit={(e) => {
            e.preventDefault();
            void start();
          }}
        >
          <div className="qr-fieldset">
            <label className="qr-label" htmlFor={pathId}>
              {t("studio.export.pathLabel")}
            </label>
            <span className={pathTouched && pathError ? "qr-field is-invalid" : "qr-field"}>
              <input
                id={pathId}
                value={path}
                placeholder={t("studio.export.pathPlaceholder")}
                autoComplete="off"
                spellCheck={false}
                disabled={busy}
                aria-invalid={pathTouched && pathError !== null}
                aria-describedby={pathHelpId}
                onChange={(e) => setPath(e.target.value)}
                onBlur={() => setPathTouched(true)}
              />
            </span>
            {pathTouched && pathError ? (
              <span className="qr-error" id={pathHelpId}>
                {pathError}
              </span>
            ) : (
              <span className="qr-help" id={pathHelpId}>
                {t("studio.export.pathHelp")}
              </span>
            )}
          </div>

          <div className="qr-fieldset">
            <span className="qr-label" id={widthLabelId}>
              {t("studio.export.widthLabel")}
            </span>
            <Segmented<WidthChoice>
              labelledBy={widthLabelId}
              value={widthChoice}
              onChange={setWidthChoice}
              options={WIDTH_CHOICES.map((w) => ({
                value: w,
                label: w === "orig" ? t("studio.export.widthOriginal") : `${w}`,
                disabled: busy || (w !== "orig" && Number(w) > project.canvas.width),
              }))}
            />
          </div>

          <label className="qr-choice">
            <input
              type="checkbox"
              role="switch"
              className="qr-switch"
              checked={overwrite}
              disabled={busy}
              onChange={(e) => setOverwrite(e.target.checked)}
            />
            {t("studio.export.overwrite")}
          </label>

          {view.phase === "running" || view.phase === "starting" ? (
            <div className="export-progress">
              <span
                className={
                  percent === null ? "qr-progress is-indeterminate" : "qr-progress"
                }
                role="progressbar"
                aria-label={t("studio.export.progressLabel")}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={percent ?? undefined}
                style={percent === null ? undefined : ({ "--v": percent / 100 } as React.CSSProperties)}
              />
              <span className="qr-help">
                {percent === null ? t("studio.export.starting") : `${percent}%`}
                {view.phase === "running" && view.message ? ` · ${view.message}` : ""}
              </span>
              <button
                type="button"
                className="qr-btn qr-btn--danger"
                disabled={view.phase !== "running"}
                onClick={job.cancel}
              >
                {t("studio.export.cancel")}
              </button>
            </div>
          ) : (
            <button
              type="submit"
              className={preparing ? "qr-btn qr-btn--primary is-loading" : "qr-btn qr-btn--primary"}
              disabled={!ready || preparing}
              aria-describedby={disabledReason ? `${pathHelpId}-why` : undefined}
            >
              {preparing ? <span className="qr-spin" /> : <Icon name="film" />}
              {view.phase === "done" ? t("studio.export.again") : t("studio.export.start")}
            </button>
          )}
          {disabledReason && view.phase !== "running" && (
            <span className="qr-help" id={`${pathHelpId}-why`}>
              {disabledReason}
            </span>
          )}
        </form>

        <div className="sr-only" role="status" aria-live="polite">
          {view.phase === "running" && liveStep !== null
            ? t("studio.export.liveProgress", { percent: liveStep })
            : view.phase === "done"
              ? view.ok
                ? t("studio.export.done")
                : t("studio.export.failed")
              : ""}
        </div>

        <ExportResult job={job} outputPath={trimmed} />

        <div className="qr-panel__head export-sub">
          <span className="qr-panel__title">{t("studio.export.more")}</span>
        </div>
        <button type="button" className="qr-btn qr-btn--secondary" onClick={onSubtitle}>
          <Icon name="file-output" />
          {t("studio.export.subtitleButton")}
        </button>
        <button type="button" className="qr-btn qr-btn--secondary" disabled={busy} onClick={onBatch}>
          <Icon name="scissors" />
          {t("studio.export.batchButton")}
        </button>
        <label className="qr-choice is-disabled">
          <input type="checkbox" role="switch" className="qr-switch" disabled />
          {t("studio.export.transparent")} · {t("common.unavailable")}
        </label>
      </div>
    </>
  );
}
