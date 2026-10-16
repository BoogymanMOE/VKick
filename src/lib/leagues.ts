/**
 * The big-five slug ↔ LeagueId maps, on their own so pure modules (the club
 * picker's grouping) and node-run tests can use them without pulling in React
 * or the query client through `hooks/useApi`.
 *
 * `hooks/useApi` re-exports these as its public surface, so existing imports
 * keep working; this module is the source of truth.
 */
import type { LeagueId } from "../types";

/** ESPN slug -> the app's LeagueId. Only the big five. */
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

/**
 * Whatever league-scoped identifier a value is — big-five alias ("PL") or an
 * ESPN slug — return the slug to query the server with. Aliases translate;
 * slugs pass through unchanged.
 */
export function slugForLeague(idOrSlug: string): string {
  return SLUG_BY_LEAGUE[idOrSlug as LeagueId] ?? idOrSlug;
}

/** Cups are removed — top-5 leagues only. */
export function isCup(_slug: string): boolean {
  return false;
}
