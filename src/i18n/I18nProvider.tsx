import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { strings, type Lang, type StringKey } from "./strings";
import { toFa } from "./names";

interface I18nValue {
  lang: Lang;
  dir: "ltr" | "rtl";
  setLang: (lang: Lang) => void;
  toggleLang: () => void;
  t: (key: StringKey, vars?: Record<string, string | number>) => string;
  /** Team / player / coach names: Persian in `fa`, identity in `en`. */
  localize: (name: string) => string;
}

const I18nContext = createContext<I18nValue | null>(null);

const STORAGE_KEY = "matchday.lang";

function detectLang(): Lang {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === "en" || saved === "fa") return saved;
  } catch {
    /* private mode */
  }
  // Persian is the v1 launch audience, so it wins the tie when the device asks for it.
  return navigator.language?.toLowerCase().startsWith("fa") ? "fa" : "en";
}

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(detectLang);
  const dir: "ltr" | "rtl" = lang === "fa" ? "rtl" : "ltr";

  // Drive direction from the document root so logical CSS properties (ms/me, ps/pe)
  // and native RTL text handling both flip with a single attribute.
  useEffect(() => {
    document.documentElement.lang = lang;
    document.documentElement.dir = dir;
  }, [lang, dir]);

  const setLang = useCallback((next: Lang) => {
    setLangState(next);
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      /* ignore */
    }
  }, []);

  const t = useCallback(
    (key: StringKey, vars?: Record<string, string | number>) => {
      let out: string = strings[lang][key] ?? strings.en[key] ?? key;
      if (vars) {
        for (const [name, value] of Object.entries(vars)) {
          out = out.replaceAll(`{${name}}`, String(value));
        }
      }
      return out;
    },
    [lang],
  );

  const localize = useCallback((name: string) => (lang === "fa" ? toFa(name) : name), [lang]);

  const value = useMemo<I18nValue>(
    () => ({
      lang,
      dir,
      setLang,
      toggleLang: () => setLang(lang === "en" ? "fa" : "en"),
      t,
      localize,
    }),
    [lang, dir, setLang, t, localize],
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nValue {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error("useI18n must be used inside <I18nProvider>");
  return ctx;
}
