import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getDb, all } from "../server/db/index.ts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = path.join(ROOT, "data", "seed.json");

const db = getDb();
const seed = {
  teams: all(db, "SELECT * FROM teams"),
  players: all(db, "SELECT * FROM players"),
  exported_at: new Date().toISOString(),
};
fs.writeFileSync(OUT, JSON.stringify(seed));
console.log("exported", seed.teams.length, "teams,", seed.players.length, "players to", OUT);
