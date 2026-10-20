import React from "react";
import ReactDOM from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { HashRouter } from "react-router-dom";
import App from "./App";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { ToastProvider } from "./components/Toast";
import { I18nProvider } from "./i18n/I18nProvider";
import { initTelegram } from "./lib/telegram";
import { applyTelegramUrlNormalization } from "./lib/telegramUrl";
import { installErrorReporting } from "./lib/errorReporting";
import "./index.css";

// Attach window `error` / `unhandledrejection` listeners before anything else
// can throw, so a crash during boot is reported too. The ErrorBoundary inside
// mount() covers render errors separately.
installErrorReporting();

// Telegram header/theme paint + ready() as early as possible (AppShell repeats
// this harmlessly for hot reloads). The SDK script is loaded before the bundle.
try {
  initTelegram();
} catch {
  /* non-Telegram browser: no-op */
}

// The index.html boot splash lives INSIDE #root now, so React's very first
// render replaces it — no hand-over animation or manual removal needed, and
// a dead splash node can never intercept pointer events again.

// The one and only cache. (A second client used to exist in App.tsx, nested
// inside this provider, so it silently won — the two disagreed on
// refetchOnWindowFocus and retry. Keep the config here.)
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: 1,
      // A Mini App is backgrounded constantly; refetching the live match when
      // the user returns is the behaviour we want.
      refetchOnWindowFocus: true,
    },
  },
});

/**
 * Mount only once the Telegram SDK has settled — loaded, failed, or hit the
 * 1.5s deadline set in index.html. AuthProvider reads initData on its first
 * render, so mounting first would silently downgrade a Telegram user to a
 * guest account; the deadline is what stops an unreachable telegram.org
 * (Iran, where this app ships) from holding the boot splash hostage while the
 * parser waits out a blackholed connection. The timer below is insurance in
 * case the inline script in index.html ever fails to run at all.
 */
let mounted = false;
function mount() {
  if (mounted) return;
  mounted = true;
  // Normalise the launch URL FIRST, before HashRouter reads it. Telegram
  // appends init data to the URL (hash canonically, sometimes the path); an
  // un-normalised hash makes HashRouter treat `tgWebAppData=...` as a route
  // and render the 404 screen. This runs only after the SDK settled, so
  // telegram-web-app.js has already parsed and stored the init data.
  applyTelegramUrlNormalization();
  // The module-level call above ran at parse time, which may predate the SDK
  // settling; repeat it so header colour and ready() see a present SDK.
  try {
    initTelegram();
  } catch {
    /* non-Telegram browser: no-op */
  }

  ReactDOM.createRoot(document.getElementById("root")!).render(
    <React.StrictMode>
      {/* Outermost: a render crash anywhere lands on the retry card, not a
          white screen. */}
      <ErrorBoundary>
        <QueryClientProvider client={queryClient}>
          {/* HashRouter: works unchanged inside Telegram's webview and on static hosts
              without needing a server-side rewrite rule. */}
          <HashRouter>
            <I18nProvider>
              <ToastProvider>
                <App />
              </ToastProvider>
            </I18nProvider>
          </HashRouter>
        </QueryClientProvider>
      </ErrorBoundary>
    </React.StrictMode>,
  );
}

if (window.__tgSdkSettled) {
  mount();
} else {
  window.addEventListener("tg-sdk-settled", mount, { once: true });
  setTimeout(mount, 2500);
}
