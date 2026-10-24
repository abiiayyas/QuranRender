import React, { useCallback, useEffect, useId, useState } from "react";
import { commands } from "./bindings";
import { useI18n } from "./i18n";
import {
  AI_ENDPOINT_KEY,
  AI_MODEL_KEY,
  DEFAULT_AI_ENDPOINT,
  DEFAULT_AI_MODEL,
  isLocalEndpoint,
  languageName,
  type EditionInfo,
} from "./studio/translation";
import { errorText, unwrap } from "./tauri";
import { ErrorAlert, Icon, Sheet } from "./ui";

type ActionError = { title: string; message: string };

/** Edisi terjemahan: bawaan dataset, terpasang (content.db), dan katalog Quran.com untuk dipasang. */
export function EditionsSection(): React.ReactElement {
  const { t, locale } = useI18n();
  const uid = useId();
  const [list, setList] = useState<EditionInfo[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<ActionError | null>(null);
  /** Kunci edisi yang sedang dipasang/dihapus (satu per satu). */
  const [busy, setBusy] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [lang, setLang] = useState("");
  const [removing, setRemoving] = useState<EditionInfo | null>(null);

  const load = useCallback(async () => {
    try {
      setList(await unwrap(commands.translationEditionsList()));
      setLoadError(null);
    } catch (e) {
      setLoadError(errorText(e));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const install = async (edition: EditionInfo) => {
    if (edition.remote_id === null) return;
    setBusy(edition.key);
    setActionError(null);
    try {
      const done = await unwrap(commands.translationEditionInstall(edition.remote_id));
      setList((cur) => cur?.map((e) => (e.key === edition.key ? done : e)) ?? cur);
    } catch (e) {
      setActionError({ title: t("app.settings.editions.installError", { name: edition.name }), message: errorText(e) });
    } finally {
      setBusy(null);
    }
  };

  const remove = async (edition: EditionInfo) => {
    setRemoving(null);
    setBusy(edition.key);
    setActionError(null);
    try {
      await unwrap(commands.translationEditionRemove(edition.key));
      await load();
    } catch (e) {
      setActionError({ title: t("app.settings.editions.removeError", { name: edition.name }), message: errorText(e) });
    } finally {
      setBusy(null);
    }
  };

  const all = list ?? [];
  const languages = [...new Set(all.map((e) => e.language))]
    .map((code) => ({ code, name: languageName(code, locale) }))
    .sort((a, b) => a.name.localeCompare(b.name, locale));
  const q = query.trim().toLocaleLowerCase(locale);
  const shown = all.filter(
    (e) =>
      (lang === "" || e.language === lang) &&
      (q === "" ||
        [e.name, e.author ?? "", e.key, languageName(e.language, locale)].some((v) =>
          v.toLocaleLowerCase(locale).includes(q)
        ))
  );
  const local = shown.filter((e) => e.installed);
  const remote = shown.filter((e) => !e.installed);
  const offline = list !== null && !all.some((e) => e.origin === "Remote");

  const row = (e: EditionInfo) => (
    <tr key={e.key}>
      <td>
        <span className="ed-cell">
          <b>{e.name}</b>
          {e.author && <small>{e.author}</small>}
        </span>
      </td>
      <td>{languageName(e.language, locale)}</td>
      <td>
        {e.origin === "Dataset" ? (
          <span className="qr-badge qr-badge--plain">{t("app.settings.editions.dataset")}</span>
        ) : e.origin === "Installed" ? (
          <span className="qr-badge qr-badge--success">{t("app.settings.editions.installed")}</span>
        ) : (
          <span className="qr-badge qr-badge--plain">{t("app.settings.editions.remote")}</span>
        )}
      </td>
      <td className="num">
        {e.origin === "Remote" ? (
          <button
            type="button"
            className={busy === e.key ? "qr-btn qr-btn--secondary qr-btn--sm is-loading" : "qr-btn qr-btn--secondary qr-btn--sm"}
            disabled={busy !== null}
            aria-label={t("app.settings.editions.installNamed", { name: e.name })}
            onClick={() => void install(e)}
          >
            {busy === e.key ? <span className="qr-spin" /> : <Icon name="download" size="sm" />}
            {busy === e.key ? t("app.settings.editions.installing") : t("app.settings.editions.install")}
          </button>
        ) : e.origin === "Installed" ? (
          <button
            type="button"
            className={busy === e.key ? "qr-btn qr-btn--ghost qr-btn--sm is-loading" : "qr-btn qr-btn--ghost qr-btn--sm"}
            disabled={busy !== null}
            aria-label={t("app.settings.editions.removeNamed", { name: e.name })}
            onClick={() => setRemoving(e)}
          >
            {busy === e.key ? <span className="qr-spin" /> : <Icon name="trash-2" size="sm" />}
            {t("app.settings.editions.remove")}
          </button>
        ) : (
          <span className="muted">{t("app.settings.editions.builtIn")}</span>
        )}
      </td>
    </tr>
  );

  const table = (rows: EditionInfo[], captionId: string) => (
    <div className="edition-tbl">
      <table className="qr-tbl" aria-labelledby={captionId}>
        <thead>
          <tr>
            <th scope="col">{t("app.settings.editions.colName")}</th>
            <th scope="col">{t("app.settings.editions.colLanguage")}</th>
            <th scope="col">{t("app.settings.editions.colStatus")}</th>
            <th scope="col">
              <span className="sr-only">{t("app.settings.editions.colAction")}</span>
            </th>
          </tr>
        </thead>
        <tbody>{rows.map(row)}</tbody>
      </table>
    </div>
  );

  return (
    <section className="qr-section" aria-labelledby={`${uid}-h`}>
      <h2 className="qr-section__title" id={`${uid}-h`}>
        {t("app.settings.editions")}
      </h2>
      <span className="qr-help">{t("app.settings.editions.help")}</span>
      {loadError && (
        <ErrorAlert title={t("app.settings.editions.loadError")} message={loadError} onClose={() => setLoadError(null)} />
      )}
      {actionError && (
        <ErrorAlert title={actionError.title} message={actionError.message} onClose={() => setActionError(null)} />
      )}
      {list === null ? (
        loadError ? null : (
          <div className="qr-empty" role="status">
            <span className="qr-spin" />
            <span>{t("app.settings.editions.loading")}</span>
          </div>
        )
      ) : (
        <>
          <div className="edition-filter">
            <span className="qr-field">
              <Icon name="search" size="sm" />
              <input
                type="search"
                value={query}
                aria-label={t("app.settings.editions.search")}
                placeholder={t("app.settings.editions.searchPlaceholder")}
                onChange={(e) => setQuery(e.target.value)}
              />
            </span>
            <span className="qr-field">
              <select value={lang} aria-label={t("app.settings.editions.language")} onChange={(e) => setLang(e.target.value)}>
                <option value="">{t("app.settings.editions.allLanguages")}</option>
                {languages.map((l) => (
                  <option key={l.code} value={l.code}>
                    {l.name}
                  </option>
                ))}
              </select>
            </span>
          </div>
          {offline && (
            <p className="qr-help" role="status">
              {t("app.settings.editions.offline")}
            </p>
          )}
          <span className="qr-label" id={`${uid}-local`}>
            {t("app.settings.editions.localTitle", { count: local.length })}
          </span>
          {local.length > 0 ? table(local, `${uid}-local`) : <span className="qr-help">{t("app.settings.editions.noMatch")}</span>}
          {!offline && (
            <>
              <span className="qr-label" id={`${uid}-remote`}>
                {t("app.settings.editions.remoteTitle", { count: remote.length })}
              </span>
              {remote.length > 0 ? (
                table(remote, `${uid}-remote`)
              ) : (
                <span className="qr-help">{t("app.settings.editions.noMatch")}</span>
              )}
              <span className="qr-help">{t("app.settings.editions.source")}</span>
            </>
          )}
        </>
      )}
      {removing && (
        <Sheet
          title={t("app.settings.editions.removeTitle", { name: removing.name })}
          onClose={() => setRemoving(null)}
          footer={
            <>
              <button type="button" className="qr-btn qr-btn--secondary" onClick={() => setRemoving(null)}>
                {t("common.cancel")}
              </button>
              <button type="button" className="qr-btn qr-btn--danger" onClick={() => void remove(removing)}>
                {t("app.settings.editions.remove")}
              </button>
            </>
          }
        >
          <p>{t("app.settings.editions.removeBody")}</p>
        </Sheet>
      )}
    </section>
  );
}

/** `https://…`, atau `http://` hanya untuk server di komputer ini (aturan `with_user_endpoint` backend). */
function endpointValid(text: string): boolean {
  if (text === "") return true;
  try {
    const url = new URL(text);
    return url.protocol === "https:" || (url.protocol === "http:" && isLocalEndpoint(text));
  } catch {
    return false;
  }
}

/** Layanan AI OpenAI-compatible untuk "Potong dengan AI": endpoint, model, dan kunci API (keychain OS). */
export function AiSection(): React.ReactElement {
  const { t } = useI18n();
  const uid = useId();
  const [saved, setSaved] = useState<{ endpoint: string; model: string } | null>(null);
  const [endpoint, setEndpoint] = useState("");
  const [model, setModel] = useState("");
  const [hasKey, setHasKey] = useState<boolean | null>(null);
  const [keyDraft, setKeyDraft] = useState("");
  const [busy, setBusy] = useState<"config" | "key" | "clear" | null>(null);
  const [error, setError] = useState<ActionError | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      unwrap(commands.settingsGet(AI_ENDPOINT_KEY)),
      unwrap(commands.settingsGet(AI_MODEL_KEY)),
      unwrap(commands.aiKeyStatus()),
    ])
      .then(([ep, md, key]) => {
        if (cancelled) return;
        const next = { endpoint: typeof ep === "string" ? ep : "", model: typeof md === "string" ? md : "" };
        setSaved(next);
        setEndpoint(next.endpoint);
        setModel(next.model);
        setHasKey(key);
      })
      .catch((e) => {
        if (!cancelled) setError({ title: t("app.settings.ai.loadError"), message: errorText(e) });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const ep = endpoint.trim();
  const md = model.trim();
  const epValid = endpointValid(ep);
  const changed = saved !== null && (ep !== saved.endpoint || md !== saved.model);
  const effective = ep === "" ? DEFAULT_AI_ENDPOINT : ep;

  const run = async (kind: "config" | "key" | "clear", action: () => Promise<void>, done: string) => {
    setBusy(kind);
    setError(null);
    setNotice(null);
    try {
      await action();
      setNotice(done);
    } catch (e) {
      setError({ title: t("app.settings.ai.saveError"), message: errorText(e) });
    } finally {
      setBusy(null);
    }
  };

  const saveConfig = () =>
    run(
      "config",
      async () => {
        await unwrap(commands.settingsSet(AI_ENDPOINT_KEY, ep));
        await unwrap(commands.settingsSet(AI_MODEL_KEY, md));
        setSaved({ endpoint: ep, model: md });
        setEndpoint(ep);
        setModel(md);
      },
      t("app.settings.ai.configSaved")
    );

  const saveKey = () =>
    run(
      "key",
      async () => {
        await unwrap(commands.aiKeySet(keyDraft));
        setKeyDraft("");
        setHasKey(true);
      },
      t("app.settings.ai.keySaved")
    );

  const clearKey = () =>
    run(
      "clear",
      async () => {
        await unwrap(commands.aiKeyClear());
        setHasKey(false);
      },
      t("app.settings.ai.keyCleared")
    );

  return (
    <section className="qr-section" aria-labelledby={`${uid}-h`}>
      <h2 className="qr-section__title" id={`${uid}-h`}>
        {t("app.settings.ai")}
      </h2>
      <span className="qr-help">{t("app.settings.ai.help")}</span>
      <div className="qr-alert qr-alert--info">
        <Icon name="shield-check" />
        <div className="qr-alert__content">
          <span className="qr-alert__title">{t("app.settings.ai.sendsTitle")}</span>
          <span className="qr-alert__body">{t("app.settings.ai.sendsBody", { endpoint: effective })}</span>
        </div>
      </div>
      {error && <ErrorAlert title={error.title} message={error.message} onClose={() => setError(null)} />}
      {notice && (
        <p className="qr-help" role="status">
          {notice}
        </p>
      )}
      {saved === null ? (
        error ? null : (
          <div className="qr-empty" role="status">
            <span className="qr-spin" />
            <span>{t("common.loading")}</span>
          </div>
        )
      ) : (
        <>
          <div className="qr-fieldset">
            <label className="qr-label" htmlFor={`${uid}-endpoint`}>
              {t("app.settings.ai.endpoint")}
            </label>
            <span className={epValid ? "qr-field" : "qr-field is-invalid"}>
              <input
                id={`${uid}-endpoint`}
                type="url"
                inputMode="url"
                spellCheck={false}
                value={endpoint}
                placeholder={DEFAULT_AI_ENDPOINT}
                aria-invalid={!epValid}
                aria-describedby={`${uid}-endpoint-help`}
                onChange={(e) => setEndpoint(e.target.value)}
              />
            </span>
            {epValid ? (
              <span className="qr-help" id={`${uid}-endpoint-help`}>
                {t("app.settings.ai.endpointHelp", { value: DEFAULT_AI_ENDPOINT })}
              </span>
            ) : (
              <span className="qr-error" id={`${uid}-endpoint-help`}>
                {t("app.settings.ai.endpointInvalid")}
              </span>
            )}
          </div>
          <div className="qr-fieldset">
            <label className="qr-label" htmlFor={`${uid}-model`}>
              {t("app.settings.ai.model")}
            </label>
            <span className="qr-field">
              <input
                id={`${uid}-model`}
                type="text"
                spellCheck={false}
                value={model}
                placeholder={DEFAULT_AI_MODEL}
                aria-describedby={`${uid}-model-help`}
                onChange={(e) => setModel(e.target.value)}
              />
            </span>
            <span className="qr-help" id={`${uid}-model-help`}>
              {t("app.settings.ai.modelHelp", { value: DEFAULT_AI_MODEL })}
            </span>
          </div>
          <div className="ai-actions">
            <button
              type="button"
              className={busy === "config" ? "qr-btn qr-btn--secondary is-loading" : "qr-btn qr-btn--secondary"}
              disabled={!changed || !epValid || busy !== null}
              onClick={() => void saveConfig()}
            >
              {busy === "config" && <span className="qr-spin" />}
              {t("app.settings.ai.saveConfig")}
            </button>
          </div>

          <div className="qr-prop">
            <span className="qr-prop__label">{t("app.settings.ai.key")}</span>
            {hasKey ? (
              <span className="qr-badge qr-badge--success">{t("app.settings.ai.keySet")}</span>
            ) : (
              <span className="qr-badge qr-badge--plain">{t("app.settings.ai.keyUnset")}</span>
            )}
          </div>
          <div className="qr-fieldset">
            <label className="qr-label" htmlFor={`${uid}-key`}>
              {hasKey ? t("app.settings.ai.keyReplace") : t("app.settings.ai.keyNew")}
            </label>
            <span className="qr-field">
              <Icon name="key-round" size="sm" />
              <input
                id={`${uid}-key`}
                type="password"
                autoComplete="off"
                spellCheck={false}
                value={keyDraft}
                aria-describedby={`${uid}-key-help`}
                onChange={(e) => setKeyDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && keyDraft.trim() !== "" && busy === null) void saveKey();
                }}
              />
            </span>
            <span className="qr-help" id={`${uid}-key-help`}>
              {t("app.settings.ai.keyHelp")}
            </span>
          </div>
          <div className="ai-actions">
            <button
              type="button"
              className={busy === "key" ? "qr-btn qr-btn--primary is-loading" : "qr-btn qr-btn--primary"}
              disabled={keyDraft.trim() === "" || busy !== null}
              onClick={() => void saveKey()}
            >
              {busy === "key" && <span className="qr-spin" />}
              {t("app.settings.ai.saveKey")}
            </button>
            {hasKey && (
              <button
                type="button"
                className={busy === "clear" ? "qr-btn qr-btn--ghost is-loading" : "qr-btn qr-btn--ghost"}
                disabled={busy !== null}
                onClick={() => void clearKey()}
              >
                {busy === "clear" ? <span className="qr-spin" /> : <Icon name="trash-2" size="sm" />}
                {t("app.settings.ai.clearKey")}
              </button>
            )}
          </div>
        </>
      )}
    </section>
  );
}
