import React from "react";
import { useI18n } from "../i18n";
import { ErrorAlert, Icon } from "../ui";
import type { PreviewState } from "./usePreview";
import type { Project } from "./model";

/** Panggung preview: frame PNG dari renderer Rust + lencana ukuran dan overflow. */
export function Stage({
  project,
  preview,
  hasSegments,
}: {
  project: Project;
  preview: PreviewState;
  hasSegments: boolean;
}): React.ReactElement {
  const { t } = useI18n();
  const { frame, error, loading } = preview;

  let body: React.ReactNode;
  if (!hasSegments) {
    body = (
      <div className="vw-msg">
        <Icon name="audio-waveform" size="lg" />
        <span>{t("studio.stage.noSegments")}</span>
      </div>
    );
  } else if (error) {
    body = (
      <div className="vw-msg">
        <ErrorAlert title={t("studio.stage.error")} message={error} />
      </div>
    );
  } else if (frame) {
    body = (
      <img src={frame.data_url} width={frame.width} height={frame.height} alt={t("studio.stage.alt")} />
    );
  } else {
    body = (
      <div className="vw-msg" role="status">
        <span className="qr-spin" />
        <span>{t("studio.stage.rendering")}</span>
      </div>
    );
  }

  return (
    <>
      <div className="vw-bar">
        <span className="qr-badge qr-badge--plain">
          {project.canvas.aspect_ratio} · {project.canvas.width}×{project.canvas.height}
        </span>
        {frame && hasSegments && !error && (
          <span className="qr-badge qr-badge--plain">
            {t("studio.stage.previewSize", { w: frame.width, h: frame.height })}
          </span>
        )}
        {frame?.text_overflow && hasSegments && (
          <span className="qr-badge qr-badge--warning" role="status">
            {t("studio.stage.overflow")}
          </span>
        )}
      </div>
      <div className={loading && frame ? "vw-stage is-loading" : "vw-stage"}>
        {hasSegments && loading && (
          <span
            className="qr-progress is-indeterminate"
            role="progressbar"
            aria-label={t("studio.stage.loading")}
          />
        )}
        {body}
      </div>
    </>
  );
}
