import React, { useEffect, useId, useState } from "react";
import { TICKS_PER_SECOND } from "../format";
import { useI18n } from "../i18n";

/**
 * Isian waktu dalam detik. Enter/blur menyimpan; ↑/↓ menggeser 0,1 dtk (Shift 1 dtk, Alt 0,01 dtk) dan
 * langsung menyimpan. `onCommit` mengembalikan pesan galat atau `null`.
 */
export function TimeField({
  label,
  ticks,
  onCommit,
}: {
  label: string;
  ticks: number | null;
  onCommit: (ticks: number) => string | null;
}): React.ReactElement {
  const { t } = useI18n();
  const inputId = useId();
  const errorId = useId();
  const current = ((ticks ?? 0) / TICKS_PER_SECOND).toFixed(3);
  const [text, setText] = useState(current);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setText(current);
    setError(null);
  }, [current]);

  const commitSeconds = (seconds: number) => {
    if (!Number.isFinite(seconds) || seconds < 0) {
      setError(t("studio.time.invalid"));
      return;
    }
    const next = Math.round(seconds * TICKS_PER_SECOND);
    setError(next === (ticks ?? 0) ? null : onCommit(next));
  };

  const commitText = () => {
    if (text.trim() === "") {
      setError(t("studio.time.invalid"));
      return;
    }
    commitSeconds(Number(text.replace(",", ".")));
  };

  return (
    <div className="qr-fieldset">
      <label className="qr-label" htmlFor={inputId}>
        {label}
      </label>
      <span className={error ? "qr-field is-invalid" : "qr-field"}>
        <input
          id={inputId}
          value={text}
          inputMode="decimal"
          autoComplete="off"
          aria-invalid={error !== null}
          aria-describedby={error ? errorId : undefined}
          onChange={(e) => setText(e.target.value)}
          onBlur={commitText}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              commitText();
            } else if (e.key === "ArrowUp" || e.key === "ArrowDown") {
              e.preventDefault();
              const step = e.shiftKey ? 1 : e.altKey ? 0.01 : 0.1;
              const base = (ticks ?? 0) / TICKS_PER_SECOND;
              commitSeconds(base + (e.key === "ArrowUp" ? step : -step));
            }
          }}
        />
        <span className="qr-field__suffix">{t("studio.time.unit")}</span>
      </span>
      {error && (
        <span className="qr-error" id={errorId}>
          {error}
        </span>
      )}
    </div>
  );
}
