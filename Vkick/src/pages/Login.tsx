import { useState, type FormEvent } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { LanguageToggle } from "../components/TopBar";
import { Button, Card, Segmented } from "../components/ui";
import { useAuth } from "../hooks/useAuth";
import { useI18n } from "../i18n/I18nProvider";
import { serverErrorKey } from "../lib/api";
import { isTelegram, haptic } from "../lib/telegram";
import type { StringKey } from "../i18n/strings";

/**
 * The entry screen. "Enter" silently creates (or reuses) an account — inside
 * Telegram that's the Telegram identity, on the web a persistent guest
 * account for this device. Username sign-in and registration (username +
 * password) sit behind a link for people returning from another device or
 * creating a roaming account.
 */
export default function Login() {
  const { t } = useI18n();
  const { user, isLoading, enterApp, loginWithUsername, registerWithUsername } = useAuth();
  const location = useLocation();
  const from = (location.state as { from?: string } | null)?.from ?? "/";
  const [showUsername, setShowUsername] = useState(false);
  // Sign-in and registration are explicit, separate modes: an unknown
  // username on sign-in is NO_ACCOUNT (never auto-created — a typo must not
  // silently mint a new account).
  const [mode, setMode] = useState<"signin" | "register">("signin");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [error, setError] = useState<StringKey | null>(null);
  const [busy, setBusy] = useState(false);

  // Already signed in (session survived a reload): skip the screen.
  if (user) {
    return <Navigate to={from} replace />;
  }

  const enter = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    haptic("light");
    try {
      await enterApp();
      // Once the user row lands, the `if (user)` branch above redirects to `from`.
    } catch (err) {
      // Coded failures (BAD_DEVICE_ID, TOO_MANY_REQUESTS…) map to localized
      // messages; only truly unexpected throws land on common.error.
      setError(serverErrorKey(err) as StringKey);
    } finally {
      setBusy(false);
    }
  };

  const submitUsername = async (event: FormEvent) => {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    haptic("light");
    try {
      if (mode === "register") {
        await registerWithUsername(username.trim(), password, displayName.trim(), true);
      } else {
        await loginWithUsername(username.trim(), password, true);
      }
      // Once the user row lands, the `if (user)` branch above redirects to `from`.
    } catch (err) {
      // Server codes (INVALID_CREDENTIALS / USERNAME_TAKEN / BAD_USERNAME /
      // BAD_PASSWORD…) map to localized inline messages, never the generic
      // fallback.
      setError(serverErrorKey(err) as StringKey);
    } finally {
      setBusy(false);
    }
  };

  const inputClass =
    "min-h-12 w-full rounded-card border border-line bg-base px-3.5 text-sm text-ink placeholder:text-ink-3 focus:border-volt focus:outline-none focus:ring-4 focus:ring-[color-mix(in_srgb,var(--volt)_16%,transparent)]";

  return (
    <div className="floodlight flex min-h-[100svh] flex-col">
      <header className="pad-safe-top">
        <div className="mx-auto flex w-full max-w-[560px] justify-end px-3 py-2">
          <LanguageToggle />
        </div>
      </header>

      <main className="mx-auto flex w-full max-w-[560px] flex-1 flex-col justify-center px-4 pb-8">
        {/* Hero: the mark over the wordmark, over the floodlit wash. */}
        <section className="rise-in px-2 pb-7 text-center">
          <img
            src="/vkick-mark.svg"
            alt=""
            width={84}
            height={84}
            className="mx-auto mb-3 h-16 w-auto sm:h-[84px]"
          />
          <h1 className="font-num text-[clamp(2.25rem,11vw,3.25rem)] leading-tight font-black tracking-[-0.03em] text-ink">
            {t("app.name")}
          </h1>
          <p className="mx-auto mt-2 max-w-[34ch] text-sm leading-relaxed text-ink-2">{t("auth.subtitle")}</p>
        </section>

        <Card className="rise-in p-4 sm:p-5" style={{ animationDelay: "70ms" }}>
          {showUsername ? (
            <form onSubmit={submitUsername} className="space-y-3">
              <Segmented
                value={mode}
                onChange={(next) => {
                  setMode(next);
                  setError(null);
                }}
                options={[
                  { value: "signin", label: t("auth.signIn") },
                  { value: "register", label: t("auth.register") },
                ]}
              />
              <label className="block space-y-1">
                <span className="label text-ink-2">{t("auth.username")}</span>
                <input
                  className={inputClass}
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  autoComplete="username"
                  autoCapitalize="none"
                  spellCheck={false}
                  dir="ltr"
                  maxLength={24}
                  required
                />
              </label>

              {mode === "register" ? (
                <label className="block space-y-1">
                  <span className="label text-ink-2">{t("auth.displayName")}</span>
                  <input
                    className={inputClass}
                    value={displayName}
                    onChange={(e) => setDisplayName(e.target.value)}
                    autoComplete="nickname"
                    dir="auto"
                    maxLength={40}
                    placeholder={t("auth.displayNamePlaceholder")}
                  />
                </label>
              ) : null}

              <label className="block space-y-1">
                <span className="label text-ink-2">{t("auth.password")}</span>
                <input
                  className={inputClass}
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete={mode === "register" ? "new-password" : "current-password"}
                  dir="ltr"
                  maxLength={72}
                  placeholder={t("auth.passwordPlaceholder")}
                  required
                />
              </label>

              {mode === "register" ? (
                <p className="px-1 text-[11px] leading-relaxed text-ink-3">{t("auth.createHint")}</p>
              ) : null}

              {error ? (
                <p
                  className="rounded-card border border-danger px-3 py-2 text-xs font-bold text-danger"
                  role="alert"
                >
                  {t(error)}
                </p>
              ) : null}

              <Button type="submit" className="w-full" disabled={busy || isLoading}>
                {busy ? t("common.loading") : t(mode === "register" ? "auth.createAccount" : "auth.signIn")}
              </Button>
              <button
                type="button"
                className="inline-flex min-h-11 w-full items-center justify-center text-center label text-ink-3 transition-colors hover:text-volt"
                onClick={() => {
                  haptic("light");
                  setShowUsername(false);
                  setError(null);
                }}
              >
                {t("auth.backToEnter")}
              </button>
            </form>
          ) : (
            <div className="space-y-3">
              {error ? (
                <p
                  className="rounded-card border border-danger px-3 py-2 text-xs font-bold text-danger"
                  role="alert"
                >
                  {t(error)}
                </p>
              ) : null}

              <Button className="w-full" onClick={() => void enter()} disabled={busy || isLoading}>
                {busy || isLoading ? t("common.loading") : t("auth.enter")}
              </Button>

              {isTelegram() ? (
                <p className="px-2 text-center text-[11px] leading-relaxed text-ink-3">
                  {t("auth.telegramHint")}
                </p>
              ) : null}

              <button
                type="button"
                className="inline-flex min-h-11 w-full items-center justify-center text-center label text-ink-3 transition-colors hover:text-volt"
                onClick={() => {
                  haptic("light");
                  setShowUsername(true);
                  setError(null);
                }}
              >
                {t("auth.haveAccount")}
              </button>
            </div>
          )}
        </Card>

        <p
          className="rise-in mt-5 px-2 text-center text-[11px] leading-relaxed text-ink-3"
          style={{ animationDelay: "140ms" }}
        >
          {t("auth.legal")}
        </p>
      </main>
    </div>
  );
}
