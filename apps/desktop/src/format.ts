/** Ticks per detik (jam master audio 48 kHz, PRD ANM-3). */
export const TICKS_PER_SECOND = 48_000;

/** `mm:ss.cc` dari tick; dipotong, bukan dibulatkan (konsisten dengan kartu proyek). */
export function formatTime(ticks: number): string {
  const cs = Math.floor(Math.max(0, ticks) / (TICKS_PER_SECOND / 100));
  const mm = String(Math.floor(cs / 6000)).padStart(2, "0");
  const ss = String(Math.floor((cs % 6000) / 100)).padStart(2, "0");
  return `${mm}:${ss}.${String(cs % 100).padStart(2, "0")}`;
}

/** `mm:ss` dari tick, dipotong. */
export function formatClock(ticks: number | null): string | null {
  if (!ticks || ticks <= 0) return null;
  const s = Math.floor(ticks / TICKS_PER_SECOND);
  const mm = String(Math.floor(s / 60)).padStart(2, "0");
  const ss = String(s % 60).padStart(2, "0");
  return `${mm}:${ss}`;
}

export function fileName(path: string): string {
  return path.split(/[\\/]/).pop() ?? path;
}

/** Folder induk dari path (pemisah `/` atau `\`); kosong bila path hanya nama berkas. */
export function parentDir(path: string): string {
  const i = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  return i > 0 ? path.slice(0, i) : "";
}
