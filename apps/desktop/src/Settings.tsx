import React, { useCallback, useEffect, useId, useState } from "react";
import { commands, type AppInfo, type TelemetryStatus } from "./bindings";
import { useI18n } from "./i18n";
import { errorText, unwrap } from "./tauri";
import { AiSection, EditionsSection } from "./TranslationSettings";
import { ErrorAlert, Icon, LangSwitch, ThemeSwitch } from "./ui";

function UnavailableRow({ what }: { what: string }): React.ReactElement {
  const { t } = useI18n();
  return (
    <div className="qr-prop">
      <span className="qr-prop__label">{what}</span>
      <span className="qr-badge qr-badge--plain">{t("common.unavailable")}</span>
      <input
        type="checkbox"
        role="switch"
        className="qr-switch"
        checked={false}
        disabled
        readOnly
        aria-label={t("common.unavailableNote", { what })}
      />
    </div>
  );
}

function PrivacySection(): React.ReactElement {
  const { t } = useI18n();
  const uid = useId();
  const [status, setStatus] = useState<TelemetryStatus | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [toggleError, setToggleError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setStatus(await unwrap(commands.telemetryStatus()));
      setLoadError(null);
    } catch (e) {
      setLoadError(errorText(e));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const toggle = async (enabled: boolean) => {
    setBusy(true);
    setToggleError(null);
    try {
      await unwrap(commands.telemetrySetOptIn(enabled));
      await load();
    } catch (e) {
      setToggleError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="qr-section" aria-labelledby={`${uid}-h`}>
      <h2 className="qr-section__title" id={`${uid}-h`}>
        {t("app.settings.privacy")}
      </h2>
      {loadError && (
        <ErrorAlert
          title={t("app.settings.privacy.loadError")}
          message={loadError}
          onClose={() => setLoadError(null)}
        />
      )}
      {toggleError && (
        <ErrorAlert
          title={t("app.settings.privacy.saveError")}
          message={toggleError}
          onClose={() => setToggleError(null)}
        />
      )}
      {status === null ? (
        loadError ? null : (
          <div className="qr-empty" role="status">
            <span className="qr-spin" />
            <span>{t("common.loading")}</span>
          </div>
        )
      ) : (
        <>
          <div className="qr-alert qr-alert--info">
            <Icon name="shield-check" />
            <div className="qr-alert__content">
              <span className="qr-alert__title">
                {status.upload_implemented
                  ? t("app.settings.privacy.uploadOn.title")
                  : t("app.settings.privacy.uploadOff.title")}
              </span>
              <span className="qr-alert__body">
                {status.upload_implemented
                  ? t("app.settings.privacy.uploadOn.body")
                  : t("app.settings.privacy.uploadOff.body")}
              </span>
            </div>
          </div>

          <div className="qr-prop">
            <label className="qr-prop__label" htmlFor={`${uid}-optin`}>
              {t("app.settings.privacy.optIn")}
            </label>
            <input
              id={`${uid}-optin`}
              type="checkbox"
              role="switch"
              className="qr-switch"
              checked={status.opt_in}
              disabled={busy}
              aria-describedby={`${uid}-optin-help`}
              onChange={(e) => void toggle(e.target.checked)}
            />
          </div>
          <span className="qr-help" id={`${uid}-optin-help`}>
            {status.upload_implemented
              ? t("app.settings.privacy.optInHelpOn")
              : t("app.settings.privacy.optInHelpOff")}
          </span>

          <div className="qr-fieldset">
            <span className="qr-label">{t("app.settings.privacy.logPath")}</span>
            <code className="mono" translate="no">
              {status.crash_log_path}
            </code>
            <span className="qr-help">{t("app.settings.privacy.entries", { count: status.entries })}</span>
          </div>

          <div className="qr-copy">
            <span className="qr-label" id={`${uid}-preview-label`}>
              {t("app.settings.privacy.preview")}
            </span>
            {status.preview.length > 0 ? (
              <div className="qr-copy__box">
                <pre
                  className="qr-copy__text mono settings-preview"
                  tabIndex={0}
                  aria-labelledby={`${uid}-preview-label`}
                >
                  {status.preview}
                </pre>
              </div>
            ) : (
              <span className="qr-help">{t("app.settings.privacy.previewEmpty")}</span>
            )}
            {status.preview_truncated && (
              <span className="qr-help">{t("app.settings.privacy.truncated")}</span>
            )}
          </div>
        </>
      )}
    </section>
  );
}

function AboutSection(): React.ReactElement {
  const { t } = useI18n();
  const uid = useId();
  const [info, setInfo] = useState<AppInfo | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    commands
      .getAppInfo()
      .then((v) => {
        if (!cancelled) setInfo(v);
      })
      .catch((e) => {
        if (!cancelled) setError(errorText(e));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <section className="qr-section" aria-labelledby={`${uid}-h`}>
      <h2 className="qr-section__title" id={`${uid}-h`}>
        {t("app.settings.about")}
      </h2>
      {error && (
        <ErrorAlert
          title={t("app.settings.about.error")}
          message={error}
          onClose={() => setError(null)}
        />
      )}
      <dl className="sum">
        <dt>{t("app.settings.about.name")}</dt>
        <dd>{t("common.appName")}</dd>
        <dt>{t("app.settings.about.version")}</dt>
        <dd>{info ? info.version : t("app.settings.about.unknown")}</dd>
        <dt>{t("app.settings.about.status")}</dt>
        <dd>{info ? info.status : t("app.settings.about.unknown")}</dd>
      </dl>
    </section>
  );
}

export function SettingsScreen(): React.ReactElement {
  const { t } = useI18n();
  const uid = useId();
  return (
    <div className="screen settings-screen">
      <h1>{t("app.settings.title")}</h1>

      <section className="qr-section" aria-labelledby={`${uid}-general`}>
        <h2 className="qr-section__title" id={`${uid}-general`}>
          {t("app.settings.general")}
        </h2>
        <div className="qr-prop">
          <span className="qr-prop__label">{t("common.language.label")}</span>
          <LangSwitch />
        </div>
        <div className="qr-prop">
          <span className="qr-prop__label">{t("common.theme.label")}</span>
          <ThemeSwitch />
        </div>
      </section>

      <EditionsSection />

      <AiSection />

      <PrivacySection />

      <section className="qr-section" aria-labelledby={`${uid}-unavailable`}>
        <h2 className="qr-section__title" id={`${uid}-unavailable`}>
          {t("app.settings.unavailable")}
        </h2>
        <UnavailableRow what={t("app.settings.unavailable.upload")} />
        <UnavailableRow what={t("app.settings.unavailable.transparent")} />
        <UnavailableRow what={t("app.settings.unavailable.gpu")} />
      </section>

      <AboutSection />
    </div>
  );
}
