/**
 * Static team seed — runs inside migrate() so a fresh Render deploy lands with
 * a populated teams table on first boot, before the ESPN sync loop has run.
 *
 * Scope: every club from the Top 5 European leagues only
 * (eng.1, esp.1, ger.1, ita.1, fra.1), each carrying its own slug so it groups
 * under its league tab. No rest-of-world clubs or national sides.
 *
 * Every row is copied from the verified ESPN sync data, cross-checked against
 * the bundled-asset manifests: every id resolves to a bundled crest in
 * src/data/logos.json or, when the crest was never bundled (France, Portugal,
 * …), carries its ESPN logo_url as a fallback; and every color matches
 * src/data/team-colors.json. This replaced an earlier hand-written list whose
 * ids had drifted, which showed the wrong crest/name for half the teams.
 *
 * Every row uses INSERT OR IGNORE, so a later ESPN sync upsert (see
 * server/sync/upserts.ts applyScoreboard/applySummary/applyRoster/applyStandings,
 * all of which upsertCoalesce on teams.id) can update names/logos/colors
 * without clobbering the seed. The seed is a floor, not a source of truth.
 */

import type { DatabaseSync } from "node:sqlite";
import { isBlockedTeam } from "./blockedTeams.js";

export interface SeedTeam {
  id: string;
  name: string;
  short_name: string | null;
  abbreviation: string | null;
  logo_url?: string | null;
  color: string | null;
  league: string;
}

/** Big-five clubs only (top-5 European leagues). */
export const SEED_TEAMS: SeedTeam[] = [
  // ---- Premier League (eng.1) ----
  {
    id: "349",
    name: "AFC Bournemouth",
    short_name: "Bournemouth",
    abbreviation: "BOU",
    color: "#F42727",
    league: "eng.1",
  },
  {
    id: "359",
    name: "Arsenal",
    short_name: "Arsenal",
    abbreviation: "ARS",
    color: "#E20520",
    league: "eng.1",
  },
  {
    id: "362",
    name: "Aston Villa",
    short_name: "Aston Villa",
    abbreviation: "AVL",
    color: "#660E36",
    league: "eng.1",
  },
  {
    id: "337",
    name: "Brentford",
    short_name: "Brentford",
    abbreviation: "BRE",
    color: "#F42727",
    league: "eng.1",
  },
  {
    id: "331",
    name: "Brighton & Hove Albion",
    short_name: "Brighton",
    abbreviation: "BHA",
    color: "#0606FA",
    league: "eng.1",
  },
  {
    id: "363",
    name: "Chelsea",
    short_name: "Chelsea",
    abbreviation: "CHE",
    color: "#144992",
    league: "eng.1",
  },
  {
    id: "388",
    name: "Coventry City",
    short_name: "Coventry",
    abbreviation: "COV",
    color: "#87CCED",
    league: "eng.1",
  },
  {
    id: "384",
    name: "Crystal Palace",
    short_name: "C Palace",
    abbreviation: "CRY",
    color: "#0202FB",
    league: "eng.1",
  },
  {
    id: "368",
    name: "Everton",
    short_name: "Everton",
    abbreviation: "EVE",
    color: "#0606FA",
    league: "eng.1",
  },
  { id: "370", name: "Fulham", short_name: "Fulham", abbreviation: "FUL", color: "#FFFFFF", league: "eng.1" },
  {
    id: "306",
    name: "Hull City",
    short_name: "Hull",
    abbreviation: "HUL",
    color: "#F28800",
    league: "eng.1",
  },
  {
    id: "373",
    name: "Ipswich Town",
    short_name: "Ipswich",
    abbreviation: "IPS",
    color: "#0000FA",
    league: "eng.1",
  },
  {
    id: "357",
    name: "Leeds United",
    short_name: "Leeds",
    abbreviation: "LEE",
    color: "#FFFFFF",
    league: "eng.1",
  },
  {
    id: "364",
    name: "Liverpool",
    short_name: "Liverpool",
    abbreviation: "LIV",
    color: "#D11317",
    league: "eng.1",
  },
  {
    id: "382",
    name: "Manchester City",
    short_name: "Man City",
    abbreviation: "MNC",
    color: "#99C5EA",
    league: "eng.1",
  },
  {
    id: "360",
    name: "Manchester United",
    short_name: "Man United",
    abbreviation: "MAN",
    color: "#DA020E",
    league: "eng.1",
  },
  {
    id: "361",
    name: "Newcastle United",
    short_name: "Newcastle",
    abbreviation: "NEW",
    color: "#0099CC",
    league: "eng.1",
  },
  {
    id: "393",
    name: "Nottingham Forest",
    short_name: "Nottm Forest",
    abbreviation: "NFO",
    color: "#C8102E",
    league: "eng.1",
  },
  {
    id: "366",
    name: "Sunderland",
    short_name: "Sunderland",
    abbreviation: "SUN",
    color: "#EB172B",
    league: "eng.1",
  },
  {
    id: "367",
    name: "Tottenham Hotspur",
    short_name: "Spurs",
    abbreviation: "TOT",
    color: "#FFFFFF",
    league: "eng.1",
  },

  // ---- La Liga (esp.1) ----
  { id: "96", name: "Alavés", short_name: "Alavés", abbreviation: "ALA", color: "#0000FF", league: "esp.1" },
  {
    id: "93",
    name: "Athletic Club",
    short_name: "Athletic",
    abbreviation: "ATH",
    color: "#C8142F",
    league: "esp.1",
  },
  {
    id: "1068",
    name: "Atlético Madrid",
    short_name: "Atlético",
    abbreviation: "ATM",
    color: "#CA3624",
    league: "esp.1",
  },
  {
    id: "83",
    name: "Barcelona",
    short_name: "Barcelona",
    abbreviation: "BAR",
    color: "#990000",
    league: "esp.1",
  },
  {
    id: "85",
    name: "Celta Vigo",
    short_name: "Celta Vigo",
    abbreviation: "CEL",
    color: "#6CACE4",
    league: "esp.1",
  },
  {
    id: "90",
    name: "Deportivo",
    short_name: "Deportivo",
    abbreviation: "DEP",
    color: "#3366CC",
    league: "esp.1",
  },
  { id: "3751", name: "Elche", short_name: "Elche", abbreviation: "ELC", color: "#288A00", league: "esp.1" },
  {
    id: "88",
    name: "Espanyol",
    short_name: "Espanyol",
    abbreviation: "ESP",
    color: "#3366CC",
    league: "esp.1",
  },
  {
    id: "2922",
    name: "Getafe",
    short_name: "Getafe",
    abbreviation: "GET",
    color: "#0000FF",
    league: "esp.1",
  },
  {
    id: "1538",
    name: "Levante",
    short_name: "Levante",
    abbreviation: "LEV",
    color: "#C8142F",
    league: "esp.1",
  },
  { id: "99", name: "Málaga", short_name: "Málaga", abbreviation: "MCF", color: "#B9E8F0", league: "esp.1" },
  {
    id: "97",
    name: "Osasuna",
    short_name: "Osasuna",
    abbreviation: "OSA",
    color: "#CD0000",
    league: "esp.1",
  },
  {
    id: "87",
    name: "Racing Santander",
    short_name: "Racing",
    abbreviation: "RAC",
    color: "#FFFFFF",
    league: "esp.1",
  },
  {
    id: "101",
    name: "Rayo Vallecano",
    short_name: "Rayo",
    abbreviation: "RAY",
    color: "#FFFFFF",
    league: "esp.1",
  },
  {
    id: "244",
    name: "Real Betis",
    short_name: "Betis",
    abbreviation: "BET",
    color: "#288A00",
    league: "esp.1",
  },
  {
    id: "86",
    name: "Real Madrid",
    short_name: "Real Madrid",
    abbreviation: "RMA",
    color: "#FFFFFF",
    league: "esp.1",
  },
  {
    id: "89",
    name: "Real Sociedad",
    short_name: "Real Sociedad",
    abbreviation: "RSO",
    color: "#3366CC",
    league: "esp.1",
  },
  {
    id: "243",
    name: "Sevilla",
    short_name: "Sevilla",
    abbreviation: "SEV",
    color: "#FFFFFF",
    league: "esp.1",
  },
  {
    id: "94",
    name: "Valencia",
    short_name: "Valencia",
    abbreviation: "VAL",
    color: "#FFFFFF",
    league: "esp.1",
  },
  {
    id: "102",
    name: "Villarreal",
    short_name: "Villarreal",
    abbreviation: "VIL",
    color: "#FFFF00",
    league: "esp.1",
  },

  // ---- Bundesliga (ger.1) ----
  {
    id: "598",
    name: "1. FC Union Berlin",
    short_name: "Union Berlin",
    abbreviation: "FCU",
    color: "#DA0308",
    league: "ger.1",
  },
  {
    id: "131",
    name: "Bayer Leverkusen",
    short_name: "Leverkusen",
    abbreviation: "B04",
    color: "#DA0308",
    league: "ger.1",
  },
  {
    id: "132",
    name: "Bayern Munich",
    short_name: "Bayern",
    abbreviation: "MUN",
    color: "#DC052D",
    league: "ger.1",
  },
  {
    id: "124",
    name: "Borussia Dortmund",
    short_name: "Dortmund",
    abbreviation: "DOR",
    color: "#FFEE00",
    league: "ger.1",
  },
  {
    id: "268",
    name: "Borussia Mönchengladbach",
    short_name: "Gladbach",
    abbreviation: "BMG",
    color: "#FFFFFF",
    league: "ger.1",
  },
  {
    id: "125",
    name: "Eintracht Frankfurt",
    short_name: "Frankfurt",
    abbreviation: "SGE",
    color: "#FFFFFF",
    league: "ger.1",
  },
  {
    id: "3841",
    name: "FC Augsburg",
    short_name: "Augsburg",
    abbreviation: "FCA",
    color: "#FFFFFF",
    league: "ger.1",
  },
  {
    id: "122",
    name: "FC Cologne",
    short_name: "Cologne",
    abbreviation: "KOE",
    color: "#FFFFFF",
    league: "ger.1",
  },
  {
    id: "127",
    name: "Hamburg SV",
    short_name: "Hamburg",
    abbreviation: "HSV",
    color: "#1A26AF",
    league: "ger.1",
  },
  { id: "2950", name: "Mainz", short_name: "Mainz", abbreviation: "M05", color: "#DA0308", league: "ger.1" },
  {
    id: "11420",
    name: "RB Leipzig",
    short_name: "RB Leipzig",
    abbreviation: "RBL",
    color: "#FFFFFF",
    league: "ger.1",
  },
  {
    id: "126",
    name: "SC Freiburg",
    short_name: "Freiburg",
    abbreviation: "SCF",
    color: "#DA0308",
    league: "ger.1",
  },
  {
    id: "3307",
    name: "SC Paderborn 07",
    short_name: "Paderborn",
    abbreviation: "SCP",
    color: "#0000DD",
    league: "ger.1",
  },
  {
    id: "10388",
    name: "SV Elversberg",
    short_name: "Elversberg",
    abbreviation: "ELV",
    color: "#FFFFFF",
    league: "ger.1",
  },
  {
    id: "133",
    name: "Schalke 04",
    short_name: "Schalke",
    abbreviation: "S04",
    color: "#0000DD",
    league: "ger.1",
  },
  {
    id: "7911",
    name: "TSG Hoffenheim",
    short_name: "Hoffenheim",
    abbreviation: "TSG",
    color: "#003399",
    league: "ger.1",
  },
  {
    id: "134",
    name: "VfB Stuttgart",
    short_name: "Stuttgart",
    abbreviation: "VFB",
    color: "#FFFFFF",
    league: "ger.1",
  },
  {
    id: "137",
    name: "Werder Bremen",
    short_name: "Bremen",
    abbreviation: "SVW",
    color: "#03915C",
    league: "ger.1",
  },

  // ---- Serie A (ita.1) ----
  {
    id: "103",
    name: "AC Milan",
    short_name: "Milan",
    abbreviation: "MIL",
    color: "#E4002B",
    league: "ita.1",
  },
  {
    id: "104",
    name: "AS Roma",
    short_name: "AS Roma",
    abbreviation: "ROMA",
    color: "#990A2C",
    league: "ita.1",
  },
  {
    id: "105",
    name: "Atalanta",
    short_name: "Atalanta",
    abbreviation: "ATA",
    color: "#1157BF",
    league: "ita.1",
  },
  {
    id: "107",
    name: "Bologna",
    short_name: "Bologna",
    abbreviation: "BOL",
    color: "#04043D",
    league: "ita.1",
  },
  {
    id: "2925",
    name: "Cagliari",
    short_name: "Cagliari",
    abbreviation: "CAG",
    color: "#282846",
    league: "ita.1",
  },
  { id: "2572", name: "Como", short_name: "Como", abbreviation: "COMO", color: "#4169E1", league: "ita.1" },
  {
    id: "109",
    name: "Fiorentina",
    short_name: "Fiorentina",
    abbreviation: "FIO",
    color: "#4C1D84",
    league: "ita.1",
  },
  {
    id: "4057",
    name: "Frosinone",
    short_name: "Frosinone",
    abbreviation: "FRO",
    color: "#FACF08",
    league: "ita.1",
  },
  { id: "3263", name: "Genoa", short_name: "Genoa", abbreviation: "GEN", color: "#08305D", league: "ita.1" },
  {
    id: "110",
    name: "Internazionale",
    short_name: "Inter Milan",
    abbreviation: "INT",
    color: "#00239C",
    league: "ita.1",
  },
  {
    id: "111",
    name: "Juventus",
    short_name: "Juventus",
    abbreviation: "JUV",
    color: "#000000",
    league: "ita.1",
  },
  { id: "112", name: "Lazio", short_name: "Lazio", abbreviation: "LAZ", color: "#74BDE7", league: "ita.1" },
  { id: "113", name: "Lecce", short_name: "Lecce", abbreviation: "LEC", color: "#FCED0B", league: "ita.1" },
  { id: "4007", name: "Monza", short_name: "Monza", abbreviation: "MON", color: "#C8142F", league: "ita.1" },
  { id: "114", name: "Napoli", short_name: "Napoli", abbreviation: "NAP", color: "#0677D2", league: "ita.1" },
  { id: "115", name: "Parma", short_name: "Parma", abbreviation: "PAR", color: "#19161D", league: "ita.1" },
  {
    id: "3997",
    name: "Sassuolo",
    short_name: "Sassuolo",
    abbreviation: "SAS",
    color: "#0FA653",
    league: "ita.1",
  },
  { id: "239", name: "Torino", short_name: "Torino", abbreviation: "TOR", color: "#9F0000", league: "ita.1" },
  {
    id: "118",
    name: "Udinese",
    short_name: "Udinese",
    abbreviation: "UDI",
    color: "#19161D",
    league: "ita.1",
  },
  {
    id: "17530",
    name: "Venezia",
    short_name: "Venezia",
    abbreviation: "VEN",
    color: "#887744",
    league: "ita.1",
  },

  // ---- Ligue 1 (fra.1) ----
  {
    id: "172",
    name: "AJ Auxerre",
    short_name: "Auxerre",
    abbreviation: "AUX",
    color: "#FFFFFF",
    league: "fra.1",
  },
  {
    id: "174",
    name: "AS Monaco",
    short_name: "Monaco",
    abbreviation: "MON",
    color: "#E91514",
    league: "fra.1",
  },
  {
    id: "7868",
    name: "Angers",
    short_name: "Angers",
    abbreviation: "ANG",
    color: "#1A1A1A",
    league: "fra.1",
  },
  { id: "6997", name: "Brest", short_name: "Brest", abbreviation: "BRE", color: "#EF2F24", league: "fra.1" },
  {
    id: "3236",
    name: "Le Havre AC",
    short_name: "Le Havre AC",
    abbreviation: "HAC",
    color: "#011F68",
    league: "fra.1",
  },
  {
    id: "2697",
    name: "Le Mans",
    short_name: "Le Mans",
    abbreviation: "MNS",
    color: "#D62B11",
    league: "fra.1",
  },
  { id: "175", name: "Lens", short_name: "Lens", abbreviation: "RCL", color: "#E91514", league: "fra.1" },
  { id: "166", name: "Lille", short_name: "Lille", abbreviation: "LILL", color: "#C2051B", league: "fra.1" },
  {
    id: "273",
    name: "Lorient",
    short_name: "Lorient",
    abbreviation: "LOR",
    color: "#F46100",
    league: "fra.1",
  },
  { id: "167", name: "Lyon", short_name: "Lyon", abbreviation: "LYON", color: "#FFFFFF", league: "fra.1" },
  {
    id: "176",
    name: "Marseille",
    short_name: "Marseille",
    abbreviation: "OLM",
    color: "#FFFFFF",
    league: "fra.1",
  },
  { id: "2502", name: "Nice", short_name: "Nice", abbreviation: "NICE", color: "#EF2F24", league: "fra.1" },
  {
    id: "6851",
    name: "Paris FC",
    short_name: "Paris FC",
    abbreviation: "PAR",
    color: "#000022",
    league: "fra.1",
  },
  {
    id: "160",
    name: "Paris Saint-Germain",
    short_name: "PSG",
    abbreviation: "PSG",
    color: "#011F68",
    league: "fra.1",
  },
  {
    id: "169",
    name: "Stade Rennais",
    short_name: "Rennes",
    abbreviation: "REN",
    color: "#EF2F24",
    league: "fra.1",
  },
  {
    id: "180",
    name: "Strasbourg",
    short_name: "Strasbourg",
    abbreviation: "STR",
    color: "#0000BF",
    league: "fra.1",
  },
  {
    id: "179",
    name: "Toulouse",
    short_name: "Toulouse",
    abbreviation: "TOU",
    color: "#560080",
    league: "fra.1",
  },
  { id: "170", name: "Troyes", short_name: "Troyes", abbreviation: "TRY", color: "#0000BF", league: "fra.1" },
];

/**
 * Seed the static team roster into the teams table. Safe to call on every
 * migrate() — INSERT OR IGNORE makes it idempotent, and a later ESPN sync
 * upsert can update these rows with live data.
 *
 * Returns the number of rows actually INSERTED this call (0 on a restart
 * against an already-seeded database, >0 the first time a row appears). The
 * caller logs it so a deploy's Render logs show definitively whether the seed
 * ran, and migrate() runs it on every boot — NOT only when the file is first
 * created — so a persistent-disk database that predates this logic still gets
 * the seed on the next deploy.
 */
export function seedTeams(db: DatabaseSync): number {
  console.log("[db] seeding teams...");
  const stmt = db.prepare(
    `INSERT OR IGNORE INTO teams (id, name, short_name, abbreviation, logo_url, color, league)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  );
  let inserted = 0;
  for (const t of SEED_TEAMS) {
    // Defense in depth: a blocklisted club must never be seeded, even if a row
    // is added to SEED_TEAMS by hand (see server/db/blockedTeams.ts).
    if (isBlockedTeam(t)) continue;
    const res = stmt.run(t.id, t.name, t.short_name, t.abbreviation, t.logo_url ?? null, t.color, t.league);
    inserted += Number(res.changes ?? 0);
  }
  console.log("[db] teams seeded:", inserted);
  const total = Number((db.prepare("SELECT COUNT(*) AS n FROM teams").get() as { n: number }).n);
  console.log(`[db] teams table now holds ${total} row(s)`);
  return inserted;
}
