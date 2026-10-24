import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  commands,
  type AlignProgressEvent as AlignProgress,
  type AudioInfo,
  type CloudAlignOptions,
  type ExportValidationReport_Serialize as ValidationReport,
} from "./bindings";
import { BatchSheet } from "./Batch";
import { formatTime, TICKS_PER_SECOND } from "./format";
import { useTauriEvent } from "./hooks";
import { useI18n } from "./i18n";
import {
  ALIGN_PROGRESS_EVENT,
  CLOUD_CONSENT_KEY,
  CONSENT_REQUIRED_PREFIX,
  DEFAULT_CLOUD_OPTIONS,
  OFFLINE_PREFIX,
} from "./studio/cloud";
import { ExportInspector, ValidationPanel } from "./studio/ExportStep";
import {
  audioAsset,
  FALLBACK_TOTAL_TICKS,
  frameTicks,
  isSpecial,
  manualSegment,
  needsReview,
  newSegmentId,
  nextWordStart,
  overflowKey,
  retimeSegment,
  segEnd,
  segmentAt,
  segStart,
  setSegmentEdge,
  snapToFrame,
  sortSegments,
  specialSegment,
  splitSegmentAt,
  verseKey,
  withRatio,
  templateById,
  type Edge,
  type Project,
  type Ratio,
  type Segment,
  type WordSelection,
} from "./studio/model";
import { SourceInspector, SourcePanel, type AyahRange } from "./studio/SourceStep";
import { Stage } from "./studio/Stage";
import { StyleInspector, TemplatePanel } from "./studio/StyleStep";
import { SubtitleSheet } from "./studio/SubtitleSheet";
import { backgroundOf, DIMMER_KEY, dimmerOf } from "./studio/background";
import { ayahCount, SURAH_COUNT } from "./studio/surahs";
import {
  CloudSyncSheet,
  SyncInspector,
  SyncPanel,
  type AlignError,
  type AlignSummary,
  type ManualSync,
  type SyncMode,
} from "./studio/SyncStep";
import { Timeline } from "./studio/Timeline";
import { isPartial, primaryEdition } from "./studio/translation";
import { TranslationPanel } from "./studio/TranslationPanel";
import { useExportJob } from "./studio/useExport";
import { usePlayback } from "./studio/usePlayback";
import { usePreview } from "./studio/usePreview";
import { useTranslations } from "./studio/useTranslations";
import { errorText, unwrap } from "./tauri";
import { ErrorAlert, Icon, isModalOpen, isTypingTarget, Sheet, ThemeSwitch } from "./ui";

type Step = 1 | 2 | 3 | 4;
const STEPS: ReadonlyArray<Step> = [1, 2, 3, 4];
const SCAN_WIDTH = 160;
/** ←/→ pada sinkron manual (Quran Caption: ±2 dtk). */
const MANUAL_SEEK_TICKS = 2 * TICKS_PER_SECOND;
/** Kata ayat dimuat per permintaan `verse_words` (prefetch ayat berikutnya). */
const WORDS_PREFETCH = 10;
/** Batas atas pilihan kata sebelum jumlah kata ayat diketahui (di-clamp saat dipakai). */
const TO_END = Number.MAX_SAFE_INTEGER;

type SaveState =
  | { kind: "saved" }
  | { kind: "dirty" }
  | { kind: "saving" }
  | { kind: "error"; message: string };

const tabId = (n: Step) => `studio-tab-${n}`;
const PANEL_ID = "studio-panel";

function initialRange(project: Project): AyahRange {
  const ayat = project.segments.filter((s) => !isSpecial(s));
  const first = ayat[0];
  if (!first) return { surah: 1, from: 1, to: 7 };
  const same = ayat.filter((s) => s.surah_id === first.surah_id).map((s) => s.ayah_number);
  return { surah: first.surah_id, from: Math.min(...same), to: Math.max(...same) };
}

/** Pintasan global tidak boleh merebut tombol yang punya arti sendiri saat Spasi/Enter. */
function isControlTarget(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    target.closest('button, a[href], summary, label, [role="tab"], [role="radio"], [role="switch"]') !== null
  );
}

export function Studio({
  project: initialProject,
  initialAudio,
  onBack,
  onSave,
}: {
  project: Project;
  /** Berkas yang dipilih/diseret di lembar Proyek baru; diimpor sekali saat Studio dibuka. */
  initialAudio?: string;
  onBack: () => void;
  onSave: (project: Project) => Promise<void>;
}): React.ReactElement {
  const { t } = useI18n();
  const [project, setProject] = useState<Project>(initialProject);
  const [save, setSave] = useState<SaveState>({ kind: "saved" });
  const [step, setStep] = useState<Step>(1);
  const [tick, setTick] = useState(0);
  const [selectedId, setSelectedId] = useState<string | null>(initialProject.segments[0]?.id ?? null);
  const [range, setRange] = useState<AyahRange>(() => initialRange(initialProject));
  const [audio, setAudio] = useState<AudioInfo | null>(null);
  const [importing, setImporting] = useState<string | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const [bgImporting, setBgImporting] = useState<string | null>(null);
  const [bgError, setBgError] = useState<string | null>(null);
  const [aligning, setAligning] = useState<"cloud" | "vad" | null>(null);
  const [alignError, setAlignError] = useState<AlignError | null>(null);
  const [alignSummary, setAlignSummary] = useState<AlignSummary | null>(null);
  const [alignProgress, setAlignProgress] = useState<AlignProgress | null>(null);
  const [confirmAlign, setConfirmAlign] = useState(false);
  const [cloudSheet, setCloudSheet] = useState<"consent" | "options" | null>(null);
  const [cloudOptions, setCloudOptions] = useState<CloudAlignOptions>(DEFAULT_CLOUD_OPTIONS);
  const [consentBusy, setConsentBusy] = useState(false);
  const [consentError, setConsentError] = useState<string | null>(null);
  const [syncMode, setSyncMode] = useState<SyncMode>(initialProject.segments.length > 0 ? "review" : "manual");
  const [verseWords, setVerseWords] = useState<Record<string, string[]>>({});
  const [manualSel, setManualSel] = useState<WordSelection | null>(null);
  const [gapAt, setGapAt] = useState<number | null>(null);
  const [manualError, setManualError] = useState<AlignError | null>(null);
  const [overflow, setOverflow] = useState<Record<string, boolean>>({});
  const [scan, setScan] = useState<{ done: number; total: number } | null>(null);
  const [scanError, setScanError] = useState<string | null>(null);
  const [ratioNotice, setRatioNotice] = useState<string | null>(null);
  const [report, setReport] = useState<ValidationReport | null>(null);
  const [reportError, setReportError] = useState<string | null>(null);
  const [validating, setValidating] = useState(false);
  const [validateNonce, setValidateNonce] = useState(0);
  const [subtitleOpen, setSubtitleOpen] = useState(false);
  const [batchOpen, setBatchOpen] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [leaving, setLeaving] = useState(false);
  /** Pintasan E: segmen yang terjemahannya diminta untuk disunting (dikonsumsi panel terjemahan). */
  const [trEditFor, setTrEditFor] = useState<string | null>(null);

  const segments = project.segments;
  const selected = segments.find((s) => s.id === selectedId) ?? null;
  const dirty = save.kind !== "saved";
  const asset = audioAsset(project);
  const hasAudio = asset !== null;
  const primary = primaryEdition(project);

  const segmentsRef = useRef(segments);
  segmentsRef.current = segments;
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const totalTicks = useMemo(() => {
    const audioTicks = audio?.duration_ticks ?? asset?.ticks ?? 0;
    const ends = [
      audioTicks,
      ...segments.map(segEnd),
      ...project.tracks.flatMap((tr) => tr.clips.map((c) => c.end_tick ?? 0)),
    ];
    const max = Math.max(0, ...ends);
    return max > 0 ? max : FALLBACK_TOTAL_TICKS;
  }, [segments, project.tracks, audio, asset?.ticks]);

  const onTick = useCallback((to: number) => {
    setTick(to);
    const hit = segmentAt(segmentsRef.current, to);
    if (hit) setSelectedId(hit.id);
  }, []);

  const playback = usePlayback({ projectId: project.id, hasAudio, tick, totalTicks, onTick });
  const preview = usePreview(project, tick, segments.length > 0, playback.playing);
  const job = useExportJob(project.id);

  // Catat overflow teks dari frame yang baru tiba untuk segmen di bawah playhead.
  useEffect(() => {
    const { frame, project: framed, tick: framedTick } = preview;
    if (!frame || !framed) return;
    const seg = segmentAt(framed.segments, framedTick);
    if (!seg) return;
    const key = overflowKey(framed, seg);
    setOverflow((o) => (o[key] === frame.text_overflow ? o : { ...o, [key]: frame.text_overflow }));
  }, [preview]);

  const overflowOf = (s: Segment): boolean | undefined => overflow[overflowKey(project, s)];
  const overflowCount = segments.filter((s) => overflowOf(s) === true).length;

  const edit = (fn: (p: Project) => Project) => {
    setProject(fn);
    setSave({ kind: "dirty" });
  };

  const patchSegment = (id: string, patch: Partial<Segment>) =>
    edit((p) => ({
      ...p,
      segments: p.segments.map((s) => (s.id === id ? { ...s, ...patch } : s)),
    }));

  const selectSegment = (s: Segment) => {
    playback.seek(segStart(s));
    setSelectedId(s.id);
  };

  const moveSegment = (dir: 1 | -1) => {
    const idx = segments.findIndex((s) => s.id === selectedId);
    const next = segments[idx + dir];
    if (next) selectSegment(next);
    else if (idx < 0 && segments[0]) selectSegment(segments[0]);
  };

  const nextReviewAfter = (id: string | null): Segment | undefined => {
    const from = segments.findIndex((s) => s.id === id);
    const ordered = [...segments.slice(from + 1), ...segments.slice(0, from + 1)];
    return ordered.find((s) => needsReview(s, primary) && s.id !== id);
  };

  const nextReview = () => {
    const hit = nextReviewAfter(selectedId);
    if (hit) selectSegment(hit);
    else if (selected && needsReview(selected, primary)) selectSegment(selected);
  };

  const acceptAndAdvance = () => {
    if (!selected) return;
    patchSegment(selected.id, { manual_override: true });
    const hit = nextReviewAfter(selected.id);
    if (hit) selectSegment(hit);
  };

  const retime = (seg: Segment, start: number, end: number) => {
    edit((p) => ({
      ...p,
      segments: p.segments.map((s) => (s.id === seg.id ? retimeSegment(s, start, end) : s)),
    }));
    // Playhead tetap di dalam segmen yang sedang disunting supaya preview menampilkannya.
    if (tick < start || tick >= end) playback.seek(start);
  };

  const split = (seg: Segment, wordIdx: number) => {
    const parts = splitSegmentAt(seg, wordIdx, newSegmentId());
    if (!parts) return;
    edit((p) => ({
      ...p,
      segments: p.segments.flatMap((s) => (s.id === seg.id ? parts : [s])),
    }));
    playback.seek(segStart(parts[0]));
    setSelectedId(parts[0].id);
  };

  const saveProject = useCallback(async (): Promise<boolean> => {
    setSave({ kind: "saving" });
    try {
      await onSave(project);
      setSave({ kind: "saved" });
      return true;
    } catch (e) {
      setSave({ kind: "error", message: errorText(e) });
      return false;
    }
  }, [onSave, project]);

  const ensureSaved = useCallback(
    async (): Promise<boolean> => (save.kind === "saved" ? true : saveProject()),
    [save.kind, saveProject]
  );

  const tr = useTranslations({ project, active: step === 2 || step === 3, edit, ensureSaved });

  const goStep = (n: Step) => {
    setStep(n);
    setNotice(null);
  };

  const importAudio = async (path: string) => {
    setImporting(path);
    setImportError(null);
    try {
      if (!(await ensureSaved())) {
        setImportError(t("studio.source.saveFirst"));
        return;
      }
      const info = await unwrap(commands.audioImport(project.id, path));
      // Aset dan klip berubah di disk: muat ulang proyek (kontrak audio_import).
      const fresh = await unwrap(commands.projectOpen(project.id));
      setProject(fresh);
      setAudio(info);
      setSave({ kind: "saved" });
      playback.invalidate();
      setSelectedId((cur) => (fresh.segments.some((s) => s.id === cur) ? cur : (fresh.segments[0]?.id ?? null)));
    } catch (e) {
      setImportError(errorText(e));
    } finally {
      setImporting(null);
    }
  };

  const importBackground = async (path: string) => {
    setBgImporting(path);
    setBgError(null);
    try {
      if (!(await ensureSaved())) {
        setBgError(t("studio.background.saveFirst"));
        return;
      }
      await unwrap(commands.backgroundImport(project.id, path));
      // Aset, klip Latar, dan dimmer berubah di disk: muat ulang proyek (kontrak background_import).
      const fresh = await unwrap(commands.projectOpen(project.id));
      setProject(fresh);
      setSave({ kind: "saved" });
      playback.invalidate();
    } catch (e) {
      setBgError(errorText(e));
    } finally {
      setBgImporting(null);
    }
  };

  const removeBackground = async () => {
    setBgError(null);
    try {
      if (!(await ensureSaved())) {
        setBgError(t("studio.background.saveFirst"));
        return;
      }
      await unwrap(commands.backgroundRemove(project.id));
      const fresh = await unwrap(commands.projectOpen(project.id));
      setProject(fresh);
      setSave({ kind: "saved" });
      playback.invalidate();
    } catch (e) {
      setBgError(errorText(e));
    }
  };

  const setDimmer = (value: number) =>
    edit((p) => ({ ...p, style_overrides: { ...p.style_overrides, [DIMMER_KEY]: String(value) } }));

  // Sekali saat Studio pertama dibuka (ref bertahan saat StrictMode memanggil efek dua kali).
  const initialImportDone = useRef(false);
  useEffect(() => {
    if (!initialAudio || initialImportDone.current) return;
    initialImportDone.current = true;
    void importAudio(initialAudio);
  }, []);

  const applyAligned = (list: Segment[]) => {
    edit((p) => ({ ...p, segments: list }));
    const first = list[0];
    setSelectedId(first?.id ?? null);
    playback.seek(first ? segStart(first) : 0);
    setSyncMode("review");
    setManualSel(null);
    setGapAt(null);
  };

  const runAlign = async () => {
    setConfirmAlign(false);
    setAligning("vad");
    setAlignError(null);
    try {
      const out = await unwrap(commands.alignAuto(project.id, range.surah, range.from, range.to));
      applyAligned(out.segments);
      setAlignSummary({
        kind: "vad",
        speechRegions: out.speech_regions,
        versesExpected: out.verses_expected,
        warnings: out.warnings,
      });
    } catch (e) {
      setAlignError({ title: t("studio.sync.error"), message: errorText(e) });
    } finally {
      setAligning(null);
    }
  };

  useTauriEvent<AlignProgress>(ALIGN_PROGRESS_EVENT, setAlignProgress, (message) =>
    setAlignError({ title: t("studio.sync.progressError"), message })
  );

  const openCloud = async () => {
    setAlignError(null);
    setConsentError(null);
    try {
      const consent = await unwrap(commands.settingsGet(CLOUD_CONSENT_KEY));
      setCloudSheet(consent === true ? "options" : "consent");
    } catch (e) {
      setAlignError({ title: t("studio.sync.error"), message: errorText(e) });
    }
  };

  const giveConsent = async () => {
    setConsentBusy(true);
    setConsentError(null);
    try {
      await unwrap(commands.settingsSet(CLOUD_CONSENT_KEY, true));
      setCloudSheet("options");
    } catch (e) {
      setConsentError(errorText(e));
    } finally {
      setConsentBusy(false);
    }
  };

  const runCloud = async () => {
    setCloudSheet(null);
    setAligning("cloud");
    setAlignError(null);
    setAlignProgress(null);
    try {
      const out = await unwrap(commands.alignCloud(project.id, cloudOptions));
      applyAligned(out.segments);
      setAlignSummary({ kind: "cloud", detected: out.detected, warnings: out.warnings });
      // Ayat terdeteksi menjadi rentang Sumber: titik awal sinkron offline/manual berikutnya.
      const d = out.detected[0];
      if (d) setRange({ surah: d.surah, from: d.from_ayah, to: d.to_ayah });
    } catch (e) {
      const message = errorText(e);
      if (message.startsWith(CONSENT_REQUIRED_PREFIX)) {
        setCloudSheet("consent");
      } else if (message.startsWith(OFFLINE_PREFIX)) {
        setAlignError({ title: t("studio.sync.offlineTitle"), message: message.slice(OFFLINE_PREFIX.length).trim() });
      } else {
        setAlignError({ title: t("studio.sync.error"), message });
      }
    } finally {
      setAligning(null);
      setAlignProgress(null);
    }
  };

  // ---- Sinkron manual (papan ketik, seperti Quran Caption) ----
  const frame = frameTicks(project);
  const sorted = sortSegments(segments);
  const lastSeg = sorted[sorted.length - 1];
  const lastEnd = lastSeg ? segEnd(lastSeg) : 0;
  const nextStart = gapAt !== null && gapAt > lastEnd ? gapAt : lastEnd;
  const wordsOf = (surah: number, ayah: number) => verseWords[verseKey(surah, ayah)];
  const resume = nextWordStart(segments, (s, a) => wordsOf(s, a)?.length, ayahCount, {
    surah: range.surah,
    ayah: range.from,
  });
  const baseSel: WordSelection | null | undefined =
    manualSel ?? (resume ? { ...resume, to: TO_END } : resume);
  const selWords = baseSel ? (wordsOf(baseSel.surah, baseSel.ayah) ?? null) : null;
  const selection: WordSelection | null | undefined =
    baseSel && selWords ? { ...baseSel, to: Math.max(baseSel.from, Math.min(baseSel.to, selWords.length)) } : baseSel;
  const lastAyahSeg = sorted.filter((s) => !isSpecial(s)).pop();
  const manualActive = step === 2 && syncMode === "manual";
  // Panel terjemahan menampilkan kata Arab segmen sebagian ayat yang terpilih.
  const selectedVerse =
    step === 2 && selected && isPartial(selected) ? verseKey(selected.surah_id, selected.ayah_number) : null;
  const wantKeys = [
    ...(manualActive && baseSel ? [verseKey(baseSel.surah, baseSel.ayah)] : []),
    ...(manualActive && lastAyahSeg?.word_range ? [verseKey(lastAyahSeg.surah_id, lastAyahSeg.ayah_number)] : []),
    ...(selectedVerse ? [selectedVerse] : []),
  ].filter((k) => verseWords[k] === undefined);
  const wordsInFlight = useRef(new Set<string>());
  const wantJoined = wantKeys.join("|");

  useEffect(() => {
    if (wantJoined === "") return;
    for (const key of wantJoined.split("|")) {
      if (wordsInFlight.current.has(key)) continue;
      const [surah, ayah] = key.split(":").map(Number);
      if (!surah || !ayah) continue;
      const to = Math.min(ayah + WORDS_PREFETCH - 1, ayahCount(surah) ?? ayah);
      wordsInFlight.current.add(key);
      unwrap(commands.verseWords(surah, ayah, to))
        .then((list) => {
          if (!mounted.current) return;
          setVerseWords((cur) => {
            const next = { ...cur };
            for (const v of list) next[verseKey(v.surah, v.ayah)] = v.words;
            return next;
          });
        })
        .catch((e) => {
          if (!mounted.current) return;
          const message = errorText(e);
          if (manualActive) setManualError({ title: t("studio.manual.error"), message });
          else tr.setError({ title: t("studio.tr.wordsError"), message });
        })
        .finally(() => wordsInFlight.current.delete(key));
    }
  }, [wantJoined]);

  const playheadTick = () => snapToFrame(tick, frame);

  const insertSegment = (seg: Segment) => {
    edit((p) => ({ ...p, segments: sortSegments([...p.segments, seg]) }));
    setSelectedId(seg.id);
    setGapAt(null);
    setManualError(null);
  };

  /** Rentang segmen baru dari akhir segmen terakhir (atau penanda jeda) sampai playhead. */
  const manualSpan = (): { start: number; end: number } | null => {
    const end = playheadTick();
    if (end - nextStart < frame) {
      setManualError({
        title: t("studio.manual.actionError"),
        message: t("studio.manual.tooShort", { time: formatTime(nextStart) }),
      });
      return null;
    }
    return { start: nextStart, end };
  };

  const manualCreate = () => {
    if (!selection || !selWords) return;
    const span = manualSpan();
    if (!span) return;
    insertSegment(manualSegment(selection, selWords, span.start, span.end));
    setManualSel(null);
  };

  const manualSpecial = (kind: "Basmala" | "Istiadha") => {
    const span = manualSpan();
    if (span) insertSegment(specialSegment(kind, span.start, span.end));
  };

  const manualUndo = () => {
    if (!lastSeg) return;
    edit((p) => ({ ...p, segments: p.segments.filter((s) => s.id !== lastSeg.id) }));
    setSelectedId(sorted[sorted.length - 2]?.id ?? null);
    setManualSel(null);
    setGapAt(null);
    setManualError(null);
  };

  const manualGap = () => {
    const at = playheadTick();
    if (at <= lastEnd) {
      setManualError({
        title: t("studio.manual.actionError"),
        message: t("studio.manual.gapBefore", { time: formatTime(lastEnd) }),
      });
      return;
    }
    setGapAt(at);
    setManualError(null);
  };

  const manualWords = (dir: 1 | -1) => {
    if (!selection || !selWords) return;
    const to = Math.min(Math.max(selection.to + dir, selection.from), selWords.length);
    setManualSel({ ...selection, to });
  };

  const manualPick = (word: number) => {
    if (!selection) return;
    setManualSel(
      word >= selection.from
        ? { ...selection, to: word }
        : { ...selection, from: word, to: Math.max(word, selection.to) }
    );
  };

  const manualAyah = (dir: 1 | -1) => {
    if (!selection) return;
    let { surah, ayah } = selection;
    ayah += dir;
    if (ayah < 1) {
      if (surah === 1) return;
      surah -= 1;
      ayah = ayahCount(surah) ?? 1;
    } else if (ayah > (ayahCount(surah) ?? 0)) {
      if (surah >= SURAH_COUNT) return;
      surah += 1;
      ayah = 1;
    }
    setManualSel({ surah, ayah, from: 1, to: TO_END });
  };

  /** Tepi segmen (seret timeline atau N/M) ke `at`; tetangga digeser supaya tidak tumpang tindih. */
  const retimeEdge = (id: string, edge: Edge, at: number) => {
    edit((p) => ({
      ...p,
      segments: setSegmentEdge(p.segments, id, edge, at, frame, totalTicks)?.segments ?? p.segments,
    }));
    setSelectedId(id);
  };

  /** N/M: segmen di bawah playhead; di jeda, N memakai segmen berikutnya dan M segmen sebelumnya. */
  const edgeAtPlayhead = (edge: Edge) => {
    const at = playheadTick();
    const target =
      segmentAt(sorted, at) ??
      (edge === "start" ? sorted.find((s) => segStart(s) > at) : [...sorted].reverse().find((s) => segEnd(s) <= at));
    if (target) retimeEdge(target.id, edge, at);
  };

  /** E (seperti Quran Caption "sunting subtitle di kursor"): pilih segmen di playhead lalu sunting terjemahannya. */
  const editTranslationAtPlayhead = () => {
    const target = segmentAt(sorted, playheadTick()) ?? selected;
    if (!target) return;
    setSelectedId(target.id);
    setTrEditFor(target.id);
  };

  const manual: ManualSync = {
    selection,
    words: selWords,
    error: manualError,
    nextStart,
    gap: nextStart !== lastEnd,
    onPick: manualPick,
    onAyah: manualAyah,
    onCreate: manualCreate,
    onUndo: manualUndo,
    onSpecial: manualSpecial,
    onGap: manualGap,
    onDismissError: () => setManualError(null),
  };

  const manualKey = (e: KeyboardEvent): boolean => {
    const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
    if (key === "Enter") {
      if (isControlTarget(e.target)) return false;
      manualCreate();
    } else if (key === "Backspace") manualUndo();
    else if (key === "ArrowUp") manualWords(1);
    else if (key === "ArrowDown") manualWords(-1);
    else if (key === "ArrowLeft") playback.seek(Math.max(tick - MANUAL_SEEK_TICKS, 0));
    else if (key === "ArrowRight") playback.seek(Math.min(tick + MANUAL_SEEK_TICKS, totalTicks));
    else if (key === "v" && selection && selWords) setManualSel({ ...selection, from: 1, to: selWords.length });
    else if (key === "r") {
      setManualSel(null);
      setGapAt(null);
    } else if (key === "b") manualSpecial("Basmala");
    else if (key === "a") manualSpecial("Istiadha");
    else if (key === "s") manualGap();
    else if (key === "n") edgeAtPlayhead("start");
    else if (key === "m") edgeAtPlayhead("end");
    else return false;
    return true;
  };

  const scanOverflow = async () => {
    const snapshot = project;
    const list = snapshot.segments;
    setScan({ done: 0, total: list.length });
    setScanError(null);
    try {
      for (const [i, s] of list.entries()) {
        const frame = await unwrap(commands.previewFrame(snapshot, segStart(s), SCAN_WIDTH));
        if (!mounted.current) return;
        setOverflow((o) => ({ ...o, [overflowKey(snapshot, s)]: frame.text_overflow }));
        setScan({ done: i + 1, total: list.length });
      }
    } catch (e) {
      if (mounted.current) setScanError(errorText(e));
    } finally {
      if (mounted.current) setScan(null);
    }
  };

  const pickTemplate = (id: string) => {
    const tpl = templateById(id);
    const first = tpl?.ratios[0];
    const current = project.canvas.aspect_ratio;
    const switchTo = tpl && first && !tpl.ratios.some((r) => r === current) ? first : null;
    edit((p) => {
      const next: Project = { ...p, template_id: id };
      return switchTo ? withRatio(next, switchTo) : next;
    });
    setRatioNotice(
      tpl && switchTo ? t("studio.style.ratioChanged", { name: t(tpl.name), from: current, to: switchTo }) : null
    );
  };

  const pickRatio = (ratio: Ratio) => {
    setRatioNotice(null);
    edit((p) => withRatio(p, ratio));
  };

  useEffect(() => {
    if (step !== 4) return;
    let cancelled = false;
    setValidating(true);
    commands
      .projectValidate(project)
      .then((r) => {
        if (cancelled) return;
        setReport(r);
        setReportError(null);
      })
      .catch((e) => {
        if (!cancelled) setReportError(errorText(e));
      })
      .finally(() => {
        if (!cancelled) setValidating(false);
      });
    return () => {
      cancelled = true;
    };
  }, [step, project, validateNonce]);

  // Pintasan global; handler terbaru lewat ref supaya listener cukup dipasang sekali.
  const keyHandler = useRef<(e: KeyboardEvent) => void>(() => undefined);
  keyHandler.current = (e: KeyboardEvent) => {
    if (isModalOpen()) return;
    const mod = e.metaKey || e.ctrlKey;
    if (mod && e.key.toLowerCase() === "s") {
      e.preventDefault();
      void saveProject();
      return;
    }
    if (mod && /^[1-4]$/.test(e.key)) {
      e.preventDefault();
      goStep(Number(e.key) as Step);
      return;
    }
    if (mod || e.altKey || isTypingTarget(e.target)) return;
    if (e.key === " " && !isControlTarget(e.target)) {
      e.preventDefault();
      playback.toggle();
    } else if (e.key === "[") {
      moveSegment(-1);
    } else if (e.key === "]") {
      moveSegment(1);
    } else if (step === 2 && e.key.toLowerCase() === "e" && !e.defaultPrevented) {
      e.preventDefault();
      editTranslationAtPlayhead();
    } else if (manualActive) {
      // Tombol yang sudah ditangani kontrol fokus (daftar, timeline, tab) tidak diambil alih.
      if (!e.defaultPrevented && manualKey(e)) e.preventDefault();
    } else if (e.key.toLowerCase() === "n" && step === 2) {
      nextReview();
    } else if (e.key === "Enter" && step === 2 && e.target === document.body) {
      acceptAndAdvance();
    }
  };
  useEffect(() => {
    const handler = (e: KeyboardEvent) => keyHandler.current(e);
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  const tabKey = (e: React.KeyboardEvent<HTMLOListElement>) => {
    const idx = STEPS.indexOf(step);
    let next: number | null = null;
    if (e.key === "ArrowRight") next = (idx + 1) % STEPS.length;
    else if (e.key === "ArrowLeft") next = (idx - 1 + STEPS.length) % STEPS.length;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = STEPS.length - 1;
    const target = next === null ? undefined : STEPS[next];
    if (target === undefined) return;
    e.preventDefault();
    goStep(target);
    document.getElementById(tabId(target))?.focus();
  };

  const leave = () => {
    playback.pause();
    if (dirty) setLeaving(true);
    else onBack();
  };

  const assets = Object.values(project.assets);
  const stepLabels: Record<Step, string> = {
    1: t("studio.step.source"),
    2: t("studio.step.sync"),
    3: t("studio.step.style"),
    4: t("studio.step.export"),
  };

  const saveLabel =
    save.kind === "saved"
      ? t("studio.save.saved")
      : save.kind === "saving"
        ? t("studio.save.saving")
        : save.kind === "dirty"
          ? t("studio.save.dirty")
          : t("studio.save.error");
  const saveCls = save.kind === "dirty" ? "save is-dirty" : save.kind === "error" ? "save is-error" : "save";

  let left: React.ReactNode;
  let inspector: React.ReactNode;

  if (step === 1) {
    left = (
      <SourcePanel
        assets={assets}
        importing={importing}
        error={importError}
        onDismissError={() => setImportError(null)}
        onImport={(p) => void importAudio(p)}
        background={backgroundOf(project)}
        dimmer={dimmerOf(project)}
        bgImporting={bgImporting}
        bgError={bgError}
        onDismissBgError={() => setBgError(null)}
        onBackground={(p) => void importBackground(p)}
        onRemoveBackground={() => void removeBackground()}
        onDimmer={setDimmer}
      />
    );
    inspector = (
      <SourceInspector project={project} assets={assets} audio={audio} range={range} onRange={setRange} />
    );
  } else if (step === 2) {
    left = (
      <SyncPanel
        segments={segments}
        primaryEdition={primary}
        selectedId={selectedId}
        range={range}
        hasAudio={hasAudio}
        aligning={aligning}
        progress={alignProgress}
        alignError={alignError}
        summary={alignSummary}
        scan={scan}
        overflowOf={overflowOf}
        mode={syncMode}
        manual={manual}
        onMode={setSyncMode}
        onAlignCloud={() => void openCloud()}
        onAlignOffline={() => (segments.length > 0 ? setConfirmAlign(true) : void runAlign())}
        onDismissError={() => setAlignError(null)}
        onSelect={selectSegment}
        onAccept={acceptAndAdvance}
        onNextReview={nextReview}
        onScan={() => void scanOverflow()}
      />
    );
    inspector = (
      <SyncInspector
        segment={selected}
        overflow={selected ? overflowOf(selected) === true : false}
        mode={syncMode}
        onRetime={retime}
        onSplit={split}
      >
        {selected && (
          <TranslationPanel
            segment={selected}
            segments={segments}
            editions={project.translation_editions}
            catalog={tr.catalog}
            tr={tr}
            words={isPartial(selected) ? (wordsOf(selected.surah_id, selected.ayah_number) ?? null) : null}
            editRequested={trEditFor === selected.id}
            onEditHandled={() => setTrEditFor(null)}
          />
        )}
      </SyncInspector>
    );
  } else if (step === 3) {
    left = <TemplatePanel templateId={project.template_id} onPick={pickTemplate} />;
    inspector = (
      <StyleInspector
        project={project}
        ratioNotice={ratioNotice}
        onRatio={pickRatio}
        catalog={tr.catalog}
        catalogError={tr.catalogError}
        onEditions={(editions) => edit((p) => ({ ...p, translation_editions: editions }))}
      />
    );
  } else {
    left = (
      <ValidationPanel
        report={report}
        error={reportError}
        validating={validating}
        overflowCount={overflowCount}
        segments={segments}
        onRevalidate={() => setValidateNonce((n) => n + 1)}
        onSelectSegment={(s) => {
          selectSegment(s);
          goStep(2);
        }}
        onGoSync={() => goStep(2)}
      />
    );
    inspector = (
      <ExportInspector
        project={project}
        totalTicks={totalTicks}
        report={report}
        validating={validating}
        job={job}
        ensureSaved={ensureSaved}
        onSubtitle={() => setSubtitleOpen(true)}
        onBatch={() => {
          void ensureSaved().then((ok) => {
            if (ok) setBatchOpen(true);
          });
        }}
      />
    );
  }

  const playLabel = playback.playing ? t("studio.transport.pause") : t("studio.transport.play");

  return (
    <div className="studio">
      <header className="st-hd">
        <div className="l">
          <button type="button" className="qr-btn qr-btn--ghost" onClick={leave}>
            <Icon name="chevron-left" />
            {t("studio.home")}
          </button>
          <span className="st-name">
            {project.name}
            {project.reciter && <small>{project.reciter}</small>}
          </span>
          <span className={saveCls} role="status" title={save.kind === "error" ? save.message : undefined}>
            <Icon name={save.kind === "saved" ? "check" : "circle-alert"} />
            {saveLabel}
          </span>
        </div>
        <ol className="qr-flow" role="tablist" aria-label={t("studio.flow.label")} onKeyDown={tabKey}>
          {STEPS.map((n, i) => {
            const cur = n === step;
            const done = n < step;
            return (
              <li key={n} role="presentation" className={cur ? "is-current" : done ? "is-done" : undefined}>
                {i > 0 && (
                  <span className="qr-flow__sep" aria-hidden="true">
                    <Icon name="chevron-right" size="sm" />
                  </span>
                )}
                <button
                  type="button"
                  role="tab"
                  id={tabId(n)}
                  aria-selected={cur}
                  aria-controls={PANEL_ID}
                  tabIndex={cur ? 0 : -1}
                  onClick={() => goStep(n)}
                >
                  <span className="qr-flow__n">{done ? <Icon name="check" size="sm" /> : n}</span>
                  <span className="lbl-t">{stepLabels[n]}</span>
                </button>
              </li>
            );
          })}
        </ol>
        <div className="r">
          <ThemeSwitch />
          <button
            type="button"
            className="qr-btn qr-btn--secondary"
            disabled={save.kind === "saving"}
            onClick={() => void saveProject()}
          >
            <Icon name="save" />
            {t("common.save")}
          </button>
          <button type="button" className="qr-btn qr-btn--primary" onClick={() => goStep(4)}>
            <Icon name="file-output" />
            {t("studio.exportAction")}
          </button>
        </div>
      </header>

      <div className="st-body" role="tabpanel" id={PANEL_ID} aria-labelledby={tabId(step)}>
        <aside className="st-left" aria-label={t("studio.left.label")}>
          {(save.kind === "error" || playback.error || scanError || notice) && (
            <div className="insp-pad">
              {save.kind === "error" && (
                <ErrorAlert title={t("studio.save.errorTitle")} message={save.message} />
              )}
              {playback.error && (
                <ErrorAlert
                  title={t("studio.playback.error")}
                  message={playback.error}
                  onClose={playback.clearError}
                />
              )}
              {scanError && (
                <ErrorAlert title={t("studio.sync.scanError")} message={scanError} onClose={() => setScanError(null)} />
              )}
              {notice && (
                <div className="qr-alert qr-alert--success" role="status">
                  <Icon name="circle-check" />
                  <div className="qr-alert__content">
                    <span className="qr-alert__body">{notice}</span>
                  </div>
                  <span className="qr-alert__actions">
                    <button type="button" className="qr-btn qr-btn--ghost qr-btn--sm" onClick={() => setNotice(null)}>
                      {t("common.close")}
                    </button>
                  </span>
                </div>
              )}
            </div>
          )}
          {left}
        </aside>
        <main className="st-viewer" aria-label={t("studio.viewer.label")}>
          <Stage project={project} preview={preview} hasSegments={segments.length > 0} />
          <div className="transport-row">
            <span className="qr-transport">
              <button
                type="button"
                className="qr-btn qr-btn--ghost qr-btn--icon"
                aria-label={t("studio.transport.prev")}
                disabled={segments.length === 0}
                onClick={() => moveSegment(-1)}
              >
                <Icon name="skip-back" />
              </button>
              <button
                type="button"
                className="qr-play"
                aria-label={hasAudio ? playLabel : t("studio.transport.noAudio")}
                title={hasAudio ? playLabel : t("studio.transport.noAudio")}
                disabled={!hasAudio}
                onClick={playback.toggle}
              >
                <Icon name={playback.playing ? "pause" : "play"} />
              </button>
              <button
                type="button"
                className="qr-btn qr-btn--ghost qr-btn--icon"
                aria-label={t("studio.transport.next")}
                disabled={segments.length === 0}
                onClick={() => moveSegment(1)}
              >
                <Icon name="step-forward" />
              </button>
              <span className="qr-tc">{formatTime(tick)}</span>
              <span className="qr-tc qr-tc--dim">/ {formatTime(totalTicks)}</span>
            </span>
          </div>
        </main>
        <aside className="st-insp" aria-label={t("studio.inspector.label")}>
          {inspector}
        </aside>
      </div>

      <div className="st-tl">
        <Timeline
          project={project}
          totalTicks={totalTicks}
          tick={tick}
          selectedId={selectedId}
          audio={audio}
          frame={frame}
          onSeek={playback.seek}
          onSelect={selectSegment}
          onRetimeEdge={retimeEdge}
        />
      </div>

      {subtitleOpen && <SubtitleSheet project={project} onClose={() => setSubtitleOpen(false)} />}
      {batchOpen && (
        <BatchSheet
          projectId={project.id}
          projectName={project.name}
          onClose={() => setBatchOpen(false)}
          onEnqueued={(count) => {
            setBatchOpen(false);
            setNotice(t("studio.export.batchQueued", { count }));
          }}
        />
      )}
      {cloudSheet && (
        <CloudSyncSheet
          key={cloudSheet}
          stage={cloudSheet}
          options={cloudOptions}
          segments={segments}
          busy={consentBusy}
          error={consentError}
          onOptions={setCloudOptions}
          onConsent={() => void giveConsent()}
          onRun={() => void runCloud()}
          onClose={() => setCloudSheet(null)}
        />
      )}
      {confirmAlign && (
        <Sheet
          title={t("studio.sync.replaceTitle")}
          onClose={() => setConfirmAlign(false)}
          footer={
            <>
              <button type="button" className="qr-btn qr-btn--secondary" onClick={() => setConfirmAlign(false)}>
                {t("common.cancel")}
              </button>
              <button type="button" className="qr-btn qr-btn--primary" onClick={() => void runAlign()}>
                {t("studio.sync.replaceConfirm")}
              </button>
            </>
          }
        >
          <p>
            {t("studio.sync.replaceBody", {
              count: segments.length,
              manual: segments.filter((s) => s.manual_override).length,
            })}
          </p>
        </Sheet>
      )}
      {leaving && (
        <Sheet
          title={t("studio.leave.title")}
          onClose={() => setLeaving(false)}
          footer={
            <>
              <button type="button" className="qr-btn qr-btn--ghost" onClick={() => setLeaving(false)}>
                {t("common.cancel")}
              </button>
              <button type="button" className="qr-btn qr-btn--danger" onClick={onBack}>
                {t("studio.leave.discard")}
              </button>
              <button
                type="button"
                className="qr-btn qr-btn--primary"
                onClick={() => {
                  void saveProject().then((ok) => {
                    if (ok) onBack();
                    else setLeaving(false);
                  });
                }}
              >
                {t("studio.leave.saveAndExit")}
              </button>
            </>
          }
        >
          <p>{t("studio.leave.body")}</p>
        </Sheet>
      )}
    </div>
  );
}
