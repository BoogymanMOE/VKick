/**
 * Extra ESPN competitions shown on the Browse screen as "coming soon".
 *
 * These slugs were verified live against site.api.espn.com (scoreboard returns
 * 200) but are NOT synced by server/sync — the catalog currently covers the big
 * five, their cups, the UEFA club competitions and international tournaments
 * (see `COMPETITIONS` / `LEAGUES_ALL` in ./types.ts). Until the sync learns
 * these, they exist so the browse list reflects what ESPN actually serves;
 * adding one to the sync later is a slug + label change, nothing else.
 *
 * The labels are seeded into the competitions table, but the sync must not be
 * pointed at these via LEAGUES_ALL without a matching `pollWindow` entry: the
 * 6-hourly sweep costs one request per competition per day of its window, and
 * the unofficial API rate-limits aggressively.
 *
 * Anything listed here AND in COMPETITIONS would render twice on Browse, so
 * promoting a competition means deleting it from this file.
 */
export interface ExtraCompetition {
  slug: string;
  name: string;
  kind: "league" | "cup" | "tournament";
}

/** Trimmed to the top-5 European leagues only. */
export const EXTRA_COMPETITIONS: ExtraCompetition[] = [];
