import React, { useEffect, useId, useRef, useState } from "react";
import type { TranslationStatus } from "../bindings";
import { useI18n, type PlainKey } from "../i18n";
import { ErrorAlert, Icon } from "../ui";
import { isSpecial, wordSpan, type Segment } from "./model";
import {
  isPartial,
  partialStatus,
  storedTranslation,
  type EditionInfo,
} from "./translation";
import type { TrimJob, Translations } from "./useTranslations";

const STATUS: Record<TranslationStatus, { label: PlainKey; badge: string }> = {
  ToReview: { label: "studio.tr.status.toReview", badge: "qr-badge qr-badge--warning" },
  AutoTrimmed: { label: "studio.tr.status.autoTrimmed", badge: "qr-badge qr-badge--accent" },
  AiTrimmed: { label: "studio.tr.status.aiTrimmed", badge: "qr-badge qr-badge--accent" },
  Reviewed: { label: "studio.tr.status.reviewed", badge: "qr-badge qr-badge--success" },
};

function hostOf(endpoint: string): string {
  try {
    return new URL(endpoint).host;
  } catch {
    return endpoint;
  }
}

type Editing = { edition: string; draft: string };

/**
 * Terjemahan segmen terpilih per edisi proyek (paritas Quran Caption). Ayat utuh memakai teks edisi
 * apa adanya; segmen sebagian ayat menyimpan potongan terjemahan beserta status tinjauannya, yang
 * bisa disunting, disetujui, atau dipotong otomatis/AI. Aksi massal berlaku untuk semua segmen
 * sebagian ayat di proyek.
 */
export function TranslationPanel({
  segment,
  segments,
  editions,
  catalog,
  tr,
  words,
  editRequested,
  onEditHandled,
}: {
  segment: Segment;
  segments: ReadonlyArray<Segment>;
  /** `project.translation_editions` (pertama = utama). */
  editions: ReadonlyArray<string>;
  catalog: ReadonlyArray<EditionInfo> | null;
  tr: Translations;
  /** Kata ayat segmen (indeks 0 = kata 1); `null` selama dimuat. */
  words: ReadonlyArray<string> | null;
  /** Pintasan E meminta penyuntingan terjemahan segmen ini. */
  editRequested: boolean;
  onEditHandled: () => void;
}): React.ReactElement {
  const { t } = useI18n();
  const headId = useId();
  const aiHelpId = useId();
  const rootRef = useRef<HTMLElement>(null);
  const editRef = useRef<HTMLTextAreaElement>(null);
  const [editing, setEditing] = useState<Editing | null>(null);

  const partial = isPartial(segment);
  const special = isSpecial(segment);
  const span = wordSpan(segment);
  const nameOf = (key: string) => catalog?.find((e) => e.key === key)?.name ?? key;
  const wholeOf = (key: string, s: Segment = segment) => tr.whole(key, s.surah_id, s.ayah_number);
  const currentText = (key: string): string | null => storedTranslation(segment, key)?.text ?? wholeOf(key) ?? null;
  const busy = tr.busy;
  const ai = tr.ai;

  useEffect(() => {
    if (!editRequested) return;
    onEditHandled();
    const target = partial ? editions[0] : undefined;
    if (target !== undefined) setEditing({ edition: target, draft: currentText(target) ?? "" });
    else rootRef.current?.focus();
    rootRef.current?.scrollIntoView({ block: "nearest" });
  }, [editRequested]);

  useEffect(() => {
    if (editing) editRef.current?.focus();
  }, [editing?.edition]);

  const saveEdit = () => {
    if (!editing) return;
    const text = editing.draft.trim();
    if (text === "") return;
    tr.setTranslation(segment.id, editing.edition, { text, status: "Reviewed" });
    setEditing(null);
  };

  // Aksi massal: hanya edisi yang punya teks ayat utuh untuk segmen itu (selain itu backend menolak).
  const partials = segments.filter(isPartial);
  const jobsWhere = (pick: (s: Segment, edition: string) => boolean): TrimJob[] =>
    editions.map((edition) => ({
      edition,
      ids: partials.filter((s) => typeof wholeOf(edition, s) === "string" && pick(s, edition)).map((s) => s.id),
    }));
  const autoJobs = jobsWhere((s, ed) => partialStatus(s, ed) === "ToReview");
  const aiJobs = jobsWhere((s, ed) => {
    const st = partialStatus(s, ed);
    return st === "ToReview" || st === "AutoTrimmed";
  });
  const count = (jobs: TrimJob[]) => jobs.reduce((n, j) => n + j.ids.length, 0);
  const primary = editions[0];
  const primaryPending =
    primary === undefined ? 0 : partials.filter((s) => partialStatus(s, primary) !== "Reviewed").length;

  const aiHelp =
    ai === null ? t("studio.tr.aiChecking") : ai.ready ? t("studio.tr.aiSends", { host: hostOf(ai.endpoint) }) : t("studio.tr.aiNoKey");

  const trimButton = (kind: "auto" | "ai", jobs: TrimJob[], scope: string, label: string, disabled: boolean) => {
    const running = busy !== null && busy.kind === kind && busy.scope === scope;
    const aiBlocked = kind === "ai" && !ai?.ready;
    return (
      <button
        type="button"
        className={running ? "qr-btn qr-btn--secondary qr-btn--sm is-loading" : "qr-btn qr-btn--secondary qr-btn--sm"}
        disabled={disabled || busy !== null || aiBlocked}
        aria-describedby={kind === "ai" ? aiHelpId : undefined}
        onClick={() => void tr.trim(kind, jobs, scope)}
      >
        {running ? <span className="qr-spin" /> : <Icon name="scissors" size="sm" />}
        {label}
      </button>
    );
  };

  return (
    <section className="tr-panel" aria-labelledby={headId} tabIndex={-1} ref={rootRef}>
      <span className="qr-label" id={headId}>
        {t("studio.tr.title")}
      </span>
      {tr.error && <ErrorAlert title={tr.error.title} message={tr.error.message} onClose={() => tr.setError(null)} />}
      {editions.length === 0 ? (
        <span className="qr-help">{t("studio.tr.noEditions")}</span>
      ) : special ? (
        <span className="qr-help">{t("studio.tr.special")}</span>
      ) : (
        <>
          {partial && span && (
            <div className="tr-block">
              <span className="qr-help">{t("studio.tr.arabic", { from: span.first, to: span.last })}</span>
              {words === null ? (
                <span className="qr-help" role="status">
                  <span className="qr-spin" /> {t("studio.tr.loadingWords")}
                </span>
              ) : (
                <p className="tr-arabic" lang="ar" dir="rtl">
                  {words.slice(span.first - 1, span.last).join(" ")}
                </p>
              )}
            </div>
          )}
          {editions.map((key, i) => {
            const whole = wholeOf(key);
            const stored = storedTranslation(segment, key);
            const status = partialStatus(segment, key);
            const text = currentText(key);
            const name = nameOf(key);
            const isEditing = editing !== null && editing.edition === key;
            const scope = `${segment.id}|${key}`;
            const job: TrimJob[] = [{ edition: key, ids: [segment.id] }];
            const canTrim = typeof whole === "string";
            return (
              <div key={key} className="tr-ed">
                <div className="tr-ed__head">
                  <span title={key}>
                    {name}
                    {i === 0 && editions.length > 1 && <small>{t("studio.tr.primary")}</small>}
                  </span>
                  {partial ? (
                    <span className={STATUS[status].badge}>{t(STATUS[status].label)}</span>
                  ) : (
                    <span className="qr-badge qr-badge--plain">{t("studio.tr.status.whole")}</span>
                  )}
                </div>
                {whole === undefined && stored === null ? (
                  <span className="qr-help" role="status">
                    <span className="qr-spin" /> {t("studio.tr.loading")}
                  </span>
                ) : whole === null && stored === null ? (
                  <span className="qr-help">{t("studio.tr.unavailable")}</span>
                ) : !partial ? (
                  <p className="tr-text">{whole}</p>
                ) : (
                  <>
                    {typeof whole === "string" && (
                      <div className="tr-block">
                        <span className="qr-help">{t("studio.tr.wholeLabel")}</span>
                        <p className="tr-whole">{whole}</p>
                      </div>
                    )}
                    <div className="tr-block">
                      <span className="qr-help">{t("studio.tr.segmentLabel")}</span>
                      {isEditing ? (
                        <textarea
                          ref={editRef}
                          className="tr-edit"
                          value={editing.draft}
                          aria-label={t("studio.tr.editLabel", { edition: name })}
                          onChange={(e) => setEditing({ edition: key, draft: e.target.value })}
                          onKeyDown={(e) => {
                            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                              e.preventDefault();
                              saveEdit();
                            } else if (e.key === "Escape") {
                              e.preventDefault();
                              setEditing(null);
                            }
                          }}
                        />
                      ) : (
                        <p className="tr-text">{text}</p>
                      )}
                    </div>
                    {isEditing ? (
                      <div className="tr-actions">
                        <button
                          type="button"
                          className="qr-btn qr-btn--primary qr-btn--sm"
                          disabled={editing.draft.trim() === ""}
                          onClick={saveEdit}
                        >
                          {t("studio.tr.saveEdit")}
                        </button>
                        <button type="button" className="qr-btn qr-btn--ghost qr-btn--sm" onClick={() => setEditing(null)}>
                          {t("common.cancel")}
                        </button>
                        <span className="qr-help">{t("studio.tr.editHelp")}</span>
                      </div>
                    ) : (
                      <div className="tr-actions">
                        <button
                          type="button"
                          className="qr-btn qr-btn--secondary qr-btn--sm"
                          onClick={() => setEditing({ edition: key, draft: text ?? "" })}
                        >
                          <Icon name="pencil-line" size="sm" />
                          {t("studio.tr.edit")}
                        </button>
                        <button
                          type="button"
                          className="qr-btn qr-btn--secondary qr-btn--sm"
                          disabled={status === "Reviewed" || text === null}
                          onClick={() => text !== null && tr.setTranslation(segment.id, key, { text, status: "Reviewed" })}
                        >
                          <Icon name="check" size="sm" />
                          {t("studio.tr.approve")}
                        </button>
                        {trimButton("auto", job, scope, t("studio.tr.autoTrim"), !canTrim)}
                        {trimButton("ai", job, scope, t("studio.tr.aiTrim"), !canTrim)}
                      </div>
                    )}
                  </>
                )}
              </div>
            );
          })}
          <span className="qr-help">{partial ? t("studio.tr.partialNote") : t("studio.tr.wholeNote")}</span>
        </>
      )}
      {editions.length > 0 && partials.length > 0 && (
        <div className="tr-bulk">
          <span className="qr-label">{t("studio.tr.bulkTitle")}</span>
          <span className="qr-help">
            {t("studio.tr.bulkSummary", { partial: partials.length, pending: primaryPending })}
          </span>
          {trimButton(
            "auto",
            autoJobs,
            "all",
            t("studio.tr.autoTrimAll", { count: count(autoJobs) }),
            count(autoJobs) === 0
          )}
          {trimButton("ai", aiJobs, "all", t("studio.tr.aiTrimAll", { count: count(aiJobs) }), count(aiJobs) === 0)}
          <span className="qr-help">{t("studio.tr.bulkHelp")}</span>
        </div>
      )}
      {editions.length > 0 && (partial || partials.length > 0) && (
        <span className="qr-help" id={aiHelpId}>
          {aiHelp}
        </span>
      )}
    </section>
  );
}
