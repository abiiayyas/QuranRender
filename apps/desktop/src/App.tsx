import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  commands,
  type ProjectIndexEntry_Serialize as ProjectEntry,
  type Project_Serialize as Project,
} from "./bindings";
import { Studio } from "./Studio";
import { errorText, isTauri, unwrap } from "./tauri";
import { ErrorAlert, Icon, Sheet, ThemeSwitch } from "./ui";
import logoLight from "../../../design/brand/logo/playhead-lockup-light.svg";
import logoDark from "../../../design/brand/logo/playhead-lockup-dark.svg";

const TICKS_PER_SECOND = 48_000;

type StatusFilter = "all" | "draft" | "ready" | "pub";

const FILTERS: ReadonlyArray<{ key: StatusFilter; label: string; icon: string }> = [
  { key: "all", label: "Semua proyek", icon: "layout-grid" },
  { key: "draft", label: "Draf", icon: "pencil-line" },
  { key: "ready", label: "Siap", icon: "circle-check" },
  { key: "pub", label: "Terbit", icon: "star" },
];

const STATUS_BADGE: Record<string, { cls: string; label: string }> = {
  draft: { cls: "qr-badge", label: "Draf" },
  ready: { cls: "qr-badge qr-badge--success", label: "Siap" },
  pub: { cls: "qr-badge qr-badge--accent", label: "Terbit" },
};

function Brand(): React.ReactElement {
  return (
    <span className="brand">
      <img className="only-light" src={logoLight} alt="QuranRender" />
      <img className="only-dark" src={logoDark} alt="QuranRender" />
    </span>
  );
}

function formatDuration(ticks: number | null): string | null {
  if (!ticks || ticks <= 0) return null;
  const s = Math.floor(ticks / TICKS_PER_SECOND);
  const mm = String(Math.floor(s / 60)).padStart(2, "0");
  const ss = String(s % 60).padStart(2, "0");
  return `${mm}:${ss}`;
}

function formatDate(ms: number | null): string {
  if (ms === null) return "";
  return new Date(ms).toLocaleDateString("id-ID", { dateStyle: "medium" });
}

function NotTauri(): React.ReactElement {
  return (
    <div className="home">
      <header className="app-hd">
        <Brand />
        <span className="spacer" />
        <ThemeSwitch />
      </header>
      <div className="center-fill">
        <div className="qr-empty">
          <Icon name="hard-drive" />
          <span className="qr-empty__title">Jalankan lewat Tauri</span>
          <span>
            Antarmuka ini memanggil perintah Rust (proyek, preview, subtitle) yang hanya tersedia
            di dalam jendela aplikasi, bukan di peramban biasa.
          </span>
          <code className="mono">pnpm --filter @quranrender/desktop tauri dev</code>
        </div>
      </div>
    </div>
  );
}

function ProjectCard({
  entry,
  busy,
  onOpen,
  onDuplicate,
  onDelete,
}: {
  entry: ProjectEntry;
  busy: boolean;
  onOpen: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
}): React.ReactElement {
  const badge = STATUS_BADGE[entry.status] ?? { cls: "qr-badge", label: entry.status };
  const dur = formatDuration(entry.duration_ticks);
  const meta = [entry.reciter ?? "Tanpa qari", entry.aspect].join(" · ");

  if (entry.missing) {
    return (
      <div className="card-wrap">
        <div className="qr-card is-missing" role="group" aria-label={entry.name}>
          <span className="qr-card__thumb">
            <Icon name="triangle-alert" />
          </span>
          <span className="qr-card__body">
            <span className="qr-card__title">{entry.name}</span>
            <span className="qr-card__meta">Folder tidak ditemukan</span>
          </span>
        </div>
        <div className="card-actions">
          <button
            type="button"
            className="qr-btn qr-btn--danger qr-btn--sm"
            disabled={busy}
            onClick={onDelete}
          >
            Hapus dari daftar
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
            <span className={badge.cls}>
              {badge.label}
            </span>
            <span>{formatDate(entry.updated_at)}</span>
          </span>
        </span>
      </button>
      <div className="card-actions">
        <button
          type="button"
          className="qr-btn qr-btn--ghost qr-btn--sm"
          disabled={busy}
          onClick={onDuplicate}
        >
          <Icon name="copy" size="sm" />
          Duplikat
        </button>
        <button
          type="button"
          className="qr-btn qr-btn--ghost qr-btn--sm"
          disabled={busy}
          onClick={onDelete}
        >
          Hapus
        </button>
      </div>
    </div>
  );
}

function NewProjectSheet({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (p: Project) => void;
}): React.ReactElement {
  const [name, setName] = useState("");
  const [reciter, setReciter] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const valid = name.trim().length > 0;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!valid || busy) return;
    setBusy(true);
    setError(null);
    try {
      const p = await unwrap(
        commands.projectCreate(name.trim(), reciter.trim() || null, "9:16")
      );
      onCreated(p);
    } catch (err) {
      setError(errorText(err));
      setBusy(false);
    }
  };

  return (
    <form onSubmit={(e) => void submit(e)}>
      <Sheet
        title="Proyek baru"
        onClose={onClose}
        footer={
          <>
            <button type="button" className="qr-btn qr-btn--secondary" onClick={onClose}>
              Batal
            </button>
            <button
              type="submit"
              className={busy ? "qr-btn qr-btn--primary is-loading" : "qr-btn qr-btn--primary"}
              disabled={!valid || busy}
            >
              {busy ? <span className="qr-spin" /> : null}
              Buat dan buka
            </button>
          </>
        }
      >
        {error && <ErrorAlert title="Proyek gagal dibuat" message={error} />}
        <div className="qr-fieldset">
          <label className="qr-label" htmlFor="np-name">
            Nama proyek
          </label>
          <span className="qr-field">
            <input
              id="np-name"
              value={name}
              autoFocus
              autoComplete="off"
              onChange={(e) => setName(e.target.value)}
            />
          </span>
        </div>
        <div className="qr-fieldset">
          <label className="qr-label" htmlFor="np-reciter">
            Qari (opsional)
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
            Rasio
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
          <span className="qr-help">Rasio lain: Belum tersedia.</span>
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
  return (
    <Sheet
      title="Hapus proyek"
      onClose={onClose}
      footer={
        <>
          <button type="button" className="qr-btn qr-btn--secondary" onClick={onClose}>
            Batal
          </button>
          <button type="button" className="qr-btn qr-btn--danger" onClick={onConfirm}>
            Hapus
          </button>
        </>
      }
    >
      <p>
        Proyek <b>{entry.name}</b> dihapus dari daftar, dan folder proyeknya di disk ikut dihapus.
        Tindakan ini tidak bisa dibatalkan.
      </p>
    </Sheet>
  );
}

function Shell(): React.ReactElement {
  const [projects, setProjects] = useState<ProjectEntry[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [active, setActive] = useState<Project | null>(null);
  const [filter, setFilter] = useState<StatusFilter>("all");
  const [query, setQuery] = useState("");
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState<ProjectEntry | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setProjects(await unwrap(commands.projectList()));
    } catch (e) {
      setError(errorText(e));
    } finally {
      setLoaded(true);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

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
      await unwrap(commands.projectDuplicate(entry.id, `${entry.name} (salinan)`));
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
        onBack={() => {
          setActive(null);
          void refresh();
        }}
        onSave={async (p) => {
          await unwrap(commands.projectSave(p));
        }}
      />
    );
  }

  const title = FILTERS.find((f) => f.key === filter)?.label ?? "Semua proyek";

  return (
    <div className="home">
      <header className="app-hd">
        <Brand />
        <span className="spacer" />
        <ThemeSwitch />
      </header>
      <div className="home-body">
        <nav className="home-rail" aria-label="Filter proyek">
          <div className="qr-rail">
            {FILTERS.map((f) => (
              <button
                key={f.key}
                type="button"
                className="qr-rail__item"
                aria-current={filter === f.key}
                onClick={() => setFilter(f.key)}
              >
                <Icon name={f.icon} />
                {f.label}
                <em>{count(f.key)}</em>
              </button>
            ))}
            <div className="qr-rail__sep" />
            <button type="button" className="qr-rail__item" aria-disabled="true" disabled>
              <Icon name="layout-template" />
              Templat
              <em>Belum tersedia</em>
            </button>
          </div>
        </nav>
        <main className="home-main">
          <div className="home-bar">
            <h1>{title}</h1>
            <button
              type="button"
              className="qr-btn qr-btn--primary"
              onClick={() => setCreating(true)}
            >
              <Icon name="plus" />
              Buat proyek
            </button>
            <span className="spacer" />
            <label className="qr-field">
              <Icon name="search" />
              <input
                placeholder="Cari proyek atau qari"
                value={query}
                autoComplete="off"
                aria-label="Cari proyek"
                onChange={(e) => setQuery(e.target.value)}
              />
            </label>
          </div>
          {error && (
            <ErrorAlert title="Terjadi kesalahan" message={error} onClose={() => setError(null)} />
          )}
          {!loaded ? (
            <div className="qr-empty" role="status">
              <span className="qr-spin" />
              <span>Memuat proyek…</span>
            </div>
          ) : projects.length === 0 ? (
            <div className="qr-drop qr-empty">
              <Icon name="file-input" />
              <span className="qr-empty__title">Belum ada proyek</span>
              <span>Mulai dengan membuat proyek pertama.</span>
              <button
                type="button"
                className="qr-btn qr-btn--primary"
                onClick={() => setCreating(true)}
              >
                <Icon name="plus" />
                Buat proyek
              </button>
            </div>
          ) : visible.length === 0 ? (
            <div className="qr-empty">
              <Icon name="search" />
              <span className="qr-empty__title">Tidak ada proyek yang cocok</span>
              <span>Coba kata kunci lain atau hapus filter.</span>
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
                />
              ))}
            </div>
          )}
        </main>
      </div>
      {creating && (
        <NewProjectSheet
          onClose={() => setCreating(false)}
          onCreated={(p) => {
            setCreating(false);
            setActive(p);
            void refresh();
          }}
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
