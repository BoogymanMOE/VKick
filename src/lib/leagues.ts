/**
 * The big-five slug ↔ LeagueId maps, on their own so pure modules (the club
 * picker's grouping) and node-run tests can use them without pulling in React
 * or the query client through `hooks/useApi`.
 *
 * `hooks/useApi` re-exports these as its public surface, so existing imports
 * keep working; this module is the source of truth.
 */
import type { LeagueId } from "../types";

/** ESPN slug -> the app's LeagueId. Cups have no LeagueId (big five only). */
export const LEAGUE_BY_SLUG: Record<string, LeagueId> = {
  "eng.1": "PL",
  "esp.1": "LL",
  "ita.1": "SA",
  "ger.1": "BL",
  "fra.1": "L1",
};

export const SLUG_BY_LEAGUE: Record<LeagueId, string> = {
  PL: "eng.1",
  LL: "esp.1",
  SA: "ita.1",
  BL: "ger.1",
  L1: "fra.1",
};
