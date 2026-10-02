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

export const EXTRA_COMPETITIONS: ExtraCompetition[] = [
  // Domestic leagues
  { slug: "eng.2", name: "EFL Championship", kind: "league" },
  { slug: "ned.1", name: "Dutch Eredivisie", kind: "league" },
  { slug: "por.1", name: "Portuguese Primeira Liga", kind: "league" },
  { slug: "tur.1", name: "Turkish Super Lig", kind: "league" },
  { slug: "sco.1", name: "Scottish Premiership", kind: "league" },
  { slug: "usa.1", name: "Major League Soccer", kind: "league" },
  { slug: "mex.1", name: "Mexican Liga BBVA MX", kind: "league" },
  { slug: "bra.1", name: "Brazilian Serie A", kind: "league" },
  { slug: "arg.1", name: "Argentine Liga Profesional", kind: "league" },
  { slug: "sau.1", name: "Saudi Pro League", kind: "league" },
  // Continental club cups — outside the catalog for now. (UEFA Super Cup,
  // UCL qualifying, UEFA Nations League, both World Cup qualifiers and the
  // FIFA Club World Cup were promoted into the sync; see COMPETITIONS.)
  { slug: "conmebol.libertadores", name: "CONMEBOL Libertadores", kind: "cup" },
  { slug: "conmebol.sudamericana", name: "CONMEBOL Sudamericana", kind: "cup" },
  { slug: "afc.champions", name: "AFC Champions League Elite", kind: "cup" },
  { slug: "afc.cup", name: "AFC Champions League Two", kind: "cup" },
  { slug: "concacaf.champions_cup", name: "CONCACAF Champions Cup", kind: "cup" },
];
