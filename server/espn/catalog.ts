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

export function competitionCatalog(): CatalogEntry[] {
  return COMPETITIONS.map((c) => ({
    slug: c.slug,
    name: c.name,
    kind: c.kind,
    hasTable: !isCup(c.slug),
    comingSoon: false,
  }));
}
