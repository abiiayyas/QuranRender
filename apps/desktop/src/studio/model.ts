import type {
  AyahSegment_Serialize as Segment,
  Project_Serialize as Project,
  WordTiming,
} from "../bindings";
import type { PlainKey, TFunction } from "../i18n";
import { TICKS_PER_SECOND } from "../format";
import { translationPending } from "./translation";

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

/** Segmen berurutan menurut waktu mulai (daftar proyek tidak dijamin terurut setelah sisipan). */
export function sortSegments(segments: ReadonlyArray<Segment>): Segment[] {
  return [...segments].sort((a, b) => segStart(a) - segStart(b));
}

/** Segmen khusus (basmalah pembuka, isti'adzah): bukan teks ayat, `surah_id`/`ayah_number` = 0. */
export function isSpecial(s: Segment): boolean {
  return s.kind !== "Ayah";
}

export type ReviewReason = "lowConfidence" | "missingWords";

/** Alasan waktu segmen perlu ditinjau; kosong bila sudah diterima/diatur manual. */
export function reviewReasons(s: Segment): ReviewReason[] {
  if (s.manual_override) return [];
  const out: ReviewReason[] = [];
  if (s.confidence === null || s.confidence < REVIEW_THRESHOLD) out.push("lowConfidence");
  if (s.has_missing_words) out.push("missingWords");
  return out;
}

/**
 * Segmen perlu ditinjau: waktunya (lihat `reviewReasons`) atau terjemahan edisi utama `primary`
 * pada segmen sebagian ayat belum disetujui/disunting. Menerima waktu tidak menyetujui terjemahan.
 */
export function needsReview(s: Segment, primary: string | null): boolean {
  return reviewReasons(s).length > 0 || translationPending(s, primary);
}

export function confidenceText(s: Segment): string {
  return s.confidence === null ? "—" : `${Math.round(s.confidence * 100)}%`;
}

/** `2:282`, `2:282 (kata 1–5)`, atau nama segmen khusus (Basmalah/Isti'adzah). */
export function segCode(s: Segment, t: TFunction): string {
  if (s.kind === "Basmala") return t("studio.seg.basmala");
  if (s.kind === "Istiadha") return t("studio.seg.istiadha");
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
  // Potongan terjemahan lama tidak berlaku untuk rentang kata baru: kedua bagian kembali ke teks ayat
  // utuh berstatus "perlu ditinjau" sampai dipotong/disunting.
  const head: Segment = {
    ...s,
    end_tick: pivot,
    word_timings: s.word_timings.filter((w) => w.word_idx < k),
    word_range: [span.first, k - 1],
    manual_override: true,
    translations: {},
  };
  const tail: Segment = {
    ...s,
    id: newId,
    start_tick: pivot,
    word_timings: s.word_timings.filter((w) => w.word_idx >= k),
    word_range: [k, span.last],
    manual_override: true,
    translations: {},
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

/** Panjang satu frame proyek dalam tick (48 kHz). */
export function frameTicks(project: Project): number {
  const { fps_num, fps_den } = project.canvas;
  return fps_num > 0 && fps_den > 0 ? (TICKS_PER_SECOND * fps_den) / fps_num : TICKS_PER_SECOND / 30;
}

export function snapToFrame(tick: number, frame: number): number {
  return Math.round(Math.round(tick / frame) * frame);
}

export type Edge = "start" | "end";

/**
 * Memindah satu tepi segmen ke `tick` (di-clamp supaya segmen dan tetangganya minimal `minTicks`).
 * Tetangga yang tertimpa atau bersambung dengan tepi itu ikut digeser, jadi segmen tidak pernah
 * tumpang tindih. `null` bila segmen tidak ada atau tidak ada ruang.
 */
export function setSegmentEdge(
  segments: ReadonlyArray<Segment>,
  id: string,
  edge: Edge,
  tick: number,
  minTicks: number,
  maxTick: number
): { segments: Segment[]; tick: number } | null {
  const list = sortSegments(segments);
  const i = list.findIndex((s) => s.id === id);
  const seg = list[i];
  if (!seg) return null;
  const start = segStart(seg);
  const end = segEnd(seg);
  if (edge === "start") {
    const prev = list[i - 1];
    const lo = prev ? segStart(prev) + minTicks : 0;
    const hi = end - minTicks;
    if (lo > hi) return null;
    const at = Math.min(Math.max(tick, lo), hi);
    list[i] = retimeSegment(seg, at, end);
    if (prev && (segEnd(prev) > at || segEnd(prev) === start)) list[i - 1] = retimeSegment(prev, segStart(prev), at);
    return { segments: list, tick: at };
  }
  const next = list[i + 1];
  const lo = start + minTicks;
  const hi = next ? segEnd(next) - minTicks : maxTick;
  if (lo > hi) return null;
  const at = Math.min(Math.max(tick, lo), hi);
  list[i] = retimeSegment(seg, start, at);
  if (next && (segStart(next) < at || segStart(next) === end)) list[i + 1] = retimeSegment(next, at, segEnd(next));
  return { segments: list, tick: at };
}

/** Waktu kata proporsional terhadap panjang huruf (seperti `align_verse_words` di crate Rust align). */
export function proportionalTimings(
  words: ReadonlyArray<string>,
  firstIdx: number,
  start: number,
  end: number
): WordTiming[] {
  const weights = words.map((w) => Math.max([...w].length, 1));
  const total = weights.reduce((a, b) => a + b, 0);
  const span = end - start;
  let acc = 0;
  return words.map((text, i) => {
    const a = start + Math.round((span * acc) / total);
    acc += weights[i] ?? 1;
    const b = i === words.length - 1 ? end : start + Math.round((span * acc) / total);
    return { word_idx: firstIdx + i, start_tick: a, end_tick: b, text, confidence: null };
  });
}

/** Pilihan kata sinkron manual: ayat `surah:ayah`, kata `from..=to` (1-based). */
export type WordSelection = { surah: number; ayah: number; from: number; to: number };

/** Segmen sinkron manual untuk kata terpilih; `word_range` dikosongkan bila seluruh ayat. */
export function manualSegment(sel: WordSelection, words: ReadonlyArray<string>, start: number, end: number): Segment {
  const whole = sel.from === 1 && sel.to >= words.length;
  return {
    id: newSegmentId(),
    surah_id: sel.surah,
    ayah_number: sel.ayah,
    start_tick: start,
    end_tick: end,
    word_timings: proportionalTimings(words.slice(sel.from - 1, sel.to), sel.from, start, end),
    confidence: null,
    manual_override: true,
    ...(whole ? {} : { word_range: [sel.from, sel.to] }),
    kind: "Ayah",
    source: "Manual",
    has_missing_words: false,
  };
}

export function specialSegment(kind: "Basmala" | "Istiadha", start: number, end: number): Segment {
  return {
    id: newSegmentId(),
    surah_id: 0,
    ayah_number: 0,
    start_tick: start,
    end_tick: end,
    word_timings: [],
    confidence: null,
    manual_override: true,
    kind,
    source: "Manual",
    has_missing_words: false,
  };
}

export function verseKey(surah: number, ayah: number): string {
  return `${surah}:${ayah}`;
}

/**
 * Posisi lanjut sinkron manual: kata setelah segmen ayat terakhir, atau ayat berikutnya bila ayat itu
 * sudah lengkap. Tanpa segmen ayat: `fallback` kata 1. `wordCount` mengembalikan `undefined` bila
 * kata ayat belum dimuat (hasil `undefined` = tunggu); `null` = sudah melewati akhir mushaf.
 */
export function nextWordStart(
  segments: ReadonlyArray<Segment>,
  wordCount: (surah: number, ayah: number) => number | undefined,
  ayahsIn: (surah: number) => number | null,
  fallback: { surah: number; ayah: number }
): { surah: number; ayah: number; from: number } | null | undefined {
  const last = sortSegments(segments)
    .filter((s) => !isSpecial(s))
    .pop();
  if (!last) return { ...fallback, from: 1 };
  const { surah_id: surah, ayah_number: ayah } = last;
  const lastWord = last.word_range?.[1];
  if (lastWord !== undefined) {
    const count = wordCount(surah, ayah);
    if (count === undefined) return undefined;
    if (lastWord < count) return { surah, ayah, from: lastWord + 1 };
  }
  const inSurah = ayahsIn(surah);
  if (inSurah !== null && ayah < inSurah) return { surah, ayah: ayah + 1, from: 1 };
  return ayahsIn(surah + 1) === null ? null : { surah: surah + 1, ayah: 1, from: 1 };
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
