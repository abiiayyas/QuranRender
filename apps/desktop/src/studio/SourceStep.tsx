import React, { useId, useRef, useState } from "react";
import type { AssetRef, AudioInfo } from "../bindings";
import { fileName, formatTime } from "../format";
import { cssPoint, useFileDrop, type DragPosition } from "../hooks";
import {
  AUDIO_ONLY_EXTENSIONS,
  BACKGROUND_EXTENSIONS,
  extOf,
  IMAGE_EXTENSIONS,
  MEDIA_EXTENSIONS,
  openFile,
  PickButton,
  VIDEO_EXTENSIONS,
} from "../pick";
import { formatBytes } from "../Packs";
import { useI18n } from "../i18n";
import { ErrorAlert, Icon } from "../ui";
import { Summary } from "./parts";
import { ayahCount, useSurahs } from "./surahs";
import type { Project } from "./model";

export type AyahRange = { surah: number; from: number; to: number };

type DropTarget = "audio" | "background";

/**
 * Tujuan seretan menurut ekstensi dan zona di bawah kursor: gambar selalu latar, audio murni selalu
 * audio; video (mp4/mov/mkv/webm) ke zona audio = audio (suaranya dipakai), selain itu latar.
 */
function routeDrop(path: string, over: DropTarget | null): DropTarget | null {
  const ext = extOf(path);
  if (IMAGE_EXTENSIONS.includes(ext)) return "background";
  if (AUDIO_ONLY_EXTENSIONS.includes(ext)) return "audio";
  if (VIDEO_EXTENSIONS.includes(ext)) return over === "audio" ? "audio" : "background";
  return null;
}

function contains(el: HTMLElement | null, p: { x: number; y: number } | null): boolean {
  if (!el || !p) return false;
  const r = el.getBoundingClientRect();
  return p.x >= r.left && p.x <= r.right && p.y >= r.top && p.y <= r.bottom;
}

/**
 * Panel kiri langkah Sumber: aset proyek, impor audio, dan latar (gambar/video). Berkas diseret ke
 * jendela selama langkah ini aktif dan dialihkan menurut ekstensi dan zona lepas; tombol pemilih
 * berkas bawaan tersedia di tiap zona.
 */
export function SourcePanel({
  assets,
  importing,
  error,
  onDismissError,
  onImport,
  background,
  dimmer,
  bgImporting,
  bgError,
  onDismissBgError,
  onBackground,
  onRemoveBackground,
  onDimmer,
}: {
  assets: AssetRef[];
  /** Path berkas yang sedang diimpor, atau `null`. */
  importing: string | null;
  error: string | null;
  onDismissError: () => void;
  onImport: (path: string) => void;
  /** Latar proyek (klip jalur Latar), atau `null`. */
  background: { assetId: string; asset: AssetRef | null } | null;
  /** Dimmer di atas latar media, 0..1. */
  dimmer: number;
  bgImporting: string | null;
  bgError: string | null;
  onDismissBgError: () => void;
  onBackground: (path: string) => void;
  onRemoveBackground: () => void;
  onDimmer: (value: number) => void;
}): React.ReactElement {
  const { t, locale } = useI18n();
  const dimmerId = useId();
  const audioZone = useRef<HTMLDivElement>(null);
  const bgZone = useRef<HTMLDivElement>(null);
  const [localError, setLocalError] = useState<string | null>(null);
  const [bgLocalError, setBgLocalError] = useState<string | null>(null);
  const hasAudio = assets.some((a) => a.kind === "Audio");
  const busy = importing !== null || bgImporting !== null;

  const zoneAt = (position: DragPosition | null): DropTarget | null => {
    const p = cssPoint(position);
    return contains(audioZone.current, p) ? "audio" : contains(bgZone.current, p) ? "background" : null;
  };

  const startAudio = (p: string) => {
    setLocalError(null);
    onImport(p);
  };
  const startBackground = (p: string) => {
    setBgLocalError(null);
    onBackground(p);
  };

  const drag = useFileDrop((paths, position) => {
    if (busy) return;
    if (paths.length > 1) {
      setLocalError(t("studio.source.dropMultiple"));
      return;
    }
    const target = routeDrop(paths[0], zoneAt(position));
    if (target === "audio") startAudio(paths[0]);
    else if (target === "background") startBackground(paths[0]);
    else setBgLocalError(t("studio.background.unsupported", { name: fileName(paths[0]) }));
  }, setLocalError);

  const dragging = drag?.paths ?? null;
  const dragTarget = drag && drag.paths.length === 1 ? routeDrop(drag.paths[0], zoneAt(drag.position)) : null;
  const audioOver = dragging !== null && !busy && dragTarget === "audio";
  const bgOver = dragging !== null && !busy && dragTarget === "background";

  const shownError = error ?? localError;
  const shownBgError = bgError ?? bgLocalError;

  let dropTitle: string;
  let dropBody: string;
  if (importing !== null) {
    dropTitle = t("studio.source.dropImporting");
    dropBody = fileName(importing);
  } else if (audioOver && dragging) {
    dropTitle = t("studio.source.dropRelease");
    dropBody = dragging.map(fileName).join(", ");
  } else {
    dropTitle = t("studio.source.dropTitle");
    dropBody = hasAudio ? t("studio.source.dropReplaces") : t("studio.source.dropFormats");
  }

  let bgTitle: string;
  let bgBody: string;
  if (bgImporting !== null) {
    bgTitle = t("studio.background.importing");
    bgBody = fileName(bgImporting);
  } else if (bgOver && dragging) {
    bgTitle = t("studio.source.dropRelease");
    bgBody = dragging.map(fileName).join(", ");
  } else {
    bgTitle = t("studio.background.dropTitle");
    bgBody = t("studio.background.dropFormats");
  }

  const bgAsset = background?.asset ?? null;
  const listed = assets.filter((a) => a.id !== background?.assetId);
  const pct = Math.round(dimmer * 100);

  return (
    <div className="st-left__body">
      <p className="pn-h">{t("studio.source.assets")}</p>
      {listed.length === 0 ? (
        <div className="qr-empty">
          <Icon name="file-input" />
          <span>{t("studio.source.noAssets")}</span>
        </div>
      ) : (
        listed.map((a) => (
          <div key={a.id} className="qr-item">
            <Icon name={a.kind === "Audio" ? "audio-waveform" : a.kind === "Video" ? "film" : "image"} />
            <span className="qr-item__name" title={a.path}>
              {fileName(a.path)}
            </span>
            <span className="qr-item__meta">{a.kind}</span>
          </div>
        ))
      )}

      <div className="import-form">
        <p className="pn-h">{t("studio.source.importTitle")}</p>
        {shownError && (
          <ErrorAlert
            title={t("studio.source.importError")}
            message={shownError}
            onClose={() => {
              setLocalError(null);
              onDismissError();
            }}
          />
        )}
        <div
          ref={audioZone}
          data-drop-zone="audio"
          className={audioOver ? "qr-drop qr-empty import-drop is-dragover" : "qr-drop qr-empty import-drop"}
        >
          {importing ? <span className="qr-spin" /> : <Icon name="upload" />}
          <span className="qr-empty__title" aria-live="polite">
            {dropTitle}
          </span>
          <span>{dropBody}</span>
          {!importing && !audioOver && (
            <PickButton
              primary
              label={t("studio.source.pickButton")}
              disabled={busy}
              pick={() => openFile(t("studio.source.pickFilter"), MEDIA_EXTENSIONS)}
              onPicked={startAudio}
              onError={setLocalError}
            />
          )}
        </div>
      </div>

      <div className="import-form">
        <p className="pn-h">{t("studio.background.title")}</p>
        {shownBgError && (
          <ErrorAlert
            title={t("studio.background.error")}
            message={shownBgError}
            onClose={() => {
              setBgLocalError(null);
              onDismissBgError();
            }}
          />
        )}
        <div
          ref={bgZone}
          data-drop-zone="background"
          className={bgOver ? "qr-drop qr-empty import-drop is-dragover" : "qr-drop qr-empty import-drop"}
        >
          {bgImporting ? <span className="qr-spin" /> : <Icon name="image" />}
          <span className="qr-empty__title" aria-live="polite">
            {bgTitle}
          </span>
          <span>{bgBody}</span>
          {!bgImporting && !bgOver && (
            <PickButton
              primary={!background}
              label={background ? t("studio.background.replace") : t("studio.background.pickButton")}
              disabled={busy}
              pick={() => openFile(t("studio.background.pickFilter"), BACKGROUND_EXTENSIONS)}
              onPicked={startBackground}
              onError={setBgLocalError}
            />
          )}
        </div>
        {background && (
          <>
            <div className="qr-item">
              <Icon name={bgAsset?.kind === "Video" ? "film" : "image"} />
              <span className="qr-item__name" title={bgAsset?.path}>
                {bgAsset ? fileName(bgAsset.path) : t("studio.background.missing")}
              </span>
              <span className="qr-item__meta">
                {bgAsset ? `${bgAsset.kind} · ${formatBytes(bgAsset.size_bytes, locale)}` : "—"}
              </span>
              <button
                type="button"
                className="qr-btn qr-btn--ghost qr-btn--icon qr-btn--sm"
                disabled={busy}
                aria-label={t("studio.background.remove")}
                title={t("studio.background.remove")}
                onClick={onRemoveBackground}
              >
                <Icon name="trash-2" />
              </button>
            </div>
            <div className="qr-fieldset">
              <label className="qr-label" htmlFor={dimmerId}>
                {t("studio.background.dimmer")}
              </label>
              <span className="inline">
                <input
                  id={dimmerId}
                  type="range"
                  className="qr-slider"
                  min={0}
                  max={100}
                  step={5}
                  value={pct}
                  style={{ "--v": dimmer } as React.CSSProperties}
                  aria-valuetext={`${pct}%`}
                  onChange={(e) => onDimmer(Number(e.target.value) / 100)}
                />
                <span className="qr-tc">{pct}%</span>
              </span>
              <span className="qr-help">{t("studio.background.dimmerHelp")}</span>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

/** Pemilih rentang: surah dari dropdown nama, ayat dari dropdown yang dibatasi jumlah ayat surah. */
function RangeForm({
  range,
  onChange,
}: {
  range: AyahRange;
  onChange: (range: AyahRange) => void;
}): React.ReactElement {
  const { t, lang } = useI18n();
  const ids = [useId(), useId(), useId()];
  const surahs = useSurahs();
  const info = surahs[range.surah - 1];
  const count = info?.ayah_count ?? ayahCount(range.surah) ?? 1;
  const ayat = Array.from({ length: count }, (_, i) => i + 1);

  const setSurah = (id: number) => {
    const n = surahs[id - 1]?.ayah_count ?? ayahCount(id) ?? 1;
    onChange({ surah: id, from: 1, to: n });
  };
  const setFrom = (from: number) => onChange({ ...range, from, to: Math.max(range.to, from) });
  const setTo = (to: number) => onChange({ ...range, to, from: Math.min(range.from, to) });

  return (
    <div className="insp-pad range-form">
      <div className="qr-fieldset">
        <label className="qr-label" htmlFor={ids[0]}>
          {t("studio.range.surah")}
        </label>
        <span className="qr-field">
          <select id={ids[0]} value={range.surah} onChange={(e) => setSurah(Number(e.target.value))}>
            {surahs.length === 0 && <option value={range.surah}>{range.surah}</option>}
            {surahs.map((s) => (
              <option key={s.id} value={s.id}>
                {`${s.id}. ${s.name_latin} (${s.name_ar})`}
              </option>
            ))}
          </select>
        </span>
        {info && (
          <span className="qr-help">
            <span lang="ar" dir="rtl">
              {info.name_ar}
            </span>
            {" — "}
            {lang === "en" ? info.meaning_en : info.meaning_id}
          </span>
        )}
      </div>
      <div className="qr-fieldset">
        <label className="qr-label" htmlFor={ids[1]}>
          {t("studio.range.from")}
        </label>
        <span className="qr-field">
          <select id={ids[1]} value={range.from} onChange={(e) => setFrom(Number(e.target.value))}>
            {ayat.map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </span>
      </div>
      <div className="qr-fieldset">
        <label className="qr-label" htmlFor={ids[2]}>
          {t("studio.range.to")}
        </label>
        <span className="qr-field">
          <select id={ids[2]} value={range.to} onChange={(e) => setTo(Number(e.target.value))}>
            {ayat.map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </span>
      </div>
      <span className="qr-help">{t("studio.range.count", { surah: info?.name_latin ?? range.surah, count })}</span>
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
