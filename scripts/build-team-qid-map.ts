/**
 * One-time builder for the ESPN team id -> Wikidata QID map.
 *
 * Output: scripts/team-qid-map.json  (gitignored, regenerable)
 * Unmatched teams: scripts/team-qid-unmatched.json
 *
 * Usage: npm run build-team-qid-map
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { mkdir, writeFile } from "node:fs/promises";
import { getDb } from "../server/db/index.ts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const MAP_PATH = path.join(ROOT, "scripts", "team-qid-map.json");
const UNMATCHED_PATH = path.join(ROOT, "scripts", "team-qid-unmatched.json");
const LEAGUES = ["eng.1", "esp.1", "ita.1", "ger.1", "fra.1"] as const;
const FOOTBALL_CLUB_QIDS = new Set(["Q476028", "Q12973014"]);
const UA = "VKickBot/1.0 (contact@vkick.example)";

interface TeamRow {
  id: string;
  name: string;
  short_name: string | null;
  league: string;
}

interface SearchHit {
  id: string;
  label: string;
  description?: string;
  aliases?: string[];
}

async function fetchJson(url: string): Promise<any> {
  const res = await fetch(url, {
    headers: { "User-Agent": UA, Accept: "application/json" },
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res.json();
}

async function searchEntities(term: string): Promise<SearchHit[]> {
  const url = `https://www.wikidata.org/w/api.php?action=wbsearchentities&search=${encodeURIComponent(term)}&language=en&format=json&limit=5`;
  const json = await fetchJson(url);
  return (json?.search ?? []) as SearchHit[];
}

async function fetchEntities(qids: string[]): Promise<Record<string, any>> {
  if (qids.length === 0) return {};
  const url = `https://www.wikidata.org/w/api.php?action=wbgetentities&ids=${qids.join("|")}&props=claims&languages=en&format=json`;
  const json = await fetchJson(url);
  return json?.entities ?? {};
}

function isFootballClub(entity: any): boolean {
  const p31 = entity?.claims?.P31 ?? [];
  return p31.some((s: any) => {
    const id = s?.mainsnak?.datavalue?.value?.id;
    return typeof id === "string" && FOOTBALL_CLUB_QIDS.has(id);
  });
}

function hasSportsLink(entity: any): boolean {
  const p118 = entity?.claims?.P118;
  const p54 = entity?.claims?.P54;
  return (Array.isArray(p118) && p118.length > 0) || (Array.isArray(p54) && p54.length > 0);
}

function statementCount(entity: any): number {
  const claims = entity?.claims ?? {};
  let n = 0;
  for (const k of Object.keys(claims)) {
    n += Array.isArray(claims[k]) ? claims[k].length : 0;
  }
  return n;
}

function nameMatches(hit: SearchHit, teamName: string): boolean {
  const target = teamName.toLowerCase().trim();
  const label = (hit.label ?? "").toLowerCase().trim();
  if (label === target) return true;
  if (label.includes(target) || target.includes(label)) return true;
  const aliases = (hit.aliases ?? []).map((a) => a.toLowerCase().trim());
  if (aliases.some((a) => a === target || a.includes(target) || target.includes(a))) return true;
  // description often mentions football
  return false;
}

async function resolveTeam(team: TeamRow): Promise<string | null> {
  const base = team.name.trim();
  const terms = new Set<string>();
  terms.add(base);
  if (team.short_name && team.short_name.trim() !== "" && team.short_name.trim() !== base) {
    terms.add(team.short_name.trim());
  }
  // Generic city/club names need a football qualifier to surface the actual club.
  for (const suffix of [" FC", " F.C.", " CF", " AFC", " SC", " AC"]) {
    terms.add(base + suffix);
    terms.add(base + suffix.toLowerCase());
  }
  let bestQid: string | null = null;
  let bestScore = -1;
  const candidates: Array<{ qid: string; score: number }> = [];

  for (const term of terms) {
    let hits: SearchHit[] = [];
    try {
      hits = await searchEntities(term);
    } catch {
      hits = [];
    }
    const ids = hits.map((h) => h.id).filter((id) => /^Q\d+$/.test(id));
    let entities: Record<string, any> = {};
    try {
      entities = await fetchEntities(ids);
    } catch {
      entities = {};
    }
    for (const hit of hits) {
      const entity = entities[hit.id];
      if (!entity) continue;
      if (!isFootballClub(entity)) continue;
      if (!hasSportsLink(entity)) continue;
      if (!nameMatches(hit, team.name)) continue;
      const score = statementCount(entity);
      candidates.push({ qid: hit.id, score });
      if (score > bestScore) {
        bestScore = score;
        bestQid = hit.id;
      }
    }
    await new Promise((r) => setTimeout(r, 150));
  }

  if (candidates.length === 0) return null;
  // prefer highest statement count (already tracked)
  return bestQid;
}

async function main(): Promise<void> {
  const db = getDb();
  const leaguePlaceholders = LEAGUES.map(() => "?").join(",");
  const teams = db
    .prepare(`SELECT id, name, short_name, league FROM teams WHERE league IN (${leaguePlaceholders}) ORDER BY league, name`)
    .all(...LEAGUES) as unknown as TeamRow[];

  console.log(`Teams in scope: ${teams.length}`);

  const map: Record<string, string> = {};
  const unmatched: Array<{ team_id: string; name: string; short_name: string | null; league: string }> = [];

  let done = 0;
  for (const t of teams) {
    done += 1;
    let qid: string | null = null;
    try {
      qid = await resolveTeam(t);
    } catch (e) {
      qid = null;
    }
    if (qid) {
      map[t.id] = qid;
    } else {
      unmatched.push({ team_id: t.id, name: t.name, short_name: t.short_name, league: t.league });
    }
    if (done % 10 === 0 || done === teams.length) {
      console.log(`Processed ${done}/${teams.length} — matched ${Object.keys(map).length}, unmatched ${unmatched.length}`);
    }
    await new Promise((r) => setTimeout(r, 250));
  }

  await mkdir(path.join(ROOT, "scripts"), { recursive: true });
  await writeFile(MAP_PATH, JSON.stringify(map, null, 2) + "\n");
  await writeFile(UNMATCHED_PATH, JSON.stringify(unmatched, null, 2) + "\n");

  console.log("");
  console.log("=== SUMMARY ===");
  console.log(`Teams processed : ${teams.length}`);
  console.log(`Matched (QID)   : ${Object.keys(map).length}`);
  console.log(`Unmatched       : ${unmatched.length}`);
  console.log(`Map file        : ${MAP_PATH}`);
  console.log(`Unmatched file  : ${UNMATCHED_PATH}`);
  if (unmatched.length > 0) {
    console.log("Unmatched teams:");
    for (const u of unmatched) console.log(`  ${u.team_id} ${u.name} (${u.league})`);
  }
}

main().catch((err) => {
  console.error("FATAL:", err);
  process.exit(1);
});
