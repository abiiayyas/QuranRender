import React, { useId } from "react";
import { useI18n } from "../i18n";
import { Segmented } from "../ui";
import { Summary } from "./parts";
import { ProjectEditions } from "./ProjectEditions";
import { RATIOS, TEMPLATES, templateById, type Project, type Ratio } from "./model";
import type { EditionInfo } from "./translation";

/** Panel kiri langkah Tampilan: pilih templat (rasio yang didukung ditampilkan per templat). */
export function TemplatePanel({
  templateId,
  onPick,
}: {
  templateId: string;
  onPick: (id: string) => void;
}): React.ReactElement {
  const { t } = useI18n();
  const labelId = useId();
  const known = templateById(templateId) !== undefined;
  return (
    <div className="st-left__body">
      <p className="pn-h" id={labelId}>
        {t("studio.style.templates")}
      </p>
      <div className="opt-list" role="radiogroup" aria-labelledby={labelId}>
        {!known && (
          <label className="qr-opt">
            <input type="radio" className="qr-radio" name="template" checked readOnly />
            <span>{templateId}</span>
            <span className="qr-opt__meta">{t("studio.style.current")}</span>
          </label>
        )}
        {TEMPLATES.map((tpl) => (
          <label key={tpl.id} className="qr-opt">
            <input
              type="radio"
              className="qr-radio"
              name="template"
              checked={templateId === tpl.id}
              onChange={() => onPick(tpl.id)}
            />
            <span>
              {t(tpl.name)}
              <small>{tpl.ratios.join(" · ")}</small>
            </span>
            <span />
          </label>
        ))}
      </div>
    </div>
  );
}

/** Inspector langkah Tampilan: rasio (hanya yang didukung templat), edisi terjemahan, ringkasan gaya. */
export function StyleInspector({
  project,
  ratioNotice,
  onRatio,
  catalog,
  catalogError,
  onEditions,
}: {
  project: Project;
  ratioNotice: string | null;
  onRatio: (ratio: Ratio) => void;
  catalog: ReadonlyArray<EditionInfo> | null;
  catalogError: string | null;
  onEditions: (editions: string[]) => void;
}): React.ReactElement {
  const { t } = useI18n();
  const labelId = useId();
  const tpl = templateById(project.template_id);
  const supported = tpl ? tpl.ratios : RATIOS.map((r) => r.id);
  const overrides = Object.entries(project.style_overrides);
  const current = RATIOS.find((r) => r.id === project.canvas.aspect_ratio)?.id ?? null;

  return (
    <>
      <div className="qr-panel__head">
        <span className="qr-panel__title">{t("studio.style.ratio")}</span>
      </div>
      <div className="insp-pad">
        <span className="qr-label" id={labelId}>
          {t("studio.style.ratioLabel")}
        </span>
        <Segmented<Ratio>
          labelledBy={labelId}
          value={current}
          onChange={onRatio}
          options={RATIOS.map((r) => ({
            value: r.id,
            label: r.id,
            disabled: !supported.includes(r.id),
            title: supported.includes(r.id) ? undefined : t("studio.style.ratioUnsupported"),
          }))}
        />
        <span className="qr-help">
          {tpl
            ? t("studio.style.supports", { name: t(tpl.name), ratios: tpl.ratios.join(", ") })
            : t("studio.style.unknownTemplate", { id: project.template_id })}
        </span>
        <div role="status" aria-live="polite">
          {ratioNotice && <span className="qr-help">{ratioNotice}</span>}
        </div>
      </div>
      <div className="qr-panel__head">
        <span className="qr-panel__title">{t("studio.editions.title")}</span>
      </div>
      <div className="insp-pad">
        <ProjectEditions
          editions={project.translation_editions}
          catalog={catalog}
          catalogError={catalogError}
          onChange={onEditions}
        />
      </div>
      <div className="qr-panel__head">
        <span className="qr-panel__title">{t("studio.style.title")}</span>
      </div>
      <div className="insp-pad">
        <Summary
          rows={[
            [t("studio.style.template"), tpl ? t(tpl.name) : project.template_id],
            [t("studio.sum.canvas"), `${project.canvas.width} × ${project.canvas.height}`],
            [t("studio.style.overrides"), String(overrides.length)],
          ]}
        />
        {overrides.length > 0 && (
          <table className="qr-tbl">
            <tbody>
              {overrides.map(([k, v]) => (
                <tr key={k}>
                  <td>{k}</td>
                  <td className="num">{v}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <span className="qr-help">{t("studio.style.unavailable")}</span>
        <label className="qr-choice is-disabled">
          <input type="checkbox" role="switch" className="qr-switch" disabled />
          {t("studio.style.gpuPreview")} · {t("common.unavailable")}
        </label>
      </div>
    </>
  );
}
