import { useEffect, useRef, useState } from "react";
import { commands, type PreviewFrame } from "../bindings";
import { errorText, unwrap } from "../tauri";
import type { Project } from "./model";

export const PREVIEW_WIDTH = 480;
const DEBOUNCE_MS = 150;
/** Selama memutar, frame baru diminta paling sering sekali per interval ini. */
const PLAYING_THROTTLE_MS = 300;

export type PreviewState = {
  frame: PreviewFrame | null;
  error: string | null;
  loading: boolean;
  /** Tick dan proyek yang dipakai frame ini (untuk mencatat overflow per segmen). */
  tick: number;
  project: Project | null;
};

/**
 * Frame preview dari renderer Rust (jalur yang sama dengan ekspor). Mengikuti `tick`: didebounce saat
 * diam, di-throttle saat memutar supaya tidak menumpuk permintaan.
 */
export function usePreview(project: Project, tick: number, enabled: boolean, playing: boolean): PreviewState {
  const [previewTick, setPreviewTick] = useState(tick);
  const [state, setState] = useState<PreviewState>({
    frame: null,
    error: null,
    loading: false,
    tick: 0,
    project: null,
  });
  const tickRef = useRef(tick);
  tickRef.current = tick;

  useEffect(() => {
    if (!playing) return;
    const timer = window.setInterval(() => setPreviewTick(tickRef.current), PLAYING_THROTTLE_MS);
    return () => clearInterval(timer);
  }, [playing]);

  useEffect(() => {
    if (playing) return;
    const timer = window.setTimeout(() => setPreviewTick(tick), DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [playing, tick]);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    setState((s) => ({ ...s, loading: true }));
    const at = Math.round(previewTick);
    unwrap(commands.previewFrame(project, at, PREVIEW_WIDTH))
      .then((frame) => {
        if (!cancelled) setState({ frame, error: null, loading: false, tick: at, project });
      })
      .catch((e) => {
        if (!cancelled)
          setState({ frame: null, error: errorText(e), loading: false, tick: at, project: null });
      });
    return () => {
      cancelled = true;
    };
  }, [project, previewTick, enabled]);

  return state;
}
