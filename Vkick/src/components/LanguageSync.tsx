import { useEffect, useRef } from "react";
import { useI18n } from "../i18n/I18nProvider";
import { api } from "../lib/api";

/**
 * Reports this device's language to the server so the bot's pushes are written
 * in the language the user is actually reading (`server/messages.ts`, which
 * picks the copy per recipient from `users.language`).
 *
 * Mounted inside the authenticated shell, so there is always a user row to
 * write to. It is a "last device wins" sync on purpose: the language is a
 * per-device choice, so whichever device the user is reading right now is the
 * one the bot should speak to. A user who signs in on someone else's English
 * laptop flips their pushes to English until they next open the app in Persian,
 * which is the intended, self-healing behaviour.
 *
 * Failures are swallowed: a missed language sync must never surface as an error,
 * and clearing the sentinel means the next app open (or language change) retries
 * rather than looping.
 */
export function LanguageSync() {
  /** Last value we successfully told the server about, for this session. */
  const sent = useRef<string | null>(null);
  const { lang } = useI18n();

  useEffect(() => {
    if (sent.current === lang) return;
    sent.current = lang;
    void api.setLanguage(lang).catch(() => {
      sent.current = null;
    });
  }, [lang]);

  return null;
}
