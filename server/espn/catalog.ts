/**
 * The Browse catalog: the 5 big-five leagues, each with its display name.
 * No cups, no internationals, no extra competitions.
 */
import { COMPETITIONS, isCup, type LeagueSlug } from "./types.js";

export type CompetitionKind = "league" | "cup" | "tournament";

export interface CatalogEntry {
  slug: LeagueSlug;
  name: string;
  kind: CompetitionKind;
  /** True when the competition owns a league table (always true for leagues). */
  hasTable: boolean;
  /** True for ESPN competitions the sync does not poll yet. Always false now. */
  comingSoon: boolean;
}

/**
 * The only leagues the API serves. The catalog was trimmed to these five, so
 * anything else still sitting in the DB (older, wider syncs) is treated as
 * unsupported: routes filter it out or 404 instead of serving it.
 */
export const LEAGUE_ALLOWLIST: ReadonlySet<string> = new Set(["eng.1", "esp.1", "ger.1", "ita.1", "fra.1"]);

export function isAllowedLeague(slug: string): boolean {
  return LEAGUE_ALLOWLIST.has(slug);
}

export function competitionCatalog(): CatalogEntry[] {
  return COMPETITIONS.map((c) => ({
    slug: c.slug,
    name: c.name,
    kind: c.kind,
    hasTable: !isCup(c.slug),
    comingSoon: false,
  }));
}
