import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  commands,
  type AssetRef,
  type AyahSegment_Serialize as Segment,
  type ExportValidationReport_Serialize as ValidationReport,
  type PreviewFrame,
  type Project_Serialize as Project,
  type SubtitleFormat,
  type SubtitleTrackSelection,
} from "./bindings";
import { errorText, unwrap } from "./tauri";
import { ErrorAlert, Icon, Sheet, ThemeSwitch } from "./ui";

const TICKS_PER_SECOND = 48_000;
const FALLBACK_TOTAL_TICKS = 30 * TICKS_PER_SECOND;
const REVIEW_THRESHOLD = 0.8;
const PREVIEW_WIDTH = 480;
const PREVIEW_DEBOUNCE_MS = 200;

const STEPS = ["Sumber", "Sinkron", "Tampilan", "Ekspor"] as const;

/** Id templat = nama folder templat renderer (crates/<renderer>/templates). */
const TEMPLATES: ReadonlyArray<{ id: string; name: string }> = [
  { id: "subuh", name: "Subuh" },
  { id: "hening", name: "Hening Grafit" },
  { id: "terang", name: "Kertas Terang" },
  { id: "besar", name: "Besar (Hafalan)" },
  { id: "senja", name: "Senja" },
  { id: "naskh-klasik", name: "Naskh Klasik" },
  { id: "madinah", name: "Madinah Hijau" },
  { id: "kartu-apung", name: "Kartu Apung" },
  { id: "siaran-lower-third", name: "Papan Siaran" },
  { id: "kajian-side-panel", name: "Kajian Side Panel" },
  { id: "editorial-split", name: "Editorial Split" },
  { id: "tadabbur-wbw", name: "Tadabbur Kosakata" },
];

const TRACK_OPTIONS: ReadonlyArray<{ id: SubtitleTrackSelection; label: string }> = [
  { id: "AyahOnly", label: "Ayat saja" },
  { id: "TranslationOnly", label: "Terjemahan saja" },
  { id: "Bilingual", label: "Ayat dan terjemahan" },
];

const FORMATS: ReadonlyArray<SubtitleFormat> = ["Srt", "Vtt", "Ass"];

type SaveState =
  | { kind: "saved" }
  | { kind: "dirty" }
  | { kind: "saving" }
  | { kind: "error"; message: string };

function segStart(s: Segment): number {
  return s.start_tick ?? 0;
}

function segEnd(s: Segment): number {
  return s.end_tick ?? segStart(s);
}

function segCode(s: Segment): string {
  const range = s.word_range ? ` (kata ${s.word_range[0]}–${s.word_range[1]})` : "";
  return `${s.surah_id}:${s.ayah_number}${range}`;
}

function needsReview(s: Segment): boolean {
  return !s.manual_override && (s.confidence === null || s.confidence < REVIEW_THRESHOLD);
}

function confidenceText(s: Segment): string {
  return s.confidence === null ? "—" : `${Math.round(s.confidence * 100)}%`;
}

function formatTime(ticks: number): string {
  const total = Math.max(0, ticks) / TICKS_PER_SECOND;
  const mm = String(Math.floor(total / 60)).padStart(2, "0");
  const ss = String(Math.floor(total % 60)).padStart(2, "0");
  const cs = String(Math.floor((total % 1) * 100)).padStart(2, "0");
  return `${mm}:${ss}.${cs}`;
}

function fileName(path: string): string {
  return path.split(/[\\/]/).pop() ?? path;
}

/* ——— Preview: gambar PNG dari renderer Rust (jalur render yang sama dengan ekspor) ——— */

type PreviewState = {
  frame: PreviewFrame | null;
  error: string | null;
  loading: boolean;
};

function usePreview(project: Project, tick: number, enabled: boolean): PreviewState {
  const [state, setState] = useState<PreviewState>({ frame: null, error: null, loading: false });

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    setState((s) => ({ ...s, loading: true }));
    const timer = window.setTimeout(() => {
      unwrap(commands.previewFrame(project, Math.round(tick), PREVIEW_WIDTH))
        .then((frame) => {
          if (!cancelled) setState({ frame, error: null, loading: false });
        })
        .catch((e) => {
          if (!cancelled) setState({ frame: null, error: errorText(e), loading: false });
        });
    }, PREVIEW_DEBOUNCE_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [project, tick, enabled]);

  return state;
}

function Stage({
  project,
  tick,
  hasSegments,
}: {
  project: Project;
  tick: number;
  hasSegments: boolean;
}): React.ReactElement {
  const { frame, error, loading } = usePreview(project, tick, hasSegments);

  let body: React.ReactNode;
  if (!hasSegments) {
    body = (
      <div className="vw-msg">
        <Icon name="audio-waveform" size="lg" />
        <span>Belum ada segmen. Preview dirender dari teks ayat dataset setelah ada segmen.</span>
      </div>
    );
  } else if (error) {
    body = (
      <div className="vw-msg">
        <ErrorAlert title="Preview gagal dirender" message={error} />
      </div>
    );
  } else if (frame) {
    body = (
      <img
        src={frame.data_url}
        width={frame.width}
        height={frame.height}
        alt="Preview frame dari renderer"
      />
    );
  } else {
    body = (
      <div className="vw-msg" role="status">
        <span className="qr-spin" />
        <span>Merender preview…</span>
      </div>
    );
  }

  return (
    <>
      <div className="vw-bar">
        <span className="qr-badge qr-badge--plain">
          {project.canvas.aspect_ratio} · {project.canvas.width}×{project.canvas.height}
        </span>
        {frame && hasSegments && !error && (
          <span className="qr-badge qr-badge--plain">
            Preview {frame.width}×{frame.height}
          </span>
        )}
        {frame?.text_overflow && hasSegments && (
          <span className="qr-badge qr-badge--warning">
            Teks terlalu panjang untuk satu layar — bagi segmen per rentang kata
          </span>
        )}
      </div>
      <div className={loading && frame ? "vw-stage is-loading" : "vw-stage"}>
        {hasSegments && loading && (
          <span className="qr-progress is-indeterminate" role="status" aria-label="Memuat preview" />
        )}
        {body}
      </div>
    </>
  );
}

/* ——— Timeline ——— */

function Timeline({
  project,
  totalTicks,
  tick,
  selectedId,
  onSeek,
  onSelect,
}: {
  project: Project;
  totalTicks: number;
  tick: number;
  selectedId: string | null;
  onSeek: (tick: number) => void;
  onSelect: (s: Segment) => void;
}): React.ReactElement {
  const pct = (t: number) => `${(Math.min(Math.max(t, 0), totalTicks) / totalTicks) * 100}%`;
  const span = (a: number, b: number) => ({ left: pct(a), width: pct(Math.max(b - a, 0)) });
  const marks = [0, 0.25, 0.5, 0.75, 1];

  return (
    <div className="qr-tl">
      <div className="tl-body">
        <div
          className="qr-tl__ruler"
          role="slider"
          tabIndex={0}
          aria-label="Posisi"
          aria-valuemin={0}
          aria-valuemax={Math.round(totalTicks / TICKS_PER_SECOND)}
          aria-valuenow={Math.round(tick / TICKS_PER_SECOND)}
          onClick={(e) => {
            const r = e.currentTarget.getBoundingClientRect();
            onSeek(Math.min(Math.max((e.clientX - r.left) / r.width, 0), 1) * totalTicks);
          }}
          onKeyDown={(e) => {
            if (e.key === "ArrowRight") onSeek(Math.min(tick + TICKS_PER_SECOND, totalTicks));
            if (e.key === "ArrowLeft") onSeek(Math.max(tick - TICKS_PER_SECOND, 0));
          }}
        >
          {marks.map((m) => (
            <span key={m}>{formatTime(m * totalTicks).slice(0, 5)}</span>
          ))}
        </div>

        <div className="qr-track is-hot">
          <div className="qr-track__head">
            <span>Ayat</span>
          </div>
          <div className="qr-lane">
            {project.segments.length === 0 && (
              <div className="lane-hint">Belum ada segmen.</div>
            )}
            {project.segments.map((s) => {
              const review = needsReview(s);
              const cls = ["qr-clip"];
              if (s.id === selectedId) cls.push("is-selected");
              if (review) cls.push("is-review");
              return (
                <button
                  key={s.id}
                  type="button"
                  className={cls.join(" ")}
                  style={span(segStart(s), segEnd(s))}
                  aria-label={`Segmen ${segCode(s)}${review ? ", perlu ditinjau" : ""}`}
                  onClick={() => onSelect(s)}
                >
                  {review && <span className="qr-dot" />}
                  <span className="qr-clip__label">{segCode(s)}</span>
                  <span className="conf">{confidenceText(s)}</span>
                </button>
              );
            })}
          </div>
        </div>

        {project.tracks
          .filter((t) => t.kind !== "Ayah")
          .map((t) => (
            <div key={t.id} className={t.locked ? "qr-track is-locked" : "qr-track"}>
              <div className="qr-track__head">
                <span>{t.name}</span>
              </div>
              <div className="qr-lane">
                {t.clips.map((c) => (
                  <div
                    key={c.id}
                    className="qr-clip"
                    style={span(c.start_tick ?? 0, c.end_tick ?? 0)}
                  >
                    <span className="qr-clip__label">{c.label}</span>
                  </div>
                ))}
              </div>
            </div>
          ))}

        <div className="tl-lanes" aria-hidden="true">
          <div className="qr-playhead" style={{ left: pct(tick) }} />
        </div>
      </div>
    </div>
  );
}

/* ——— Isian waktu (detik) ——— */

function TimeField({
  label,
  ticks,
  onCommit,
}: {
  label: string;
  ticks: number | null;
  onCommit: (ticks: number) => string | null;
}): React.ReactElement {
  const current = ((ticks ?? 0) / TICKS_PER_SECOND).toFixed(3);
  const [text, setText] = useState(current);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setText(current);
    setError(null);
  }, [current]);

  const commit = () => {
    const v = Number(text.replace(",", "."));
    if (text.trim() === "" || !Number.isFinite(v) || v < 0) {
      setError("Masukkan detik, mis. 12,5");
      return;
    }
    setError(onCommit(Math.round(v * TICKS_PER_SECOND)));
  };

  return (
    <div className="qr-fieldset">
      <label className="qr-label">{label}</label>
      <span className={error ? "qr-field is-invalid" : "qr-field"}>
        <input
          value={text}
          inputMode="decimal"
          onChange={(e) => setText(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter") commit();
          }}
        />
        <span className="qr-field__suffix">dtk</span>
      </span>
      {error && <span className="qr-error">{error}</span>}
    </div>
  );
}

/* ——— Panel kiri & inspector per langkah ——— */

function AssetPanel({ assets }: { assets: AssetRef[] }): React.ReactElement {
  return (
    <>
      <div className="st-left__body">
        <p className="pn-h">Aset proyek</p>
        {assets.length === 0 ? (
          <div className="qr-empty">
            <Icon name="file-input" />
            <span>Belum ada aset di proyek ini.</span>
          </div>
        ) : (
          assets.map((a) => (
            <div key={a.id} className="qr-item">
              <Icon name={a.kind === "Audio" ? "audio-waveform" : a.kind === "Video" ? "film" : "image"} />
              <span className="qr-item__name">{fileName(a.path)}</span>
              <span className="qr-item__meta">{a.kind}</span>
            </div>
          ))
        )}
      </div>
      <div className="st-left__foot">
        <button type="button" className="qr-btn qr-btn--secondary" disabled>
          <Icon name="audio-waveform" />
          Sinkronkan
        </button>
        <span className="pn-note">Sinkron otomatis: Belum tersedia.</span>
      </div>
    </>
  );
}

function SegmentPanel({
  segments,
  selectedId,
  onSelect,
  onAccept,
  onNextReview,
}: {
  segments: Segment[];
  selectedId: string | null;
  onSelect: (s: Segment) => void;
  onAccept: () => void;
  onNextReview: () => void;
}): React.ReactElement {
  const pending = segments.filter(needsReview).length;
  const ratio = segments.length === 0 ? 0 : (segments.length - pending) / segments.length;
  return (
    <>
      <div className="st-left__body">
        {segments.length === 0 ? (
          <div className="qr-empty">
            <Icon name="audio-waveform" />
            <span>Belum ada segmen. Sinkron otomatis: Belum tersedia.</span>
          </div>
        ) : (
          <>
            <p className="pn-h">
              {pending > 0
                ? `${pending} dari ${segments.length} perlu ditinjau`
                : "Semua segmen sudah ditinjau"}
            </p>
            <span className="qr-progress" style={{ "--v": ratio } as React.CSSProperties} />
            {segments.map((s) => (
              <button
                key={s.id}
                type="button"
                className={s.id === selectedId ? "qr-item is-selected" : "qr-item"}
                onClick={() => onSelect(s)}
              >
                {needsReview(s) ? (
                  <span className="qr-dot" />
                ) : s.manual_override ? (
                  <Icon name="check" size="sm" />
                ) : (
                  <span className="dot-slot" />
                )}
                <span className="qr-item__name">
                  <b>{segCode(s)}</b>
                </span>
                <span className="qr-item__meta">{confidenceText(s)}</span>
              </button>
            ))}
          </>
        )}
      </div>
      <div className="st-left__foot">
        <div className="grid-2">
          <button
            type="button"
            className="qr-btn qr-btn--secondary"
            disabled={selectedId === null}
            onClick={onAccept}
          >
            Terima
          </button>
          <button
            type="button"
            className="qr-btn qr-btn--secondary"
            disabled={pending === 0}
            onClick={onNextReview}
          >
            Berikutnya
          </button>
        </div>
      </div>
    </>
  );
}

function TemplatePanel({
  templateId,
  onPick,
}: {
  templateId: string;
  onPick: (id: string) => void;
}): React.ReactElement {
  const known = TEMPLATES.some((t) => t.id === templateId);
  return (
    <div className="st-left__body">
      <p className="pn-h">Templat</p>
      <div className="opt-list">
        {!known && (
          <label className="qr-opt">
            <input type="radio" className="qr-radio" name="template" checked readOnly />
            <span>{templateId}</span>
            <span className="qr-opt__meta">saat ini</span>
          </label>
        )}
        {TEMPLATES.map((t) => (
          <label key={t.id} className="qr-opt">
            <input
              type="radio"
              className="qr-radio"
              name="template"
              checked={templateId === t.id}
              onChange={() => onPick(t.id)}
            />
            <span>{t.name}</span>
          </label>
        ))}
      </div>
    </div>
  );
}

function ValidationPanel({
  report,
  error,
  validating,
  onRevalidate,
  onSelectSegment,
  segments,
}: {
  report: ValidationReport | null;
  error: string | null;
  validating: boolean;
  onRevalidate: () => void;
  onSelectSegment: (s: Segment) => void;
  segments: Segment[];
}): React.ReactElement {
  return (
    <>
      <div className="st-left__body">
        <p className="pn-h">Pemeriksaan sebelum ekspor</p>
        {error && <ErrorAlert title="Validasi gagal" message={error} />}
        {validating && !report && (
          <div className="qr-empty" role="status">
            <span className="qr-spin" />
            <span>Memeriksa…</span>
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
                  {report.is_ready ? "Lolos pemeriksaan" : "Ada masalah yang menghalangi ekspor"}
                </span>
                <span className="qr-alert__body">
                  {report.blocking_count ?? 0} memblokir · {report.warning_count ?? 0} peringatan
                </span>
              </div>
            </div>
            {report.violations.map((v, i) => {
              const blocking = v.severity === "Blocking";
              const seg = v.segment_id ? segments.find((s) => s.id === v.segment_id) : undefined;
              return (
                <div key={`${v.code}-${i}`} className={blocking ? "qr-check-row is-fail" : "qr-check-row is-warn"}>
                  <Icon name={blocking ? "circle-alert" : "triangle-alert"} />
                  <div>
                    <div className="qr-check-row__title">{v.title}</div>
                    <div className="qr-check-row__detail">{v.description}</div>
                    {seg && (
                      <button
                        type="button"
                        className="qr-btn qr-btn--ghost qr-btn--sm"
                        onClick={() => onSelectSegment(seg)}
                      >
                        Lihat segmen {segCode(seg)}
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
          Periksa ulang
        </button>
      </div>
    </>
  );
}

function Summary({
  rows,
}: {
  rows: ReadonlyArray<readonly [string, string]>;
}): React.ReactElement {
  return (
    <dl className="sum">
      {rows.map(([k, v]) => (
        <React.Fragment key={k}>
          <dt>{k}</dt>
          <dd>{v}</dd>
        </React.Fragment>
      ))}
    </dl>
  );
}

/* ——— Ekspor subtitle ——— */

function SubtitleSheet({
  project,
  onClose,
}: {
  project: Project;
  onClose: () => void;
}): React.ReactElement {
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
      title="Ekspor subtitle"
      onClose={onClose}
      footer={
        <>
          <span className="qr-sheet__note">Simpan ke berkas: Belum tersedia.</span>
          <button type="button" className="qr-btn qr-btn--secondary" onClick={onClose}>
            Tutup
          </button>
          <button
            type="button"
            className={busy ? "qr-btn qr-btn--primary is-loading" : "qr-btn qr-btn--primary"}
            disabled={busy}
            onClick={() => void generate()}
          >
            {busy && <span className="qr-spin" />}
            Buat subtitle
          </button>
        </>
      }
    >
      {error && <ErrorAlert title="Subtitle gagal dibuat" message={error} />}
      <div className="field-row">
        <span className="lbl" id="sub-format">
          Format
        </span>
        <div className="qr-seg" role="radiogroup" aria-labelledby="sub-format">
          {FORMATS.map((f) => (
            <button
              key={f}
              type="button"
              role="radio"
              aria-checked={format === f}
              onClick={() => {
                setFormat(f);
                invalidate();
              }}
            >
              {f.toUpperCase()}
            </button>
          ))}
        </div>
      </div>
      <div className="field-row">
        <span className="lbl">Isi</span>
        <div className="opt-list">
          {TRACK_OPTIONS.map((t) => (
            <label key={t.id} className="qr-opt">
              <input
                type="radio"
                className="qr-radio"
                name="subtitle-track"
                checked={track === t.id}
                onChange={() => {
                  setTrack(t.id);
                  invalidate();
                }}
              />
              <span>{t.label}</span>
              <span />
            </label>
          ))}
        </div>
      </div>
      <div className="field-row">
        <span className="lbl">Nomor ayat</span>
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
          Sematkan nomor ayat di teks
        </label>
      </div>
      <div className="field-row">
        <span className="lbl">Catatan kaki</span>
        <label className="qr-choice is-disabled">
          <input type="checkbox" role="switch" className="qr-switch" disabled />
          Belum tersedia
        </label>
      </div>
      {output !== null && (
        <div className="qr-copy">
          <span className="qr-label">Hasil</span>
          <div className="qr-copy__box">
            <pre className="qr-copy__text">{output}</pre>
            <button
              type="button"
              className="qr-btn qr-btn--secondary qr-btn--sm"
              onClick={() => void copy(output)}
            >
              <Icon name="copy" size="sm" />
              {copied ? "Tersalin" : "Salin"}
            </button>
          </div>
        </div>
      )}
    </Sheet>
  );
}

/* ——— Studio ——— */

export function Studio({
  project: initialProject,
  onBack,
  onSave,
}: {
  project: Project;
  onBack: () => void;
  onSave: (project: Project) => Promise<void>;
}): React.ReactElement {
  const [project, setProject] = useState<Project>(initialProject);
  const [save, setSave] = useState<SaveState>({ kind: "saved" });
  const [step, setStep] = useState(1);
  const [tick, setTick] = useState(0);
  const [selectedId, setSelectedId] = useState<string | null>(
    initialProject.segments[0]?.id ?? null
  );
  const [report, setReport] = useState<ValidationReport | null>(null);
  const [reportError, setReportError] = useState<string | null>(null);
  const [validating, setValidating] = useState(false);
  const [validateNonce, setValidateNonce] = useState(0);
  const [subtitleOpen, setSubtitleOpen] = useState(false);
  const [leaving, setLeaving] = useState(false);

  const segments = project.segments;
  const selected = segments.find((s) => s.id === selectedId) ?? null;
  const dirty = save.kind !== "saved";

  const totalTicks = useMemo(() => {
    const ends = [
      ...segments.map(segEnd),
      ...project.tracks.flatMap((t) => t.clips.map((c) => c.end_tick ?? 0)),
    ];
    const max = Math.max(0, ...ends);
    return max > 0 ? max : FALLBACK_TOTAL_TICKS;
  }, [segments, project.tracks]);

  const edit = (fn: (p: Project) => Project) => {
    setProject(fn);
    setSave({ kind: "dirty" });
  };

  const patchSegment = (id: string, patch: Partial<Segment>) =>
    edit((p) => ({
      ...p,
      segments: p.segments.map((s) => (s.id === id ? { ...s, ...patch } : s)),
    }));

  const selectSegment = (s: Segment) => {
    setSelectedId(s.id);
    setTick(segStart(s));
  };

  const seek = (t: number) => {
    setTick(t);
    const hit = segments.find((s) => t >= segStart(s) && t < segEnd(s));
    if (hit) setSelectedId(hit.id);
  };

  const moveSegment = (dir: 1 | -1) => {
    const idx = segments.findIndex((s) => s.id === selectedId);
    const next = segments[idx + dir];
    if (next) selectSegment(next);
    else if (idx < 0 && segments[0]) selectSegment(segments[0]);
  };

  const nextReview = () => {
    const from = segments.findIndex((s) => s.id === selectedId);
    const ordered = [...segments.slice(from + 1), ...segments.slice(0, from + 1)];
    const hit = ordered.find(needsReview);
    if (hit) selectSegment(hit);
  };

  const saveProject = useCallback(async (): Promise<boolean> => {
    setSave({ kind: "saving" });
    try {
      await onSave(project);
      setSave({ kind: "saved" });
      return true;
    } catch (e) {
      setSave({ kind: "error", message: errorText(e) });
      return false;
    }
  }, [onSave, project]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        void saveProject();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [saveProject]);

  useEffect(() => {
    if (step !== 4) return;
    let cancelled = false;
    setValidating(true);
    commands
      .projectValidate(project)
      .then((r) => {
        if (cancelled) return;
        setReport(r);
        setReportError(null);
      })
      .catch((e) => {
        if (!cancelled) setReportError(errorText(e));
      })
      .finally(() => {
        if (!cancelled) setValidating(false);
      });
    return () => {
      cancelled = true;
    };
  }, [step, project, validateNonce]);

  const assets = Object.values(project.assets);
  const canvas = project.canvas;
  const templateName = TEMPLATES.find((t) => t.id === project.template_id)?.name ?? project.template_id;
  const overrides = Object.entries(project.style_overrides);

  const saveLabel =
    save.kind === "saved"
      ? "Tersimpan"
      : save.kind === "saving"
        ? "Menyimpan…"
        : save.kind === "dirty"
          ? "Belum disimpan"
          : "Gagal menyimpan";
  const saveCls =
    save.kind === "dirty" ? "save is-dirty" : save.kind === "error" ? "save is-error" : "save";

  let left: React.ReactNode;
  let inspector: React.ReactNode;

  if (step === 1) {
    left = <AssetPanel assets={assets} />;
    inspector = (
      <>
        <div className="qr-panel__head">
          <span className="qr-panel__title">Proyek</span>
        </div>
        <div className="insp-pad">
          <Summary
            rows={[
              ["Nama", project.name],
              ["Qari", project.reciter ?? "—"],
              ["Kanvas", `${canvas.width} × ${canvas.height}`],
              ["Rasio", canvas.aspect_ratio],
              ["Laju frame", `${(canvas.fps_num / canvas.fps_den).toFixed(2)} fps`],
              ["Aset", String(assets.length)],
              ["Segmen", String(segments.length)],
            ]}
          />
        </div>
      </>
    );
  } else if (step === 2) {
    left = (
      <SegmentPanel
        segments={segments}
        selectedId={selectedId}
        onSelect={selectSegment}
        onAccept={() => selected && patchSegment(selected.id, { manual_override: true })}
        onNextReview={nextReview}
      />
    );
    inspector = selected ? (
      <>
        <div className="qr-panel__head">
          <span className="qr-panel__title">Segmen {segCode(selected)}</span>
          <span className="qr-panel__actions">
            {needsReview(selected) ? (
              <span className="qr-badge qr-badge--warning">Keyakinan {confidenceText(selected)}</span>
            ) : (
              <span className="qr-badge qr-badge--success">
                {selected.manual_override ? "Diterima" : `Keyakinan ${confidenceText(selected)}`}
              </span>
            )}
          </span>
        </div>
        <div className="insp-pad" key={selected.id}>
          <TimeField
            label="Mulai"
            ticks={selected.start_tick}
            onCommit={(t) => {
              if (selected.end_tick !== null && t >= selected.end_tick)
                return "Mulai harus sebelum selesai";
              patchSegment(selected.id, { start_tick: t, manual_override: true });
              return null;
            }}
          />
          <TimeField
            label="Selesai"
            ticks={selected.end_tick}
            onCommit={(t) => {
              if (selected.start_tick !== null && t <= selected.start_tick)
                return "Selesai harus setelah mulai";
              patchSegment(selected.id, { end_tick: t, manual_override: true });
              return null;
            }}
          />
          <Summary
            rows={[
              ["Surah", String(selected.surah_id)],
              ["Ayat", String(selected.ayah_number)],
              [
                "Kata",
                selected.word_range
                  ? `${selected.word_range[0]}–${selected.word_range[1]}`
                  : "seluruh ayat",
              ],
              ["Waktu kata", `${selected.word_timings.length} kata`],
            ]}
          />
          <span className="qr-help">Teks ayat berasal dari dataset terverifikasi dan tidak dapat diubah.</span>
        </div>
      </>
    ) : (
      <div className="insp-empty">Belum ada segmen untuk diperiksa.</div>
    );
  } else if (step === 3) {
    left = (
      <TemplatePanel
        templateId={project.template_id}
        onPick={(id) => edit((p) => ({ ...p, template_id: id }))}
      />
    );
    inspector = (
      <>
        <div className="qr-panel__head">
          <span className="qr-panel__title">Gaya</span>
        </div>
        <div className="insp-pad">
          <Summary
            rows={[
              ["Templat", templateName],
              ["Penimpaan proyek", String(overrides.length)],
            ]}
          />
          {overrides.length > 0 && (
            <table className="qr-tbl">
              <tbody>
                {overrides.map(([k, v]) => (
                  <tr key={k}>
                    <td>{k}</td>
                    <td className="num">{v}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <span className="qr-help">Mengubah properti gaya satu per satu: Belum tersedia.</span>
        </div>
      </>
    );
  } else {
    left = (
      <ValidationPanel
        report={report}
        error={reportError}
        validating={validating}
        onRevalidate={() => setValidateNonce((n) => n + 1)}
        onSelectSegment={selectSegment}
        segments={segments}
      />
    );
    inspector = (
      <>
        <div className="qr-panel__head">
          <span className="qr-panel__title">Keluaran</span>
        </div>
        <div className="insp-pad">
          <Summary
            rows={[
              ["Ukuran", `${canvas.width} × ${canvas.height}`],
              ["Durasi", formatTime(totalTicks)],
              ["Templat", templateName],
            ]}
          />
          <button
            type="button"
            className="qr-btn qr-btn--secondary"
            onClick={() => setSubtitleOpen(true)}
          >
            <Icon name="file-output" />
            Ekspor subtitle…
          </button>
          <button type="button" className="qr-btn qr-btn--primary" disabled>
            <Icon name="film" />
            Ekspor video (MP4)
          </button>
          <span className="qr-help">Ekspor video MP4: Belum tersedia.</span>
        </div>
      </>
    );
  }

  return (
    <div className="studio">
      <header className="st-hd">
        <div className="l">
          <button
            type="button"
            className="qr-btn qr-btn--ghost"
            onClick={() => (dirty ? setLeaving(true) : onBack())}
          >
            <Icon name="chevron-left" />
            Beranda
          </button>
          <span className="st-name">
            {project.name}
            {project.reciter && <small>{project.reciter}</small>}
          </span>
          <span className={saveCls} title={save.kind === "error" ? save.message : undefined}>
            <Icon name={save.kind === "saved" ? "check" : "circle-alert"} />
            {saveLabel}
          </span>
        </div>
        <ol className="qr-flow" aria-label="Alur kerja">
          {STEPS.map((name, i) => {
            const n = i + 1;
            const cur = n === step;
            const done = n < step;
            return (
              <li
                key={name}
                className={cur ? "is-current" : done ? "is-done" : undefined}
                aria-current={cur ? "step" : undefined}
              >
                {i > 0 && (
                  <span className="qr-flow__sep" aria-hidden="true">
                    <Icon name="chevron-right" size="sm" />
                  </span>
                )}
                <button type="button" onClick={() => setStep(n)}>
                  <span className="qr-flow__n">
                    {done ? <Icon name="check" size="sm" /> : n}
                  </span>
                  <span className="lbl-t">{name}</span>
                </button>
              </li>
            );
          })}
        </ol>
        <div className="r">
          <ThemeSwitch />
          <button
            type="button"
            className="qr-btn qr-btn--secondary"
            disabled={save.kind === "saving"}
            onClick={() => void saveProject()}
          >
            <Icon name="save" />
            Simpan
          </button>
          <button type="button" className="qr-btn qr-btn--primary" onClick={() => setStep(4)}>
            <Icon name="file-output" />
            Ekspor
          </button>
        </div>
      </header>

      <div className="st-body">
        <aside className="st-left" aria-label="Panel kiri">
          {save.kind === "error" && (
            <div className="insp-pad">
              <ErrorAlert title="Gagal menyimpan" message={save.message} />
            </div>
          )}
          {left}
        </aside>
        <section className="st-viewer" aria-label="Pratinjau">
          <Stage project={project} tick={tick} hasSegments={segments.length > 0} />
          <div className="transport-row">
            <span className="qr-transport">
              <button
                type="button"
                className="qr-btn qr-btn--ghost qr-btn--icon"
                aria-label="Segmen sebelumnya"
                disabled={segments.length === 0}
                onClick={() => moveSegment(-1)}
              >
                <Icon name="skip-back" />
              </button>
              <button
                type="button"
                className="qr-play"
                aria-label="Putar (Belum tersedia)"
                title="Pemutaran audio: Belum tersedia"
                disabled
              >
                <Icon name="play" />
              </button>
              <button
                type="button"
                className="qr-btn qr-btn--ghost qr-btn--icon"
                aria-label="Segmen berikutnya"
                disabled={segments.length === 0}
                onClick={() => moveSegment(1)}
              >
                <Icon name="step-forward" />
              </button>
              <span className="qr-tc">{formatTime(tick)}</span>
              <span className="qr-tc qr-tc--dim">/ {formatTime(totalTicks)}</span>
            </span>
          </div>
        </section>
        <aside className="st-insp" aria-label="Inspector">
          {inspector}
        </aside>
      </div>

      <div className="st-tl">
        <Timeline
          project={project}
          totalTicks={totalTicks}
          tick={tick}
          selectedId={selectedId}
          onSeek={seek}
          onSelect={selectSegment}
        />
      </div>

      {subtitleOpen && <SubtitleSheet project={project} onClose={() => setSubtitleOpen(false)} />}
      {leaving && (
        <Sheet
          title="Perubahan belum disimpan"
          onClose={() => setLeaving(false)}
          footer={
            <>
              <button type="button" className="qr-btn qr-btn--ghost" onClick={() => setLeaving(false)}>
                Batal
              </button>
              <button type="button" className="qr-btn qr-btn--danger" onClick={onBack}>
                Buang perubahan
              </button>
              <button
                type="button"
                className="qr-btn qr-btn--primary"
                onClick={() => {
                  void saveProject().then((ok) => {
                    if (ok) onBack();
                    else setLeaving(false);
                  });
                }}
              >
                Simpan dan keluar
              </button>
            </>
          }
        >
          <p>Proyek ini punya perubahan yang belum disimpan.</p>
        </Sheet>
      )}
    </div>
  );
}
