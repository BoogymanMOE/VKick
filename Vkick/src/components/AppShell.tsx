import { Suspense, useEffect } from "react";
import { Outlet, useLocation } from "react-router-dom";
import { initTelegram } from "../lib/telegram";
import { useI18n } from "../i18n/I18nProvider";
import { LanguageSync } from "./LanguageSync";
import { RowSkeleton } from "./Skeletons";
import { TabBar } from "./TabBar";

/**
 * Mobile-first shell: header + scrollable page + persistent bottom tabs.
 * Screens render their own <TopBar>, so the shell stays a layout concern only.
 *
 * The keyed wrapper replays the 180ms page-in on every route change, so main
 * navigation feels intentional (fade + small rise) rather than an abrupt swap.
 * It collapses to a hard cut under prefers-reduced-motion via the global rule.
 *
 * Lazy routes suspend here, around the Outlet, so the tab bar and skip link
 * stay put while a page chunk loads instead of flashing out of the tree.
 */
export function AppShell() {
  const { pathname } = useLocation();
  const { t } = useI18n();

  useEffect(() => {
    initTelegram();
  }, []);

  // Route change should start at the top, like a native app would.
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: "auto" });
  }, [pathname]);

  return (
    <div className="floodlight flex min-h-[100svh] flex-col">
      {/* Renders nothing; keeps the server's copy of the UI language in step so
          bot pushes match what the user reads. */}
      <LanguageSync />
      {/* Keyboard and screen-reader users reach the page, not the tab strip,
          first. Hidden until focused. */}
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:absolute focus:left-3 focus:top-3 focus:z-50 focus:rounded-card focus:border focus:border-volt focus:bg-base focus:px-3 focus:py-2 focus:text-xs focus:font-bold focus:text-ink"
      >
        {t("common.skipToContent")}
      </a>
      {/* key={pathname} remounts the wrapper per route, replaying the animation. */}
      <main
        id="main-content"
        tabIndex={-1}
        key={pathname}
        className="page-in mx-auto w-full max-w-[560px] flex-1 px-3 pb-6 outline-none"
      >
        <Suspense
          fallback={
            <div className="mt-4" aria-busy="true">
              <RowSkeleton rows={5} />
            </div>
          }
        >
          <Outlet />
        </Suspense>
      </main>
      <TabBar />
    </div>
  );
}
