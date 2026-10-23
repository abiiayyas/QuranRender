import React, { useEffect, useState } from "react";
import {
  commands,
  type AppInfo,
  type ProjectIndexEntry_Serialize as ProjectEntry,
} from "./bindings";

export function App(): React.ReactElement {
  const [info, setInfo] = useState<AppInfo | null>(null);
  const [projects, setProjects] = useState<ProjectEntry[]>([]);
  const [activeProjectName, setActiveProjectName] = useState<string | null>(null);
  const [newProjectName, setNewProjectName] = useState<string>("");
  const [reciterName, setReciterName] = useState<string>("");
  const [aspectRatio, setAspectRatio] = useState<string>("9:16");
  const [isCreating, setIsCreating] = useState<boolean>(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const refreshProjects = async () => {
    try {
      const res = await commands.projectList();
      if (res.status === "ok") {
        setProjects(res.data);
      } else {
        setErrorMsg(res.error);
      }
    } catch {
      // Di web preview browser (bukan runtime Tauri)
      setProjects([]);
    }
  };

  useEffect(() => {
    commands
      .getAppInfo()
      .then(setInfo)
      .catch(() => {
        setInfo({
          name: "QuranRender (Web Preview)",
          version: "0.1.0",
          status: "Fase 1 — Alpha",
        });
      });

    void refreshProjects();
  }, []);

  const handleCreateProject = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newProjectName.trim()) return;

    try {
      const res = await commands.projectCreate(
        newProjectName.trim(),
        reciterName.trim() || null,
        aspectRatio
      );

      if (res.status === "ok") {
        setNewProjectName("");
        setReciterName("");
        setIsCreating(false);
        setActiveProjectName(res.data.name);
        await refreshProjects();
      } else {
        setErrorMsg(res.error);
      }
    } catch (err) {
      setErrorMsg(String(err));
    }
  };

  const handleOpenProject = async (id: string) => {
    try {
      const res = await commands.projectOpen(id);
      if (res.status === "ok") {
        setActiveProjectName(res.data.name);
        await refreshProjects();
      } else {
        setErrorMsg(res.error);
      }
    } catch (err) {
      setErrorMsg(String(err));
    }
  };

  const handleDuplicateProject = async (id: string, name: string) => {
    try {
      const res = await commands.projectDuplicate(id, `${name} (Salinan)`);
      if (res.status === "ok") {
        await refreshProjects();
      } else {
        setErrorMsg(res.error);
      }
    } catch (err) {
      setErrorMsg(String(err));
    }
  };

  const handleDeleteProject = async (id: string) => {
    try {
      const res = await commands.projectDelete(id);
      if (res.status === "ok") {
        await refreshProjects();
      } else {
        setErrorMsg(res.error);
      }
    } catch (err) {
      setErrorMsg(String(err));
    }
  };

  return (
    <div style={{ maxWidth: "1100px", margin: "0 auto", padding: "32px 24px", fontFamily: "system-ui, -apple-system, sans-serif" }}>
      <header style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "32px", borderBottom: "1px solid #e5e7eb", paddingBottom: "16px" }}>
        <div>
          <h1 style={{ margin: 0, fontSize: "24px", fontWeight: "700" }}>{info?.name ?? "QuranRender"}</h1>
          <p style={{ margin: "4px 0 0", color: "#6b7280", fontSize: "14px" }}>
            {info?.status} (v{info?.version})
          </p>
        </div>
        <div>
          <button
            onClick={() => setIsCreating(true)}
            style={{
              background: "#4f46e5",
              color: "#fff",
              border: "none",
              borderRadius: "6px",
              padding: "10px 18px",
              fontWeight: "600",
              cursor: "pointer",
            }}
          >
            + Buat Proyek
          </button>
        </div>
      </header>

      {errorMsg && (
        <div style={{ background: "#fee2e2", color: "#b91c1c", padding: "12px 16px", borderRadius: "6px", marginBottom: "24px" }}>
          <strong>Peringatan:</strong> {errorMsg}
          <button onClick={() => setErrorMsg(null)} style={{ float: "right", border: "none", background: "transparent", cursor: "pointer" }}>✕</button>
        </div>
      )}

      {activeProjectName && (
        <div style={{ background: "#f0fdf4", color: "#166534", padding: "12px 16px", borderRadius: "6px", marginBottom: "24px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span>Proyek Aktif di Studio: <strong>{activeProjectName}</strong></span>
          <button onClick={() => setActiveProjectName(null)} style={{ border: "none", background: "transparent", cursor: "pointer", color: "#166534", textDecoration: "underline" }}>Tutup Studio</button>
        </div>
      )}

      {isCreating && (
        <div style={{ background: "#f9fafb", border: "1px solid #e5e7eb", borderRadius: "8px", padding: "20px", marginBottom: "28px" }}>
          <h3 style={{ margin: "0 0 16px" }}>Proyek Baru</h3>
          <form onSubmit={handleCreateProject} style={{ display: "grid", gap: "12px", maxWidth: "480px" }}>
            <label style={{ display: "grid", gap: "4px", fontSize: "14px" }}>
              Nama Proyek:
              <input
                type="text"
                required
                value={newProjectName}
                onChange={(e) => setNewProjectName(e.target.value)}
                placeholder="mis. Al-Fatihah 1-7"
                style={{ padding: "8px 12px", borderRadius: "6px", border: "1px solid #d1d5db" }}
              />
            </label>
            <label style={{ display: "grid", gap: "4px", fontSize: "14px" }}>
              Nama Qari (opsional):
              <input
                type="text"
                value={reciterName}
                onChange={(e) => setReciterName(e.target.value)}
                placeholder="mis. Mishary Rashid Alafasy"
                style={{ padding: "8px 12px", borderRadius: "6px", border: "1px solid #d1d5db" }}
              />
            </label>
            <label style={{ display: "grid", gap: "4px", fontSize: "14px" }}>
              Rasio Aspek:
              <select
                value={aspectRatio}
                onChange={(e) => setAspectRatio(e.target.value)}
                style={{ padding: "8px 12px", borderRadius: "6px", border: "1px solid #d1d5db" }}
              >
                <option value="9:16">9:16 (Shorts / Reels / TikTok)</option>
                <option value="16:9">16:9 (YouTube Lanskap)</option>
                <option value="1:1">1:1 (Persegi)</option>
                <option value="4:5">4:5 (Instagram Potret)</option>
              </select>
            </label>
            <div style={{ display: "flex", gap: "8px", marginTop: "8px" }}>
              <button
                type="submit"
                style={{ background: "#4f46e5", color: "#fff", border: "none", borderRadius: "6px", padding: "8px 16px", cursor: "pointer", fontWeight: "600" }}
              >
                Simpan & Buka
              </button>
              <button
                type="button"
                onClick={() => setIsCreating(false)}
                style={{ background: "#e5e7eb", color: "#374151", border: "none", borderRadius: "6px", padding: "8px 16px", cursor: "pointer" }}
              >
                Batal
              </button>
            </div>
          </form>
        </div>
      )}

      <section>
        <h2 style={{ fontSize: "18px", fontWeight: "600", marginBottom: "16px" }}>Semua Proyek ({projects.length})</h2>
        {projects.length === 0 ? (
          <div style={{ border: "2px dashed #d1d5db", borderRadius: "8px", padding: "48px", textAlign: "center", color: "#6b7280" }}>
            <p style={{ margin: "0 0 12px" }}>Belum ada proyek yang dibuat.</p>
            <button
              onClick={() => setIsCreating(true)}
              style={{ background: "#4f46e5", color: "#fff", border: "none", borderRadius: "6px", padding: "8px 16px", cursor: "pointer" }}
            >
              Buat proyek pertama
            </button>
          </div>
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: "16px" }}>
            {projects.map((p) => (
              <div
                key={p.id}
                style={{
                  border: "1px solid #e5e7eb",
                  borderRadius: "8px",
                  padding: "16px",
                  background: p.missing ? "#fffbeb" : "#fff",
                  display: "flex",
                  flexDirection: "column",
                  justifyContent: "space-between",
                }}
              >
                <div>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "8px" }}>
                    <h3 style={{ margin: 0, fontSize: "16px", fontWeight: "600" }}>{p.name}</h3>
                    <span style={{ fontSize: "12px", background: "#f3f4f6", padding: "2px 8px", borderRadius: "999px" }}>
                      {p.aspect}
                    </span>
                  </div>
                  <p style={{ margin: "0 0 4px", fontSize: "14px", color: "#4b5563" }}>
                    {p.reciter || "Tanpa qari"}
                  </p>
                  <p style={{ margin: 0, fontSize: "12px", color: p.missing ? "#b45309" : "#9ca3af" }}>
                    {p.missing ? "⚠️ Folder di disk tidak ditemukan" : p.status}
                  </p>
                </div>
                <div style={{ display: "flex", gap: "8px", marginTop: "16px", borderTop: "1px solid #f3f4f6", paddingTop: "12px" }}>
                  <button
                    disabled={p.missing}
                    onClick={() => handleOpenProject(p.id)}
                    style={{ flex: 1, background: p.missing ? "#e5e7eb" : "#4f46e5", color: p.missing ? "#9ca3af" : "#fff", border: "none", borderRadius: "4px", padding: "6px 10px", fontSize: "13px", cursor: p.missing ? "not-allowed" : "pointer" }}
                  >
                    Buka
                  </button>
                  <button
                    disabled={p.missing}
                    onClick={() => handleDuplicateProject(p.id, p.name)}
                    style={{ background: "#f3f4f6", border: "1px solid #d1d5db", borderRadius: "4px", padding: "6px 10px", fontSize: "13px", cursor: p.missing ? "not-allowed" : "pointer" }}
                  >
                    Duplikat
                  </button>
                  <button
                    onClick={() => handleDeleteProject(p.id)}
                    style={{ background: "#fee2e2", color: "#dc2626", border: "none", borderRadius: "4px", padding: "6px 10px", fontSize: "13px", cursor: "pointer" }}
                  >
                    Hapus
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
