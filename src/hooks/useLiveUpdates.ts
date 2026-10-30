import { useEffect, useSyncExternalStore } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { getLiveLinkConnected, setLiveLinkConnected, subscribeLiveLink } from "../lib/liveLink";

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
    let source: EventSource | null = null;
    let retryTimer: number | null = null;
    let attempts = 0;
    let disposed = false;

    const scheduleRetry = () => {
      if (disposed) return;
      // 5s, 10s, 20s, 40s, then every minute. The browser retries a dropped
      // stream by itself; this is for the case it cannot recover — a proxy that
      // answers 204, a server that ended the stream — which leaves the app on
      // polling with no push path until the page is reloaded.
      const delay = Math.min(60_000, 5_000 * 2 ** attempts);
      attempts += 1;
      retryTimer = window.setTimeout(connect, delay);
    };

    function connect() {
      if (disposed) return;
      const es = new EventSource("/api/live");
      source = es;

      // The browser reconnects an EventSource on its own; these listeners only
      // report whether the push path is live right now, so a screen can say
      // when it is running on the polling backstop alone.
      es.onopen = () => {
        attempts = 0;
        setLiveLinkConnected(true);
      };
      es.onerror = () => {
        setLiveLinkConnected(false);
        if (es.readyState === EventSource.CLOSED) {
          es.close();
          if (source === es) source = null;
          scheduleRetry();
        }
      };

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
    }

    connect();

    return () => {
      disposed = true;
      if (retryTimer != null) window.clearTimeout(retryTimer);
      source?.close();
      // A remount opens a new stream; until that one reports open, treat the
      // link as down rather than claiming a connection nobody holds.
      setLiveLinkConnected(false);
    };
  }, [queryClient]);
}

/** True while the SSE stream is delivering; false when only polling is left. */
export function useLiveLinkConnected(): boolean {
  return useSyncExternalStore(subscribeLiveLink, getLiveLinkConnected, () => true);
}
