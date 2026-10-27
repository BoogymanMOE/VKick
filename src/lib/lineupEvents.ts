import type { ApiTimelineEvent } from "./api";
import type { LineupPlayerEvents } from "../types";

/**
 * Server → view adapter for the lineup pitch: what each player actually did in
 * this match, keyed by player id (the pitch renders by id, and every timeline
 * event carries its participants' ids).
 *
 * Sits in lib rather than in `pages/MatchDetail` for the same reason
 * `adaptComments` does — a module that exports a page component should not also
 * export a plain helper (Fast Refresh cannot hot-patch those).
 *
 * An own goal is served as a plain `goal` naming the player who put it into his
 * own net. It must not earn him a scoring badge — the stat sheet does not credit
 * it to him either — so it is skipped, exactly as the timeline's own score line
 * treats it.
 */
export function buildPlayerEvents(events: ApiTimelineEvent[]): Record<string, LineupPlayerEvents> {
  const map: Record<string, LineupPlayerEvents> = {};
  const entry = (id: string): LineupPlayerEvents => (map[id] ??= { goals: 0, assists: 0 });
  // A red outranks a second yellow outranks a plain yellow: if the feed files
  // two rows for one player, the pitch shows the booking that matters.
  const rank = { yellow: 1, "second-yellow": 2, red: 3 } as const;

  for (const e of events) {
    const [first, second] = e.participants;
    if (!first) continue;
    if (e.type === "goal") {
      if (/own goal/i.test(e.description)) continue;
      entry(first.id).goals += 1;
      // ESPN names the assist as the second participant when there is one — a
      // solo goal or a penalty carries the scorer alone.
      if (second) entry(second.id).assists += 1;
    } else if (e.type === "substitution" && second) {
      // participants: [on, off].
      entry(first.id).subInMinute = e.minute_display;
      entry(second.id).subOutMinute = e.minute_display;
    } else if (e.type === "card") {
      // ESPN folds every sending-off into one `card` type; only the description
      // says which card it was (same reading the timeline uses).
      const kind = /second yellow/i.test(e.description)
        ? "second-yellow"
        : /\bred card\b/i.test(e.description)
          ? "red"
          : /yellow/i.test(e.description)
            ? "yellow"
            : null;
      if (!kind) continue;
      const row = entry(first.id);
      if (!row.card || rank[kind] > rank[row.card]) row.card = kind;
    }
  }
  return map;
}
