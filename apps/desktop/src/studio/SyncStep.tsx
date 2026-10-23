import React, { useEffect, useId, useRef, useState } from "react";
import { formatTime } from "../format";
import { useI18n } from "../i18n";
import { ErrorAlert, Icon } from "../ui";
import { Kbd, KEYS, MOD_KEY, Summary } from "./parts";
import { TimeField } from "./TimeField";
import type { AyahRange } from "./SourceStep";
import {
  confidenceText,
  needsReview,
  segCode,
  segEnd,
  segmentWords,
  segStart,
  splitSegmentAt,
  wordSpan,
  type Segment,
} from "./model";

export type AlignSummary = { speechRegions: number; versesExpected: number; warnings: string[] };

/** Panel kiri langkah Sinkron: jalankan sinkron otomatis, tinjau peringatan dan daftar segmen. */
export function SyncPanel({
  segments,
  selectedId,
  range,
  hasAudio,
  aligning,
  alignError,
  summary,
  scan,
  overflowOf,
  onAlign,
  onDismissError,
  onSelect,
  onAccept,
  onNextReview,
  onScan,
}: {
  segments: Segment[];
  selectedId: string | null;
  range: AyahRange;
  hasAudio: boolean;
  aligning: boolean;
  alignError: string | null;
  summary: AlignSummary | null;
  scan: { done: number; total: number } | null;
  overflowOf: (s: Segment) => boolean | undefined;
  onAlign: () => void;
  onDismissError: () => void;
  onSelect: (s: Segment) => void;
  onAccept: () => void;
  onNextReview: () => void;
  onScan: () => void;
}): React.ReactElement {
  const { t } = useI18n();
  const listRef = useRef<HTMLDivElement>(null);
  const listLabel = useId();
  const pending = segments.filter(needsReview).length;
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
    } else if (e.key === "Enter" && selectedId !== null) {
      e.preventDefault();
      onAccept();
    }
  };

  return (
    <>
      <div className="st-left__body">
        <p className="qr-help honest-note">
          <b>{t("studio.sync.honestTitle")}.</b> {t("studio.sync.honestBody")}
        </p>

        <button
          type="button"
          className={aligning ? "qr-btn qr-btn--secondary is-loading" : "qr-btn qr-btn--secondary"}
          disabled={!hasAudio || aligning}
          aria-describedby={hasAudio ? undefined : `${listLabel}-noaudio`}
          onClick={onAlign}
        >
          {aligning ? <span className="qr-spin" /> : <Icon name="audio-waveform" />}
          {t("studio.sync.run")}
        </button>
        {!hasAudio && (
          <span className="pn-note" id={`${listLabel}-noaudio`}>
            {t("studio.sync.needAudio")}
          </span>
        )}
        <span className="pn-note">
          {t("studio.sync.rangeNote", { surah: range.surah, from: range.from, to: range.to })}
        </span>

        {alignError && (
          <ErrorAlert title={t("studio.sync.error")} message={alignError} onClose={onDismissError} />
        )}

        {summary && (
          <div
            className={
              summary.speechRegions === summary.versesExpected
                ? "qr-alert qr-alert--success"
                : "qr-alert qr-alert--warning"
            }
            role="status"
          >
            <Icon name={summary.speechRegions === summary.versesExpected ? "circle-check" : "triangle-alert"} />
            <div className="qr-alert__content">
              <span className="qr-alert__title">
                {t("studio.sync.regions", {
                  regions: summary.speechRegions,
                  verses: summary.versesExpected,
                })}
              </span>
              {summary.warnings.map((w, i) => (
                <span key={`${i}-${w}`} className="qr-alert__body">
                  {w}
                </span>
              ))}
            </div>
          </div>
        )}

        {segments.length === 0 ? (
          <div className="qr-empty">
            <Icon name="audio-waveform" />
            <span>{t("studio.sync.empty")}</span>
          </div>
        ) : (
          <>
            <p className="pn-h" id={listLabel}>
              {pending > 0
                ? t("studio.sync.pending", { pending, total: segments.length })
                : t("studio.sync.allReviewed")}
            </p>
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
                return (
                  <button
                    key={s.id}
                    type="button"
                    data-seg-id={s.id}
                    className={selected ? "qr-item is-selected" : "qr-item"}
                    tabIndex={tabStop ? 0 : -1}
                    aria-pressed={selected}
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
                      <b>{segCode(s, t)}</b>
                    </span>
                    {over === true && (
                      <span className="qr-badge qr-badge--warning">{t("studio.sync.overflowBadge")}</span>
                    )}
                    <span className="qr-item__meta">{confidenceText(s)}</span>
                    <span className="sr-only">
                      {needsReview(s)
                        ? t("studio.sync.stateReview")
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
      </div>
    </>
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

/** Inspector langkah Sinkron: waktu mulai/selesai, pembagian per kata, dan pintasan. */
export function SyncInspector({
  segment,
  overflow,
  onRetime,
  onSplit,
}: {
  segment: Segment | null;
  overflow: boolean;
  onRetime: (segment: Segment, start: number, end: number) => void;
  onSplit: (segment: Segment, wordIdx: number) => void;
}): React.ReactElement {
  const { t } = useI18n();
  if (!segment) {
    return <div className="insp-empty">{t("studio.sync.noSelection")}</div>;
  }
  const review = needsReview(segment);
  const span = wordSpan(segment);
  return (
    <>
      <div className="qr-panel__head">
        <span className="qr-panel__title">{t("studio.sync.segmentTitle", { code: segCode(segment, t) })}</span>
        <span className="qr-panel__actions">
          {review ? (
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
          rows={[
            [t("studio.sum.surah"), String(segment.surah_id)],
            [t("studio.sum.ayah"), String(segment.ayah_number)],
            [
              t("studio.sum.words"),
              span ? `${span.first}–${span.last}` : t("studio.sum.wholeAyah"),
            ],
            [t("studio.sum.wordTimings"), t("studio.sum.wordCount", { count: segment.word_timings.length })],
          ]}
        />
        <span className="qr-help">{t("studio.sync.textLocked")}</span>
        {overflow && <SplitPanel key={segment.id} segment={segment} onSplit={(k) => onSplit(segment, k)} />}
        <div className="shortcuts">
          <p className="pn-h">{t("studio.shortcuts.title")}</p>
          <dl className="sum">
            <dt>
              <Kbd>{KEYS.enter}</Kbd>
            </dt>
            <dd>{t("studio.shortcuts.accept")}</dd>
            <dt>
              <Kbd>{KEYS.next}</Kbd>
            </dt>
            <dd>{t("studio.shortcuts.next")}</dd>
            <dt>
              <Kbd>{KEYS.prev}</Kbd> <Kbd>{KEYS.following}</Kbd>
            </dt>
            <dd>{t("studio.shortcuts.prevNext")}</dd>
            <dt>
              <Kbd>{t("studio.key.space")}</Kbd>
            </dt>
            <dd>{t("studio.shortcuts.play")}</dd>
            <dt>
              <Kbd>{KEYS.up}</Kbd> <Kbd>{KEYS.down}</Kbd>
            </dt>
            <dd>{t("studio.shortcuts.nudge")}</dd>
            <dt>
              <Kbd>{MOD_KEY}</Kbd> <Kbd>{KEYS.save}</Kbd>
            </dt>
            <dd>{t("studio.shortcuts.save")}</dd>
          </dl>
        </div>
      </div>
    </>
  );
}
