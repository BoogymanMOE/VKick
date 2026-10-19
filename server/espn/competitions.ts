/**
 * The Browse/Cups catalog as the API serves it: the synced big five PLUS any
 * cup or tournament that actually has a match in the database. The DB is the
 * source of truth for what exists — a competition with no fixture is noise on
 * the Cups strip, while one with fixtures and no catalog entry is invisible.
 *
 * Names are the English keys `src/i18n/names.ts` maps to Persian, so a cup the
 * client localizes never shows a raw slug. An unknown slug is humanized (never
 * printed as a dotted code) and defaults to `league`, because showing a league
 * on the Cups page is a worse mistake than hiding an unrecognised knockout.
 */
import { all, type DB } from "../db/index.js";
import { competitionCatalog, type CatalogEntry, type CompetitionKind } from "./catalog.js";

/** slug -> the English name `toFa` knows. */
const COMPETITION_NAMES: Record<string, string> = {
  "uefa.champions": "UEFA Champions League",
  "uefa.europa": "UEFA Europa League",
  "uefa.europa.conf": "UEFA Conference League",
  "uefa.champions_qual": "UEFA Champions League Qualifying",
  "uefa.super_cup": "UEFA Super Cup",
  "eng.fa": "English FA Cup",
  "eng.league_cup": "English Carabao Cup",
  "esp.copa_del_rey": "Spanish Copa del Rey",
  "ger.dfb_pokal": "German Cup",
  "ita.coppa_italia": "Coppa Italia",
  "fra.coupe_de_france": "Coupe de France",
  "fifa.world": "FIFA World Cup",
  "fifa.cwc": "FIFA Club World Cup",
  "fifa.worldq.uefa": "FIFA World Cup Qualifying — UEFA",
  "fifa.worldq.conmebol": "FIFA World Cup Qualifying — CONMEBOL",
  "uefa.euro": "UEFA European Championship",
  "uefa.euroq": "UEFA European Championship Qualifying",
  "uefa.nations": "UEFA Nations League",
  "caf.nations": "Africa Cup of Nations",
  "concacaf.gold": "CONCACAF Gold Cup",
  "conmebol.america": "Copa América",
  "ned.1": "Dutch Eredivisie",
  "por.1": "Portuguese Primeira Liga",
  "tur.1": "Turkish Super Lig",
  "sco.1": "Scottish Premiership",
};

/** Domestic cup slugs (knockout). */
const CUP_SLUGS = new Set([
  "uefa.champions",
  "uefa.europa",
  "uefa.europa.conf",
  "uefa.champions_qual",
  "uefa.super_cup",
  "eng.fa",
  "eng.league_cup",
  "esp.copa_del_rey",
  "ger.dfb_pokal",
  "ita.coppa_italia",
  "fra.coupe_de_france",
]);

/** National-team tournament slugs. */
const TOURNAMENT_SLUGS = new Set([
  "fifa.world",
  "fifa.cwc",
  "fifa.worldq.uefa",
  "fifa.worldq.conmebol",
  "uefa.euro",
  "uefa.euroq",
  "uefa.nations",
  "caf.nations",
  "concacaf.gold",
  "conmebol.america",
]);

export function kindForCompetition(slug: string): CompetitionKind {
  if (CUP_SLUGS.has(slug)) return "cup";
  if (TOURNAMENT_SLUGS.has(slug)) return "tournament";
  return "league";
}

/** English display name for a slug; humanized when unknown (never the raw code). */
export function competitionNameFor(slug: string): string {
  const known = COMPETITION_NAMES[slug];
  if (known) return known;
  const parts = slug.split(".").slice(1);
  const joined = (parts.length ? parts.join(" ") : slug)
    .replace(/[_-]+/g, " ")
    .trim();
  return joined ? joined.replace(/\b\w/g, (c) => c.toUpperCase()) : slug;
}

/**
 * The synced catalog plus every competition the database has a match for.
 * `competitionCatalog()` alone is deliberately big-five-only (pinned by
 * tests/competitions.test.ts); this is the API-facing view.
 */
export function competitionCatalogWithMatches(db: DB): CatalogEntry[] {
  const entries = competitionCatalog();
  const seen = new Set(entries.map((e) => e.slug));
  const extra = all<{ league: string }>(db, "SELECT DISTINCT league FROM matches ORDER BY league ASC");
  for (const row of extra) {
    if (seen.has(row.league)) continue;
    entries.push({
      slug: row.league,
      name: competitionNameFor(row.league),
      kind: kindForCompetition(row.league),
      hasTable: false,
      comingSoon: false,
    });
    seen.add(row.league);
  }
  return entries;
}
