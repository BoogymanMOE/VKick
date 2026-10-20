/**
 * FLIP animation plumbing for the feed→detail score handoff
 * (First-Last-Invert-Play, Web Animations API — no library).
 *
 * MatchCard records the First rect of its score block on the tap; MatchDetail
 * finds the Last rect once the hero has rendered, then plays the inversion so
 * the score visually grows out of the card the user just tapped.
 *
 * The store is a module-level Map keyed by intent ("match-score"): one
 * navigation in flight at a time, and `getFlipFirst` consumes the rect so a
 * re-render can never replay it.
 */

const flipStore = new Map<string, DOMRect>();

/** Call before navigation: remembers where the element was on the OLD page. */
export function recordFlipFirst(key: string, el: HTMLElement): void {
  flipStore.set(key, el.getBoundingClientRect());
}

/** Reads and clears the recorded First rect — one read is one play. */
export function getFlipFirst(key: string): DOMRect | undefined {
  const rect = flipStore.get(key);
  flipStore.delete(key);
  return rect;
}

/**
 * The Web Animations API does NOT resolve CSS custom properties — an `easing:
 * "var(--ease-out)"` throws "not a valid value for easing". So the design
 * system's curve is read concretely from :root, with the same value inline as
 * the fallback for contexts without stylesheets.
 */
function easeOut(): string {
  const token = getComputedStyle(document.documentElement).getPropertyValue("--ease-out").trim();
  return token || "cubic-bezier(0.22, 1, 0.36, 1)";
}

/**
 * Plays the inversion on the destination element: it starts at the First
 * rect's position/scale and settles into its own natural place.
 * Callers gate on prefers-reduced-motion before invoking.
 */
export function flipIntoPlace(
  el: HTMLElement,
  first: DOMRect,
  { duration = 300 } = {},
): void {
  const last = el.getBoundingClientRect();
  const dx = first.left - last.left;
  const dy = first.top - last.top;
  const sx = first.width / Math.max(1, last.width);
  const sy = first.height / Math.max(1, last.height);
  el.animate(
    [
      {
        transform: `translate(${dx}px, ${dy}px) scale(${sx}, ${sy})`,
        opacity: 0.5,
      },
      { transform: "none", opacity: 1 },
    ],
    {
      duration,
      easing: easeOut(),
      fill: "both",
    },
  );
}
