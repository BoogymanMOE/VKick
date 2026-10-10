/**
 * The Favorite Leagues picker's list algebra, on its own so it is testable
 * without React (tests/client.test.ts) — the same reason lib/pickerGroups.ts
 * exists for the club picker.
 *
 * Two rules live here, both easy to get subtly wrong in JSX:
 *  1. the segmented filter's kind mapping — "cups" means cups AND international
 *     tournaments (both are knockout competitions with no table), which is the
 *     grouping Browse already uses;
 *  2. followed competitions bubble to the top of their section, so the sheet
 *     opens on what the user already has instead of making them scroll the
 *     catalog to find and un-follow something.
 *
 * Catalog order is preserved inside each tier (Array.prototype.sort is stable),
 * and empty sections are dropped rather than rendered as a stray heading.
 */
import type { ApiCompetition } from "./api";

/** The sheet's segmented control values. */
export type LeagueKindFilter = "all" | "league" | "cup";

/** A section is addressed by the competition `kind` it holds. */
export type LeaguePickerSectionId = "league" | "cup" | "tournament";

export interface LeaguePickerSection {
  id: LeaguePickerSectionId;
  rows: ApiCompetition[];
}

const SECTION_ORDER: LeaguePickerSectionId[] = ["league", "cup", "tournament"];

/** The kinds a filter shows — "cup" also carries the international tournaments. */
export function leagueKindsForFilter(filter: LeagueKindFilter): Set<LeaguePickerSectionId> {
  if (filter === "league") return new Set<LeaguePickerSectionId>(["league"]);
  if (filter === "cup") return new Set<LeaguePickerSectionId>(["cup", "tournament"]);
  return new Set(SECTION_ORDER);
}

/**
 * The sheet's sections: only the kinds the filter wants, only the ones that
 * have rows, each with followed competitions first.
 */
export function leaguePickerSections(
  comps: ApiCompetition[],
  filter: LeagueKindFilter,
  followedSlugs: string[],
): LeaguePickerSection[] {
  const followed = new Set(followedSlugs);
  const wanted = leagueKindsForFilter(filter);
  return SECTION_ORDER.filter((id) => wanted.has(id))
    .map((id) => ({
      id,
      rows: comps
        .filter((comp) => comp.kind === id)
        // One stable sort: 0 for followed, 1 for not, so followed rows rise
        // without disturbing the catalog order inside either tier.
        .sort((a, b) => Number(!followed.has(a.slug)) - Number(!followed.has(b.slug))),
    }))
    .filter((section) => section.rows.length > 0);
}
