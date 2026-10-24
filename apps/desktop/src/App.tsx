import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  commands,
  type ProjectIndexEntry_Serialize as ProjectEntry,
  type Project_Serialize as Project,
} from "./bindings";
import { BatchSheet } from "./Batch";
import { fileName, formatClock } from "./format";
import { useI18n } from "./i18n";
import { ExportPackSheet, ImportPackSheet } from "./Packs";
import { IMAGE_EXTENSIONS, MEDIA_EXTENSIONS, openFile, PACK_EXTENSION, PickButton } from "./pick";
import { activeJobCount, QueueScreen, useQueueEvents } from "./Queue";
import { SettingsScreen } from "./Settings";
import { Studio } from "./Studio";
import { errorText, isTauri, unwrap } from "./tauri";
import { useFileDrop } from "./hooks";
import { ErrorAlert, Icon, LangSwitch, Sheet, ThemeSwitch } from "./ui";
import logoLight from "../../../design/brand/logo/playhead-lockup-light.svg";
import logoDark from "../../../design/brand/logo/playhead-lockup-dark.svg";

const TAURI_DEV_COMMAND = "pnpm app";
const QUEUE_COUNT_POLL_MS = 2500;

type StatusFilter = "all" | "draft" | "ready" | "pub";
type View = "projects" | "queue" | "settings";

const FILTERS = [
  { key: "all", label: "app.filter.all", icon: "layout-grid" },
  { key: "draft", label: "app.filter.draft", icon: "pencil-line" },
  { key: "ready", label: "app.filter.ready", icon: "circle-check" },
  { key: "pub", label: "app.filter.pub", icon: "star" },
] as const;

function Brand(): React.ReactElement {
  const { t } = useI18n();
  return (
    <span className="brand">
      <img className="only-light" src={logoLight} alt={t("common.appName")} />
      <img className="only-dark" src={logoDark} alt={t("common.appName")} />
    </span>
  );
}

function AppHeader(): React.ReactElement {
  return (
    <header className="app-hd">
      <Brand />
      <span className="spacer" />
      <LangSwitch />
      <ThemeSwitch />
    </header>
  );
}

function formatDate(ms: number | null, locale: string): string {
  if (ms === null) return "";
  return new Date(ms).toLocaleDateString(locale, { dateStyle: "medium" });
}

function NotTauri(): React.ReactElement {
  const { t } = useI18n();
  return (
    <div className="home">
      <AppHeader />
      <main className="center-fill">
        <div className="qr-empty">
          <Icon name="hard-drive" />
          <span className="qr-empty__title">{t("app.notTauri.title")}</span>
          <span>{t("app.notTauri.body")}</span>
          <code className="mono">{TAURI_DEV_COMMAND}</code>
        </div>
      </main>
    </div>
  );
}

function StatusBadge({ status }: { status: string }): React.ReactElement {
  const { t } = useI18n();
  switch (status) {
    case "draft":
      return <span className="qr-badge">{t("app.status.draft")}</span>;
    case "ready":
      return <span className="qr-badge qr-badge--success">{t("app.status.ready")}</span>;
    case "pub":
      return <span className="qr-badge qr-badge--accent">{t("app.status.pub")}</span>;
    default:
      return <span className="qr-badge">{status}</span>;
  }
}

function ProjectCard({
  entry,
  busy,
  onOpen,
  onDuplicate,
  onDelete,
  onExportPack,
  onBatch,
}: {
  entry: ProjectEntry;
  busy: boolean;
  onOpen: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
  onExportPack: () => void;
  onBatch: () => void;
}): React.ReactElement {
  const { t, locale } = useI18n();
  const dur = formatClock(entry.duration_ticks);
  const meta = [entry.reciter ?? t("app.card.noReciter"), entry.aspect].join(" · ");

  if (entry.missing) {
    return (
      <div className="card-wrap">
        <div className="qr-card is-missing" role="group" aria-label={entry.name}>
          <span className="qr-card__thumb">
            <Icon name="triangle-alert" />
          </span>
          <span className="qr-card__body">
            <span className="qr-card__title">{entry.name}</span>
            <span className="qr-card__meta">{t("app.card.missing")}</span>
          </span>
        </div>
        <div className="card-actions">
          <button
            type="button"
            className="qr-btn qr-btn--danger qr-btn--sm"
            disabled={busy}
            aria-label={t("app.card.removeNamed", { name: entry.name })}
            onClick={onDelete}
          >
            {t("app.card.remove")}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="card-wrap">
      <button type="button" className="qr-card" onClick={onOpen} disabled={busy}>
        <span className="qr-card__thumb">
          <Icon name="audio-waveform" />
          {dur && <span className="qr-card__dur">{dur}</span>}
        </span>
        <span className="qr-card__body">
          <span className="qr-card__title">{entry.name}</span>
          <span className="qr-card__meta">{meta}</span>
          <span className="qr-card__foot">
            <StatusBadge status={entry.status} />
            <span>{formatDate(entry.updated_at, locale)}</span>
          </span>
        </span>
      </button>
      <div className="card-actions">
        <button
          type="button"
          className="qr-btn qr-btn--ghost qr-btn--sm"
          disabled={busy}
          aria-label={t("app.card.duplicateNamed", { name: entry.name })}
          onClick={onDuplicate}
        >
          <Icon name="copy" size="sm" />
          {t("app.card.duplicate")}
        </button>
        <button
          type="button"
          className="qr-btn qr-btn--ghost qr-btn--sm"
          disabled={busy}
          aria-label={t("app.card.exportPackNamed", { name: entry.name })}
          onClick={onExportPack}
        >
          <Icon name="download" size="sm" />
          {t("app.card.exportPack")}
        </button>
        <button
          type="button"
          className="qr-btn qr-btn--ghost qr-btn--sm"
          disabled={busy}
          aria-label={t("app.card.batchNamed", { name: entry.name })}
          onClick={onBatch}
        >
          <Icon name="scissors" size="sm" />
          {t("app.card.batch")}
        </button>
        <button
          type="button"
          className="qr-btn qr-btn--ghost qr-btn--sm"
          disabled={busy}
          aria-label={t("app.card.deleteNamed", { name: entry.name })}
          onClick={onDelete}
        >
          {t("common.delete")}
        </button>
      </div>
    </div>
  );
}

/** Nama proyek bawaan dari nama berkas tanpa ekstensi. */
function fileStem(path: string): string {
  return fileName(path).replace(/\.[^.]+$/, "");
}

function NewProjectSheet({
  file,
  dragging,
  notice,
  onFile,
  onClose,
  onCreated,
}: {
  /** Berkas tilawah (opsional); diimpor saat Studio dibuka. */
  file: string | null;
  /** Path yang sedang diseret di atas jendela, untuk sorotan area lepas. */
  dragging: string[] | null;
  /** Galat seret-lepas dari Shell (mis. format tidak didukung). */
  notice: string | null;
  onFile: (path: string | null) => void;
  onClose: () => void;
  onCreated: (p: Project, file: string | null) => void;
}): React.ReactElement {
  const { t } = useI18n();
  const [name, setName] = useState(() => (file ? fileStem(file) : ""));
  const [nameEdited, setNameEdited] = useState(false);
  const [reciter, setReciter] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const valid = name.trim().length > 0;

  useEffect(() => {
    if (file && !nameEdited) setName(fileStem(file));
  }, [file, nameEdited]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!valid || busy) return;
    setBusy(true);
    setError(null);
    try {
      const p = await unwrap(
        commands.projectCreate(name.trim(), reciter.trim() || null, "9:16")
      );
      onCreated(p, file);
    } catch (err) {
      setError(errorText(err));
      setBusy(false);
    }
  };

  const pickMedia = () => openFile(t("studio.source.pickFilter"), MEDIA_EXTENSIONS);

  return (
    <form onSubmit={(e) => void submit(e)}>
      <Sheet
        title={t("app.new.title")}
        onClose={onClose}
        footer={
          <>
            <button type="button" className="qr-btn qr-btn--secondary" onClick={onClose}>
              {t("common.cancel")}
            </button>
            <button
              type="submit"
              className={busy ? "qr-btn qr-btn--primary is-loading" : "qr-btn qr-btn--primary"}
              disabled={!valid || busy}
            >
              {busy ? <span className="qr-spin" /> : null}
              {t("app.new.submit")}
            </button>
          </>
        }
      >
        {error && <ErrorAlert title={t("app.new.failed")} message={error} />}
        {notice && <ErrorAlert title={t("app.drop.failed")} message={notice} />}
        <div className="qr-fieldset">
          <span className="qr-label">{t("app.new.file")}</span>
          {file ? (
            <div className={dragging ? "qr-item is-dragover" : "qr-item"}>
              <Icon name="audio-waveform" />
              <span className="qr-item__name" title={file}>
                {fileName(file)}
              </span>
              <PickButton
                label={t("app.new.fileChange")}
                disabled={busy}
                pick={pickMedia}
                onPicked={onFile}
                onError={setError}
              />
              <button
                type="button"
                className="qr-btn qr-btn--ghost qr-btn--icon"
                aria-label={t("app.new.fileRemove")}
                disabled={busy}
                onClick={() => onFile(null)}
              >
                <Icon name="x" />
              </button>
            </div>
          ) : (
            <div className={dragging ? "qr-drop qr-empty import-drop is-dragover" : "qr-drop qr-empty import-drop"}>
              <Icon name="upload" />
              <span className="qr-empty__title" aria-live="polite">
                {dragging ? t("studio.source.dropRelease") : t("app.new.fileDrop")}
              </span>
              {dragging ? (
                <span>{dragging.map(fileName).join(", ")}</span>
              ) : (
                <PickButton
                  primary
                  label={t("studio.source.pickButton")}
                  disabled={busy}
                  pick={pickMedia}
                  onPicked={onFile}
                  onError={setError}
                />
              )}
            </div>
          )}
          <span className="qr-help">{t("app.new.fileHelp")}</span>
        </div>
        <div className="qr-fieldset">
          <label className="qr-label" htmlFor="np-name">
            {t("app.new.name")}
          </label>
          <span className="qr-field">
            <input
              id="np-name"
              value={name}
              data-autofocus
              autoComplete="off"
              onChange={(e) => {
                setName(e.target.value);
                setNameEdited(true);
              }}
            />
          </span>
        </div>
        <div className="qr-fieldset">
          <label className="qr-label" htmlFor="np-reciter">
            {t("app.new.reciter")}
          </label>
          <span className="qr-field">
            <input
              id="np-reciter"
              value={reciter}
              autoComplete="off"
              onChange={(e) => setReciter(e.target.value)}
            />
          </span>
        </div>
        <div className="qr-fieldset">
          <span className="qr-label" id="np-aspect">
            {t("app.new.aspect")}
          </span>
          <div className="qr-seg" role="radiogroup" aria-labelledby="np-aspect">
            <button type="button" role="radio" aria-checked="true">
              9:16
            </button>
            <button type="button" role="radio" aria-checked="false" disabled>
              16:9
            </button>
            <button type="button" role="radio" aria-checked="false" disabled>
              1:1
            </button>
          </div>
          <span className="qr-help">{t("app.new.aspectNote")}</span>
        </div>
      </Sheet>
    </form>
  );
}

function DeleteSheet({
  entry,
  onClose,
  onConfirm,
}: {
  entry: ProjectEntry;
  onClose: () => void;
  onConfirm: () => void;
}): React.ReactElement {
  const { t } = useI18n();
  return (
    <Sheet
      title={t("app.delete.title")}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="qr-btn qr-btn--secondary" onClick={onClose}>
            {t("common.cancel")}
          </button>
          <button type="button" className="qr-btn qr-btn--danger" onClick={onConfirm}>
            {t("common.delete")}
          </button>
        </>
      }
    >
      <p>
        <b>{entry.name}</b>
      </p>
      <p>{t("app.delete.body")}</p>
    </Sheet>
  );
}

type DropKind = "media" | "pack" | "image" | "multiple" | "unsupported";

function dropKind(paths: string[]): DropKind {
  if (paths.length !== 1) return "multiple";
  const name = fileName(paths[0]);
  const ext = name.includes(".") ? (name.split(".").pop() ?? "").toLowerCase() : "";
  if (ext === PACK_EXTENSION) return "pack";
  if (IMAGE_EXTENSIONS.includes(ext)) return "image";
  return MEDIA_EXTENSIONS.includes(ext) ? "media" : "unsupported";
}

const DROP_TITLE = {
  media: "app.drop.createProject",
  pack: "app.drop.importPack",
  image: "app.drop.imageShort",
  multiple: "app.drop.multiple",
  unsupported: "app.drop.unsupportedShort",
} as const;

function Shell(): React.ReactElement {
  const { t, error: langError, clearError: clearLangError } = useI18n();
  const [projects, setProjects] = useState<ProjectEntry[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [active, setActive] = useState<Project | null>(null);
  const [view, setView] = useState<View>("projects");
  const [filter, setFilter] = useState<StatusFilter>("all");
  const [query, setQuery] = useState("");
  const [creating, setCreating] = useState(false);
  const [newFile, setNewFile] = useState<string | null>(null);
  const [pendingAudio, setPendingAudio] = useState<string | null>(null);
  /** Sumber awal lembar Impor paket (`""` = kosong); `null` = lembar tertutup. */
  const [packSource, setPackSource] = useState<string | null>(null);
  const [dropError, setDropError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<ProjectEntry | null>(null);
  const [exportingPack, setExportingPack] = useState<ProjectEntry | null>(null);
  const [batching, setBatching] = useState<ProjectEntry | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [queueCount, setQueueCount] = useState(0);

  // Seret berkas ke Beranda: media membuka Proyek baru dengan berkas itu, .qrpack membuka Impor paket.
  const acceptsDrop =
    active === null && view === "projects" && packSource === null && !deleting && !exportingPack && !batching;
  const drag = useFileDrop((paths) => {
    if (!acceptsDrop) return;
    const kind = dropKind(paths);
    if (kind === "media") {
      setDropError(null);
      setNewFile(paths[0]);
      setCreating(true);
    } else if (kind === "pack") {
      setDropError(null);
      setCreating(false);
      setNewFile(null);
      setPackSource(paths[0]);
    } else {
      setDropError(
        kind === "multiple"
          ? t("app.drop.multiple")
          : kind === "image"
            ? t("app.drop.image")
            : t("app.drop.unsupported", { name: fileName(paths[0]) })
      );
    }
  }, setError);
  const dragging = drag?.paths ?? null;
  const shownDrag = acceptsDrop ? dragging : null;
  const shownKind = shownDrag ? dropKind(shownDrag) : null;
  const dropOk = shownKind === "media" || shownKind === "pack";
  const closeCreate = () => {
    setCreating(false);
    setNewFile(null);
    setDropError(null);
  };

  const refresh = useCallback(async () => {
    try {
      setProjects(await unwrap(commands.projectList()));
    } catch (e) {
      setError(errorText(e));
    } finally {
      setLoaded(true);
    }
  }, []);

  const refreshQueueCount = useCallback(async () => {
    try {
      setQueueCount(activeJobCount(await unwrap(commands.queueList())));
    } catch (e) {
      setError(errorText(e));
    }
  }, []);

  useEffect(() => {
    void refresh();
    void refreshQueueCount();
  }, [refresh, refreshQueueCount]);

  // Di layar Antrean, QueueScreen sendiri yang memuat dan melapor; selain itu hitung di sini.
  const onQueueEvent = useCallback(() => {
    if (view !== "queue") void refreshQueueCount();
  }, [view, refreshQueueCount]);
  useQueueEvents(onQueueEvent, setError);

  const pollCount = queueCount > 0 && view !== "queue";
  useEffect(() => {
    if (!pollCount) return;
    const handle = window.setInterval(() => void refreshQueueCount(), QUEUE_COUNT_POLL_MS);
    return () => clearInterval(handle);
  }, [pollCount, refreshQueueCount]);

  const withBusy = async (id: string, job: () => Promise<void>) => {
    setBusyId(id);
    setError(null);
    try {
      await job();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusyId(null);
    }
  };

  const open = (id: string) =>
    withBusy(id, async () => {
      setActive(await unwrap(commands.projectOpen(id)));
    });

  const duplicate = (entry: ProjectEntry) =>
    withBusy(entry.id, async () => {
      await unwrap(commands.projectDuplicate(entry.id, t("app.card.copyName", { name: entry.name })));
      await refresh();
    });

  const remove = (entry: ProjectEntry) => {
    setDeleting(null);
    return withBusy(entry.id, async () => {
      await unwrap(commands.projectDelete(entry.id));
      await refresh();
    });
  };

  const count = (f: StatusFilter) =>
    f === "all" ? projects.length : projects.filter((p) => p.status === f).length;

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return projects.filter(
      (p) =>
        (filter === "all" || p.status === filter) &&
        (!q || `${p.name} ${p.reciter ?? ""}`.toLowerCase().includes(q))
    );
  }, [projects, filter, query]);

  if (active) {
    return (
      <Studio
        project={active}
        initialAudio={pendingAudio ?? undefined}
        onBack={() => {
          setActive(null);
          setPendingAudio(null);
          void refresh();
          void refreshQueueCount();
        }}
        onSave={async (p) => {
          await unwrap(commands.projectSave(p));
        }}
      />
    );
  }

  const current = FILTERS.find((f) => f.key === filter) ?? FILTERS[0];
  const showFilter = (key: StatusFilter) => {
    setFilter(key);
    setView("projects");
  };

  return (
    <div className="home">
      <AppHeader />
      <div className="home-body">
        <nav className="home-rail" aria-label={t("app.nav.label")}>
          <div className="qr-rail">
            {FILTERS.map((f) => (
              <button
                key={f.key}
                type="button"
                className="qr-rail__item"
                aria-current={view === "projects" && filter === f.key}
                onClick={() => showFilter(f.key)}
              >
                <Icon name={f.icon} />
                {t(f.label)}
                <em>{count(f.key)}</em>
              </button>
            ))}
            <div className="qr-rail__sep" />
            <button
              type="button"
              className="qr-rail__item"
              aria-current={view === "queue"}
              onClick={() => setView("queue")}
            >
              <Icon name="list-checks" />
              {t("app.nav.queue")}
              <em>{queueCount}</em>
            </button>
            <button
              type="button"
              className="qr-rail__item"
              aria-current={view === "settings"}
              onClick={() => setView("settings")}
            >
              <Icon name="settings-2" />
              {t("app.nav.settings")}
            </button>
            <button type="button" className="qr-rail__item" aria-disabled="true" disabled>
              <Icon name="layout-template" />
              {t("app.nav.templates")}
              <em>{t("common.unavailable")}</em>
            </button>
          </div>
        </nav>
        <main className="home-main">
          {langError && (
            <ErrorAlert title={t("common.error")} message={langError} onClose={clearLangError} />
          )}
          {error && (
            <ErrorAlert title={t("common.error")} message={error} onClose={() => setError(null)} />
          )}
          {dropError && !creating && (
            <ErrorAlert title={t("app.drop.failed")} message={dropError} onClose={() => setDropError(null)} />
          )}
          {view === "queue" && <QueueScreen onActiveCount={setQueueCount} />}
          {view === "settings" && <SettingsScreen />}
          {view === "projects" && (
            <>
              <div className="home-bar">
                <h1>{t(current.label)}</h1>
                <button
                  type="button"
                  className="qr-btn qr-btn--primary"
                  onClick={() => setCreating(true)}
                >
                  <Icon name="plus" />
                  {t("app.home.create")}
                </button>
                <button
                  type="button"
                  className="qr-btn qr-btn--secondary"
                  onClick={() => setPackSource("")}
                >
                  <Icon name="upload" />
                  {t("app.home.importPack")}
                </button>
                <span className="spacer" />
                <label className="qr-field">
                  <Icon name="search" />
                  <input
                    placeholder={t("app.home.searchPlaceholder")}
                    value={query}
                    autoComplete="off"
                    aria-label={t("app.home.searchLabel")}
                    onChange={(e) => setQuery(e.target.value)}
                  />
                </label>
              </div>
              {!loaded ? (
                <div className="qr-empty" role="status">
                  <span className="qr-spin" />
                  <span>{t("app.home.loading")}</span>
                </div>
              ) : projects.length === 0 ? (
                <div className={dropOk ? "qr-drop qr-empty is-dragover" : "qr-drop qr-empty"}>
                  <Icon name={shownDrag ? "upload" : "file-input"} />
                  <span className="qr-empty__title" aria-live="polite">
                    {shownKind ? t(DROP_TITLE[shownKind]) : t("app.home.empty.title")}
                  </span>
                  <span>{shownDrag ? shownDrag.map(fileName).join(", ") : t("app.home.empty.body")}</span>
                  <button
                    type="button"
                    className="qr-btn qr-btn--primary"
                    onClick={() => setCreating(true)}
                  >
                    <Icon name="plus" />
                    {t("app.home.create")}
                  </button>
                </div>
              ) : visible.length === 0 ? (
                <div className="qr-empty">
                  <Icon name="search" />
                  <span className="qr-empty__title">{t("app.home.noMatch.title")}</span>
                  <span>{t("app.home.noMatch.body")}</span>
                </div>
              ) : (
                <div className="grid">
                  {visible.map((p) => (
                    <ProjectCard
                      key={p.id}
                      entry={p}
                      busy={busyId === p.id}
                      onOpen={() => void open(p.id)}
                      onDuplicate={() => void duplicate(p)}
                      onDelete={() => setDeleting(p)}
                      onExportPack={() => setExportingPack(p)}
                      onBatch={() => setBatching(p)}
                    />
                  ))}
                </div>
              )}
            </>
          )}
        </main>
        {shownKind && !creating && projects.length > 0 && (
          <div className={dropOk ? "qr-drop qr-empty home-drop is-dragover" : "qr-drop qr-empty home-drop"}>
            <Icon name="upload" />
            <span className="qr-empty__title" aria-live="polite">
              {t(DROP_TITLE[shownKind])}
            </span>
            <span>{shownDrag?.map(fileName).join(", ")}</span>
          </div>
        )}
      </div>
      {creating && (
        <NewProjectSheet
          file={newFile}
          dragging={shownDrag}
          notice={dropError}
          onFile={(p) => {
            setDropError(null);
            setNewFile(p);
          }}
          onClose={closeCreate}
          onCreated={(p, file) => {
            closeCreate();
            setPendingAudio(file);
            setActive(p);
            void refresh();
          }}
        />
      )}
      {packSource !== null && (
        <ImportPackSheet
          initialPath={packSource}
          onClose={() => setPackSource(null)}
          onImported={() => void refresh()}
        />
      )}
      {exportingPack && (
        <ExportPackSheet entry={exportingPack} onClose={() => setExportingPack(null)} />
      )}
      {batching && (
        <BatchSheet
          projectId={batching.id}
          projectName={batching.name}
          onClose={() => setBatching(null)}
          onEnqueued={() => void refreshQueueCount()}
        />
      )}
      {deleting && (
        <DeleteSheet
          entry={deleting}
          onClose={() => setDeleting(null)}
          onConfirm={() => void remove(deleting)}
        />
      )}
    </div>
  );
}

export function App(): React.ReactElement {
  return isTauri() ? <Shell /> : <NotTauri />;
}
