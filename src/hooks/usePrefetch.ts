import { useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api";

/**
 * Press-time prefetch: call on pointerdown/finger-down so match detail data is
 * already in flight while the finger is still travelling — by the time the
 * route renders, the cache is usually warm and no skeleton shows.
 *
 * `fetchQuery` dedupes, so double-fires (pointerdown → click) and taps on
 * already-cached matches are free. Timeline/comments/players share the match
 * id and are picked up by their tabs the moment they mount.
 */
export function usePrefetchMatch() {
  const queryClient = useQueryClient();
  return useCallback(
    (matchId: string) => {
      if (!matchId) return;
      void queryClient.prefetchQuery({
        queryKey: ["match", matchId],
        queryFn: () => api.getMatch(matchId),
        staleTime: 30_000,
      });
      void queryClient.prefetchQuery({
        queryKey: ["timeline", matchId],
        queryFn: () => api.getTimeline(matchId),
        staleTime: 30_000,
      });
      void queryClient.prefetchQuery({
        queryKey: ["comments", matchId],
        queryFn: () => api.getComments(matchId),
        staleTime: 30_000,
      });
    },
    [queryClient],
  );
}
