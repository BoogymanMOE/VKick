/**
 * The Browse catalog: the synced COMPETITIONS list followed by the browse-only
 * EXTRA_COMPETITIONS, each marked `comingSoon`.
 *
 * Lives in a pure module (no express, no db) so the invariant that broke
 * once is testable: a slug the sync has promoted must appear exactly once. It
 * did not — `ned.1`, `por.1`, `tur.1` and `sco.1` were left in
 * EXTRA_COMPETITIONS after promotion, so Browse rendered each twice (once
 * "live scores", once "not in your feed yet") under a duplicate React key.
 *
 * Dedupe is defensive: `extra.ts` is the source of truth and a promoted slug
 * must be deleted there, but the catalog must never emit duplicates even if
 * that edit is forgotten.
 */
import { COMPETITIONS, isCup, type LeagueSlug } from "./types.js";
import { EXTRA_COMPETITIONS } from "./extra.js";

export type CompetitionKind = "league" | "cup" | "tournament";

export interface CatalogEntry {
  slug: LeagueSlug | string;
  name: string;
  kind: CompetitionKind;
  /** True when the competition owns a league table (never for a cup). */
  hasTable: boolean;
  /** True for ESPN competitions the sync does not poll yet. */
  comingSoon: boolean;
}

export function competitionCatalog(): CatalogEntry[] {
  const seen = new Set<string>();
  const entries: CatalogEntry[] = [
    ...COMPETITIONS.map((c) => ({
      slug: c.slug,
      name: c.name,
      kind: c.kind,
      hasTable: !isCup(c.slug),
      comingSoon: false,
    })),
    ...EXTRA_COMPETITIONS.map((c) => ({
      slug: c.slug,
      name: c.name,
      kind: c.kind,
      hasTable: false,
      comingSoon: true,
    })),
  ];
  return entries.filter((entry) => {
    if (seen.has(entry.slug)) return false;
    seen.add(entry.slug);
    return true;
  });
}
