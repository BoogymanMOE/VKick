/**
 * The big-five slug ↔ LeagueId maps, on their own so pure modules (the club
 * picker's grouping) and node-run tests can use them without pulling in React
 * or the query client through `hooks/useApi`.
 *
 * `hooks/useApi` re-exports these as its public surface, so existing imports
 * keep working; this module is the source of truth.
 */
import type { LeagueId } from "../types";
import type { Lang } from "../i18n/strings";

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

/** Human-readable competition name for any slug, in either language. */
export const COMPETITION_NAMES: Record<string, { en: string; fa: string; de: string }> = {
  "uefa.champions": { en: "Champions League", fa: "لیگ قهرمانان اروپا", de: "Champions League" },
  "uefa.europa": { en: "Europa League", fa: "لیگ اروپا", de: "Europa League" },
  "uefa.europa.conf": { en: "Conference League", fa: "لیگ کنفرانس اروپا", de: "Conference League" },
  "eng.fa": { en: "FA Cup", fa: "جام حذفی انگلیس", de: "FA Cup" },
  "eng.league_cup": { en: "EFL Cup", fa: "جام اتحادیه انگلیس", de: "EFL Cup" },
  "esp.copa_del_rey": { en: "Copa del Rey", fa: "کوپا دل ری", de: "Copa del Rey" },
  "ger.dfb_pokal": { en: "DFB-Pokal", fa: "جام حذفی آلمان", de: "DFB-Pokal" },
  "ita.coppa_italia": { en: "Coppa Italia", fa: "کوپا ایتالیا", de: "Coppa Italia" },
  "fra.coupe_de_france": { en: "Coupe de France", fa: "جام حذفی فرانسه", de: "Coupe de France" },
  "ned.1": { en: "Eredivisie", fa: "اردیویزی", de: "Eredivisie" },
  "tur.1": { en: "Süper Lig", fa: "سوपरلیگ ترکیه", de: "1. Bundesliga" },
  "por.1": { en: "Primeira Liga", fa: "لیگ برتر پرتغال", de: "Bundesliga" },
  "gre.1": { en: "Super League Greece", fa: "سوپر لیگ یونان", de: "Serie A" },
  "sco.1": { en: "Scottish Premiership", fa: "لیگ برتر اسکاتلند", de: "Schottischer Premier League" },
  "bel.1": { en: "Belgian Pro League", fa: "لیگ برتر بلژیک", de: "Pro League Belgien" },
};


/** Last resort for unknown slugs: never show the raw code. */
export function humanizeSlug(slug: string): string {
  // An empty slug, or one with no dots, never becomes the raw code.
  if (!slug) return "—";
  const parts = slug.split(".").slice(1);
  if (parts.length === 0) return slug.replace(/\b\w/g, (c) => c.toUpperCase());
  const joined = parts.join(" ").replace(/[_-]+/g, " ").trim();
  return joined ? joined.replace(/\b\w/g, (c) => c.toUpperCase()) : slug;
}

export function competitionName(slug: string | null | undefined, lang: Lang): string {
  if (!slug) return "—";
  return COMPETITION_NAMES[slug]?.[lang] ?? humanizeSlug(slug);
}
