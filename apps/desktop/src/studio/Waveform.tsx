import React, { useMemo } from "react";

/** Waveform dari `peaks` (0..1) sebagai satu poligon SVG berwarna `currentColor`. */
export function Waveform({
  peaks,
  label,
}: {
  peaks: ReadonlyArray<number | null>;
  label: string;
}): React.ReactElement {
  const path = useMemo(() => {
    const n = peaks.length;
    if (n === 0) return "";
    const amp = (v: number | null) => Math.min(Math.max(v ?? 0, 0), 1) * 46 + 0.5;
    const top = peaks.map((v, i) => `${i === 0 ? "M" : "L"}${i + 0.5} ${(50 - amp(v)).toFixed(2)}`);
    const bottom = peaks
      .map((v, i) => `L${i + 0.5} ${(50 + amp(v)).toFixed(2)}`)
      .reverse();
    return `${top.join("")}${bottom.join("")}Z`;
  }, [peaks]);

  return (
    <svg
      className="wave-svg"
      viewBox={`0 0 ${Math.max(peaks.length, 1)} 100`}
      preserveAspectRatio="none"
      role="img"
      aria-label={label}
    >
      <path d={path} />
    </svg>
  );
}
