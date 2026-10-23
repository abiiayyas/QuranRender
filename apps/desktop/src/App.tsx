import React, { useEffect, useState } from "react";
import { commands, type AppInfo } from "./bindings";

export function App(): React.ReactElement {
  const [info, setInfo] = useState<AppInfo | null>(null);
  const [greeting, setGreeting] = useState<string>("");

  useEffect(() => {
    // Di lingkungan dev web murni (browser), invoke Tauri bisa fallback atau mock
    commands
      .getAppInfo()
      .then(setInfo)
      .catch(() => {
        setInfo({
          name: "QuranRender (Web Preview)",
          version: "0.1.0",
          status: "Fase 0 — Fondasi",
        });
      });

    commands
      .greet("Pengguna")
      .then(setGreeting)
      .catch(() => setGreeting("Salam, Pengguna!"));
  }, []);

  return (
    <main style={{ padding: "32px", fontFamily: "system-ui, sans-serif" }}>
      <h1>{info?.name ?? "QuranRender"}</h1>
      <p>
        <strong>Status:</strong> {info?.status ?? "Memuat..."} (v{info?.version ?? "0.1.0"})
      </p>
      <p>{greeting}</p>
    </main>
  );
}
