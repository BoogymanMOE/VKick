import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";

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
          queryClient.invalidateQueries({ queryKey: ["matches"] });
          queryClient.invalidateQueries({ queryKey: ["match", data.matchId] });
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
