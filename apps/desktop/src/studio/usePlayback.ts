import { useCallback, useEffect, useRef, useState } from "react";
import { commands } from "../bindings";
import { errorText, unwrap } from "../tauri";

/** ~15 Hz, hanya saat memutar (doc 04: polling `playbackStatus` hanya selama playing). */
const POLL_MS = 66;
const END_SLACK_TICKS = 480;

export type Playback = {
  playing: boolean;
  /** Galat pemuatan/pemutaran/polling dari engine audio; `null` bila tidak ada. */
  error: string | null;
  clearError: () => void;
  toggle: () => void;
  pause: () => void;
  /** Pindah posisi: memperbarui playhead dan, bila audio sudah dimuat, engine. */
  seek: (tick: number) => void;
  /** Audio berubah (impor baru): muat ulang pada pemutaran berikutnya. */
  invalidate: () => void;
};

export function usePlayback({
  projectId,
  hasAudio,
  tick,
  totalTicks,
  onTick,
}: {
  projectId: string;
  hasAudio: boolean;
  tick: number;
  totalTicks: number;
  onTick: (tick: number) => void;
}): Playback {
  const [playing, setPlaying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const loaded = useRef(false);
  const playingRef = useRef(false);
  const inFlight = useRef(false);
  const latest = useRef({ tick, totalTicks, onTick });
  latest.current = { tick, totalTicks, onTick };
  playingRef.current = playing;

  const fail = useCallback((e: unknown) => {
    setError(errorText(e));
    setPlaying(false);
  }, []);

  const pause = useCallback(() => {
    setPlaying(false);
    if (!playingRef.current) return;
    unwrap(commands.playbackPause()).catch(fail);
  }, [fail]);

  const toggle = useCallback(() => {
    if (playingRef.current) {
      pause();
      return;
    }
    if (!hasAudio) return;
    const run = async () => {
      if (!loaded.current) {
        await unwrap(commands.playbackLoad(projectId));
        loaded.current = true;
      }
      const { tick: at, totalTicks: total } = latest.current;
      await unwrap(commands.playbackSeek(at >= total - END_SLACK_TICKS ? 0 : at));
      await unwrap(commands.playbackPlay());
      setError(null);
      setPlaying(true);
    };
    run().catch(fail);
  }, [fail, hasAudio, pause, projectId]);

  const seek = useCallback(
    (to: number) => {
      latest.current.onTick(to);
      if (!loaded.current) return;
      unwrap(commands.playbackSeek(Math.round(to))).catch(fail);
    },
    [fail]
  );

  const invalidate = useCallback(() => {
    loaded.current = false;
    setPlaying(false);
  }, []);

  useEffect(() => {
    if (!playing) return;
    const timer = window.setInterval(() => {
      if (inFlight.current) return;
      inFlight.current = true;
      commands
        .playbackStatus()
        .then((s) => {
          if (s.tick !== null) latest.current.onTick(s.tick);
          if (s.error) {
            setError(s.error);
            setPlaying(false);
          } else if (s.finished || !s.playing) {
            setPlaying(false);
          }
        })
        .catch(fail)
        .finally(() => {
          inFlight.current = false;
        });
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [playing, fail]);

  // Keluar dari Studio: hentikan suara (hasil perintah tidak bisa ditampilkan lagi di sini).
  useEffect(
    () => () => {
      if (playingRef.current) void commands.playbackPause();
    },
    []
  );

  return { playing, error, clearError: () => setError(null), toggle, pause, seek, invalidate };
}
