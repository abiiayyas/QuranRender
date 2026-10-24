import React, { useEffect, useId, useRef, useState } from "react";
import { formatTime } from "../format";
import { useI18n } from "../i18n";
import { ErrorAlert, Icon, Segmented, Sheet } from "../ui";
import type {
  AlignProgressEvent as AlignProgress,
  CloudAlignOptions,
  CloudModel,
  DetectedRange,
} from "../bindings";
import { Kbd, KEYS, MOD_KEY, Summary } from "./parts";
import { TimeField } from "./TimeField";
import type { AyahRange } from "./SourceStep";
import {
  confidenceText,
  isSpecial,
  needsReview,
  reviewReasons,
  segCode,
  segEnd,
  segmentWords,
  segStart,
  splitSegmentAt,
  wordSpan,
  type Segment,
  type WordSelection,
} from "./model";
import { rangeLabel, surahName, useSurahs } from "./surahs";
import { translationPending } from "./translation";

export type AlignSummary =
  | { kind: "vad"; speechRegions: number; versesExpected: number; warnings: string[] }
  | { kind: "cloud"; detected: DetectedRange[]; warnings: string[] };

export type AlignError = { title: string; message: string };

/** Tinjau hasil sinkron, atau sinkron manual dengan papan ketik (pintasan berbeda per mode). */
export type SyncMode = "review" | "manual";

export type ManualSync = {
  /** `undefined` selama posisi lanjut dihitung (kata dimuat); `null` bila sudah melewati akhir mushaf. */
  selection: WordSelection | null | undefined;
  /** Kata ayat terpilih; `null` selama dimuat. */
  words: string[] | null;
  error: AlignError | null;
  /** Awal segmen berikutnya (akhir segmen terakhir, atau penanda jeda). */
  nextStart: number;
  gap: boolean;
  onPick: (word: number) => void;
  onAyah: (dir: 1 | -1) => void;
  onCreate: () => void;
  onUndo: () => void;
  onSpecial: (kind: "Basmala" | "Istiadha") => void;
  onGap: () => void;
  onDismissError: () => void;
};

const STAGE_KEYS = {
  preparing: "studio.sync.stage.preparing",
  uploading: "studio.sync.stage.uploading",
  queued: "studio.sync.stage.queued",
  processing: "studio.sync.stage.processing",
  mapping: "studio.sync.stage.mapping",
  done: "studio.sync.stage.done",
} as const;

function SummaryAlert({ summary }: { summary: AlignSummary }): React.ReactElement {
  const { t } = useI18n();
  const surahs = useSurahs();
  const ok =
    summary.warnings.length === 0 &&
    (summary.kind === "cloud" ? summary.detected.length > 0 : summary.speechRegions === summary.versesExpected);
  const title =
    summary.kind === "vad"
      ? t("studio.sync.regions", { regions: summary.speechRegions, verses: summary.versesExpected })
      : summary.detected.length === 0
        ? t("studio.sync.detectedNone")
        : t("studio.sync.detected", {
            ranges: summary.detected
              .map((d) => rangeLabel(surahs, d.surah, d.from_ayah, d.to_ayah))
              .join(", "),
          });
  return (
    <div className={ok ? "qr-alert qr-alert--success" : "qr-alert qr-alert--warning"} role="status">
      <Icon name={ok ? "circle-check" : "triangle-alert"} />
      <div className="qr-alert__content">
        <span className="qr-alert__title">{title}</span>
        {summary.warnings.map((w, i) => (
          <span key={`${i}-${w}`} className="qr-alert__body">
            {w}
          </span>
        ))}
      </div>
    </div>
  );
}

/** Pemilih kata ayat aktif untuk sinkron manual (↑/↓ memperluas/mempersempit, V seluruh ayat). */
function ManualSyncPanel({ manual }: { manual: ManualSync }): React.ReactElement {
  const { t } = useI18n();
  const sel = manual.selection;
  const groupId = useId();
  if (sel === null) {
    return <span className="pn-note">{t("studio.manual.end")}</span>;
  }
  if (sel === undefined) {
    return manual.error ? (
      <ErrorAlert title={manual.error.title} message={manual.error.message} onClose={manual.onDismissError} />
    ) : (
      <span className="pn-note" role="status">
        <span className="qr-spin" /> {t("studio.manual.loading")}
      </span>
    );
  }
  const words = manual.words;
  return (
    <div className="manual-panel">
      <div className="manual-head">
        <button
          type="button"
          className="qr-btn qr-btn--ghost qr-btn--icon qr-btn--sm"
          aria-label={t("studio.manual.prevAyah")}
          disabled={sel.surah === 1 && sel.ayah === 1}
          onClick={() => manual.onAyah(-1)}
        >
          <Icon name="chevron-left" size="sm" />
        </button>
        <b id={groupId}>{t("studio.manual.ayah", { code: `${sel.surah}:${sel.ayah}` })}</b>
        <button
          type="button"
          className="qr-btn qr-btn--ghost qr-btn--icon qr-btn--sm"
          aria-label={t("studio.manual.nextAyah")}
          onClick={() => manual.onAyah(1)}
        >
          <Icon name="chevron-right" size="sm" />
        </button>
      </div>
      {manual.error && (
        <ErrorAlert title={manual.error.title} message={manual.error.message} onClose={manual.onDismissError} />
      )}
      {words === null ? (
        manual.error === null && (
          <span className="pn-note" role="status">
            <span className="qr-spin" /> {t("studio.manual.loading")}
          </span>
        )
      ) : (
        <>
          <div className="word-grid" role="group" aria-labelledby={groupId}>
            {words.map((w, i) => {
              const k = i + 1;
              const picked = k >= sel.from && k <= sel.to;
              const cls = picked ? "word-chip is-picked" : k < sel.from ? "word-chip is-done" : "word-chip";
              return (
                <button
                  key={k}
                  type="button"
                  className={cls}
                  aria-pressed={picked}
                  aria-label={t("studio.manual.word", { n: k, word: w })}
                  onClick={() => manual.onPick(k)}
                >
                  <span className="ar-word" lang="ar" dir="rtl">
                    {w}
                  </span>
                  <small>{k}</small>
                </button>
              );
            })}
          </div>
          <span className="pn-note" role="status">
            {sel.from === 1 && sel.to >= words.length
              ? t("studio.manual.selectionWhole")
              : t("studio.manual.selection", { from: sel.from, to: sel.to, count: words.length })}
          </span>
        </>
      )}
      <span className="pn-note">
        {manual.gap
          ? t("studio.manual.startsAtGap", { time: formatTime(manual.nextStart) })
          : t("studio.manual.startsAt", { time: formatTime(manual.nextStart) })}
      </span>
      <div className="manual-actions">
        <button type="button" className="qr-btn qr-btn--secondary qr-btn--sm" onClick={() => manual.onSpecial("Basmala")}>
          {t("studio.seg.basmala")}
          <Kbd>{KEYS.basmala}</Kbd>
        </button>
        <button type="button" className="qr-btn qr-btn--secondary qr-btn--sm" onClick={() => manual.onSpecial("Istiadha")}>
          {t("studio.seg.istiadha")}
          <Kbd>{KEYS.istiadha}</Kbd>
        </button>
        <button type="button" className="qr-btn qr-btn--secondary qr-btn--sm" onClick={manual.onGap}>
          {t("studio.manual.gap")}
          <Kbd>{KEYS.gap}</Kbd>
        </button>
      </div>
    </div>
  );
}

/** Panel kiri langkah Sinkron: sinkron AI/offline/manual, tinjau peringatan dan daftar segmen. */
export function SyncPanel({
  segments,
  primaryEdition,
  selectedId,
  range,
  hasAudio,
  aligning,
  progress,
  alignError,
  summary,
  scan,
  overflowOf,
  mode,
  manual,
  onMode,
  onAlignCloud,
  onAlignOffline,
  onDismissError,
  onSelect,
  onAccept,
  onNextReview,
  onScan,
}: {
  segments: Segment[];
  /** Edisi utama proyek: terjemahan segmen sebagian ayat yang belum ditinjau ikut dihitung. */
  primaryEdition: string | null;
  selectedId: string | null;
  range: AyahRange;
  hasAudio: boolean;
  aligning: "cloud" | "vad" | null;
  progress: AlignProgress | null;
  alignError: AlignError | null;
  summary: AlignSummary | null;
  scan: { done: number; total: number } | null;
  overflowOf: (s: Segment) => boolean | undefined;
  mode: SyncMode;
  manual: ManualSync;
  onMode: (mode: SyncMode) => void;
  onAlignCloud: () => void;
  onAlignOffline: () => void;
  onDismissError: () => void;
  onSelect: (s: Segment) => void;
  onAccept: () => void;
  onNextReview: () => void;
  onScan: () => void;
}): React.ReactElement {
  const { t } = useI18n();
  const surahs = useSurahs();
  const listRef = useRef<HTMLDivElement>(null);
  const listLabel = useId();
  const modeLabel = useId();
  const pending = segments.filter((s) => needsReview(s, primaryEdition)).length;
  const reasons = segments.flatMap(reviewReasons);
  const lowCount = reasons.filter((r) => r === "lowConfidence").length;
  const missingCount = reasons.filter((r) => r === "missingWords").length;
  const translationCount = segments.filter((s) => translationPending(s, primaryEdition)).length;
  const ratio = segments.length === 0 ? 0 : (segments.length - pending) / segments.length;
  const flagged = segments.filter((s) => overflowOf(s) === true).length;

  // Fokus mengikuti pilihan hanya bila pilihan berubah lewat papan ketik di daftar ini.
  const focusFollows = useRef(false);
  useEffect(() => {
    const item = listRef.current?.querySelector<HTMLElement>(`[data-seg-id="${selectedId}"]`);
    if (!item) return;
    item.scrollIntoView({ block: "nearest" });
    if (focusFollows.current) {
      item.focus();
      focusFollows.current = false;
    }
  }, [selectedId]);

  const onListKey = (e: React.KeyboardEvent<HTMLDivElement>) => {
    focusFollows.current = true;
    const idx = segments.findIndex((s) => s.id === selectedId);
    const move = (to: number) => {
      const target = segments[Math.min(Math.max(to, 0), segments.length - 1)];
      if (target) onSelect(target);
    };
    if (e.key === "ArrowDown") {
      e.preventDefault();
      move(idx + 1);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      move(idx < 0 ? 0 : idx - 1);
    } else if (e.key === "Home") {
      e.preventDefault();
      move(0);
    } else if (e.key === "End") {
      e.preventDefault();
      move(segments.length - 1);
    } else if (e.key === "Enter" && selectedId !== null && mode === "review") {
      e.preventDefault();
      onAccept();
    }
  };

  const busy = aligning !== null;
  const noAudioId = `${listLabel}-noaudio`;

  return (
    <>
      <div className="st-left__body">
        <p className="qr-help honest-note">
          <b>{t("studio.sync.honestTitle")}.</b> {t("studio.sync.honestBody")}
        </p>

        <button
          type="button"
          className={aligning === "cloud" ? "qr-btn qr-btn--primary is-loading" : "qr-btn qr-btn--primary"}
          disabled={!hasAudio || busy}
          aria-describedby={hasAudio ? undefined : noAudioId}
          onClick={onAlignCloud}
        >
          {aligning === "cloud" ? <span className="qr-spin" /> : <Icon name="audio-waveform" />}
          {t("studio.sync.runCloud")}
        </button>
        <button
          type="button"
          className={aligning === "vad" ? "qr-btn qr-btn--secondary is-loading" : "qr-btn qr-btn--secondary"}
          disabled={!hasAudio || busy}
          aria-describedby={hasAudio ? undefined : noAudioId}
          onClick={onAlignOffline}
        >
          {aligning === "vad" && <span className="qr-spin" />}
          {t("studio.sync.runOffline")}
        </button>
        {!hasAudio && (
          <span className="pn-note" id={noAudioId}>
            {t("studio.sync.needAudio")}
          </span>
        )}
        <span className="pn-note">
          {t("studio.sync.rangeNote", { surah: surahName(surahs, range.surah), from: range.from, to: range.to })}
        </span>

        {aligning === "cloud" && (
          <span className="pn-note" role="status">
            {progress ? t(STAGE_KEYS[progress.stage]) : t("studio.sync.stage.preparing")}
            {progress?.message ? ` · ${progress.message}` : ""}
          </span>
        )}

        {alignError && <ErrorAlert title={alignError.title} message={alignError.message} onClose={onDismissError} />}

        {summary && <SummaryAlert summary={summary} />}

        <p className="pn-h" id={modeLabel}>
          {t("studio.sync.mode")}
        </p>
        <Segmented<SyncMode>
          labelledBy={modeLabel}
          value={mode}
          onChange={onMode}
          options={[
            { value: "review", label: t("studio.sync.modeReview") },
            { value: "manual", label: t("studio.sync.modeManual") },
          ]}
        />

        {mode === "manual" && <ManualSyncPanel manual={manual} />}

        {segments.length === 0 ? (
          <div className="qr-empty">
            <Icon name="audio-waveform" />
            <span>{mode === "manual" ? t("studio.manual.empty") : t("studio.sync.empty")}</span>
          </div>
        ) : (
          <>
            <p className="pn-h" id={listLabel}>
              {pending > 0
                ? t("studio.sync.pending", { pending, total: segments.length })
                : t("studio.sync.allReviewed")}
            </p>
            {pending > 0 && (
              <span className="pn-note">
                {t("studio.sync.reasonCounts", { low: lowCount, missing: missingCount, translation: translationCount })}
              </span>
            )}
            <span
              className="qr-progress"
              role="progressbar"
              aria-label={t("studio.sync.reviewProgress")}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={Math.round(ratio * 100)}
              style={{ "--v": ratio } as React.CSSProperties}
            />
            <div
              ref={listRef}
              className="seg-list"
              role="group"
              aria-labelledby={listLabel}
              onKeyDown={onListKey}
              onPointerDown={() => {
                focusFollows.current = false;
              }}
              onBlur={(e) => {
                if (!e.currentTarget.contains(e.relatedTarget)) focusFollows.current = false;
              }}
            >
              {segments.map((s, i) => {
                const selected = s.id === selectedId;
                const tabStop = selected || (selectedId === null && i === 0);
                const over = overflowOf(s);
                const why = reviewReasons(s);
                const trPending = translationPending(s, primaryEdition);
                const whyText = [
                  ...why.map((r) => t(r === "lowConfidence" ? "studio.sync.reasonLow" : "studio.sync.reasonMissing")),
                  ...(trPending ? [t("studio.sync.reasonTranslation")] : []),
                ];
                return (
                  <button
                    key={s.id}
                    type="button"
                    data-seg-id={s.id}
                    title={s.kind === "Ayah" ? `${surahName(surahs, s.surah_id)} ${s.ayah_number}` : undefined}
                    className={selected ? "qr-item is-selected" : "qr-item"}
                    tabIndex={tabStop ? 0 : -1}
                    aria-pressed={selected}
                    onClick={() => onSelect(s)}
                  >
                    {whyText.length > 0 ? (
                      <span className={why.includes("missingWords") ? "qr-dot qr-dot--danger" : "qr-dot"} />
                    ) : s.manual_override ? (
                      <Icon name="check" size="sm" />
                    ) : (
                      <span className="dot-slot" />
                    )}
                    <span className="qr-item__name">
                      <b>{segCode(s, t)}</b>
                    </span>
                    {why.includes("missingWords") && (
                      <span className="qr-badge qr-badge--danger">{t("studio.sync.missingBadge")}</span>
                    )}
                    {over === true && (
                      <span className="qr-badge qr-badge--warning">{t("studio.sync.overflowBadge")}</span>
                    )}
                    {trPending && <Icon name="languages" size="sm" />}
                    <span className="qr-item__meta">{confidenceText(s)}</span>
                    <span className="sr-only">
                      {whyText.length > 0
                        ? `${t("studio.sync.stateReview")}: ${whyText.join(", ")}`
                        : s.manual_override
                          ? t("studio.sync.stateAccepted")
                          : t("studio.sync.stateConfident")}
                    </span>
                  </button>
                );
              })}
            </div>
            <button
              type="button"
              className="qr-btn qr-btn--ghost qr-btn--sm"
              disabled={scan !== null}
              onClick={onScan}
            >
              {scan !== null ? <span className="qr-spin" /> : <Icon name="scan" size="sm" />}
              {scan !== null
                ? t("studio.sync.scanning", { done: scan.done, total: scan.total })
                : t("studio.sync.scan")}
            </button>
            {flagged > 0 && (
              <span className="pn-note" role="status">
                {t("studio.sync.flagged", { count: flagged })}
              </span>
            )}
          </>
        )}
      </div>
      <div className="st-left__foot">
        {mode === "review" ? (
          <div className="grid-2">
            <button
              type="button"
              className="qr-btn qr-btn--secondary"
              disabled={selectedId === null}
              onClick={onAccept}
            >
              {t("studio.sync.accept")}
              <Kbd>{KEYS.enter}</Kbd>
            </button>
            <button
              type="button"
              className="qr-btn qr-btn--secondary"
              disabled={pending === 0}
              onClick={onNextReview}
            >
              {t("studio.sync.next")}
              <Kbd>{KEYS.next}</Kbd>
            </button>
          </div>
        ) : (
          <>
            <button
              type="button"
              className="qr-btn qr-btn--primary"
              disabled={!manual.selection || manual.words === null}
              onClick={manual.onCreate}
            >
              {t("studio.manual.create")}
              <Kbd>{KEYS.enter}</Kbd>
            </button>
            <button
              type="button"
              className="qr-btn qr-btn--secondary"
              disabled={segments.length === 0}
              onClick={manual.onUndo}
            >
              {t("studio.manual.undo")}
              <Kbd>{KEYS.backspace}</Kbd>
            </button>
          </>
        )}
      </div>
    </>
  );
}

function parseMs(text: string): number | null {
  return /^\d{1,5}$/.test(text.trim()) ? Number(text) : null;
}

/**
 * Lembar sinkron AI. Tahap `consent`: penjelasan unggah ke HF Space publik (sekali, disimpan di
 * pengaturan). Tahap `options`: model, pengaturan lanjutan, dan konfirmasi ganti segmen.
 */
export function CloudSyncSheet({
  stage,
  options,
  segments,
  busy,
  error,
  onOptions,
  onConsent,
  onRun,
  onClose,
}: {
  stage: "consent" | "options";
  options: CloudAlignOptions;
  segments: Segment[];
  /** Menyimpan persetujuan sedang berjalan. */
  busy: boolean;
  error: string | null;
  onOptions: (options: CloudAlignOptions) => void;
  onConsent: () => void;
  onRun: () => void;
  onClose: () => void;
}): React.ReactElement {
  const { t } = useI18n();
  const modelId = useId();
  const ids = [useId(), useId(), useId()];
  const [draft, setDraft] = useState({
    min_silence_ms: String(options.min_silence_ms),
    min_speech_ms: String(options.min_speech_ms),
    pad_ms: String(options.pad_ms),
  });
  const numbers: ReadonlyArray<{ key: keyof typeof draft; label: string }> = [
    { key: "min_silence_ms", label: t("studio.cloud.minSilence") },
    { key: "min_speech_ms", label: t("studio.cloud.minSpeech") },
    { key: "pad_ms", label: t("studio.cloud.padding") },
  ];
  const invalid = numbers.some((n) => parseMs(draft[n.key]) === null);

  const setNumber = (key: keyof typeof draft, text: string) => {
    setDraft((d) => ({ ...d, [key]: text }));
    const v = parseMs(text);
    if (v !== null) onOptions({ ...options, [key]: v });
  };

  if (stage === "consent") {
    return (
      <Sheet
        title={t("studio.cloud.consentTitle")}
        size="md"
        onClose={onClose}
        footer={
          <>
            <button type="button" className="qr-btn qr-btn--secondary" onClick={onClose}>
              {t("common.cancel")}
            </button>
            <button
              type="button"
              className={busy ? "qr-btn qr-btn--primary is-loading" : "qr-btn qr-btn--primary"}
              disabled={busy}
              onClick={onConsent}
            >
              {busy && <span className="qr-spin" />}
              {t("studio.cloud.consentAgree")}
            </button>
          </>
        }
      >
        {error && <ErrorAlert title={t("studio.cloud.consentError")} message={error} />}
        <p>{t("studio.cloud.consentBody")}</p>
        <p className="qr-help">{t("studio.cloud.consentPrivacy")}</p>
        <p className="qr-help">{t("studio.cloud.consentStored")}</p>
      </Sheet>
    );
  }

  const manual = segments.filter((s) => s.manual_override).length;
  return (
    <Sheet
      title={t("studio.cloud.optionsTitle")}
      size="md"
      onClose={onClose}
      footer={
        <>
          <button type="button" className="qr-btn qr-btn--secondary" onClick={onClose}>
            {t("common.cancel")}
          </button>
          <button type="button" className="qr-btn qr-btn--primary" disabled={invalid} onClick={onRun}>
            {segments.length > 0 ? t("studio.cloud.replaceAndRun") : t("studio.cloud.run")}
          </button>
        </>
      }
    >
      <p className="qr-help">{t("studio.cloud.optionsBody")}</p>
      <div className="field-row">
        <span className="lbl" id={modelId}>
          {t("studio.cloud.model")}
        </span>
        <Segmented<CloudModel>
          labelledBy={modelId}
          value={options.model}
          onChange={(model) => onOptions({ ...options, model })}
          options={[
            { value: "Base", label: t("studio.cloud.modelBase") },
            { value: "Large", label: t("studio.cloud.modelLarge") },
          ]}
        />
      </div>
      <span className="qr-help">{t("studio.cloud.modelHelp")}</span>
      <details className="qr-group cloud-adv">
        <summary>
          <Icon name="chevron-down" size="sm" />
          {t("studio.cloud.advanced")}
        </summary>
        <div className="cloud-adv__body">
          {numbers.map((n, i) => {
            const bad = parseMs(draft[n.key]) === null;
            return (
              <div key={n.key} className="qr-fieldset">
                <label className="qr-label" htmlFor={ids[i]}>
                  {n.label}
                </label>
                <span className={bad ? "qr-field is-invalid" : "qr-field"}>
                  <input
                    id={ids[i]}
                    type="number"
                    inputMode="numeric"
                    min={0}
                    max={99999}
                    step={10}
                    value={draft[n.key]}
                    aria-invalid={bad}
                    onChange={(e) => setNumber(n.key, e.target.value)}
                  />
                  <span className="qr-field__suffix">{t("studio.cloud.ms")}</span>
                </span>
                {bad && <span className="qr-error">{t("studio.cloud.msInvalid")}</span>}
              </div>
            );
          })}
          <label className="qr-choice">
            <input
              type="checkbox"
              role="switch"
              className="qr-switch"
              checked={options.fill_silence}
              onChange={(e) => onOptions({ ...options, fill_silence: e.target.checked })}
            />
            {t("studio.cloud.fillSilence")}
          </label>
          <span className="qr-help">{t("studio.cloud.fillSilenceHelp")}</span>
        </div>
      </details>
      {segments.length > 0 && (
        <div className="qr-alert qr-alert--warning" role="status">
          <Icon name="triangle-alert" />
          <div className="qr-alert__content">
            <span className="qr-alert__title">{t("studio.sync.replaceTitle")}</span>
            <span className="qr-alert__body">
              {t("studio.sync.replaceBody", { count: segments.length, manual })}
            </span>
          </div>
        </div>
      )}
    </Sheet>
  );
}

/** Pilih titik bagi per kata untuk segmen yang meluber; pembagian hanya di batas kata (CNT-1). */
function SplitPanel({
  segment,
  onSplit,
}: {
  segment: Segment;
  onSplit: (wordIdx: number) => void;
}): React.ReactElement {
  const { t } = useI18n();
  const span = wordSpan(segment);
  const words = segmentWords(segment);
  const groupId = useId();
  const defaultPick = span ? Math.ceil((span.first + span.last + 1) / 2) : 0;
  const [pick, setPick] = useState(defaultPick);

  const preview = span ? splitSegmentAt(segment, pick, "preview") : null;
  const selectable = words.filter((w) => span !== null && w.word_idx > span.first);

  return (
    <div className="split-panel">
      <div className="qr-alert qr-alert--warning" role="status">
        <Icon name="triangle-alert" />
        <div className="qr-alert__content">
          <span className="qr-alert__title">{t("studio.split.title")}</span>
          <span className="qr-alert__body">{t("studio.split.body")}</span>
        </div>
      </div>
      {span === null || selectable.length === 0 ? (
        <span className="qr-help">{t("studio.split.noWords")}</span>
      ) : (
        <>
          <span className="qr-label" id={groupId}>
            {t("studio.split.pick")}
          </span>
          <div className="word-grid" role="radiogroup" aria-labelledby={groupId}>
            {selectable.map((w) => (
              <label key={w.word_idx} className={pick === w.word_idx ? "word-chip is-picked" : "word-chip"}>
                <input
                  type="radio"
                  className="sr-only"
                  name={`split-${segment.id}`}
                  aria-label={t("studio.split.option", { n: w.word_idx })}
                  checked={pick === w.word_idx}
                  onChange={() => setPick(w.word_idx)}
                />
                <span className="ar-word" lang="ar" dir="rtl">
                  {w.text}
                </span>
                <small>{w.word_idx}</small>
              </label>
            ))}
          </div>
          {preview ? (
            <Summary
              rows={[
                [
                  t("studio.split.part1"),
                  `${t("studio.seg.wordRange", { from: preview[0].word_range?.[0] ?? 0, to: preview[0].word_range?.[1] ?? 0 })} · ${formatTime(segStart(preview[0]))}–${formatTime(segEnd(preview[0]))}`,
                ],
                [
                  t("studio.split.part2"),
                  `${t("studio.seg.wordRange", { from: preview[1].word_range?.[0] ?? 0, to: preview[1].word_range?.[1] ?? 0 })} · ${formatTime(segStart(preview[1]))}–${formatTime(segEnd(preview[1]))}`,
                ],
              ]}
            />
          ) : (
            <span className="qr-help">{t("studio.split.invalid")}</span>
          )}
          <button
            type="button"
            className="qr-btn qr-btn--secondary"
            disabled={preview === null}
            onClick={() => onSplit(pick)}
          >
            {t("studio.split.apply")}
          </button>
        </>
      )}
    </div>
  );
}

/** Legenda pintasan langkah Sinkron; isi mengikuti mode (tinjau vs. manual). */
function ShortcutLegend({ mode }: { mode: SyncMode }): React.ReactElement {
  const { t } = useI18n();
  const rows: ReadonlyArray<readonly [React.ReactNode, string]> =
    mode === "manual"
      ? [
          [<Kbd key="e">{KEYS.enter}</Kbd>, t("studio.shortcuts.manualCreate")],
          [<Kbd key="b">{KEYS.backspace}</Kbd>, t("studio.shortcuts.manualUndo")],
          [
            <React.Fragment key="ud">
              <Kbd>{KEYS.up}</Kbd> <Kbd>{KEYS.down}</Kbd>
            </React.Fragment>,
            t("studio.shortcuts.manualWords"),
          ],
          [<Kbd key="v">{KEYS.wholeAyah}</Kbd>, t("studio.shortcuts.manualWhole")],
          [<Kbd key="r">{KEYS.reset}</Kbd>, t("studio.shortcuts.manualReset")],
          [<Kbd key="ba">{KEYS.basmala}</Kbd>, t("studio.shortcuts.manualBasmala")],
          [<Kbd key="is">{KEYS.istiadha}</Kbd>, t("studio.shortcuts.manualIstiadha")],
          [<Kbd key="s">{KEYS.gap}</Kbd>, t("studio.shortcuts.manualGap")],
          [<Kbd key="tr">{KEYS.editTranslation}</Kbd>, t("studio.shortcuts.translation")],
          [
            <React.Fragment key="nm">
              <Kbd>{KEYS.setStart}</Kbd> <Kbd>{KEYS.setEnd}</Kbd>
            </React.Fragment>,
            t("studio.shortcuts.manualEdges"),
          ],
          [
            <React.Fragment key="lr">
              <Kbd>{KEYS.left}</Kbd> <Kbd>{KEYS.right}</Kbd>
            </React.Fragment>,
            t("studio.shortcuts.manualSeek"),
          ],
          [<Kbd key="sp">{t("studio.key.space")}</Kbd>, t("studio.shortcuts.play")],
          [
            <React.Fragment key="sv">
              <Kbd>{MOD_KEY}</Kbd> <Kbd>{KEYS.save}</Kbd>
            </React.Fragment>,
            t("studio.shortcuts.save"),
          ],
        ]
      : [
          [<Kbd key="e">{KEYS.enter}</Kbd>, t("studio.shortcuts.accept")],
          [<Kbd key="n">{KEYS.next}</Kbd>, t("studio.shortcuts.next")],
          [<Kbd key="tr">{KEYS.editTranslation}</Kbd>, t("studio.shortcuts.translation")],
          [
            <React.Fragment key="pn">
              <Kbd>{KEYS.prev}</Kbd> <Kbd>{KEYS.following}</Kbd>
            </React.Fragment>,
            t("studio.shortcuts.prevNext"),
          ],
          [<Kbd key="sp">{t("studio.key.space")}</Kbd>, t("studio.shortcuts.play")],
          [
            <React.Fragment key="ud">
              <Kbd>{KEYS.up}</Kbd> <Kbd>{KEYS.down}</Kbd>
            </React.Fragment>,
            t("studio.shortcuts.nudge"),
          ],
          [
            <React.Fragment key="sv">
              <Kbd>{MOD_KEY}</Kbd> <Kbd>{KEYS.save}</Kbd>
            </React.Fragment>,
            t("studio.shortcuts.save"),
          ],
        ];
  return (
    <div className="shortcuts">
      <p className="pn-h">
        {mode === "manual" ? t("studio.shortcuts.titleManual") : t("studio.shortcuts.title")}
      </p>
      <dl className="sum">
        {rows.map(([keys, label]) => (
          <React.Fragment key={label}>
            <dt>{keys}</dt>
            <dd>{label}</dd>
          </React.Fragment>
        ))}
      </dl>
    </div>
  );
}

/**
 * Inspector langkah Sinkron: waktu mulai/selesai, pembagian per kata, dan pintasan. `children`
 * dipasang di bawah ringkasan segmen (tempat panel terjemahan).
 */
export function SyncInspector({
  segment,
  overflow,
  mode,
  onRetime,
  onSplit,
  children,
}: {
  segment: Segment | null;
  overflow: boolean;
  mode: SyncMode;
  onRetime: (segment: Segment, start: number, end: number) => void;
  onSplit: (segment: Segment, wordIdx: number) => void;
  children?: React.ReactNode;
}): React.ReactElement {
  const { t } = useI18n();
  if (!segment) {
    return (
      <>
        <div className="insp-empty">{t("studio.sync.noSelection")}</div>
        <div className="insp-pad">
          <ShortcutLegend mode={mode} />
        </div>
      </>
    );
  }
  const why = reviewReasons(segment);
  const span = wordSpan(segment);
  const special = isSpecial(segment);
  const sourceLabel =
    segment.source === "Cloud"
      ? t("studio.sync.sourceCloud")
      : segment.source === "Vad"
        ? t("studio.sync.sourceVad")
        : t("studio.sync.sourceManual");
  return (
    <>
      <div className="qr-panel__head">
        <span className="qr-panel__title">{t("studio.sync.segmentTitle", { code: segCode(segment, t) })}</span>
        <span className="qr-panel__actions">
          {why.length > 0 ? (
            <span className="qr-badge qr-badge--warning">
              {t("studio.sync.confidence", { value: confidenceText(segment) })}
            </span>
          ) : (
            <span className="qr-badge qr-badge--success">
              {segment.manual_override
                ? t("studio.sync.accepted")
                : t("studio.sync.confidence", { value: confidenceText(segment) })}
            </span>
          )}
        </span>
      </div>
      <div className="insp-pad" key={segment.id}>
        {why.includes("missingWords") && (
          <div className="qr-alert qr-alert--danger" role="status">
            <Icon name="circle-alert" />
            <div className="qr-alert__content">
              <span className="qr-alert__title">{t("studio.sync.missingTitle")}</span>
              <span className="qr-alert__body">{t("studio.sync.missingBody")}</span>
            </div>
          </div>
        )}
        <TimeField
          label={t("studio.sync.start")}
          ticks={segment.start_tick}
          onCommit={(tick) => {
            if (segment.end_tick !== null && tick >= segment.end_tick) return t("studio.sync.startBeforeEnd");
            onRetime(segment, tick, segEnd(segment));
            return null;
          }}
        />
        <TimeField
          label={t("studio.sync.end")}
          ticks={segment.end_tick}
          onCommit={(tick) => {
            if (segment.start_tick !== null && tick <= segment.start_tick) return t("studio.sync.endAfterStart");
            onRetime(segment, segStart(segment), tick);
            return null;
          }}
        />
        <span className="qr-help">{t("studio.sync.timeHelp")}</span>
        <Summary
          rows={
            special
              ? [
                  [t("studio.sum.kind"), segCode(segment, t)],
                  [t("studio.sum.source"), sourceLabel],
                ]
              : [
                  [t("studio.sum.surah"), String(segment.surah_id)],
                  [t("studio.sum.ayah"), String(segment.ayah_number)],
                  [t("studio.sum.words"), span ? `${span.first}–${span.last}` : t("studio.sum.wholeAyah")],
                  [t("studio.sum.wordTimings"), t("studio.sum.wordCount", { count: segment.word_timings.length })],
                  [t("studio.sum.source"), sourceLabel],
                ]
          }
        />
        <span className="qr-help">{special ? t("studio.sync.specialNote") : t("studio.sync.textLocked")}</span>
        {children}
        {overflow && <SplitPanel key={segment.id} segment={segment} onSplit={(k) => onSplit(segment, k)} />}
        <ShortcutLegend mode={mode} />
      </div>
    </>
  );
}
