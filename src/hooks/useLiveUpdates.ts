import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";

/**
 * Query families that are keyed by a match id, in the same order their keys are
 * declared by the screens that own them. An SSE update about one match has to
 * refresh every one of them — a goal that moves the scoreboard but leaves the
 * timeline, the shot plot and the lineup panel on their old payload is exactly
 * the "the timeline is out of sync" complaint this hook exists to answer.
 */
const MATCH_SCOPED_KEYS = [
  "match",
  "timeline",

  "matchPlayers",
  "ratings",
  "lineups",
  "predictions",
] as const;

/**
 * Server-sent live updates. The sync's live pulse and summary pass broadcast a
 * goal the moment ESPN reports it, which lands here first — polling is the
 * backstop, this is the instant path. Refreshing the match's whole query family
 * (not just the header) is what keeps the feed, the score and the timeline
 * moving together.
 */
export function useLiveUpdates() {
  const queryClient = useQueryClient();

  useEffect(() => {
    const es = new EventSource("/api/live");

    es.addEventListener("update", (event) => {
      try {
        const data = JSON.parse((event as MessageEvent).data) as {
          matchId?: string;
          type?: string;
        };
        if (data.matchId) {
          // The matchday feed and the club screens ride along: a goal changes
          // the card's score too, and they carry no match id of their own.
          queryClient.invalidateQueries({ queryKey: ["matches"] });
          for (const key of MATCH_SCOPED_KEYS) {
            queryClient.invalidateQueries({ queryKey: [key, data.matchId] });
          }
        }
      } catch {
        // ignore malformed events
      }
    });

    return () => {
      es.close();
    };
  }, [queryClient]);
}
