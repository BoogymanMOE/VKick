import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getDb, all } from "../server/db/index.ts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const FACES_DIR = path.join(ROOT, "public", "faces");

interface PlayerRow { id: string; full_name: string; team_id: string; league: string }

const db = getDb();
const players = all<PlayerRow>(
  db,
  `SELECT p.id, p.full_name, p.team_id, t.league
   FROM players p JOIN teams t ON t.id = p.team_id
   WHERE t.league IN ('eng.1','esp.1','ita.1','ger.1','fra.1')`,
);
const playerById = new Map(players.map((p) => [p.id, p]));

const files = fs.readdirSync(FACES_DIR).filter((f) => /\.(png|jpe?g|webp)$/i.test(f));
const matched: string[] = [];
const unmatched: string[] = [];
const empty: string[] = [];

for (const f of files) {
  const id = path.basename(f, path.extname(f));
  const full = path.join(FACES_DIR, f);
  const size = fs.statSync(full).size;
  if (size === 0) empty.push(f);
  if (playerById.has(id)) matched.push(id);
  else unmatched.push(f);
}

console.log(`Scanned ${files.length} face files`);
console.log(`Matched to a player ID: ${matched.length}`);
console.log(`Unmatched (no player with that ID): ${unmatched.length}`);
if (unmatched.length) {
  console.log("Unmatched files:", unmatched.slice(0, 50).join(", "));
  if (unmatched.length > 50) console.log(`... and ${unmatched.length - 50} more`);
}
if (empty.length) console.log("Empty files:", empty.length, empty.slice(0, 20).join(", "));

// Per-league coverage
const byLeague = new Map<string, { total: number; withFace: number }>();
for (const p of players) {
  const e = byLeague.get(p.league) ?? { total: 0, withFace: 0 };
  e.total += 1;
  if (matched.includes(p.id)) e.withFace += 1;
  byLeague.set(p.league, e);
}
console.log("\nPer-league face coverage:");
for (const [lg, e] of byLeague) {
  console.log(`  ${lg}: ${e.withFace}/${e.total} (${Math.round((e.withFace / e.total) * 100)}%)`);
}

// Per-team top missing (teams with 0 faces)
const byTeam = new Map<string, { name: string; total: number; withFace: number }>();
for (const p of players) {
  const e = byTeam.get(p.team_id) ?? { name: p.team_id, total: 0, withFace: 0 };
  e.total += 1;
  if (matched.includes(p.id)) e.withFace += 1;
  byTeam.set(p.team_id, e);
}
const noFaceTeams = [...byTeam.entries()].filter(([, e]) => e.withFace === 0);
console.log(`\nTeams with zero faces: ${noFaceTeams.length}`);
