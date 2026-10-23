import { useCallback, useEffect, useReducer, useState } from "react";
import { commands, type ExportFinishedEvent_Serialize, type ExportProgressEvent } from "../bindings";
import { useTauriEvent } from "../hooks";
import { errorText, unwrap } from "../tauri";

const STATUS_POLL_MS = 2000;

export type ExportView =
  | { phase: "idle" }
  | { phase: "starting" }
  | { phase: "running"; jobId: string; fraction: number | null; message: string }
  | {
      phase: "done";
      jobId: string;
      ok: boolean;
      outputPath: string | null;
      errorCode: string | null;
      message: string;
    };

type Store = {
  jobId: string | null;
  starting: boolean;
  progress: Record<string, ExportProgressEvent>;
  finished: Record<string, ExportFinishedEvent_Serialize>;
};

type Action =
  | { type: "starting" }
  | { type: "started"; jobId: string }
  | { type: "start-failed" }
  | { type: "progress"; event: ExportProgressEvent }
  | { type: "finished"; event: ExportFinishedEvent_Serialize };

const INITIAL: Store = { jobId: null, starting: false, progress: {}, finished: {} };

function reduce(s: Store, a: Action): Store {
  switch (a.type) {
    case "starting":
      return { ...s, jobId: null, starting: true };
    case "started":
      return { ...s, jobId: a.jobId, starting: false };
    case "start-failed":
      return { ...s, starting: false };
    // Event bisa tiba sebelum `exportStart` mengembalikan job_id: disimpan per job.
    case "progress":
      return { ...s, progress: { ...s.progress, [a.event.job_id]: a.event } };
    case "finished":
      return { ...s, finished: { ...s.finished, [a.event.job_id]: a.event } };
  }
}

export type ExportJob = {
  view: ExportView;
  /** Galat memulai/membatalkan/memantau ekspor; `null` bila tidak ada. */
  error: string | null;
  clearError: () => void;
  start: (outputPath: string, width: number | null, overwrite: boolean) => Promise<void>;
  cancel: () => void;
};

/**
 * Ekspor MP4 lewat `exportStart` dengan event `export-progress`/`export-finished`. Event disimpan per
 * job (bisa datang sebelum `job_id` kembali); `exportStatus` tiap 2 dtk hanya jaring pengaman bila
 * event penutup tidak terterima.
 */
export function useExportJob(projectId: string): ExportJob {
  const [store, dispatch] = useReducer(reduce, INITIAL);
  const [error, setError] = useState<string | null>(null);

  useTauriEvent<ExportProgressEvent>("export-progress", (event) => dispatch({ type: "progress", event }), setError);
  useTauriEvent<ExportFinishedEvent_Serialize>(
    "export-finished",
    (event) => dispatch({ type: "finished", event }),
    setError
  );

  const { jobId } = store;
  const jobFinished = jobId !== null && store.finished[jobId] !== undefined;

  useEffect(() => {
    if (jobId === null || jobFinished) return;
    const timer = window.setInterval(() => {
      unwrap(commands.exportStatus(jobId))
        .then((job) => {
          if (job.state !== "succeeded" && job.state !== "failed" && job.state !== "canceled") return;
          dispatch({
            type: "finished",
            event: {
              job_id: jobId,
              ok: job.state === "succeeded",
              output_path: job.output_path,
              error_code: job.error_code,
              message: job.error_detail ?? job.progress_label ?? job.state,
            },
          });
        })
        .catch((e) => setError(errorText(e)));
    }, STATUS_POLL_MS);
    return () => clearInterval(timer);
  }, [jobId, jobFinished]);

  const start = useCallback(
    async (outputPath: string, width: number | null, overwrite: boolean) => {
      setError(null);
      dispatch({ type: "starting" });
      try {
        const id = await unwrap(commands.exportStart(projectId, outputPath, width, overwrite));
        dispatch({ type: "started", jobId: id });
      } catch (e) {
        dispatch({ type: "start-failed" });
        setError(errorText(e));
      }
    },
    [projectId]
  );

  const cancel = useCallback(() => {
    if (jobId === null) return;
    unwrap(commands.exportCancel(jobId)).catch((e) => setError(errorText(e)));
  }, [jobId]);

  let view: ExportView = { phase: "idle" };
  if (store.starting) view = { phase: "starting" };
  else if (jobId !== null) {
    const fin = store.finished[jobId];
    const prog = store.progress[jobId];
    view = fin
      ? {
          phase: "done",
          jobId,
          ok: fin.ok,
          outputPath: fin.output_path,
          errorCode: fin.error_code,
          message: fin.message,
        }
      : { phase: "running", jobId, fraction: prog?.fraction ?? null, message: prog?.message ?? "" };
  }

  return { view, error, clearError: () => setError(null), start, cancel };
}
