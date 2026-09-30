import React from "react";
import ReactDOM from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { HashRouter } from "react-router-dom";
import App from "./App";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { ToastProvider } from "./components/Toast";
import { I18nProvider } from "./i18n/I18nProvider";
import { initTelegram } from "./lib/telegram";
import "./index.css";

// Telegram header/theme paint + ready() as early as possible (AppShell repeats
// this harmlessly for hot reloads). The SDK script is loaded before the bundle.
try {
  initTelegram();
} catch {
  /* non-Telegram browser: no-op */
}

// Fade out the index.html boot splash once React owns the screen. The class is
// on <html> so the transition lives entirely in the head style; the node is
// removed after the fade so it can never intercept pointer events.
requestAnimationFrame(() => {
  document.documentElement.classList.add("boot-done");
  setTimeout(() => document.getElementById("boot")?.remove(), 350);
});

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
