import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getDb, all } from "../server/db/index.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = path.join(ROOT, "scripts", "fbref-team-map.json");

const db = getDb();
const teams = all<{ id: string; name: string; short_name: string; league: string }>(
  db,
  "SELECT id, name, short_name, league FROM teams ORDER BY league, name",
);

// FBref squad ids are not derivable from ESPN data; this file is the manual
// lookup table. The script seeds an empty entry per team so the operator can
// fill in the FBref squad id (from https://fbref.com/en/squads/<id>/...).
const map: Record<string, { name: string; league: string; fbref_squad_id: string | null }> = {};
for (const t of teams) {
  map[t.id] = { name: t.name, league: t.league, fbref_squad_id: null };
}

fs.writeFileSync(OUT, JSON.stringify(map, null, 2));
console.log(`Wrote ${Object.keys(map).length} team entries to ${OUT}`);
console.log("Fill in fbref_squad_id for each top-5-league team, then run build-fbref-match-map.");
