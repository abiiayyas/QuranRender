import React, { useEffect, useId, useRef } from "react";
import type { Job } from "@shared/types";
import { useApp } from "../store/app";
import { t } from "@shared/i18n";

export function Icon({ name, size }: { name: string; size?: "sm" | "lg" }): React.ReactElement {
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
          <button type="button" className="qr-btn qr-btn--ghost qr-btn--sm" onClick={onClose}>
            {t("Tutup")}
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
  size?: "sm" | "md" | "lg";
}): React.ReactElement {
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
            aria-label={t("Tutup")}
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

export function Toasts(): React.ReactElement {
  const toasts = useApp((s) => s.toasts);
  const dismiss = useApp((s) => s.dismiss);
  return (
    <div className="toasts" role="status" aria-live="polite">
      {toasts.map((toast) => (
        <div key={toast.id} className={toast.kind === "error" ? "qr-toast qr-toast--danger" : toast.kind === "success" ? "qr-toast qr-toast--success" : "qr-toast"}>
          <Icon name={toast.kind === "error" ? "circle-alert" : toast.kind === "success" ? "circle-check" : "info"} />
          <div className="qr-toast__body">{toast.text}</div>
          {toast.action && (
            <button
              type="button"
              className="qr-btn qr-btn--ghost qr-btn--sm"
              onClick={() => {
                toast.action!.run();
                dismiss(toast.id);
              }}
            >
              {toast.action.label}
            </button>
          )}
          <button type="button" className="qr-btn qr-btn--ghost qr-btn--icon qr-btn--sm" aria-label={t("Tutup")} onClick={() => dismiss(toast.id)}>
            <Icon name="x" size="sm" />
          </button>
        </div>
      ))}
    </div>
  );
}

/** Renders the dialog opened by `confirmDialog()`. */
export function ConfirmHost(): React.ReactElement | null {
  const c = useApp((s) => s.confirm);
  if (!c) return null;
  const close = (ok: boolean) => {
    useApp.setState({ confirm: null });
    c.resolve(ok);
  };
  return (
    <Sheet
      title={c.title}
      size="sm"
      onClose={() => close(false)}
      footer={
        <>
          <button type="button" className="qr-btn qr-btn--secondary" onClick={() => close(false)}>
            {t("Batal")}
          </button>
          <button type="button" className={`qr-btn ${c.danger ? "qr-btn--danger" : "qr-btn--primary"}`} onClick={() => close(true)}>
            {c.confirmLabel}
          </button>
        </>
      }
    >
      <p>{c.body}</p>
    </Sheet>
  );
}

/** Progress line for a job; nothing when the job is finished or missing. */
export function JobProgress({ job, label }: { job: Job | null; label: string }): React.ReactElement | null {
  if (!job || (job.status !== "queued" && job.status !== "running")) return null;
  const pct = Math.round(job.progress * 100);
  return (
    <div className="qr-jobs">
      <div className="qr-job" role="status">
        <span className="qr-job__code">{job.status === "queued" ? "…" : `${pct}%`}</span>
        <span className="qr-job__title">
          <span>{job.status === "queued" ? t("{label} (menunggu antrean)", { label }) : label}</span>
          {job.message && <small>{job.message}</small>}
        </span>
        <span className="qr-job__state">
          <span
            className={job.status === "queued" ? "qr-progress is-indeterminate" : "qr-progress"}
            style={{ "--v": job.progress } as React.CSSProperties}
            role="progressbar"
            aria-label={label}
            aria-valuenow={pct}
            aria-valuemin={0}
            aria-valuemax={100}
          />
        </span>
        <span className="qr-job__actions">
          <button type="button" className="qr-btn qr-btn--ghost qr-btn--sm" onClick={() => void window.api.jobs.cancel(job.id)}>
            {t("Batalkan")}
          </button>
        </span>
      </div>
    </div>
  );
}

/** Surah + ayah range with native selects inside qr-field. */
export function RangePicker({
  surahs,
  surah,
  from,
  to,
  onChange,
}: {
  surahs: ReadonlyArray<{ id: number; nameLatin: string; nameArabic: string; ayahCount: number }>;
  surah: number | null;
  from: number | null;
  to: number | null;
  onChange: (v: { surah: number; from: number; to: number }) => void;
}): React.ReactElement {
  const ids = [useId(), useId(), useId()];
  const info = surahs.find((s) => s.id === surah);
  const ayat = Array.from({ length: info?.ayahCount ?? 0 }, (_, i) => i + 1);
  const f = from ?? 1;
  const upTo = to ?? info?.ayahCount ?? 1;
  return (
    <div className="range-form stack">
      <div className="qr-fieldset">
        <label className="qr-label" htmlFor={ids[0]}>
          {t("Surah")}
        </label>
        <span className="qr-field">
          <select
            id={ids[0]}
            value={surah ?? ""}
            onChange={(e) => {
              const s = surahs.find((x) => x.id === Number(e.target.value));
              if (s) onChange({ surah: s.id, from: 1, to: s.ayahCount });
            }}
          >
            <option value="" disabled>
              {t("Pilih surah")}
            </option>
            {surahs.map((s) => (
              <option key={s.id} value={s.id}>
                {`${s.id}. ${s.nameLatin} (${s.nameArabic})`}
              </option>
            ))}
          </select>
        </span>
      </div>
      {info && (
        <div className="grid-2">
          <div className="qr-fieldset">
            <label className="qr-label" htmlFor={ids[1]}>
              {t("Dari ayat")}
            </label>
            <span className="qr-field">
              <select id={ids[1]} value={f} onChange={(e) => onChange({ surah: info.id, from: Number(e.target.value), to: Math.max(upTo, Number(e.target.value)) })}>
                {ayat.map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
            </span>
          </div>
          <div className="qr-fieldset">
            <label className="qr-label" htmlFor={ids[2]}>
              {t("Sampai ayat")}
            </label>
            <span className="qr-field">
              <select id={ids[2]} value={upTo} onChange={(e) => onChange({ surah: info.id, from: Math.min(f, Number(e.target.value)), to: Number(e.target.value) })}>
                {ayat.map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
