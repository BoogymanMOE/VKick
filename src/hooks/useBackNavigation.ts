import { useEffect } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { telegram } from "../lib/telegram";

/** The tab roots — the back button hides here; Telegram's default close takes over. */
const ROOTS = new Set(["/matches", "/leaderboards", "/browse", "/table", "/profile"]);

/**
 * Telegram's Android back button. Without it, pressing back on a detail page
 * closed the mini app outright — the classic Android Telegram complaint — and
 * there was no way back from a deep link at all.
 *
 * Behavior:
 * - on any non-root route, the Telegram back button shows and pops history
 * - on tab roots, it hides; Telegram's default close-on-back takes over
 * - outside Telegram, this is a no-op (the browser bar already works)
 */
export function useBackNavigation() {
  const navigate = useNavigate();
  const { pathname } = useLocation();

  useEffect(() => {
    const app = telegram();
    if (!app?.BackButton) return;

    const bb = app.BackButton;
    if (ROOTS.has(pathname)) {
      bb.hide();
      return;
    }

    bb.show();
    const onBack = () => navigate(-1);
    bb.onClick(onBack);
    return () => {
      bb.offClick(onBack);
    };
  }, [pathname, navigate]);
}
