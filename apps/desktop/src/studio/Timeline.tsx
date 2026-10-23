import React from "react";
import type { AudioInfo, Track_Serialize as Track } from "../bindings";
import { TICKS_PER_SECOND, formatTime } from "../format";
import { useI18n } from "../i18n";
import { Waveform } from "./Waveform";
import {
  confidenceText,
  needsReview,
  segCode,
  segEnd,
  segStart,
  type Project,
  type Segment,
} from "./model";

const KEY_STEP_TICKS = TICKS_PER_SECOND;

function trackOrder(t: Track): number {
  return t.kind === "Background" ? 0 : t.kind === "Audio" ? 1 : 2;
}

export function Timeline({
  project,
  totalTicks,
  tick,
  selectedId,
  audio,
  onSeek,
  onSelect,
}: {
  project: Project;
  totalTicks: number;
  tick: number;
  selectedId: string | null;
  /** Hasil impor audio sesi ini (punya `peaks`); `null` bila audio belum diimpor di sesi ini. */
  audio: AudioInfo | null;
  onSeek: (tick: number) => void;
  onSelect: (s: Segment) => void;
}): React.ReactElement {
  const { t } = useI18n();
  const pct = (v: number) => `${(Math.min(Math.max(v, 0), totalTicks) / totalTicks) * 100}%`;
  const span = (a: number, b: number) => ({ left: pct(a), width: pct(Math.max(b - a, 0)) });
  const marks = [0, 0.25, 0.5, 0.75, 1];

  const seekKey = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const big = e.shiftKey ? 5 : 1;
    let next: number | null = null;
    if (e.key === "ArrowRight") next = tick + KEY_STEP_TICKS * big;
    else if (e.key === "ArrowLeft") next = tick - KEY_STEP_TICKS * big;
    else if (e.key === "PageUp") next = tick + KEY_STEP_TICKS * 10;
    else if (e.key === "PageDown") next = tick - KEY_STEP_TICKS * 10;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = totalTicks;
    if (next === null) return;
    e.preventDefault();
    onSeek(Math.min(Math.max(next, 0), totalTicks));
  };

  const seekFromPointer = (e: React.PointerEvent<HTMLElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    onSeek(Math.min(Math.max((e.clientX - r.left) / r.width, 0), 1) * totalTicks);
  };

  const otherTrack = (tr: Track) => {
    const isAudio = tr.kind === "Audio";
    const peaks = isAudio && audio ? audio.peaks : null;
    const audioTicks = audio?.duration_ticks ?? null;
    const cls = ["qr-track"];
    if (tr.locked) cls.push("is-locked");
    if (peaks) cls.push("is-wave");
    return (
      <div key={tr.id} className={cls.join(" ")}>
        <div className="qr-track__head">
          <span>{tr.name}</span>
        </div>
        <div className="qr-lane">
          {peaks && audioTicks ? (
            // Klik/seret pada waveform hanya tambahan untuk pointer; papan ketik memakai slider Posisi.
            <div
              className="wave-lane"
              style={{ width: pct(audioTicks) }}
              onPointerDown={(e) => seekFromPointer(e)}
            >
              <Waveform
                peaks={peaks}
                label={t("studio.wave.label", {
                  duration: formatTime(audioTicks),
                  rate: audio?.sample_rate ?? 0,
                })}
              />
            </div>
          ) : (
            <>
              {isAudio && !audio && tr.clips.length > 0 && (
                <span className="lane-note">{t("studio.wave.noPeaks")}</span>
              )}
              {tr.clips.map((c) => (
                <div key={c.id} className="qr-clip" style={span(c.start_tick ?? 0, c.end_tick ?? 0)}>
                  <span className="qr-clip__label">{c.label}</span>
                </div>
              ))}
            </>
          )}
        </div>
      </div>
    );
  };

  const tracks = [...project.tracks].filter((x) => x.kind !== "Ayah").sort((a, b) => trackOrder(a) - trackOrder(b));
  const before = tracks.filter((x) => trackOrder(x) < 2);
  const after = tracks.filter((x) => trackOrder(x) >= 2);

  return (
    <div className="qr-tl">
      <div className="tl-body">
        <div
          className="qr-tl__ruler"
          role="slider"
          tabIndex={0}
          aria-label={t("studio.timeline.position")}
          aria-valuemin={0}
          aria-valuemax={Math.round(totalTicks / TICKS_PER_SECOND)}
          aria-valuenow={Math.round(tick / TICKS_PER_SECOND)}
          aria-valuetext={formatTime(tick)}
          onPointerDown={seekFromPointer}
          onKeyDown={seekKey}
        >
          {marks.map((m) => (
            <span key={m}>{formatTime(m * totalTicks).slice(0, 5)}</span>
          ))}
        </div>

        {before.map(otherTrack)}

        <div className="qr-track is-hot">
          <div className="qr-track__head">
            <span>{t("studio.timeline.ayah")}</span>
          </div>
          <div className="qr-lane">
            {project.segments.length === 0 && (
              <div className="lane-hint">{t("studio.timeline.noSegments")}</div>
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
                  aria-label={
                    review
                      ? t("studio.timeline.segmentReview", { code: segCode(s, t) })
                      : t("studio.timeline.segment", { code: segCode(s, t) })
                  }
                  aria-pressed={s.id === selectedId}
                  onClick={() => onSelect(s)}
                >
                  {review && <span className="qr-dot" />}
                  <span className="qr-clip__label">{segCode(s, t)}</span>
                  <span className="conf">{confidenceText(s)}</span>
                </button>
              );
            })}
          </div>
        </div>

        {after.map(otherTrack)}

        <div className="tl-lanes" aria-hidden="true">
          <div className="qr-playhead" style={{ left: pct(tick) }} />
        </div>
      </div>
    </div>
  );
}
