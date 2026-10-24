import React, { useId, useState } from "react";
import { useI18n } from "../i18n";
import { Icon } from "../ui";
import { languageName, type EditionInfo } from "./translation";

/**
 * Edisi terjemahan yang ditampilkan proyek beserta urutannya (yang pertama = utama: dipakai hitungan
 * tinjauan langkah Sinkron). Hanya edisi bawaan/terpasang yang bisa ditambahkan; pasang edisi lain
 * di Pengaturan.
 */
export function ProjectEditions({
  editions,
  catalog,
  catalogError,
  onChange,
}: {
  editions: ReadonlyArray<string>;
  catalog: ReadonlyArray<EditionInfo> | null;
  catalogError: string | null;
  onChange: (editions: string[]) => void;
}): React.ReactElement {
  const { t, locale } = useI18n();
  const listId = useId();
  const addId = useId();
  const [pick, setPick] = useState("");
  const addable = (catalog ?? []).filter((e) => e.installed && !editions.includes(e.key));
  const chosen = addable.some((e) => e.key === pick) ? pick : (addable[0]?.key ?? "");

  const move = (from: number, to: number) => {
    const next = [...editions];
    const [item] = next.splice(from, 1);
    if (item === undefined) return;
    next.splice(to, 0, item);
    onChange(next);
  };

  return (
    <>
      <span className="qr-label" id={listId}>
        {t("studio.editions.label")}
      </span>
      {editions.length === 0 ? (
        <span className="qr-help">{t("studio.editions.none")}</span>
      ) : (
        <ol className="ed-order" aria-labelledby={listId}>
          {editions.map((key, i) => {
            const e = catalog?.find((c) => c.key === key);
            const name = e?.name ?? key;
            return (
              <li key={key} className="ed-row">
                <span className="ed-row__name" title={key}>
                  {name}
                  <small>
                    {e ? languageName(e.language, locale) : key}
                    {i === 0 ? ` · ${t("studio.tr.primary")}` : ""}
                  </small>
                </span>
                {catalog !== null && !e?.installed && (
                  <span className="qr-badge qr-badge--warning">{t("studio.editions.missing")}</span>
                )}
                <span className="ed-row__actions">
                  <button
                    type="button"
                    className="qr-btn qr-btn--ghost qr-btn--icon qr-btn--sm"
                    aria-label={t("studio.editions.up", { name })}
                    disabled={i === 0}
                    onClick={() => move(i, i - 1)}
                  >
                    <Icon name="chevron-up" size="sm" />
                  </button>
                  <button
                    type="button"
                    className="qr-btn qr-btn--ghost qr-btn--icon qr-btn--sm"
                    aria-label={t("studio.editions.down", { name })}
                    disabled={i === editions.length - 1}
                    onClick={() => move(i, i + 1)}
                  >
                    <Icon name="chevron-down" size="sm" />
                  </button>
                  <button
                    type="button"
                    className="qr-btn qr-btn--ghost qr-btn--icon qr-btn--sm"
                    aria-label={t("studio.editions.remove", { name })}
                    onClick={() => onChange(editions.filter((k) => k !== key))}
                  >
                    <Icon name="x" size="sm" />
                  </button>
                </span>
              </li>
            );
          })}
        </ol>
      )}
      {catalog === null ? (
        catalogError ? (
          <span className="qr-error" role="alert">
            {t("studio.editions.loadError", { message: catalogError })}
          </span>
        ) : (
          <span className="qr-help" role="status">
            <span className="qr-spin" /> {t("studio.editions.loading")}
          </span>
        )
      ) : addable.length > 0 ? (
        <div className="qr-fieldset">
          <label className="qr-label" htmlFor={addId}>
            {t("studio.editions.add")}
          </label>
          <div className="path-pick">
            <span className="qr-field">
              <select id={addId} value={chosen} onChange={(e) => setPick(e.target.value)}>
                {addable.map((e) => (
                  <option key={e.key} value={e.key}>
                    {`${e.name} (${languageName(e.language, locale)})`}
                  </option>
                ))}
              </select>
            </span>
            <button
              type="button"
              className="qr-btn qr-btn--secondary qr-btn--sm"
              disabled={chosen === ""}
              onClick={() => onChange([...editions, chosen])}
            >
              <Icon name="plus" size="sm" />
              {t("studio.editions.addAction")}
            </button>
          </div>
        </div>
      ) : null}
      <span className="qr-help">{t("studio.editions.help")}</span>
    </>
  );
}
