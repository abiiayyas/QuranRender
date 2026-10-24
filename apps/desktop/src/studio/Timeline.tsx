import React, { useRef, useState } from "react";
import type { AudioInfo, Track_Serialize as Track } from "../bindings";
import { TICKS_PER_SECOND, fileName, formatTime } from "../format";
import { useI18n } from "../i18n";
import { Waveform } from "./Waveform";
import {
  confidenceText,
  reviewReasons,
  segCode,
  segEnd,
  segStart,
  setSegmentEdge,
  snapToFrame,
  type Edge,
  type Project,
  type Segment,
} from "./model";

const KEY_STEP_TICKS = TICKS_PER_SECOND;

function trackOrder(t: Track): number {
  return t.kind === "Background" ? 0 : t.kind === "Audio" ? 1 : 2;
}

type Drag = { id: string; edge: Edge; tick: number };

export function Timeline({
  project,
  totalTicks,
  tick,
  selectedId,
  audio,
  frame,
  onSeek,
  onSelect,
  onRetimeEdge,
}: {
  project: Project;
  totalTicks: number;
  tick: number;
  selectedId: string | null;
  /** Hasil impor audio sesi ini (punya `peaks`); `null` bila audio belum diimpor di sesi ini. */
  audio: AudioInfo | null;
  /** Panjang satu frame (tick): tepi hasil seret di-snap ke kelipatannya. */
  frame: number;
  onSeek: (tick: number) => void;
  onSelect: (s: Segment) => void;
  /** Tepi segmen diseret ke `tick` (sudah di-snap); tetangga disesuaikan oleh pemanggil. */
  onRetimeEdge: (id: string, edge: Edge, tick: number) => void;
}): React.ReactElement {
  const { t } = useI18n();
  const [drag, setDrag] = useState<Drag | null>(null);
  // Seretan aktif juga di ref: pointerup bisa tiba sebelum render dari pointermove terakhir.
  const dragRef = useRef<Drag | null>(null);
  // Klik yang menyusul akhir seretan tidak boleh memilih/seek segmen.
  const suppressClick = useRef(false);
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

  const dragTick = (e: React.PointerEvent<HTMLElement>): number | null => {
    const lane = e.currentTarget.closest(".qr-lane");
    if (!lane) return null;
    const r = lane.getBoundingClientRect();
    if (r.width <= 0) return null;
    const raw = Math.min(Math.max((e.clientX - r.left) / r.width, 0), 1) * totalTicks;
    return snapToFrame(raw, frame);
  };

  const updateDrag = (next: Drag | null) => {
    dragRef.current = next;
    setDrag(next);
  };

  // Pegangan tepi hanya untuk pointer; papan ketik memakai isian Mulai/Selesai di inspector dan N/M.
  const edgeHandlers = (id: string, edge: Edge) => {
    const active = () => {
      const d = dragRef.current;
      return d && d.id === id && d.edge === edge ? d : null;
    };
    return {
      onPointerDown: (e: React.PointerEvent<HTMLElement>) => {
        const seg = project.segments.find((x) => x.id === id);
        if (e.button !== 0 || !seg) return;
        e.preventDefault();
        e.stopPropagation();
        e.currentTarget.setPointerCapture(e.pointerId);
        updateDrag({ id, edge, tick: edge === "start" ? segStart(seg) : segEnd(seg) });
      },
      onPointerMove: (e: React.PointerEvent<HTMLElement>) => {
        const d = active();
        const at = d ? dragTick(e) : null;
        if (d && at !== null && at !== d.tick) updateDrag({ ...d, tick: at });
      },
      onPointerUp: (e: React.PointerEvent<HTMLElement>) => {
        const d = active();
        if (!d) return;
        e.stopPropagation();
        suppressClick.current = true;
        // Bandingkan dengan segmen proyek, bukan pratinjau seretan yang sudah bergeser.
        const seg = project.segments.find((x) => x.id === id);
        const original = seg ? (edge === "start" ? segStart(seg) : segEnd(seg)) : d.tick;
        if (d.tick !== original) onRetimeEdge(id, edge, d.tick);
        updateDrag(null);
      },
      onPointerCancel: () => updateDrag(null),
    };
  };

  const dragged = drag ? setSegmentEdge(project.segments, drag.id, drag.edge, drag.tick, frame, totalTicks) : null;
  const shown = dragged?.segments ?? project.segments;

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
              {tr.clips.map((c) => {
                // Klip Latar: nama berkas aset; putus-putus bila berkas/aset hilang dari proyek.
                const bg = tr.kind === "Background" && c.asset_id ? project.assets[c.asset_id] : undefined;
                const missing = tr.kind === "Background" && !!c.asset_id && !bg;
                const label = bg ? fileName(bg.path) : c.label;
                return (
                  <div
                    key={c.id}
                    className={missing ? "qr-clip is-special" : "qr-clip"}
                    style={span(c.start_tick ?? 0, c.end_tick ?? 0)}
                    title={missing ? t("studio.timeline.backgroundMissing") : bg?.path}
                  >
                    <span className="qr-clip__label">{missing ? t("studio.timeline.backgroundMissing") : label}</span>
                  </div>
                );
              })}
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
            {shown.map((s) => {
              const why = reviewReasons(s);
              const review = why.length > 0;
              const missing = why.includes("missingWords");
              const cls = ["qr-clip"];
              if (s.id === selectedId) cls.push("is-selected");
              if (review) cls.push("is-review");
              if (missing) cls.push("is-danger");
              if (s.kind !== "Ayah") cls.push("is-special");
              const code = segCode(s, t);
              const states = [
                ...why.map((r) => t(r === "lowConfidence" ? "studio.sync.reasonLow" : "studio.sync.reasonMissing")),
                ...(s.source === "Cloud" ? [t("studio.sync.sourceCloud")] : []),
              ];
              return (
                <button
                  key={s.id}
                  type="button"
                  className={cls.join(" ")}
                  style={span(segStart(s), segEnd(s))}
                  aria-label={
                    states.length > 0
                      ? t("studio.timeline.segmentStates", { code, states: states.join(", ") })
                      : t("studio.timeline.segment", { code })
                  }
                  aria-pressed={s.id === selectedId}
                  onClick={() => {
                    if (suppressClick.current) {
                      suppressClick.current = false;
                      return;
                    }
                    onSelect(s);
                  }}
                >
                  {review && <span className="qr-dot" />}
                  <span className="qr-clip__label">{code}</span>
                  {s.source === "Cloud" && <span className="qr-clip__tag">{t("studio.timeline.cloudTag")}</span>}
                  <span className="conf">{confidenceText(s)}</span>
                  <span className="seg-edge is-start" aria-hidden="true" {...edgeHandlers(s.id, "start")} />
                  <span className="seg-edge is-end" aria-hidden="true" {...edgeHandlers(s.id, "end")} />
                </button>
              );
            })}
            {dragged && (
              <div className="qr-snap" style={{ left: pct(dragged.tick) }}>
                <span className="qr-snap__label">{formatTime(dragged.tick)}</span>
              </div>
            )}
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
