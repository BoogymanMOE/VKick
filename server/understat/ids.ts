/**
 * Every Understat→local identifier mapping lives here.
 *
 * Understat identifies clubs by its own titles ("Borussia M.Gladbach") and
 * slug forms ("Borussia_M.Gladbach"), while the local `teams` table uses
 * ESPN's abbreviations ("BMG"). Renames, promotions and ESPN abbreviation
 * changes have bit us repeatedly, so this table is maintained by hand against
 * the CURRENT season and verified by `npm run verify` — when a club's title
 * or abbreviation changes, this is the file that changes.
 */

/** Local ESPN abbreviation -> Understat's title, slug-underscored. */
export const TEAM_SLUGS: Record<string, string> = {
  // Premier League
  ARS: "Arsenal",
  AVL: "Aston_Villa",
  BHA: "Brighton",
  BOU: "Bournemouth",
  BRE: "Brentford",
  CHE: "Chelsea",
  COV: "Coventry",
  CRY: "Crystal_Palace",
  EVE: "Everton",
  FUL: "Fulham",
  HUL: "Hull",
  IPS: "Ipswich",
  LEE: "Leeds",
  LIV: "Liverpool",
  MAN: "Manchester_United",
  MNC: "Manchester_City",
  NEW: "Newcastle_United",
  NFO: "Nottingham_Forest",
  SUN: "Sunderland",
  TOT: "Tottenham",

  // La Liga
  ALA: "Alaves",
  ATM: "Atletico_Madrid",
  ATH: "Athletic_Club",
  BAR: "Barcelona",
  BET: "Real_Betis",
  CEL: "Celta_Vigo",
  DEP: "Deportivo_La_Coruna",
  ELC: "Elche",
  ESP: "Espanyol",
  GET: "Getafe",
  LEV: "Levante",
  MCF: "Malaga",
  OSA: "Osasuna",
  RAC: "Racing_Santander",
  RAY: "Rayo_Vallecano",
  RMA: "Real_Madrid",
  RSO: "Real_Sociedad",
  SEV: "Sevilla",
  VAL: "Valencia",
  VIL: "Villarreal",

  // Serie A
  ATA: "Atalanta",
  BOL: "Bologna",
  CAG: "Cagliari",
  COMO: "Como",
  FIO: "Fiorentina",
  FRO: "Frosinone",
  GEN: "Genoa",
  INT: "Inter",
  JUV: "Juventus",
  LAZ: "Lazio",
  LEC: "Lecce",
  MIL: "AC_Milan",
  MON: "Monza",
  NAP: "Napoli",
  PAR: "Parma_Calcio_1913",
  ROMA: "Roma",
  SAS: "Sassuolo",
  TOR: "Torino",
  UDI: "Udinese",
  VEN: "Venezia",

  // Bundesliga
  B04: "Bayer_Leverkusen",
  BMG: "Borussia_M.Gladbach",
  DOR: "Borussia_Dortmund",
  ELV: "Elversberg",
  FCA: "Augsburg",
  FCU: "Union_Berlin",
  HSV: "Hamburger_SV",
  KOE: "FC_Cologne",
  M05: "Mainz_05",
  MUN: "Bayern_Munich",
  RBL: "RasenBallsport_Leipzig",
  S04: "Schalke_04",
  SCF: "Freiburg",
  SCP: "Paderborn",
  SGE: "Eintracht_Frankfurt",
  SVW: "Werder_Bremen",
  TSG: "Hoffenheim",
  VFB: "VfB_Stuttgart",

  // Ligue 1
  ANG: "Angers",
  AUX: "Auxerre",
  HAC: "Le_Havre",
  LILL: "Lille",
  LOR: "Lorient",
  LYON: "Lyon",
  MNS: "Le_Mans",
  NICE: "Nice",
  OLM: "Marseille",
  RCL: "Lens",
  REN: "Rennes",
  STR: "Strasbourg",
  TOU: "Toulouse",
  TRY: "Troyes",
};

export const LEAGUE_SLUGS: Record<string, string> = {
  "eng.1": "EPL",
  "esp.1": "La_liga",
  "ita.1": "Serie_A",
  "ger.1": "Bundesliga",
  "fra.1": "Ligue_1",
};

/**
 * A few abbreviations collide across leagues ("BRE" is Brentford in the
 * Premier League and Brest in Ligue 1, "PAR" is Parma and Paris FC), and
 * Understat titles are league-independent in both lookups:
 *
 * - the league-wide walk goes title -> abbreviation and scopes its teams to
 *   one league, so the correct club wins there — but the table below must
 *   still offer BOTH titles or one side never matches;
 * - the per-club walk goes local abbreviation -> Understat slug and knows the
 *   league, so THESE overrides decide which title a colliding abbreviation
 *   means in that direction.
 *
 * A league here REPLACES the base entry for its clubs; every other club falls
 * through to TEAM_SLUGS.
 */
export const TEAM_SLUGS_BY_LEAGUE: Record<string, Record<string, string>> = {
  "fra.1": {
    BRE: "Brest",
    MON: "Monaco", // ESPN renamed Monaco ASM->MON, colliding with Monza
    PAR: "Paris_FC",
    PSG: "Paris_Saint_Germain",
  },
};

/** The Understat team-title slug for a local abbreviation in one league. */
export function understatSlugFor(abbr: string, league: string): string | undefined {
  return TEAM_SLUGS_BY_LEAGUE[league]?.[abbr] ?? TEAM_SLUGS[abbr];
}

/**
 * The inverse of the slug tables: an Understat team title -> ESPN abbreviation.
 *
 * A league payload keys its table by Understat's own title ("Manchester_City"),
 * while everything we store is keyed by a local id, so a league-wide walk
 * (expected points) has to cross back through the abbreviation. Built from the
 * tables above rather than a second hand-maintained list, so they can't drift
 * apart. Colliding abbreviations appear twice (once per league); the league
 * matcher scopes its team list to one league before joining, so only the right
 * side can win.
 */
export const ABBR_BY_SLUG: Record<string, string> = Object.fromEntries(
  Object.entries(TEAM_SLUGS)
    .concat(Object.values(TEAM_SLUGS_BY_LEAGUE).flatMap((m) => Object.entries(m)))
    .map(([abbr, slug]) => [slug, abbr]),
);
