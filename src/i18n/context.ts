import { createContext, useContext } from "react";
import { type Lang, type StringKey } from "./strings";

/**
 * The i18n context and its hook, kept OUT of `I18nProvider.tsx` on purpose:
 * React Fast Refresh only preserves component state when a module exports
 * nothing but components, so the provider file exports its component alone
 * and everything that reads translations comes through `useI18n` here.
 */
export interface I18nValue {
  lang: Lang;
  dir: "ltr" | "rtl";
  setLang: (lang: Lang) => void;
  toggleLang: () => void;
  t: (key: StringKey, vars?: Record<string, string | number>) => string;
  /** Team / player / coach names: Persian in `fa`, identity in `en`. */
  localize: (name: string) => string;
}

export const I18nContext = createContext<I18nValue | null>(null);

export function useI18n(): I18nValue {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error("useI18n must be used inside <I18nProvider>");
  return ctx;
}
