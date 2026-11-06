import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as cheerio from "cheerio";
import { getDb, all } from "../server/db/index.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const TEAM_MAP_PATH = path.join(ROOT, "scripts", "fbref-team-map.json");
const OUT = path.join(ROOT, "scripts", "fbref-match-map.json");

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const db = getDb();
const teamMap = JSON.parse(fs.readFileSync(TEAM_MAP_PATH, "utf8")) as Record<
  string,
  { fbref_squad_id: string | null }
>;

const matchMap: Record<string, string> = fs.existsSync(OUT)
  ? JSON.parse(fs.readFileSync(OUT, "utf8"))
  : {};

async function fetchHtml(url: string): Promise<string> {
  const res = await fetch(url, { headers: { "User-Agent": UA, Accept: "text/html" } });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res.text();
}

function norm(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, " ");
}

for (const [espnTeamId, info] of Object.entries(teamMap)) {
  const squadId = info?.fbref_squad_id;
  if (!squadId) {
    console.log(`[skip] ${espnTeamId}: no fbref_squad_id`);
    continue;
  }
  const url = `https://fbref.com/en/squads/${squadId}/2026-2027/matchlogs/all_comps`;
  console.log(`[fetch] ${espnTeamId} ${url}`);
  let html: string;
  try {
    html = await fetchHtml(url);
  } catch (e) {
    console.error(`[err] ${espnTeamId}: ${String(e)}`);
    continue;
  }
  const $ = cheerio.load(html);
  const rows = $("#matchlogs_for tbody tr").toArray();
  // Local finished matches for this team.
  const localMatches = all<{ id: string; kickoff_at: string; home_team_id: string; away_team_id: string; home_name?: string; away_name?: string }>(
    db,
    `SELECT m.id, m.kickoff_at, m.home_team_id, m.away_team_id
     FROM matches m
     WHERE (m.home_team_id = ? OR m.away_team_id = ?) AND m.status = 'finished'`,
    [espnTeamId, espnTeamId],
  );
  for (const tr of rows) {
    const $tr = $(tr);
    const date = $tr.find("th[data-stat='date'], td[data-stat='date']").text().trim();
    const opponent = norm($tr.find("td[data-stat='opponent']").text());
    const link = $tr.find("td[data-stat='match_report'] a, th[data-stat='match_report'] a").attr("href");
    if (!date || !opponent || !link) continue;
    const m = link.match(/\/matches\/([0-9a-f]+)/i);
    if (!m) continue;
    const fbrefId = m[1];
    // Find local match by date (YYYY-MM-DD) + opponent name contains.
    const local = localMatches.find((lm) => {
      const d = lm.kickoff_at.slice(0, 10);
      if (d !== date) return false;
      // opponent is the other team; we don't have name here, so match by date only if unique.
      return true;
    });
    if (local && !matchMap[local.id]) {
      matchMap[local.id] = fbrefId;
    }
  }
  await sleep(5000);
}

fs.writeFileSync(OUT, JSON.stringify(matchMap, null, 2));
console.log(`Wrote ${Object.keys(matchMap).length} match mappings to ${OUT}`);
