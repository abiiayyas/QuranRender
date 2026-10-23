import React, { useEffect, useId, useRef, useState } from "react";
import { LANGS, useI18n, type Lang } from "./i18n";
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

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

function focusablesIn(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
    (el) => el.getClientRects().length > 0
  );
}

/** Benar bila ada dialog modal terbuka: pintasan global tidak boleh aktif di belakangnya. */
export function isModalOpen(): boolean {
  return document.querySelector('[role="dialog"][aria-modal="true"]') !== null;
}

/** Benar bila fokus ada di kontrol yang memakai tombol-tombol pintasan itu sendiri. */
export function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return (
    target.isContentEditable ||
    target.tagName === "INPUT" ||
    target.tagName === "TEXTAREA" ||
    target.tagName === "SELECT"
  );
}

/** Kontrol segmen (radiogroup) dengan roving tabindex dan navigasi panah. */
export function Segmented<T extends string>({
  options,
  value,
  onChange,
  ariaLabel,
  labelledBy,
}: {
  options: ReadonlyArray<{ value: T; label: React.ReactNode; disabled?: boolean; title?: string }>;
  value: T | null;
  onChange: (value: T) => void;
  ariaLabel?: string;
  labelledBy?: string;
}): React.ReactElement {
  const refs = useRef<Array<HTMLButtonElement | null>>([]);
  const firstEnabled = options.findIndex((o) => !o.disabled);
  const selected = options.findIndex((o) => o.value === value && !o.disabled);
  const tabStop = selected >= 0 ? selected : firstEnabled;

  const move = (from: number, dir: 1 | -1) => {
    for (let step = 1; step <= options.length; step++) {
      const i = (from + dir * step + options.length * step) % options.length;
      const opt = options[i];
      if (opt && !opt.disabled) {
        onChange(opt.value);
        refs.current[i]?.focus();
        return;
      }
    }
  };

  return (
    <div
      className="qr-seg"
      role="radiogroup"
      aria-label={ariaLabel}
      aria-labelledby={labelledBy}
      onKeyDown={(e) => {
        const from = refs.current.findIndex((el) => el === document.activeElement);
        if (from < 0) return;
        if (e.key === "ArrowRight" || e.key === "ArrowDown") {
          e.preventDefault();
          move(from, 1);
        } else if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
          e.preventDefault();
          move(from, -1);
        }
      }}
    >
      {options.map((o, i) => (
        <button
          key={o.value}
          ref={(el) => {
            refs.current[i] = el;
          }}
          type="button"
          role="radio"
          aria-checked={o.value === value}
          tabIndex={i === tabStop ? 0 : -1}
          disabled={o.disabled}
          title={o.title}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function ThemeSwitch(): React.ReactElement {
  const { t } = useI18n();
  const [theme, setTheme] = useState<ThemeChoice>(loadTheme);
  return (
    <Segmented<ThemeChoice>
      ariaLabel={t("common.theme.label")}
      value={theme}
      onChange={(key) => {
        applyTheme(key);
        setTheme(key);
      }}
      options={[
        { value: "system", label: t("common.theme.system") },
        { value: "light", label: t("common.theme.light") },
        { value: "dark", label: t("common.theme.dark") },
      ]}
    />
  );
}

export function LangSwitch(): React.ReactElement {
  const { t, lang, setLang } = useI18n();
  const labels: Record<Lang, string> = {
    id: t("common.language.id"),
    en: t("common.language.en"),
  };
  return (
    <Segmented<Lang>
      ariaLabel={t("common.language.label")}
      value={lang}
      onChange={setLang}
      options={LANGS.map((l) => ({ value: l, label: labels[l] }))}
    />
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
  const { t } = useI18n();
  return (
    <div className="qr-alert qr-alert--danger" role="alert">
      <Icon name="circle-alert" />
      <div className="qr-alert__content">
        <span className="qr-alert__title">{title}</span>
        <span className="qr-alert__body">{message}</span>
      </div>
      {onClose && (
        <span className="qr-alert__actions">
          <button type="button" className="qr-btn qr-btn--ghost qr-btn--sm" onClick={onClose}>
            {t("common.close")}
          </button>
        </span>
      )}
    </div>
  );
}

/**
 * Lembar modal: `role="dialog"`, fokus awal ke `[data-autofocus]` atau tombol primer footer, Tab
 * terkurung, Esc menutup, fokus kembali ke pemicu saat ditutup (doc 04 §5).
 */
export function Sheet({
  title,
  onClose,
  children,
  footer,
  size,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  footer: React.ReactNode;
  size?: "sm" | "md";
}): React.ReactElement {
  const { t } = useI18n();
  const titleId = useId();
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const trigger = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const root = ref.current;
    if (root) {
      const initial =
        root.querySelector<HTMLElement>("[data-autofocus]") ??
        root.querySelector<HTMLElement>(".qr-sheet__foot .qr-btn--primary:not([disabled])") ??
        focusablesIn(root)[0];
      initial?.focus();
    }
    return () => trigger?.focus();
  }, []);

  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "Escape") {
      e.stopPropagation();
      onClose();
      return;
    }
    if (e.key !== "Tab" || !ref.current) return;
    const items = focusablesIn(ref.current);
    const first = items[0];
    const last = items[items.length - 1];
    if (!first || !last) return;
    const active = document.activeElement;
    if (e.shiftKey && (active === first || !ref.current.contains(active))) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && (active === last || !ref.current.contains(active))) {
      e.preventDefault();
      first.focus();
    }
  };

  const cls = size ? `qr-sheet sheet-${size}` : "qr-sheet";
  return (
    <div className="qr-scrim-fixed" onMouseDown={onClose}>
      <div
        ref={ref}
        className={cls}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onKeyDown={onKeyDown}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="qr-sheet__head">
          <h2 className="qr-sheet__title" id={titleId}>
            {title}
          </h2>
          <button
            type="button"
            className="qr-btn qr-btn--ghost qr-btn--icon qr-btn--sm"
            aria-label={t("common.close")}
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
