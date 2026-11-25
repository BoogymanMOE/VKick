/**
 * The Browse catalog: the big-five leagues plus the two UEFA club cups (the
 * Champions League and Europa League), each with its display name. No
 * internationals, no browse-only extras.
 */
import { COMPETITIONS, CUPS, LEAGUES, isCup } from "./types.js";

export type CompetitionKind = "league" | "cup" | "tournament";

export interface CatalogEntry {
  /** Big-five slugs for the synced leagues; any slug the DB carries for cups. */
  slug: string;
  name: string;
  kind: CompetitionKind;
  /** True when the competition owns a league table (always true for leagues). */
  hasTable: boolean;
  /** True for ESPN competitions the sync does not poll yet. Always false now. */
  comingSoon: boolean;
}

/**
 * The only competitions the API serves: the big five and the two UEFA club
 * cups. Anything else still sitting in the DB (older, wider syncs) is treated
 * as unsupported: routes filter it out or 404 instead of serving it.
 */
export const LEAGUE_ALLOWLIST: ReadonlySet<string> = new Set<string>([...LEAGUES, ...CUPS]);

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
