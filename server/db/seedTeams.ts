/**
 * Static team seed — runs inside migrate() so a fresh Render deploy lands with
 * a populated teams table on first boot, before the ESPN sync loop has run.
 *
 * Scope (per the product rule):
 *  1. Top-5 European leagues (eng.1, esp.1, ger.1, ita.1, fra.1)
 *  2. UEFA club cups (uefa.champions, uefa.europa)
 *  3. Domestic cups for those five leagues (eng.fa, esp.copa_del_rey, ger.dfb_pokal,
 *     ita.coppa_italia, fra.coupe_de_france)
 *  4. International tournaments (fifa.world, uefa.euro) — national sides only.
 *
 * Club sides carry their DOMESTIC league (the favorites rule depends on it).
 * Cup-synced clubs also keep their domestic league here (unlike the live sync,
 * which sets league="" for cup scoreboards and fills it in later). National
 * sides carry league="" — they land in the "international" group once a match
 * exists for them, otherwise "other" until then.
 *
 * Every row uses INSERT OR IGNORE, so a later ESPN sync upsert (see
 * server/sync/upserts.ts applyScoreboard/applySummary/applyRoster/applyStandings,
 * all of which upsertCoalesce on teams.id) can update names/logos/colors
 * without clobbering the seed. The seed is a floor, not a source of truth.
 *
 * ESPN team ids are the real ids these clubs/national sides carry on
 * site.api.espn.com. Name/short_name/abbreviation are the canonical English
 * labels; logo_url and color are our stored values for when the sync hasn't
 * run yet (the sync overwrites them from the live payload).
 */

import type { DatabaseSync } from "node:sqlite";

export interface SeedTeam {
  id: string;
  name: string;
  short_name: string | null;
  abbreviation: string | null;
  logo_url?: string | null;
  color: string | null;
  league: string;
}

/** Big-five domestic clubs + UEFA cup participants + national sides. */
export const SEED_TEAMS: SeedTeam[] = [
  // ---- Premier League (eng.1) ----
  {
    id: "359",
    name: "Arsenal",
    short_name: "Arsenal",
    abbreviation: "ARS",
    color: "#EF0107",
    league: "eng.1",
  },
  {
    id: "364",
    name: "Chelsea",
    short_name: "Chelsea",
    abbreviation: "CHE",
    color: "#034694",
    league: "eng.1",
  },
  {
    id: "366",
    name: "Crystal Palace",
    short_name: "Crystal Palace",
    abbreviation: "CRY",
    color: "#1B4F8A",
    league: "eng.1",
  },
  {
    id: "370",
    name: "Liverpool",
    short_name: "Liverpool",
    abbreviation: "LIV",
    color: "#C8102E",
    league: "eng.1",
  },
  {
    id: "373",
    name: "Manchester City",
    short_name: "Man City",
    abbreviation: "MCI",
    color: "#6CABDD",
    league: "eng.1",
  },
  {
    id: "381",
    name: "Manchester United",
    short_name: "Man Utd",
    abbreviation: "MUN",
    color: "#DA291C",
    league: "eng.1",
  },
  {
    id: "382",
    name: "Newcastle United",
    short_name: "Newcastle",
    abbreviation: "NEW",
    color: "#606C70",
    league: "eng.1",
  },
  {
    id: "393",
    name: "Tottenham Hotspur",
    short_name: "Spurs",
    abbreviation: "TOT",
    color: "#132257",
    league: "eng.1",
  },
  {
    id: "432",
    name: "West Ham United",
    short_name: "West Ham",
    abbreviation: "WHL",
    color: "#7A2E1F",
    league: "eng.1",
  },
  {
    id: "433",
    name: "Wolverhampton Wanderers",
    short_name: "Wolves",
    abbreviation: "WOL",
    color: "#F2C94C",
    league: "eng.1",
  },
  {
    id: "997",
    name: "Brighton & Hove Albion",
    short_name: "Brighton",
    abbreviation: "BHA",
    color: "#0057B8",
    league: "eng.1",
  },

  // ---- La Liga (esp.1) ----
  {
    id: "93",
    name: "Athletic Club",
    short_name: "Athletic Bilbao",
    abbreviation: "ATH",
    color: "#C8142F",
    league: "esp.1",
  },
  {
    id: "94",
    name: "Atlético Madrid",
    short_name: "Atlético",
    abbreviation: "ATM",
    color: "#CB3333",
    league: "esp.1",
  },
  {
    id: "96",
    name: "Real Betis",
    short_name: "Betis",
    abbreviation: "BET",
    color: "#004D99",
    league: "esp.1",
  },
  {
    id: "97",
    name: "Sevilla",
    short_name: "Sevilla",
    abbreviation: "SEV",
    color: "#D6130D",
    league: "esp.1",
  },
  {
    id: "103",
    name: "Real Madrid",
    short_name: "Real Madrid",
    abbreviation: "RMA",
    color: "#FEBE10",
    league: "esp.1",
  },
  {
    id: "104",
    name: "Real Sociedad",
    short_name: "Real Sociedad",
    abbreviation: "RSO",
    color: "#0033A0",
    league: "esp.1",
  },
  {
    id: "105",
    name: "Valencia",
    short_name: "Valencia",
    abbreviation: "VAL",
    color: "#FEBE10",
    league: "esp.1",
  },
  {
    id: "111",
    name: "FC Barcelona",
    short_name: "Barcelona",
    abbreviation: "BAR",
    color: "#A50044",
    league: "esp.1",
  },
  {
    id: "124",
    name: "Real Valladolid",
    short_name: "Valladolid",
    abbreviation: "VLD",
    color: "#FFEE00",
    league: "esp.1",
  },
  { id: "126", name: "Getafe", short_name: "Getafe", abbreviation: "GET", color: "#DA0308", league: "esp.1" },
  {
    id: "139",
    name: "Villarreal",
    short_name: "Villarreal",
    abbreviation: "VIR",
    color: "#00A0E5",
    league: "esp.1",
  },

  // ---- Bundesliga (ger.1) ----
  {
    id: "239",
    name: "Bayern Munich",
    short_name: "Bayern",
    abbreviation: "BAY",
    color: "#DC052D",
    league: "ger.1",
  },
  {
    id: "243",
    name: "Borrussia Dortmund",
    short_name: "Dortmund",
    abbreviation: "DOR",
    color: "#FFF200",
    league: "ger.1",
  },
  {
    id: "256",
    name: "SC Freiburg",
    short_name: "Freiburg",
    abbreviation: "FRE",
    color: "#009921",
    league: "ger.1",
  },
  {
    id: "268",
    name: "Eintracht Frankfurt",
    short_name: "Frankfurt",
    abbreviation: "FRA",
    color: "#000000",
    league: "ger.1",
  },
  {
    id: "273",
    name: "Hamburger SV",
    short_name: "Hamburg",
    abbreviation: "HAM",
    color: "#DB0007",
    league: "ger.1",
  },
  {
    id: "337",
    name: "RB Leipzig",
    short_name: "Leipzig",
    abbreviation: "RBL",
    color: "#FC2940",
    league: "ger.1",
  },
  {
    id: "349",
    name: "Bayer Leverkusen",
    short_name: "Leverkusen",
    abbreviation: "LEV",
    color: "#041E42",
    league: "ger.1",
  },
  {
    id: "357",
    name: "Borussia Mönchengladbach",
    short_name: "Gladbach",
    abbreviation: "GLA",
    color: "#6FFC47",
    league: "ger.1",
  },
  {
    id: "368",
    name: "VfB Stuttgart",
    short_name: "Stuttgart",
    abbreviation: "STU",
    color: "#0098C0",
    league: "ger.1",
  },
  {
    id: "3751",
    name: "1. FC Union Berlin",
    short_name: "Union Berlin",
    abbreviation: "UNB",
    color: "#000000",
    league: "ger.1",
  },
  {
    id: "3997",
    name: "Eintracht Braunschweig",
    short_name: "Braunschweig",
    abbreviation: "BSS",
    color: "#0055A4",
    league: "ger.1",
  },

  // ---- Serie A (ita.1) ----
  {
    id: "174",
    name: "AC Milan",
    short_name: "Milan",
    abbreviation: "ACM",
    color: "#006D32",
    league: "ita.1",
  },
  { id: "175", name: "AS Roma", short_name: "Roma", abbreviation: "ROM", color: "#8CC63F", league: "ita.1" },
  {
    id: "176",
    name: "Bologna FC",
    short_name: "Bologna",
    abbreviation: "BOL",
    color: "#006837",
    league: "ita.1",
  },
  {
    id: "179",
    name: "Cagliari",
    short_name: "Cagliari",
    abbreviation: "CAG",
    color: "#7A0034",
    league: "ita.1",
  },
  { id: "441", name: "Empoli", short_name: "Empoli", abbreviation: "EMP", color: "#695196", league: "ita.1" },
  {
    id: "521",
    name: "Fiorentina",
    short_name: "Fiorentina",
    abbreviation: "FIO",
    color: "#81C0FF",
    league: "ita.1",
  },
  {
    id: "582",
    name: "Inter Milan",
    short_name: "Inter",
    abbreviation: "INT",
    color: "#000000",
    league: "ita.1",
  },
  {
    id: "589",
    name: "Juventus",
    short_name: "Juventus",
    abbreviation: "JUV",
    color: "#000000",
    league: "ita.1",
  },
  { id: "617", name: "Lazio", short_name: "Lazio", abbreviation: "LAZ", color: "#025719", league: "ita.1" },
  { id: "620", name: "Napoli", short_name: "Napoli", abbreviation: "NAP", color: "#003A6B", league: "ita.1" },
  {
    id: "622",
    name: "Atalanta",
    short_name: "Atalanta",
    abbreviation: "ATA",
    color: "#006633",
    league: "ita.1",
  },

  // ---- Ligue 1 (fra.1) ----
  {
    id: "85",
    name: "AS Monaco",
    short_name: "Monaco",
    abbreviation: "MON",
    color: "#6CACE4",
    league: "fra.1",
  },
  {
    id: "86",
    name: "AS Saint-Étienne",
    short_name: "Saint-Étienne",
    abbreviation: "STE",
    color: "#FFFFFF",
    league: "fra.1",
  },
  {
    id: "88",
    name: "Olympique Lyonnais",
    short_name: "Lyon",
    abbreviation: "LYO",
    color: "#3366CC",
    league: "fra.1",
  },
  {
    id: "89",
    name: "FC Nantes",
    short_name: "Nantes",
    abbreviation: "NAN",
    color: "#3366CC",
    league: "fra.1",
  },
  {
    id: "90",
    name: "Olympique de Marseille",
    short_name: "Marseille",
    abbreviation: "MAR",
    color: "#0066CC",
    league: "fra.1",
  },
  {
    id: "99",
    name: "Paris FC",
    short_name: "Paris FC",
    abbreviation: "PFC",
    color: "#B9E8F0",
    league: "fra.1",
  },
  {
    id: "160",
    name: "Paris Saint-Germain",
    short_name: "PSG",
    abbreviation: "PSG",
    color: "#004170",
    league: "fra.1",
  },
  {
    id: "166",
    name: "Lille OSC",
    short_name: "Lille",
    abbreviation: "LIL",
    color: "#C2051B",
    league: "fra.1",
  },
  {
    id: "2994",
    name: "AS Cannes",
    short_name: "Cannes",
    abbreviation: "CAN",
    color: "#DE1F26",
    league: "fra.1",
  },
  {
    id: "3236",
    name: "Clermont Foot 63",
    short_name: "Clermont",
    abbreviation: "CLO",
    color: "#0033A0",
    league: "fra.1",
  },

  // ---- UEFA Champions League (uefa.champions) — clubs keep their domestic league ----
  // (Already covered above via Real Madrid, Barcelona, Bayern, Milan, Inter, PSG,
  // Dortmund, Juventus, Atletico, Liverpool, Man City, Arsenal. No separate rows.)

  // ---- UEFA Europa League (uefa.europa) — clubs keep their domestic league ----
  // (Already covered above via Sevilla, Atlético, Leverkusen, etc. No separate rows.)

  // ---- Domestic Cups — clubs already seeded above; no separate rows needed ----

  // ---- International tournaments — national sides (league="") ----
  {
    id: "20024",
    name: "England",
    short_name: "England",
    abbreviation: "ENG",
    logo_url: null,
    color: "#FFFFFF",
    league: "",
  },
  {
    id: "20025",
    name: "France",
    short_name: "France",
    abbreviation: "FRA",
    logo_url: null,
    color: "#00239C",
    league: "",
  },
  {
    id: "20028",
    name: "Germany",
    short_name: "Germany",
    abbreviation: "GER",
    logo_url: null,
    color: "#DD0000",
    league: "",
  },
  {
    id: "20703",
    name: "Spain",
    short_name: "Spain",
    abbreviation: "ESP",
    logo_url: null,
    color: "#C60000",
    league: "",
  },
  {
    id: "20710",
    name: "Italy",
    short_name: "Italy",
    abbreviation: "ITA",
    logo_url: null,
    color: "#008037",
    league: "",
  },
  {
    id: "21615",
    name: "Argentina",
    short_name: "Argentina",
    abbreviation: "ARG",
    logo_url: null,
    color: "#75AADB",
    league: "",
  },
  {
    id: "21922",
    name: "Brazil",
    short_name: "Brazil",
    abbreviation: "BRA",
    logo_url: null,
    color: "#009C3B",
    league: "",
  },
  {
    id: "21943",
    name: "Colombia",
    short_name: "Colombia",
    abbreviation: "COL",
    logo_url: null,
    color: "#FCD116",
    league: "",
  },
  {
    id: "22281",
    name: "Netherlands",
    short_name: "Netherlands",
    abbreviation: "NED",
    logo_url: null,
    color: "#D52B1E",
    league: "",
  },
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
    const res = stmt.run(t.id, t.name, t.short_name, t.abbreviation, t.logo_url ?? null, t.color, t.league);
    inserted += Number(res.changes ?? 0);
  }
  console.log("[db] teams seeded:", inserted);
  const total = Number((db.prepare("SELECT COUNT(*) AS n FROM teams").get() as { n: number }).n);
  console.log(`[db] teams table now holds ${total} row(s)`);
  return inserted;
}
