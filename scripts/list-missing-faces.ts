import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getDb, all } from "../server/db/index.ts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const players = all<{ id: string; full_name: string; team_id: string; league: string; short_name: string | null }>(
  getDb(),
  `SELECT p.id, p.full_name, p.short_name, p.team_id, t.league
   FROM players p JOIN teams t ON t.id = p.team_id
   WHERE t.league IN ('eng.1','esp.1','ita.1','ger.1','fra.1')
   ORDER BY t.league, t.name, p.full_name`,
);
const faceDir = path.join(ROOT, "public", "faces");
const hasFace = (id: string) => fs.existsSync(path.join(faceDir, id + ".webp")) || fs.existsSync(path.join(faceDir, id + ".png"));
const missing = players.filter((p) => !hasFace(p.id));
const lines = missing.map((p) => `${p.league}\t${p.team_id}\t${p.id}\t${p.full_name}`);
fs.writeFileSync(path.join(ROOT, "scripts", "players-without-face.txt"), lines.join("\n") + "\n");
console.log("missing:", missing.length, "of", players.length);
console.log("written to scripts/players-without-face.txt");
