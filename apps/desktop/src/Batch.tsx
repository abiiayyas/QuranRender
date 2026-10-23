import React, { useId, useState } from "react";
import { commands, type BatchClipDto, type BatchMode } from "./bindings";
import { useI18n } from "./i18n";
import { errorText, unwrap } from "./tauri";
import { ErrorAlert, Icon, Segmented, Sheet } from "./ui";

type Method = BatchMode["method"];

const MAX_U32 = 4_294_967_295;
const NONE = "—";

/** Bilangan bulat positif yang muat di u32 (tipe di sisi Rust); `null` bila tidak valid. */
function parsePositiveInt(text: string): number | null {
  const v = text.trim();
  if (!/^\d+$/.test(v)) return null;
  const n = Number(v);
  return n >= 1 && n <= MAX_U32 ? n : null;
}

/** Path absolut POSIX, Windows (`C:\` / `C:/`) atau UNC; sisi Rust menolak path relatif. */
function isAbsolutePath(path: string): boolean {
  return path.startsWith("/") || path.startsWith("\\\\") || /^[A-Za-z]:[\\/]/.test(path);
}

function formatSeconds(seconds: number | null): string {
  if (seconds === null || !Number.isFinite(seconds) || seconds < 0) return NONE;
  const total = Math.round(seconds);
  const mm = String(Math.floor(total / 60)).padStart(2, "0");
  const ss = String(total % 60).padStart(2, "0");
  return `${mm}:${ss}`;
}

function ayahRange(clip: BatchClipDto): string {
  return clip.start_ayah === clip.end_ayah
    ? `${clip.surah_id}:${clip.start_ayah}`
    : `${clip.surah_id}:${clip.start_ayah}–${clip.end_ayah}`;
}

function FieldError({ id, message }: { id: string; message: string }): React.ReactElement {
  return (
    <span className="qr-error" id={id}>
      <Icon name="circle-alert" size="sm" />
      {message}
    </span>
  );
}

/** Pecah proyek menjadi klip, pratinjau pembagian, lalu masukkan ke antrean. Tanpa state milik App. */
export function BatchSheet({
  projectId,
  projectName,
  onClose,
  onEnqueued,
}: {
  projectId: string;
  projectName: string;
  onClose: () => void;
  onEnqueued: (count: number) => void;
}): React.ReactElement {
  const { t } = useI18n();
  const uid = useId();
  const [method, setMethod] = useState<Method>("by_ayah_count");
  const [countText, setCountText] = useState("5");
  const [secondsText, setSecondsText] = useState("60");
  const [outputDir, setOutputDir] = useState("");
  const [widthText, setWidthText] = useState("");
  const [overwrite, setOverwrite] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  const [previewing, setPreviewing] = useState(false);
  const [clips, setClips] = useState<BatchClipDto[] | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);

  const [enqueuing, setEnqueuing] = useState(false);
  const [enqueueError, setEnqueueError] = useState<string | null>(null);
  const [enqueued, setEnqueued] = useState<number | null>(null);

  const valueText = method === "by_ayah_count" ? countText : secondsText;
  const parsedValue = parsePositiveInt(valueText);
  const mode: BatchMode | null =
    parsedValue === null
      ? null
      : method === "by_ayah_count"
        ? { method: "by_ayah_count", count: parsedValue }
        : { method: "by_max_duration_sec", max_seconds: parsedValue };
  const valueProblem =
    mode !== null
      ? null
      : method === "by_ayah_count"
        ? t("app.batch.countInvalid")
        : t("app.batch.secondsInvalid");

  const dir = outputDir.trim();
  const dirProblem =
    dir.length === 0
      ? t("app.batch.outputRequired")
      : !isAbsolutePath(dir)
        ? t("app.batch.outputAbsolute")
        : null;

  const widthTrimmed = widthText.trim();
  const parsedWidth = widthTrimmed.length === 0 ? null : parsePositiveInt(widthTrimmed);
  const widthProblem =
    widthTrimmed.length > 0 && parsedWidth === null ? t("app.batch.widthInvalid") : null;

  // Galat muncul setelah pengguna mencoba melanjutkan (atau, untuk angka, setelah mengetik).
  const showValueProblem = valueProblem !== null && (submitted || valueText.trim().length > 0);
  const showDirProblem = submitted && dirProblem !== null;
  const showWidthProblem = widthProblem !== null;

  const changeMethod = (next: Method) => {
    setMethod(next);
    setClips(null);
    setPreviewError(null);
  };

  const preview = async () => {
    setSubmitted(true);
    if (mode === null || previewing) return;
    setPreviewing(true);
    setPreviewError(null);
    try {
      setClips(await unwrap(commands.batchSplit(projectId, mode)));
    } catch (err) {
      setClips(null);
      setPreviewError(errorText(err));
    } finally {
      setPreviewing(false);
    }
  };

  const enqueue = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitted(true);
    if (mode === null || dirProblem !== null || widthProblem !== null || enqueuing) return;
    setEnqueuing(true);
    setEnqueueError(null);
    try {
      const jobs = await unwrap(
        commands.queueEnqueueBatch(projectId, mode, dir, parsedWidth, overwrite)
      );
      setEnqueued(jobs.length);
      onEnqueued(jobs.length);
    } catch (err) {
      setEnqueueError(errorText(err));
    } finally {
      setEnqueuing(false);
    }
  };

  const busy = previewing || enqueuing;
  const valueId = `${uid}-value`;

  return (
    <form onSubmit={(e) => void enqueue(e)} noValidate>
      <Sheet
        title={t("app.batch.title")}
        size="md"
        onClose={onClose}
        footer={
          enqueued !== null ? (
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
                className={enqueuing ? "qr-btn qr-btn--primary is-loading" : "qr-btn qr-btn--primary"}
                disabled={busy}
              >
                {enqueuing ? <span className="qr-spin" /> : <Icon name="layers" />}
                {t("app.batch.enqueue")}
              </button>
            </>
          )
        }
      >
        <p>{t("app.batch.intro", { name: projectName })}</p>

        {enqueued !== null && (
          <div className="qr-alert qr-alert--success" role="status">
            <Icon name="circle-check" />
            <div className="qr-alert__content">
              <span className="qr-alert__title">{t("app.batch.enqueued", { count: enqueued })}</span>
              <span className="qr-alert__body">{t("app.batch.enqueuedHint")}</span>
            </div>
          </div>
        )}
        {enqueueError && <ErrorAlert title={t("app.batch.enqueueFailed")} message={enqueueError} />}

        {enqueued === null && (
          <>
            <div className="qr-fieldset">
              <span className="qr-label" id={`${uid}-method`}>
                {t("app.batch.method")}
              </span>
              <Segmented<Method>
                labelledBy={`${uid}-method`}
                value={method}
                onChange={changeMethod}
                options={[
                  { value: "by_ayah_count", label: t("app.batch.method.ayah") },
                  { value: "by_max_duration_sec", label: t("app.batch.method.duration") },
                ]}
              />
            </div>

            <div className="qr-fieldset">
              <label className="qr-label" htmlFor={valueId}>
                {method === "by_ayah_count" ? t("app.batch.countLabel") : t("app.batch.secondsLabel")}
              </label>
              <span className={showValueProblem ? "qr-field is-invalid" : "qr-field"}>
                <input
                  id={valueId}
                  type="number"
                  inputMode="numeric"
                  min={1}
                  step={1}
                  value={valueText}
                  data-autofocus
                  disabled={busy}
                  aria-invalid={showValueProblem}
                  aria-describedby={showValueProblem ? `${valueId}-err` : `${valueId}-help`}
                  onChange={(e) => {
                    if (method === "by_ayah_count") setCountText(e.target.value);
                    else setSecondsText(e.target.value);
                    setClips(null);
                    setPreviewError(null);
                  }}
                />
                <span className="qr-field__suffix">
                  {method === "by_ayah_count" ? t("app.batch.countUnit") : t("app.batch.secondsUnit")}
                </span>
              </span>
              {showValueProblem && valueProblem !== null ? (
                <FieldError id={`${valueId}-err`} message={valueProblem} />
              ) : (
                <span className="qr-help" id={`${valueId}-help`}>
                  {method === "by_ayah_count" ? t("app.batch.countHelp") : t("app.batch.secondsHelp")}
                </span>
              )}
            </div>

            <div className="qr-section">
              <div>
                <button
                  type="button"
                  className={
                    previewing ? "qr-btn qr-btn--secondary is-loading" : "qr-btn qr-btn--secondary"
                  }
                  disabled={busy || mode === null}
                  onClick={() => void preview()}
                >
                  {previewing ? <span className="qr-spin" /> : <Icon name="scissors" />}
                  {t("app.batch.preview")}
                </button>
              </div>
              {previewError && (
                <ErrorAlert title={t("app.batch.previewFailed")} message={previewError} />
              )}
              {clips !== null && clips.length === 0 && (
                <p className="muted" role="status">
                  {t("app.batch.previewEmpty")}
                </p>
              )}
              {clips !== null && clips.length > 0 && (
                <>
                  <p className="muted" role="status">
                    {t("app.batch.previewCount", { count: clips.length })}
                  </p>
                  <div
                    className="batch-tbl"
                    role="region"
                    tabIndex={0}
                    aria-label={t("app.batch.tableLabel")}
                  >
                    <table className="qr-tbl">
                      <thead>
                        <tr>
                          <th scope="col">{t("app.batch.col.index")}</th>
                          <th scope="col">{t("app.batch.col.title")}</th>
                          <th scope="col">{t("app.batch.col.ayah")}</th>
                          <th scope="col">{t("app.batch.col.duration")}</th>
                          <th scope="col">{t("app.batch.col.check")}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {clips.map((c) => (
                          <tr key={c.clip_index}>
                            <td className="num">{c.clip_index}</td>
                            <td>{c.title}</td>
                            <td className="num">{ayahRange(c)}</td>
                            <td className="num">{formatSeconds(c.duration_seconds)}</td>
                            <td>
                              {c.has_low_confidence ? (
                                <span className="qr-badge qr-badge--plain qr-badge--warning">
                                  <Icon name="triangle-alert" size="sm" />
                                  {t("app.batch.lowConfidence")}
                                </span>
                              ) : (
                                NONE
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </>
              )}
            </div>

            <div className="qr-fieldset">
              <label className="qr-label" htmlFor={`${uid}-dir`}>
                {t("app.batch.outputLabel")}
              </label>
              <span className={showDirProblem ? "qr-field is-invalid" : "qr-field"}>
                <input
                  id={`${uid}-dir`}
                  value={outputDir}
                  autoComplete="off"
                  spellCheck={false}
                  disabled={busy}
                  placeholder={t("app.batch.outputPlaceholder")}
                  aria-invalid={showDirProblem}
                  aria-describedby={showDirProblem ? `${uid}-dir-err` : `${uid}-dir-help`}
                  onChange={(e) => setOutputDir(e.target.value)}
                />
              </span>
              {showDirProblem && dirProblem !== null ? (
                <FieldError id={`${uid}-dir-err`} message={dirProblem} />
              ) : (
                <span className="qr-help" id={`${uid}-dir-help`}>
                  {t("app.batch.outputHelp")}
                </span>
              )}
            </div>

            <div className="qr-fieldset">
              <label className="qr-label" htmlFor={`${uid}-width`}>
                {t("app.batch.widthLabel")}
              </label>
              <span className={showWidthProblem ? "qr-field is-invalid" : "qr-field"}>
                <input
                  id={`${uid}-width`}
                  type="number"
                  inputMode="numeric"
                  min={1}
                  step={1}
                  value={widthText}
                  disabled={busy}
                  placeholder={t("app.batch.widthPlaceholder")}
                  aria-invalid={showWidthProblem}
                  aria-describedby={showWidthProblem ? `${uid}-width-err` : `${uid}-width-help`}
                  onChange={(e) => setWidthText(e.target.value)}
                />
                <span className="qr-field__suffix">{t("app.batch.widthUnit")}</span>
              </span>
              {showWidthProblem && widthProblem !== null ? (
                <FieldError id={`${uid}-width-err`} message={widthProblem} />
              ) : (
                <span className="qr-help" id={`${uid}-width-help`}>
                  {t("app.batch.widthHelp")}
                </span>
              )}
            </div>

            <div className="qr-prop">
              <label className="qr-prop__label batch-grow" htmlFor={`${uid}-overwrite`}>
                {t("app.batch.overwrite")}
              </label>
              <input
                id={`${uid}-overwrite`}
                type="checkbox"
                role="switch"
                className="qr-switch"
                checked={overwrite}
                disabled={busy}
                onChange={(e) => setOverwrite(e.target.checked)}
              />
            </div>
          </>
        )}
      </Sheet>
    </form>
  );
}
