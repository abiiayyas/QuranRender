import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { commands } from "../bindings";
import { errorText, isTauri, unwrap } from "../tauri";
import { en } from "./en";
import { id } from "./id";

export type Lang = "id" | "en";
export type MessageKey = keyof typeof id;

export const LANGS: ReadonlyArray<Lang> = ["id", "en"];

const SETTING_KEY = "ui.language";
const STORAGE_KEY = "qr.lang";

const CATALOGS: Record<Lang, Record<MessageKey, string>> = { id, en };
const LOCALES: Record<Lang, string> = { id: "id-ID", en: "en-US" };

/** Nama variabel `{x}` di sebuah pesan; dipakai untuk mengetik parameter `t`. */
type Vars<S extends string> = S extends `${string}{${infer P}}${infer R}` ? P | Vars<R> : never;

/** Kunci tanpa parameter `{x}`: boleh disimpan di data dan diterjemahkan belakangan dengan `t(key)`. */
export type PlainKey = {
  [K in MessageKey]: [Vars<(typeof id)[K]>] extends [never] ? K : never;
}[MessageKey];

export type TFunction = <K extends MessageKey>(
  key: K,
  ...args: [Vars<(typeof id)[K]>] extends [never]
    ? []
    : [params: Record<Vars<(typeof id)[K]>, string | number>]
) => string;

function isLang(v: unknown): v is Lang {
  return v === "id" || v === "en";
}

function storedLang(): Lang {
  const v = window.localStorage.getItem(STORAGE_KEY);
  return isLang(v) ? v : "id";
}

export function translate(lang: Lang, key: MessageKey, params?: Record<string, string | number>): string {
  const template = CATALOGS[lang][key];
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (whole, name: string) => {
    const v = params[name];
    return v === undefined ? whole : String(v);
  });
}

type I18nValue = {
  lang: Lang;
  /** Locale BCP 47 untuk `Intl`/`toLocale*`. */
  locale: string;
  t: TFunction;
  setLang: (lang: Lang) => void;
  /** Galat membaca/menyimpan bahasa lewat pengaturan aplikasi; `null` bila tidak ada. */
  error: string | null;
  clearError: () => void;
};

const I18nContext = createContext<I18nValue | null>(null);

export function I18nProvider({ children }: { children: React.ReactNode }): React.ReactElement {
  const [lang, setLangState] = useState<Lang>(storedLang);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    document.documentElement.lang = lang;
  }, [lang]);

  // Di dalam Tauri, pengaturan aplikasi adalah sumber kebenaran; localStorage hanya cadangan
  // (dan satu-satunya penyimpanan di luar Tauri).
  useEffect(() => {
    if (!isTauri()) return;
    let cancelled = false;
    unwrap(commands.settingsGet(SETTING_KEY))
      .then((v) => {
        if (cancelled || !isLang(v)) return;
        window.localStorage.setItem(STORAGE_KEY, v);
        setLangState(v);
      })
      .catch((e) => {
        if (!cancelled) setError(`${translate(storedLang(), "common.language.loadError")} ${errorText(e)}`);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const setLang = useCallback((next: Lang) => {
    setLangState(next);
    window.localStorage.setItem(STORAGE_KEY, next);
    if (!isTauri()) return;
    unwrap(commands.settingsSet(SETTING_KEY, next)).catch((e) =>
      setError(`${translate(next, "common.language.saveError")} ${errorText(e)}`)
    );
  }, []);

  const clearError = useCallback(() => setError(null), []);

  const value = useMemo<I18nValue>(() => {
    const t: TFunction = (key, ...args) => translate(lang, key, args[0]);
    return { lang, locale: LOCALES[lang], t, setLang, error, clearError };
  }, [lang, setLang, error, clearError]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nValue {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error("useI18n dipakai di luar I18nProvider");
  return ctx;
}
