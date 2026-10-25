import { Suspense, useEffect, useRef, useLayoutEffect } from "react";
import { Outlet, useLocation } from "react-router-dom";
import { initTelegram } from "../lib/telegram";
import { useBackNavigation } from "../hooks/useBackNavigation";
import { useI18n } from "../i18n/context";
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

  // Measure the bottom tab bar height dynamically and set the CSS variable.
  const tabBarRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    // Measure synchronously on mount so --bottom-nav-h is set before first paint.
    if (tabBarRef.current) {
      const h = tabBarRef.current.offsetHeight;
      document.documentElement.style.setProperty('--bottom-nav-h', h + 'px');
    }
    if (!tabBarRef.current) return;
    const observer = new ResizeObserver((entries) => {
      const height = entries[0].borderBoxSize?.[0]?.blockSize ?? entries[0].contentRect.height;
      document.documentElement.style.setProperty('--bottom-nav-h', height + 'px');
    });
    observer.observe(tabBarRef.current);
    // Also listen for orientation / window resize changes.
    const handleResize = () => {
      if (tabBarRef.current) observer.observe(tabBarRef.current);
    };
    window.addEventListener('resize', handleResize);
    window.addEventListener('orientationchange', handleResize);
    return () => {
      window.removeEventListener('resize', handleResize);
      window.removeEventListener('orientationchange', handleResize);
      observer.disconnect();
    };
  }, [tabBarRef]);

  // Android's hardware back inside Telegram: pop in-app history on detail
  // routes instead of closing the mini app.
  useBackNavigation();

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
      {/* key={pathname} remounts the wrapper per route, replaying the animation.
          The bottom padding reserves space for the sticky TabBar (~56px); the ad
          is inline now, so the last match card / league row only has to clear
          the tab bar itself. */}
      <main
        id="main-content"
        tabIndex={-1}
        key={pathname}
        className="page-in mx-auto w-full max-w-[var(--app-max-width,768px)] flex-1 px-[var(--space-page-x,16px)] outline-none"
        // The sticky tab bar height is measured dynamically via ResizeObserver
        // and set as --bottom-nav-h on the root element.
        style={{
          paddingBottom: "calc(var(--bottom-nav-h, 60px) + 16px)",
        }}
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
      <TabBar ref={tabBarRef} />
    </div>
  );
}
