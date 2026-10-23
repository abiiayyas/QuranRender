import React, { useState, useEffect } from "react";
import {
  commands,
  Project,
  Project_Deserialize,
  AyahSegment,
  ExportValidationReport,
  SubtitleFormat,
  SubtitleTrackSelection,
} from "./bindings";

interface StudioProps {
  project: Project;
  onBack: () => void;
  onSave: (proj: Project) => Promise<void>;
}

export function Studio({
  project: initialProject,
  onBack,
  onSave,
}: StudioProps): React.ReactElement {
  const [project, setProject] = useState<Project>(initialProject);
  const [step, setStep] = useState<number>(1);
  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const [currentTick, setCurrentTick] = useState<number>(0);
  const [selectedSegmentIdx, setSelectedSegmentIdx] = useState<number>(0);
  const [saveStatus, setSaveStatus] = useState<string>("Tersimpan");
  const [validationReport, setValidationReport] =
    useState<ExportValidationReport | null>(null);
  const [subtitleOutput, setSubtitleOutput] = useState<string | null>(null);

  const segments: AyahSegment[] = project.segments ?? [];

  const lastEndTick =
    segments.length > 0
      ? segments[segments.length - 1].end_tick ?? 48000 * 30
      : 48000 * 30;

  const totalTicks = Math.max(project.canvas.fps_num * 48000, lastEndTick);

  // Playback timer (48.000 ticks/sec simulasi)
  useEffect(() => {
    let timer: number | undefined;
    if (isPlaying) {
      timer = setInterval(() => {
        setCurrentTick((prev) => {
          const next = prev + 48000 / 30;
          if (next >= totalTicks) {
            setIsPlaying(false);
            return 0;
          }
          return next;
        });
      }, 1000 / 30);
    }
    return () => {
      clearInterval(timer);
    };
  }, [isPlaying, totalTicks]);

  // Keyboard shortcut Space untuk play/pause
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.code === "Space" && (e.target as HTMLElement).tagName !== "INPUT") {
        e.preventDefault();
        setIsPlaying((p) => !p);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  const handleSave = async () => {
    setSaveStatus("Menyimpan...");
    try {
      await onSave(project);
      setSaveStatus("Tersimpan");
    } catch {
      setSaveStatus("Gagal menyimpan");
    }
  };

  const handleValidate = async () => {
    try {
      const report = await commands.projectValidate(
        project as unknown as Project_Deserialize
      );
      setValidationReport(report);
    } catch (e) {
      console.error(e);
    }
  };

  const handleExportSubtitle = async (fmt: SubtitleFormat) => {
    try {
      const srt = await commands.subtitleExport(
        project as unknown as Project_Deserialize,
        {
          format: fmt,
          track: "AyahOnly" as SubtitleTrackSelection,
          include_ayah_number: false,
          include_footnotes: false,
        }
      );
      setSubtitleOutput(srt);
    } catch (e) {
      console.error(e);
    }
  };

  // Cari segmen aktif berdasarkan currentTick
  const activeSegment: AyahSegment | null =
    segments.find((s) => {
      const start = s.start_tick ?? 0;
      const end = s.end_tick ?? 0;
      return currentTick >= start && currentTick <= end;
    }) ||
    segments[selectedSegmentIdx] ||
    null;

  // Format tick ke mm:ss
  const formatTime = (ticks: number) => {
    const s = Math.floor(ticks / 48000);
    const m = Math.floor(s / 60);
    const sec = s % 60;
    return `${m.toString().padStart(2, "0")}:${sec.toString().padStart(2, "0")}`;
  };

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100vh",
        background: "var(--bg-canvas)",
      }}
    >
      {/* Header Studio */}
      <header
        style={{
          height: "48px",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "0 16px",
          borderBottom: "1px solid var(--border)",
          background: "var(--bg-panel)",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
          <button className="qr-btn qr-btn-ghost qr-btn-sm" onClick={onBack}>
            ← Beranda
          </button>
          <span style={{ fontWeight: 600, fontSize: "14px" }}>
            {project.name}
          </span>
          <span className="qr-badge qr-badge-sm qr-badge-neutral">
            {saveStatus}
          </span>
        </div>

        {/* Wizard 4 langkah */}
        <div className="qr-flow" style={{ display: "flex", gap: "4px" }}>
          <button
            className={`qr-flow-btn ${step === 1 ? "is-active" : ""}`}
            onClick={() => setStep(1)}
          >
            1. Sumber
          </button>
          <button
            className={`qr-flow-btn ${step === 2 ? "is-active" : ""}`}
            onClick={() => setStep(2)}
          >
            2. Sinkron
          </button>
          <button
            className={`qr-flow-btn ${step === 3 ? "is-active" : ""}`}
            onClick={() => setStep(3)}
          >
            3. Tampilan
          </button>
          <button
            className={`qr-flow-btn ${step === 4 ? "is-active" : ""}`}
            onClick={() => setStep(4)}
          >
            4. Ekspor
          </button>
        </div>

        <div style={{ display: "flex", gap: "8px" }}>
          <button
            className="qr-btn qr-btn-sm qr-btn-secondary"
            onClick={handleSave}
          >
            Simpan
          </button>
          <button
            className="qr-btn qr-btn-sm qr-btn-primary"
            onClick={() => setStep(4)}
          >
            Ekspor
          </button>
        </div>
      </header>

      {/* Area Tengah: Panel Kiri (Inspector Langkah) + Viewer Kanvas */}
      <div style={{ display: "flex", flex: 1, minHeight: 0 }}>
        {/* Panel Kiri Berdasarkan Langkah */}
        <aside
          style={{
            width: "320px",
            borderRight: "1px solid var(--border)",
            background: "var(--bg-panel)",
            display: "flex",
            flexDirection: "column",
            padding: "16px",
            overflowY: "auto",
            gap: "16px",
          }}
        >
          {step === 1 && (
            <div>
              <h3
                style={{
                  fontSize: "14px",
                  fontWeight: 600,
                  margin: "0 0 12px 0",
                }}
              >
                Langkah 1: Sumber Tilawah
              </h3>
              <p
                style={{
                  fontSize: "12px",
                  color: "var(--text-3)",
                  margin: "0 0 16px 0",
                }}
              >
                Pilih rekaman audio tilawah dan tetapkan penguatan normalisasi
                suara (LUFS).
              </p>
              <div className="qr-field" style={{ marginBottom: "12px" }}>
                <label className="qr-field-label">Nama Qari</label>
                <input
                  type="text"
                  className="qr-field-input"
                  value={project.reciter || ""}
                  placeholder="Contoh: Misyari Rasyid Al-Afasy"
                  onChange={(e) =>
                    setProject({ ...project, reciter: e.target.value })
                  }
                />
              </div>
              <div className="qr-field" style={{ marginBottom: "12px" }}>
                <label className="qr-field-label">
                  Penguatan Suara (+12 dB normalisasi)
                </label>
                <input
                  type="range"
                  min="-12"
                  max="12"
                  defaultValue="0"
                  style={{ width: "100%" }}
                />
              </div>
              <button
                className="qr-btn qr-btn-secondary qr-btn-sm"
                style={{ width: "100%", marginTop: "16px" }}
                onClick={() => setStep(2)}
              >
                Lanjut ke Sinkronisasi →
              </button>
            </div>
          )}

          {step === 2 && (
            <div>
              <h3
                style={{
                  fontSize: "14px",
                  fontWeight: 600,
                  margin: "0 0 12px 0",
                }}
              >
                Langkah 2: Sinkronisasi Ayat
              </h3>
              <p
                style={{
                  fontSize: "12px",
                  color: "var(--text-3)",
                  margin: "0 0 12px 0",
                }}
              >
                Daftar segmen ayat hasil pengenalan suara dan VAD.
              </p>

              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: "8px",
                }}
              >
                {segments.map((seg, idx) => {
                  const conf = seg.confidence ?? 0;
                  const start = seg.start_tick ?? 0;
                  const end = seg.end_tick ?? 0;
                  const needsReview = conf < 0.8 && !seg.manual_override;
                  return (
                    <div
                      key={seg.id}
                      onClick={() => {
                        setSelectedSegmentIdx(idx);
                        setCurrentTick(start);
                      }}
                      style={{
                        padding: "8px 12px",
                        borderRadius: "var(--r-ctl)",
                        border:
                          selectedSegmentIdx === idx
                            ? "1px solid var(--accent)"
                            : "1px solid var(--border)",
                        background:
                          selectedSegmentIdx === idx
                            ? "var(--accent-surface)"
                            : "var(--bg-canvas)",
                        cursor: "pointer",
                      }}
                    >
                      <div
                        style={{
                          display: "flex",
                          justifyContent: "space-between",
                          alignItems: "center",
                        }}
                      >
                        <span style={{ fontWeight: 600, fontSize: "13px" }}>
                          Ayat {seg.surah_id}:{seg.ayah_number}
                        </span>
                        {needsReview ? (
                          <span className="qr-badge qr-badge-sm qr-badge-warning">
                            Perlu ditinjau
                          </span>
                        ) : (
                          <span className="qr-badge qr-badge-sm qr-badge-success">
                            {Math.round(conf * 100)}%
                          </span>
                        )}
                      </div>
                      <div
                        style={{
                          fontSize: "11px",
                          color: "var(--text-3)",
                          marginTop: "4px",
                        }}
                      >
                        {formatTime(start)} – {formatTime(end)}
                      </div>
                    </div>
                  );
                })}
              </div>

              <button
                className="qr-btn qr-btn-secondary qr-btn-sm"
                style={{ width: "100%", marginTop: "16px" }}
                onClick={() => setStep(3)}
              >
                Lanjut ke Tampilan →
              </button>
            </div>
          )}

          {step === 3 && (
            <div>
              <h3
                style={{
                  fontSize: "14px",
                  fontWeight: 600,
                  margin: "0 0 12px 0",
                }}
              >
                Langkah 3: Tampilan & Template
              </h3>
              <p
                style={{
                  fontSize: "12px",
                  color: "var(--text-3)",
                  margin: "0 0 12px 0",
                }}
              >
                Pilih template video tilawah dan konfigurasi layer.
              </p>

              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: "8px",
                }}
              >
                {[
                  {
                    id: "subuh",
                    name: "Subuh",
                    desc: "Gradien fajar tenang",
                  },
                  {
                    id: "hening",
                    name: "Hening Grafit",
                    desc: "Monokrom gelap khusyuk",
                  },
                  {
                    id: "terang",
                    name: "Kertas Terang",
                    desc: "Halaman mushaf hangat",
                  },
                  {
                    id: "besar",
                    name: "Besar (Hafalan)",
                    desc: "Teks besar tanpa terjemahan",
                  },
                ].map((tpl) => (
                  <div
                    key={tpl.id}
                    onClick={() =>
                      setProject({ ...project, template_id: tpl.id })
                    }
                    style={{
                      padding: "8px 12px",
                      borderRadius: "var(--r-ctl)",
                      border:
                        project.template_id === tpl.id
                          ? "1px solid var(--accent)"
                          : "1px solid var(--border)",
                      background:
                        project.template_id === tpl.id
                          ? "var(--accent-surface)"
                          : "var(--bg-canvas)",
                      cursor: "pointer",
                    }}
                  >
                    <div style={{ fontWeight: 600, fontSize: "13px" }}>
                      {tpl.name}
                    </div>
                    <div style={{ fontSize: "11px", color: "var(--text-3)" }}>
                      {tpl.desc}
                    </div>
                  </div>
                ))}
              </div>

              <button
                className="qr-btn qr-btn-secondary qr-btn-sm"
                style={{ width: "100%", marginTop: "16px" }}
                onClick={() => setStep(4)}
              >
                Lanjut ke Ekspor →
              </button>
            </div>
          )}

          {step === 4 && (
            <div>
              <h3
                style={{
                  fontSize: "14px",
                  fontWeight: 600,
                  margin: "0 0 12px 0",
                }}
              >
                Langkah 4: Validasi & Ekspor
              </h3>
              <p
                style={{
                  fontSize: "12px",
                  color: "var(--text-3)",
                  margin: "0 0 12px 0",
                }}
              >
                Periksa kelayakan ekspor sesuai aturan kebijakan konten
                (CNT-1..5).
              </p>

              <button
                className="qr-btn qr-btn-secondary qr-btn-sm"
                style={{ width: "100%", marginBottom: "12px" }}
                onClick={handleValidate}
              >
                Periksa Kebijakan Konten
              </button>

              {validationReport && (
                <div
                  style={{
                    padding: "12px",
                    borderRadius: "var(--r-ctl)",
                    marginBottom: "16px",
                    background: validationReport.is_ready
                      ? "rgba(34,197,94,0.1)"
                      : "rgba(239,68,68,0.1)",
                    border: validationReport.is_ready
                      ? "1px solid var(--success)"
                      : "1px solid var(--danger)",
                  }}
                >
                  <div style={{ fontWeight: 600, fontSize: "13px" }}>
                    {validationReport.is_ready
                      ? "v Siap Diekspor"
                      : "X Ekspor Diblokir"}
                  </div>
                  <div style={{ fontSize: "11px", marginTop: "4px" }}>
                    {validationReport.blocking_count} pemblokir,{" "}
                    {validationReport.warning_count} peringatan.
                  </div>
                </div>
              )}

              <h4 style={{ fontSize: "13px", margin: "16px 0 8px 0" }}>
                Ekspor Subtitle
              </h4>
              <div style={{ display: "flex", gap: "8px" }}>
                <button
                  className="qr-btn qr-btn-ghost qr-btn-sm"
                  onClick={() => handleExportSubtitle("Srt" as SubtitleFormat)}
                >
                  Unduh SRT
                </button>
                <button
                  className="qr-btn qr-btn-ghost qr-btn-sm"
                  onClick={() => handleExportSubtitle("Vtt" as SubtitleFormat)}
                >
                  Unduh VTT
                </button>
              </div>

              {subtitleOutput && (
                <pre
                  style={{
                    fontSize: "11px",
                    background: "var(--bg-canvas)",
                    padding: "8px",
                    borderRadius: "var(--r-ctl)",
                    overflowX: "auto",
                    maxHeight: "150px",
                    marginTop: "12px",
                  }}
                >
                  {subtitleOutput}
                </pre>
              )}
            </div>
          )}
        </aside>

        {/* Viewer Kanvas Preview (ADR S1) */}
        <main
          style={{
            flex: 1,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            background: "var(--bg-canvas)",
            position: "relative",
          }}
        >
          {/* Box Kanvas 9:16 */}
          <div
            style={{
              width: "360px",
              height: "640px",
              background:
                project.template_id === "terang" ? "#FBF8F2" : "#121417",
              color: project.template_id === "terang" ? "#1A1A1A" : "#F3F4F6",
              borderRadius: "var(--r-panel)",
              boxShadow: "0 20px 40px rgba(0,0,0,0.5)",
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              padding: "32px",
              textAlign: "center",
              position: "relative",
              overflow: "hidden",
            }}
          >
            {activeSegment ? (
              <div>
                <div
                  style={{
                    fontFamily: "var(--font-ayah)",
                    fontSize:
                      project.template_id === "besar" ? "36px" : "26px",
                    lineHeight: 2.2,
                    direction: "rtl",
                    marginBottom: "16px",
                  }}
                >
                  {activeSegment.word_timings &&
                  activeSegment.word_timings.length > 0
                    ? activeSegment.word_timings.map((wt) => {
                        const start = wt.start_tick ?? 0;
                        const end = wt.end_tick ?? 0;
                        const isWordActive =
                          currentTick >= start && currentTick <= end;
                        return (
                          <span
                            key={wt.word_idx}
                            style={{
                              padding: "0 4px",
                              borderRadius: "4px",
                              background: isWordActive
                                ? "rgba(99, 102, 241, 0.3)"
                                : "transparent",
                              color: isWordActive ? "var(--accent)" : "inherit",
                              transition: "all 0.1s ease",
                            }}
                          >
                            {wt.text}{" "}
                          </span>
                        );
                      })
                    : "بِسْمِ اللَّهِ الرَّحْمَٰنِ الرَّحِيمِ"}
                </div>

                {project.template_id !== "besar" && (
                  <div
                    style={{
                      fontSize: "13px",
                      opacity: 0.85,
                      lineHeight: 1.5,
                      color:
                        project.template_id === "terang"
                          ? "#4B5563"
                          : "#D1D5DB",
                    }}
                  >
                    Dengan nama Allah Yang Maha Pengasih, Maha Penyayang.
                  </div>
                )}
              </div>
            ) : (
              <div style={{ color: "var(--text-3)", fontSize: "14px" }}>
                Tidak ada ayat pada playhead
              </div>
            )}

            {/* Nama Qari Pill */}
            {project.reciter && (
              <div
                style={{
                  position: "absolute",
                  bottom: "24px",
                  fontSize: "11px",
                  padding: "4px 12px",
                  borderRadius: "9999px",
                  background: "rgba(0,0,0,0.4)",
                  color: "#E5E7EB",
                }}
              >
                {project.reciter}
              </div>
            )}
          </div>
        </main>
      </div>

      {/* Timeline & Scrubber Bawah */}
      <footer
        style={{
          height: "160px",
          borderTop: "1px solid var(--border)",
          background: "var(--bg-panel)",
          display: "flex",
          flexDirection: "column",
        }}
      >
        {/* Bar Transport */}
        <div
          style={{
            height: "40px",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "0 16px",
            borderBottom: "1px solid var(--border)",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
            <button
              className="qr-btn qr-btn-sm qr-btn-secondary"
              onClick={() => setIsPlaying(!isPlaying)}
            >
              {isPlaying ? "Pause (Spasi)" : "Play (Spasi)"}
            </button>
            <span style={{ fontSize: "12px", fontFamily: "monospace" }}>
              {formatTime(currentTick)} / {formatTime(totalTicks)}
            </span>
          </div>

          <div style={{ fontSize: "12px", color: "var(--text-3)" }}>
            Master Clock: 48.000 Hz | Frame:{" "}
            {Math.floor(currentTick / (48000 / 30))} @ 30 fps
          </div>
        </div>

        {/* Timeline Tracks */}
        <div
          style={{
            flex: 1,
            padding: "12px 16px",
            display: "flex",
            flexDirection: "column",
            gap: "8px",
            overflowX: "auto",
            position: "relative",
          }}
        >
          {/* Trek Ayat */}
          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <span
              style={{
                width: "80px",
                fontSize: "11px",
                color: "var(--text-3)",
              }}
            >
              Ayat
            </span>
            <div
              style={{
                flex: 1,
                height: "28px",
                background: "var(--bg-canvas)",
                borderRadius: "var(--r-ctl)",
                position: "relative",
                display: "flex",
                overflow: "hidden",
              }}
            >
              {segments.map((seg, idx) => {
                const start = seg.start_tick ?? 0;
                const end = seg.end_tick ?? 0;
                const conf = seg.confidence ?? 0;
                const segWidth = ((end - start) / totalTicks) * 100;
                return (
                  <div
                    key={seg.id}
                    onClick={() => {
                      setSelectedSegmentIdx(idx);
                      setCurrentTick(start);
                    }}
                    style={{
                      width: `${segWidth}%`,
                      height: "100%",
                      background:
                        selectedSegmentIdx === idx
                          ? "var(--accent)"
                          : conf < 0.8
                          ? "rgba(245, 158, 11, 0.4)"
                          : "rgba(99, 102, 241, 0.2)",
                      borderRight: "1px solid var(--border)",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      fontSize: "11px",
                      cursor: "pointer",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {seg.surah_id}:{seg.ayah_number}
                  </div>
                );
              })}
            </div>
          </div>

          {/* Trek Latar Media */}
          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <span
              style={{
                width: "80px",
                fontSize: "11px",
                color: "var(--text-3)",
              }}
            >
              Latar
            </span>
            <div
              style={{
                flex: 1,
                height: "24px",
                background: "rgba(255,255,255,0.05)",
                borderRadius: "var(--r-ctl)",
                display: "flex",
                alignItems: "center",
                padding: "0 8px",
                fontSize: "11px",
                color: "var(--text-3)",
              }}
            >
              Template: {project.template_id}
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}
