import type {
  AyahSegment_Serialize as TrimmedSegment,
  EditionInfo_Serialize,
  SegmentTranslation,
  TranslationStatus,
} from "../bindings";
import type { Project, Segment } from "./model";

export type EditionInfo = EditionInfo_Serialize;

/** Pengaturan layanan AI (non-rahasia; kunci API ada di keychain OS). */
export const AI_ENDPOINT_KEY = "ai.endpoint";
export const AI_MODEL_KEY = "ai.model";
/** Nilai bawaan backend bila pengaturan kosong (`DEFAULT_AI_ENDPOINT`/`DEFAULT_AI_MODEL` di Rust). */
export const DEFAULT_AI_ENDPOINT = "https://api.openai.com/v1";
export const DEFAULT_AI_MODEL = "gpt-4o-mini";

/** Server di komputer ini tidak butuh kunci API (sama dengan `is_local_endpoint` di backend). */
export function isLocalEndpoint(endpoint: string): boolean {
  try {
    const host = new URL(endpoint).hostname;
    return host === "localhost" || host === "127.0.0.1";
  } catch {
    return false;
  }
}

/** Edisi utama proyek (yang pertama); `null` bila proyek tidak menampilkan terjemahan. */
export function primaryEdition(project: Project): string | null {
  return project.translation_editions[0] ?? null;
}

/** Segmen sebagian ayat: terjemahannya disimpan per segmen (dipotong lalu ditinjau). */
export function isPartial(s: Segment): boolean {
  return s.kind === "Ayah" && Boolean(s.word_range);
}

/** Entri terjemahan segmen untuk `edition`; entri kosong diperlakukan seperti tidak ada (seperti renderer). */
export function storedTranslation(s: Segment, edition: string): SegmentTranslation | null {
  const entry = s.translations?.[edition];
  return entry && entry.text.trim() !== "" ? entry : null;
}

/** Status terjemahan segmen sebagian ayat; tanpa entri = teks ayat utuh berstatus `ToReview`. */
export function partialStatus(s: Segment, edition: string): TranslationStatus {
  return storedTranslation(s, edition)?.status ?? "ToReview";
}

/** Terjemahan segmen sebagian ayat pada `edition` belum disetujui/disunting. */
export function translationPending(s: Segment, edition: string | null): boolean {
  return edition !== null && isPartial(s) && partialStatus(s, edition) !== "Reviewed";
}

export function withTranslation(s: Segment, edition: string, value: SegmentTranslation): Segment {
  return { ...s, translations: { ...s.translations, [edition]: value } };
}

/**
 * Menggabungkan hasil `translation_auto_trim`/`translation_ai_trim` ke segmen proyek: hanya entri
 * `edition` yang diambil, sehingga perubahan lain pada segmen tidak tertimpa salinan dari disk.
 */
export function mergeTrimmed(
  segments: ReadonlyArray<Segment>,
  trimmed: ReadonlyArray<TrimmedSegment>,
  edition: string
): Segment[] {
  const byId = new Map<string, SegmentTranslation>();
  for (const s of trimmed) {
    const entry = s.translations?.[edition];
    if (entry) byId.set(s.id, entry);
  }
  return segments.map((s) => {
    const entry = byId.get(s.id);
    return entry ? withTranslation(s, edition, entry) : s;
  });
}

/** Kunci cache teks ayat utuh per edisi. */
export function wholeKey(edition: string, surah: number, ayah: number): string {
  return `${edition}|${surah}:${ayah}`;
}

const displayNames = new Map<string, Intl.DisplayNames>();

/** Nama bahasa dari kode ISO 639-1 (atau nama bahasa apa adanya bila bukan kode). */
export function languageName(code: string, locale: string): string {
  try {
    let names = displayNames.get(locale);
    if (!names) {
      names = new Intl.DisplayNames([locale], { type: "language" });
      displayNames.set(locale, names);
    }
    return names.of(code) ?? code;
  } catch {
    return code;
  }
}
