import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { commands, type JobDto_Serialize as Job } from "./bindings";
import { fileName } from "./format";
import { useTauriEvent } from "./hooks";
import { useI18n, type TFunction } from "./i18n";
import { errorText, unwrap } from "./tauri";
import { ErrorAlert, Icon } from "./ui";

const POLL_MS = 1500;
const EVENT_COALESCE_MS = 250;

type Group = "running" | "waiting" | "done" | "failed" | "other";
type Op = "cancel" | "pause" | "resume";

const GROUP_ORDER: ReadonlyArray<Group> = ["running", "waiting", "done", "failed", "other"];

function groupOf(state: string): Group {
  switch (state) {
    case "running":
      return "running";
    case "queued":
    case "paused":
      return "waiting";
    case "succeeded":
      return "done";
    case "failed":
    case "canceled":
      return "failed";
    default:
      return "other";
  }
}

/** Jumlah job yang masih berjalan atau menunggu (queued, running, paused). */
export function activeJobCount(jobs: ReadonlyArray<Job>): number {
  return jobs.filter((j) => j.state === "queued" || j.state === "running" || j.state === "paused")
    .length;
}

/**
 * Memanggil `onRefresh` setiap kali worker melaporkan kemajuan atau selesai. Event progres bisa
 * sangat rapat, jadi beberapa event digabung menjadi satu panggilan per `EVENT_COALESCE_MS`.
 */
export function useQueueEvents(onRefresh: () => void, onError: (message: string) => void): void {
  const timer = useRef<number | undefined>(undefined);
  const refreshRef = useRef(onRefresh);
  refreshRef.current = onRefresh;

  useEffect(
    () => () => {
      clearTimeout(timer.current);
    },
    []
  );

  const schedule = useCallback(() => {
    if (timer.current !== undefined) return;
    timer.current = window.setTimeout(() => {
      timer.current = undefined;
      refreshRef.current();
    }, EVENT_COALESCE_MS);
  }, []);

  useTauriEvent<unknown>("export-progress", schedule, onError);
  useTauriEvent<unknown>("export-finished", schedule, onError);
}

function kindIcon(kind: string): string {
  switch (kind) {
    case "render":
      return "film";
    case "align":
      return "audio-waveform";
    case "batch_split":
      return "scissors";
    case "download_edition":
    case "download_model":
      return "download";
    default:
      return "list";
  }
}

function kindLabel(kind: string, t: TFunction): string {
  switch (kind) {
    case "render":
      return t("app.queue.kind.render");
    case "align":
      return t("app.queue.kind.align");
    case "batch_split":
      return t("app.queue.kind.batchSplit");
    case "download_edition":
      return t("app.queue.kind.downloadEdition");
    case "download_model":
      return t("app.queue.kind.downloadModel");
    default:
      return kind;
  }
}

function progressPercent(progress: number | null): number | null {
  if (progress === null || !Number.isFinite(progress)) return null;
  return Math.round(Math.min(1, Math.max(0, progress)) * 100);
}

function StateBadge({ job }: { job: Job }): React.ReactElement {
  const { t } = useI18n();
  const pct = progressPercent(job.progress);
  switch (job.state) {
    case "queued":
      return (
        <span className="qr-badge qr-badge--plain">
          <Icon name="history" size="sm" />
          {t("app.queue.state.queued")}
        </span>
      );
    case "running":
      return (
        <span className="qr-badge qr-badge--plain">
          <Icon name="play" size="sm" />
          {pct === null ? t("app.queue.state.running") : t("app.queue.state.runningPct", { pct })}
        </span>
      );
    case "paused":
      return (
        <span className="qr-badge qr-badge--plain">
          <Icon name="pause" size="sm" />
          {pct === null ? t("app.queue.state.paused") : t("app.queue.state.pausedPct", { pct })}
        </span>
      );
    case "succeeded":
      return (
        <span className="qr-badge qr-badge--plain qr-badge--success">
          <Icon name="circle-check" size="sm" />
          {t("app.queue.state.succeeded")}
        </span>
      );
    case "failed":
      return (
        <span className="qr-badge qr-badge--plain qr-badge--danger">
          <Icon name="circle-alert" size="sm" />
          {t("app.queue.state.failed")}
        </span>
      );
    case "canceled":
      return (
        <span className="qr-badge qr-badge--plain">
          <Icon name="x" size="sm" />
          {t("app.queue.state.canceled")}
        </span>
      );
    default:
      return (
        <span className="qr-badge qr-badge--plain">
          <Icon name="info" size="sm" />
          {job.state}
        </span>
      );
  }
}

function JobRow({
  job,
  projectName,
  busy,
  onAct,
}: {
  job: Job;
  projectName: string | null;
  busy: boolean;
  onAct: (job: Job, op: Op) => void;
}): React.ReactElement {
  const { t } = useI18n();
  const title = job.title ?? (job.output_path ? fileName(job.output_path) : kindLabel(job.kind, t));
  const meta = [kindLabel(job.kind, t), projectName].filter((s) => s !== null && s !== "").join(" · ");
  const pct = progressPercent(job.progress);
  const showBar = job.state === "running" || job.state === "paused";
  const barClass =
    pct === null
      ? "qr-progress is-indeterminate"
      : job.state === "paused"
        ? "qr-progress is-paused"
        : "qr-progress";
  const canCancel = job.state === "queued" || job.state === "running" || job.state === "paused";

  return (
    <div
      className={job.state === "canceled" ? "qr-job is-canceled" : "qr-job"}
      role="listitem"
      aria-busy={busy}
    >
      <span className="qr-job__code">
        <Icon name={kindIcon(job.kind)} />
      </span>
      <span className="qr-job__title">
        <span title={title}>{title}</span>
        <small>{meta}</small>
        {job.progress_label && <small>{job.progress_label}</small>}
        {job.state === "succeeded" && job.output_path && (
          <small title={job.output_path}>{job.output_path}</small>
        )}
      </span>
      <span className="qr-job__state">
        <StateBadge job={job} />
        {showBar && (
          <span
            className={barClass}
            role="progressbar"
            aria-label={t("app.queue.progressLabel", { title })}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={pct ?? undefined}
            style={{ "--v": (pct ?? 0) / 100 } as React.CSSProperties}
          />
        )}
      </span>
      <span className="qr-job__actions">
        {job.state === "queued" && (
          <button
            type="button"
            className="qr-btn qr-btn--ghost qr-btn--icon qr-btn--sm"
            aria-label={t("app.queue.action.pause", { title })}
            title={t("app.queue.action.pauseShort")}
            disabled={busy}
            onClick={() => onAct(job, "pause")}
          >
            <Icon name="pause" size="sm" />
          </button>
        )}
        {job.state === "running" && (
          <button
            type="button"
            className="qr-btn qr-btn--ghost qr-btn--icon qr-btn--sm"
            aria-label={t("app.queue.action.pauseUnsupported", { title })}
            title={t("app.queue.action.pauseUnsupportedShort")}
            disabled
          >
            <Icon name="pause" size="sm" />
          </button>
        )}
        {job.state === "paused" && (
          <button
            type="button"
            className="qr-btn qr-btn--ghost qr-btn--icon qr-btn--sm"
            aria-label={t("app.queue.action.resume", { title })}
            title={t("app.queue.action.resumeShort")}
            disabled={busy}
            onClick={() => onAct(job, "resume")}
          >
            <Icon name="play" size="sm" />
          </button>
        )}
        {canCancel && (
          <button
            type="button"
            className="qr-btn qr-btn--ghost qr-btn--icon qr-btn--sm"
            aria-label={t("app.queue.action.cancel", { title })}
            title={t("app.queue.action.cancelShort")}
            disabled={busy}
            onClick={() => onAct(job, "cancel")}
          >
            <Icon name="x" size="sm" />
          </button>
        )}
      </span>
      {job.state === "failed" && (
        <span className="qr-error job-note">
          <Icon name="circle-alert" size="sm" />
          <span>
            {job.error_code || job.error_detail
              ? [job.error_code, job.error_detail].filter((s) => s).join(": ")
              : t("app.queue.errorUnknown")}
          </span>
        </span>
      )}
    </div>
  );
}

export function QueueScreen({
  onActiveCount,
}: {
  /** Dipanggil setiap daftar dimuat dengan jumlah job queued+running+paused (untuk lencana rail). */
  onActiveCount?: (count: number) => void;
}): React.ReactElement {
  const { t } = useI18n();
  const [jobs, setJobs] = useState<Job[] | null>(null);
  const [projectNames, setProjectNames] = useState<ReadonlyMap<string, string>>(new Map());
  const [listError, setListError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busyIds, setBusyIds] = useState<ReadonlySet<string>>(new Set());
  const inFlight = useRef(false);
  const rerun = useRef(false);
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const refresh = useCallback(async () => {
    // Permintaan yang datang saat ada pemuatan berjalan diulang sekali setelahnya, supaya hasil
    // aksi (batal/jeda/lanjut) tidak tertinggal.
    if (inFlight.current) {
      rerun.current = true;
      return;
    }
    inFlight.current = true;
    try {
      do {
        rerun.current = false;
        try {
          const list = await unwrap(commands.queueList());
          if (alive.current) {
            setJobs(list);
            setListError(null);
          }
        } catch (e) {
          if (alive.current) setListError(errorText(e));
        }
      } while (rerun.current && alive.current);
    } finally {
      inFlight.current = false;
    }
  }, []);

  const refreshVoid = useCallback(() => void refresh(), [refresh]);

  useEffect(() => {
    void refresh();
    unwrap(commands.projectList())
      .then((list) => {
        if (alive.current) setProjectNames(new Map(list.map((p) => [p.id, p.name])));
      })
      .catch((e) => {
        if (alive.current) setListError(errorText(e));
      });
  }, [refresh]);

  useQueueEvents(refreshVoid, setListError);

  const active = jobs === null ? 0 : activeJobCount(jobs);

  useEffect(() => {
    if (jobs !== null) onActiveCount?.(active);
  }, [jobs, active, onActiveCount]);

  // Poll hanya selama layar terpasang dan masih ada job yang bergerak.
  useEffect(() => {
    if (active === 0) return;
    const handle = window.setInterval(refreshVoid, POLL_MS);
    return () => clearInterval(handle);
  }, [active, refreshVoid]);

  const act = async (job: Job, op: Op) => {
    setBusyIds((prev) => new Set(prev).add(job.id));
    setActionError(null);
    try {
      if (op === "cancel") await unwrap(commands.queueCancel(job.id));
      else if (op === "pause") await unwrap(commands.queuePause(job.id));
      else await unwrap(commands.queueResume(job.id));
    } catch (e) {
      if (alive.current) setActionError(errorText(e));
    }
    if (alive.current) {
      setBusyIds((prev) => {
        const next = new Set(prev);
        next.delete(job.id);
        return next;
      });
    }
    await refresh();
  };

  const grouped = useMemo(() => {
    const map = new Map<Group, Job[]>();
    for (const job of jobs ?? []) {
      const g = groupOf(job.state);
      const list = map.get(g);
      if (list) list.push(job);
      else map.set(g, [job]);
    }
    return map;
  }, [jobs]);

  const groupLabel = (g: Group): string => {
    switch (g) {
      case "running":
        return t("app.queue.group.running");
      case "waiting":
        return t("app.queue.group.waiting");
      case "done":
        return t("app.queue.group.done");
      case "failed":
        return t("app.queue.group.failed");
      default:
        return t("app.queue.group.other");
    }
  };

  const done = grouped.get("done")?.length ?? 0;
  const failed = (grouped.get("failed") ?? []).filter((j) => j.state === "failed").length;

  return (
    <div className="screen">
      <h1>{t("app.queue.title")}</h1>
      {listError && (
        <ErrorAlert
          title={t("app.queue.loadError")}
          message={listError}
          onClose={() => setListError(null)}
        />
      )}
      {actionError && (
        <ErrorAlert
          title={t("app.queue.actionError")}
          message={actionError}
          onClose={() => setActionError(null)}
        />
      )}
      {jobs === null ? (
        listError ? null : (
          <div className="qr-empty" role="status">
            <span className="qr-spin" />
            <span>{t("app.queue.loading")}</span>
          </div>
        )
      ) : (
        <>
          <p className="queue-summary" role="status" aria-live="polite">
            {t("app.queue.summary", { active, done, failed })}
          </p>
          {jobs.length === 0 ? (
            <div className="qr-empty">
              <Icon name="list-checks" />
              <span className="qr-empty__title">{t("app.queue.empty.title")}</span>
              <span>{t("app.queue.empty.body")}</span>
            </div>
          ) : (
            <div className="queue-panel">
              {GROUP_ORDER.map((g) => {
                const list = grouped.get(g);
                if (!list) return null;
                return (
                  <div key={g}>
                    <div className="qr-group-label" aria-hidden="true">
                      {groupLabel(g)}
                    </div>
                    <div className="qr-jobs" role="list" aria-label={groupLabel(g)}>
                      {list.map((job) => (
                        <JobRow
                          key={job.id}
                          job={job}
                          projectName={job.project_id ? (projectNames.get(job.project_id) ?? null) : null}
                          busy={busyIds.has(job.id)}
                          onAct={(j, op) => void act(j, op)}
                        />
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}
      <p className="muted">{t("app.queue.persistNote")}</p>
    </div>
  );
}
