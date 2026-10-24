import { useEffect, useRef, useState } from "react";
import { commands, type SegmentTranslation } from "../bindings";
import { useI18n } from "../i18n";
import { errorText, unwrap } from "../tauri";
import { isSpecial, verseKey, type Project } from "./model";
import {
  AI_ENDPOINT_KEY,
  DEFAULT_AI_ENDPOINT,
  isLocalEndpoint,
  mergeTrimmed,
  wholeKey,
  withTranslation,
  type EditionInfo,
} from "./translation";

export type TrimKind = "auto" | "ai";
/** Satu permintaan pemotongan: segmen `ids` pada `edition`. */
export type TrimJob = { edition: string; ids: string[] };
/** Pemotongan berjalan; `scope` = id segmen, atau `"all"` untuk aksi massal. */
export type TrimBusy = { kind: TrimKind; scope: string };
export type AiStatus = { hasKey: boolean; endpoint: string; ready: boolean };
export type TranslationError = { title: string; message: string };

export type Translations = {
  /** Katalog edisi; `null` selama dimuat (atau gagal, lihat `catalogError`). */
  catalog: EditionInfo[] | null;
  catalogError: string | null;
  /** Teks ayat utuh: `undefined` selama dimuat, `null` bila edisi tidak punya teks ayat itu. */
  whole: (edition: string, surah: number, ayah: number) => string | null | undefined;
  /** Status kunci API/endpoint AI; `null` selama diperiksa. */
  ai: AiStatus | null;
  busy: TrimBusy | null;
  error: TranslationError | null;
  setError: (error: TranslationError | null) => void;
  trim: (kind: TrimKind, jobs: ReadonlyArray<TrimJob>, scope: string) => Promise<void>;
  setTranslation: (segmentId: string, edition: string, value: SegmentTranslation) => void;
};

const SEP = "\n";

/**
 * Data terjemahan Studio: katalog edisi, teks ayat utuh per edisi untuk ayat-ayat proyek, status AI,
 * dan pemotongan per segmen. Perintah pemotongan membaca proyek tersimpan, jadi proyek disimpan dulu;
 * hasilnya digabung lewat `edit` (proyek menjadi "belum disimpan" seperti suntingan lain).
 */
export function useTranslations({
  project,
  active,
  edit,
  ensureSaved,
}: {
  project: Project;
  /** Langkah yang memakai terjemahan sedang terbuka (data dimuat malas). */
  active: boolean;
  edit: (fn: (p: Project) => Project) => void;
  ensureSaved: () => Promise<boolean>;
}): Translations {
  const { t } = useI18n();
  const [catalog, setCatalog] = useState<EditionInfo[] | null>(null);
  const [catalogError, setCatalogError] = useState<string | null>(null);
  const [whole, setWhole] = useState<Record<string, string | null>>({});
  const [ai, setAi] = useState<AiStatus | null>(null);
  const [busy, setBusy] = useState<TrimBusy | null>(null);
  const [error, setError] = useState<TranslationError | null>(null);
  const requested = useRef(new Set<string>());
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const catalogLoaded = catalog !== null;
  useEffect(() => {
    if (!active || catalogLoaded) return;
    let cancelled = false;
    unwrap(commands.translationEditionsList())
      .then((list) => {
        if (cancelled) return;
        setCatalog(list);
        setCatalogError(null);
      })
      .catch((e) => {
        if (!cancelled) setCatalogError(errorText(e));
      });
    return () => {
      cancelled = true;
    };
  }, [active, catalogLoaded]);

  // Diperiksa ulang tiap kali langkah dibuka: kunci bisa diatur di Pengaturan sementara itu.
  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    Promise.all([unwrap(commands.aiKeyStatus()), unwrap(commands.settingsGet(AI_ENDPOINT_KEY))])
      .then(([hasKey, stored]) => {
        if (cancelled) return;
        const endpoint = typeof stored === "string" && stored.trim() !== "" ? stored.trim() : DEFAULT_AI_ENDPOINT;
        setAi({ hasKey, endpoint, ready: hasKey || isLocalEndpoint(endpoint) });
      })
      .catch((e) => {
        if (!cancelled) setError({ title: t("studio.tr.aiStatusError"), message: errorText(e) });
      });
    return () => {
      cancelled = true;
    };
  }, [active]);

  const editionsJoined = project.translation_editions.join(SEP);
  const versesJoined = [
    ...new Set(project.segments.filter((s) => !isSpecial(s)).map((s) => verseKey(s.surah_id, s.ayah_number))),
  ]
    .sort()
    .join(SEP);

  useEffect(() => {
    if (!active || editionsJoined === "" || versesJoined === "") return;
    const editions = editionsJoined.split(SEP);
    const verses = versesJoined
      .split(SEP)
      .filter((v) => editions.some((ed) => !requested.current.has(`${ed}|${v}`)));
    if (verses.length === 0) return;
    const pairs = verses.flatMap((v) => editions.map((ed) => `${ed}|${v}`));
    for (const p of pairs) requested.current.add(p);
    const refs = verses.map((v) => {
      const [surah = 0, ayah = 0] = v.split(":").map(Number);
      return { surah, ayah };
    });
    unwrap(commands.verseTranslations(editions, refs))
      .then((list) => {
        if (!mounted.current) return;
        setWhole((cur) => {
          const next = { ...cur };
          for (const p of pairs) if (next[p] === undefined) next[p] = null;
          for (const v of list) next[wholeKey(v.edition_key, v.surah, v.ayah)] = v.text;
          return next;
        });
      })
      .catch((e) => {
        for (const p of pairs) requested.current.delete(p);
        if (mounted.current) setError({ title: t("studio.tr.loadError"), message: errorText(e) });
      });
  }, [active, editionsJoined, versesJoined]);

  const trim = async (kind: TrimKind, jobs: ReadonlyArray<TrimJob>, scope: string) => {
    const todo = jobs.filter((j) => j.ids.length > 0);
    if (todo.length === 0 || busy !== null) return;
    setBusy({ kind, scope });
    setError(null);
    const title = kind === "ai" ? t("studio.tr.aiError") : t("studio.tr.autoError");
    try {
      if (!(await ensureSaved())) {
        if (mounted.current) setError({ title, message: t("studio.tr.saveFirst") });
        return;
      }
      for (const job of todo) {
        const out = await unwrap(
          kind === "ai"
            ? commands.translationAiTrim(project.id, job.ids, job.edition)
            : commands.translationAutoTrim(project.id, job.ids, job.edition)
        );
        if (!mounted.current) return;
        edit((p) => ({ ...p, segments: mergeTrimmed(p.segments, out, job.edition) }));
      }
    } catch (e) {
      if (mounted.current) setError({ title, message: errorText(e) });
    } finally {
      if (mounted.current) setBusy(null);
    }
  };

  const setTranslation = (segmentId: string, edition: string, value: SegmentTranslation) =>
    edit((p) => ({
      ...p,
      segments: p.segments.map((s) => (s.id === segmentId ? withTranslation(s, edition, value) : s)),
    }));

  return {
    catalog,
    catalogError,
    whole: (edition, surah, ayah) => whole[wholeKey(edition, surah, ayah)],
    ai,
    busy,
    error,
    setError,
    trim,
    setTranslation,
  };
}
