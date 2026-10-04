import { useEffect, useState } from "react";

/**
 * A clock that re-renders the caller on a fixed interval.
 *
 * Time-derived UI (a "locks in 0h 12m" countdown) only refreshes when the
 * component re-renders, and a window query that isn't polled never re-renders
 * on its own — so the countdown would sit frozen until an unrelated refetch.
 * Ticking here keeps it honest without polling the server: the data is static,
 * only the rendering of it ages.
 *
 * Default 30s: fine-grained enough that a minute-accuracy countdown never
 * looks stuck, cheap enough to run on a screen showing a handful of cards.
 */
export function useNow(intervalMs = 30_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), intervalMs);
    return () => window.clearInterval(id);
  }, [intervalMs]);
  return now;
}
