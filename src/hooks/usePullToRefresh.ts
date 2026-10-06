import { useEffect, useRef, useState } from "react";

/**
 * Pull down from the top of the feed to resync it.
 *
 * The feed is the app's front door and its users are checking live scores
 * one-handed on a phone, so the platform gesture has to work; the TopBar icon
 * stays as the keyboard/screen-reader equivalent and never goes away.
 *
 * Design notes:
 * - Listeners live on `window` with `touchmove` registered non-passive, so the
 *   browser's own overscroll is suppressed while the gesture is ours. Without
 *   that the feed rubber-bands and the indicator fights it.
 * - The gesture is only claimed when the feed is already at the top and no
 *   refresh is running; anywhere else the listeners stand down and normal
 *   scrolling is untouched.
 * - Distance is rubber-banded (x0.5) and capped, so a long drag feels resisted
 *   rather than tracking the finger 1:1.
 *
 * Lives in hooks/ so `components/PullToRefresh` exports only components — Fast
 * Refresh can't hot-patch a module that also exports a hook.
 */
export const THRESHOLD = 64;
const MAX_PULL = 96;

export function usePullToRefresh(onRefresh: () => void, enabled: boolean) {
  const [pull, setPull] = useState(0);
  const startY = useRef<number | null>(null);
  const distance = useRef(0);
  const latest = useRef(onRefresh);

  // Keep the callback current without resubscribing the listeners every render.
  useEffect(() => {
    latest.current = onRefresh;
  }, [onRefresh]);

  useEffect(() => {
    if (!enabled) return;

    const atTop = () => (document.scrollingElement?.scrollTop ?? 0) <= 0;

    const start = (event: TouchEvent) => {
      distance.current = 0;
      startY.current = atTop() ? (event.touches[0]?.clientY ?? null) : null;
    };

    const move = (event: TouchEvent) => {
      if (startY.current === null) return;
      const y = event.touches[0]?.clientY ?? 0;
      const delta = y - startY.current;
      if (delta <= 0 || !atTop()) {
        // Swiped up (or the feed scrolled): hand the gesture back to the page.
        startY.current = null;
        distance.current = 0;
        setPull(0);
        return;
      }
      if (event.cancelable) event.preventDefault();
      distance.current = Math.min(delta * 0.5, MAX_PULL);
      setPull(distance.current);
    };

    const end = () => {
      if (startY.current !== null && distance.current >= THRESHOLD) latest.current();
      startY.current = null;
      distance.current = 0;
      setPull(0);
    };

    window.addEventListener("touchstart", start, { passive: true });
    window.addEventListener("touchmove", move, { passive: false });
    window.addEventListener("touchend", end, { passive: true });
    window.addEventListener("touchcancel", end, { passive: true });
    return () => {
      window.removeEventListener("touchstart", start);
      window.removeEventListener("touchmove", move);
      window.removeEventListener("touchend", end);
      window.removeEventListener("touchcancel", end);
    };
  }, [enabled]);

  return pull;
}
