import React, { useState } from "react";
import { applyTheme, loadTheme, type ThemeChoice } from "./theme";

export function Icon({
  name,
  size,
}: {
  name: string;
  size?: "sm" | "lg";
}): React.ReactElement {
  const cls = size === "sm" ? "qr-ic qr-ic--sm" : size === "lg" ? "qr-ic qr-ic--lg" : "qr-ic";
  return (
    <svg className={cls} aria-hidden="true">
      <use href={`${import.meta.env.BASE_URL}icons.svg#i-${name}`} />
    </svg>
  );
}

const THEMES: ReadonlyArray<readonly [ThemeChoice, string]> = [
  ["system", "Sistem"],
  ["light", "Terang"],
  ["dark", "Gelap"],
];

export function ThemeSwitch(): React.ReactElement {
  const [theme, setTheme] = useState<ThemeChoice>(loadTheme);
  return (
    <div className="qr-seg" role="radiogroup" aria-label="Tema">
      {THEMES.map(([key, label]) => (
        <button
          key={key}
          type="button"
          role="radio"
          aria-checked={theme === key}
          onClick={() => {
            applyTheme(key);
            setTheme(key);
          }}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

export function ErrorAlert({
  title,
  message,
  onClose,
}: {
  title: string;
  message: string;
  onClose?: () => void;
}): React.ReactElement {
  return (
    <div className="qr-alert qr-alert--danger" role="alert">
      <Icon name="circle-alert" />
      <div className="qr-alert__content">
        <span className="qr-alert__title">{title}</span>
        <span className="qr-alert__body">{message}</span>
      </div>
      {onClose && (
        <span className="qr-alert__actions">
          <button
            type="button"
            className="qr-btn qr-btn--ghost qr-btn--sm"
            onClick={onClose}
          >
            Tutup
          </button>
        </span>
      )}
    </div>
  );
}

export function Sheet({
  title,
  onClose,
  children,
  footer,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  footer: React.ReactNode;
}): React.ReactElement {
  return (
    <div className="qr-scrim-fixed" onMouseDown={onClose}>
      <div
        className="qr-sheet"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="qr-sheet__head">
          <h2 className="qr-sheet__title">{title}</h2>
          <button
            type="button"
            className="qr-btn qr-btn--ghost qr-btn--icon qr-btn--sm"
            aria-label="Tutup"
            onClick={onClose}
          >
            <Icon name="x" size="sm" />
          </button>
        </div>
        <div className="qr-sheet__body">{children}</div>
        <div className="qr-sheet__foot">{footer}</div>
      </div>
    </div>
  );
}
