import { commands, type SurahInfoDto as SurahInfo } from "../bindings";
import { useEffect, useState } from "react";
import { errorText, unwrap } from "../tauri";

/** Jumlah ayat per surah (indeks 0 = surah 1). Metadata mushaf Kemenag; total 6.236. Bukan teks ayat. */
export const AYAH_COUNTS: ReadonlyArray<number> = [
  7, 286, 200, 176, 120, 165, 206, 75, 129, 109, 123, 111, 43, 52, 99, 128, 111, 110, 98,
  135, 112, 78, 118, 64, 77, 227, 93, 88, 69, 60, 34, 30, 73, 54, 45, 83, 182, 88,
  75, 85, 54, 53, 89, 59, 37, 35, 38, 29, 18, 45, 60, 49, 62, 55, 78, 96, 29,
  22, 24, 13, 14, 11, 11, 18, 12, 12, 30, 52, 52, 44, 28, 28, 20, 56, 40, 31,
  50, 40, 46, 42, 29, 19, 36, 25, 22, 17, 19, 26, 30, 20, 15, 21, 11, 8, 8,
  19, 5, 8, 8, 11, 11, 8, 3, 9, 5, 4, 7, 3, 6, 3, 5, 4, 5, 6,
];

export const SURAH_COUNT = AYAH_COUNTS.length;

/** Jumlah ayat surah `surah` (1..114), atau `null` bila di luar rentang. */
export function ayahCount(surah: number): number | null {
  return AYAH_COUNTS[surah - 1] ?? null;
}

let cache: SurahInfo[] | null = null;
let inflight: Promise<SurahInfo[]> | null = null;
const waiters = new Set<() => void>();

/** Memuat daftar surah sekali per sesi aplikasi; panggilan berikutnya memakai hasil yang sama. */
export function loadSurahs(): Promise<SurahInfo[]> {
  if (cache) return Promise.resolve(cache);
  inflight ??= (async () => {
    try {
      const r = await unwrap(commands.surahList());
      cache = r;
      waiters.forEach((w) => w());
      return r;
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}

/** Daftar surah (kosong sampai termuat). Galat pemuatan diteruskan ke `onError`. */
export function useSurahs(onError?: (message: string) => void): ReadonlyArray<SurahInfo> {
  const [, bump] = useState(0);
  useEffect(() => {
    const w = () => bump((n) => n + 1);
    waiters.add(w);
    if (!cache) loadSurahs().catch((e) => onError?.(errorText(e)));
    return () => void waiters.delete(w);
  }, []);
  return cache ?? [];
}

/** Nama Latin surah (mis. "Al-Mulk"); jatuh ke nomor bila daftar belum termuat. */
export function surahName(list: ReadonlyArray<SurahInfo>, id: number): string {
  return list[id - 1]?.name_latin ?? String(id);
}

/** Ringkasan rentang untuk teks UI: "Al-Mulk 1–4" atau "Al-Mulk 3". */
export function rangeLabel(list: ReadonlyArray<SurahInfo>, surah: number, from: number, to: number): string {
  return `${surahName(list, surah)} ${from === to ? from : `${from}–${to}`}`;
}

export type { SurahInfo };
