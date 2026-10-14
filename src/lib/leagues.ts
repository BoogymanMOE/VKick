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

/**
 * Whatever league-scoped identifier a value is — big-five alias ("PL") or an
 * ESPN slug ("ned.1") — return the slug to query the server with. Aliases
 * translate; slugs (and anything else) pass through unchanged. The league
 * tabs mix both values by design, so every screen that consumes them needs
 * exactly this coercion.
 */
export function slugForLeague(idOrSlug: string): string {
  return SLUG_BY_LEAGUE[idOrSlug as LeagueId] ?? idOrSlug;
}

const CUP_SLUGS = new Set([
  "uefa.champions",
  "uefa.europa",
  "uefa.europa.conf",
  "uefa.super_cup",
  "uefa.champions_qual",
  "eng.fa",
  "eng.league_cup",
  "esp.copa_del_rey",
  "ita.coppa_italia",
  "ger.dfb_pokal",
  "fra.coupe_de_france",
]);

export function isCup(slug: string): boolean {
  return CUP_SLUGS.has(slug);
}
