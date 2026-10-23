import type {
  AyahSegment_Serialize as Segment,
  Project_Serialize as Project,
  WordTiming,
} from "../bindings";
import type { PlainKey, TFunction } from "../i18n";
import { TICKS_PER_SECOND } from "../format";

export type { Segment, Project };

export const REVIEW_THRESHOLD = 0.8;
export const FALLBACK_TOTAL_TICKS = 30 * TICKS_PER_SECOND;

export type Ratio = "9:16" | "16:9" | "1:1" | "4:5";

/** Resolusi dasar per rasio: identik dengan `CanvasConfig::set_aspect` di crate inti Rust. */
export const RATIOS: ReadonlyArray<{ id: Ratio; width: number; height: number }> = [
  { id: "9:16", width: 1080, height: 1920 },
  { id: "16:9", width: 1920, height: 1080 },
  { id: "1:1", width: 1080, height: 1080 },
  { id: "4:5", width: 1080, height: 1350 },
];

const ALL_RATIOS: ReadonlyArray<Ratio> = ["9:16", "16:9", "1:1", "4:5"];

/**
 * Id templat = nama folder templat renderer. Rasio yang didukung mengikuti
 * docs/design/05_VIDEO_TEMPLATES.md §8 (rasio pertama = utama).
 */
export const TEMPLATES: ReadonlyArray<{ id: string; name: PlainKey; ratios: ReadonlyArray<Ratio> }> = [
  { id: "subuh", name: "studio.template.subuh", ratios: ["9:16", "16:9", "1:1", "4:5"] },
  { id: "hening", name: "studio.template.hening", ratios: ALL_RATIOS },
  { id: "terang", name: "studio.template.terang", ratios: ["9:16", "16:9", "1:1"] },
  { id: "besar", name: "studio.template.besar", ratios: ["9:16", "1:1"] },
  { id: "senja", name: "studio.template.senja", ratios: ["9:16", "4:5"] },
  { id: "naskh-klasik", name: "studio.template.naskhKlasik", ratios: ["9:16", "4:5"] },
  { id: "madinah", name: "studio.template.madinah", ratios: ["16:9", "1:1"] },
  { id: "kartu-apung", name: "studio.template.kartuApung", ratios: ["9:16", "4:5"] },
  { id: "siaran-lower-third", name: "studio.template.siaranLowerThird", ratios: ["16:9"] },
  { id: "kajian-side-panel", name: "studio.template.kajianSidePanel", ratios: ["16:9"] },
  { id: "editorial-split", name: "studio.template.editorialSplit", ratios: ["16:9", "9:16"] },
  { id: "tadabbur-wbw", name: "studio.template.tadabburWbw", ratios: ["9:16", "1:1"] },
];

export function templateById(id: string): (typeof TEMPLATES)[number] | undefined {
  return TEMPLATES.find((t) => t.id === id);
}

/** Terapkan rasio ke kanvas (ukuran ikut berubah). */
export function withRatio(project: Project, ratio: Ratio): Project {
  const r = RATIOS.find((x) => x.id === ratio);
  if (!r) return project;
  return {
    ...project,
    canvas: { ...project.canvas, width: r.width, height: r.height, aspect_ratio: r.id },
  };
}

export function segStart(s: Segment): number {
  return s.start_tick ?? 0;
}

export function segEnd(s: Segment): number {
  return s.end_tick ?? segStart(s);
}

export function segmentAt(segments: ReadonlyArray<Segment>, tick: number): Segment | undefined {
  return segments.find((s) => tick >= segStart(s) && tick < segEnd(s));
}

export function needsReview(s: Segment): boolean {
  return !s.manual_override && (s.confidence === null || s.confidence < REVIEW_THRESHOLD);
}

export function confidenceText(s: Segment): string {
  return s.confidence === null ? "—" : `${Math.round(s.confidence * 100)}%`;
}

/** `2:282` atau `2:282 (kata 1–5)` untuk segmen yang dibagi per rentang kata. */
export function segCode(s: Segment, t: TFunction): string {
  const base = `${s.surah_id}:${s.ayah_number}`;
  if (!s.word_range) return base;
  return `${base} ${t("studio.seg.wordRange", { from: s.word_range[0] ?? 0, to: s.word_range[1] ?? 0 })}`;
}

export function newSegmentId(): string {
  return crypto.randomUUID();
}

/** Rentang kata (1-based) yang dicakup segmen; `null` bila tidak diketahui (tanpa data kata). */
export function wordSpan(s: Segment): { first: number; last: number } | null {
  if (s.word_range) {
    const [a, b] = s.word_range;
    return a !== undefined && b !== undefined ? { first: a, last: b } : null;
  }
  const idx = s.word_timings.map((w) => w.word_idx);
  if (idx.length === 0) return null;
  return { first: Math.min(...idx), last: Math.max(...idx) };
}

/** Kata segmen dalam urutan indeks (untuk memilih titik bagi). */
export function segmentWords(s: Segment): WordTiming[] {
  return [...s.word_timings].sort((a, b) => a.word_idx - b.word_idx);
}

/**
 * Titik bagi: kata `k` menjadi kata pertama bagian kedua. Waktu pecah = awal kata `k`, sehingga tidak
 * ada kata yang terpotong (CNT-1). `null` bila `k` di luar (first, last], kata `k` tidak punya waktu,
 * atau waktu pecah tidak berada di dalam segmen.
 */
export function splitSegmentAt(
  s: Segment,
  k: number,
  newId: string
): [Segment, Segment] | null {
  const span = wordSpan(s);
  if (!span || k <= span.first || k > span.last) return null;
  const pivot = s.word_timings.find((w) => w.word_idx === k)?.start_tick;
  if (pivot === null || pivot === undefined) return null;
  if (pivot <= segStart(s) || pivot >= segEnd(s)) return null;
  const head: Segment = {
    ...s,
    end_tick: pivot,
    word_timings: s.word_timings.filter((w) => w.word_idx < k),
    word_range: [span.first, k - 1],
    manual_override: true,
  };
  const tail: Segment = {
    ...s,
    id: newId,
    start_tick: pivot,
    word_timings: s.word_timings.filter((w) => w.word_idx >= k),
    word_range: [k, span.last],
    manual_override: true,
  };
  return [head, tail];
}

/**
 * Mengubah batas segmen dan memetakan waktu kata secara linear ke batas baru, supaya tidak ada kata
 * yang keluar dari segmen (CNT-1). Timing kata memang proporsional, jadi pemetaan linear tetap benar.
 */
export function retimeSegment(s: Segment, start: number, end: number): Segment {
  const oldStart = segStart(s);
  const oldSpan = segEnd(s) - oldStart;
  const newSpan = end - start;
  const map = (tick: number | null): number | null => {
    if (tick === null || oldSpan <= 0) return tick;
    return Math.round(start + ((tick - oldStart) * newSpan) / oldSpan);
  };
  return {
    ...s,
    start_tick: start,
    end_tick: end,
    manual_override: true,
    word_timings: s.word_timings.map((w) => ({
      ...w,
      start_tick: map(w.start_tick),
      end_tick: map(w.end_tick),
    })),
  };
}

/** Kunci cache overflow: berubah bila templat, rasio, atau rentang kata segmen berubah. */
export function overflowKey(project: Project, s: Segment): string {
  const range = s.word_range ? `${s.word_range[0]}-${s.word_range[1]}` : "all";
  return `${project.template_id}|${project.canvas.aspect_ratio}|${s.id}|${range}`;
}

export function audioAsset(project: Project): { id: string; path: string; ticks: number | null } | null {
  const a = Object.values(project.assets).find((x) => x.kind === "Audio");
  return a ? { id: a.id, path: a.path, ticks: a.duration_ticks } : null;
}
