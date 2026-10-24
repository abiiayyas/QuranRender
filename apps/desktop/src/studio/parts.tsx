import React from "react";

/** Daftar ringkasan kunci–nilai (`dl`). */
export function Summary({
  rows,
}: {
  rows: ReadonlyArray<readonly [string, string]>;
}): React.ReactElement {
  return (
    <dl className="sum">
      {rows.map(([k, v]) => (
        <React.Fragment key={k}>
          <dt>{k}</dt>
          <dd>{v}</dd>
        </React.Fragment>
      ))}
    </dl>
  );
}

/** Tombol pintasan visual `qr-kbd` di dalam teks/tombol. */
export function Kbd({ children }: { children: React.ReactNode }): React.ReactElement {
  return <kbd className="qr-kbd">{children}</kbd>;
}

/** Nama tombol di keycap (bukan teks terjemahan). */
export const KEYS = {
  enter: "↵",
  next: "N",
  save: "S",
  up: "↑",
  down: "↓",
  left: "←",
  right: "→",
  prev: "[",
  following: "]",
  backspace: "⌫",
  wholeAyah: "V",
  reset: "R",
  basmala: "B",
  istiadha: "A",
  gap: "S",
  setStart: "N",
  setEnd: "M",
  editTranslation: "E",
} as const;

/** Tombol pengubah menurut platform: ⌘ di macOS, Ctrl di tempat lain. */
export const MOD_KEY = /Mac|iPhone|iPad/.test(navigator.platform) ? "⌘" : "Ctrl";
