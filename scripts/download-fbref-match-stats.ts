import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as cheerio from "cheerio";
import { getDb } from "../server/db/index.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const MATCH_MAP_PATH = path.join(ROOT, "scripts", "fbref-match-map.json");
const TEAM_ARG = process.argv.includes("--team")
  ? process.argv[process.argv.indexOf("--team") + 1]
  : null;

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const db = getDb();
const matchMap = JSON.parse(fs.readFileSync(MATCH_MAP_PATH, "utf8")) as Record<string, string>;

function norm(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, " ");
}

function num(v: string | undefined): number | null {
  if (v === undefined || v === null || v === "" || v === "—") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

async function fetchHtml(url: string): Promise<string> {
  try {
    const res = await fetch(url, { headers: { "User-Agent": UA, Accept: "text/html" } });
    if (res.ok) {
      const text = await res.text();
      if (!text.includes("Just a moment")) return text;
    }
  } catch {
    // fall through
  }
  const { chromium } = await import("playwright");
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  try {
    const page = await browser.newPage();
    await page.setExtraHTTPHeaders({ "User-Agent": UA });
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
    await page.waitForTimeout(3000);
    return await page.content();
  } finally {
    await browser.close();
  }
}

// For a given match page, extract per-player advanced stats keyed by normalized player name + team side.
interface AdvRow {
  name: string;
  teamSide: "home" | "away";
  tackles: number | null;
  interceptions: number | null;
  clearances: number | null;
  blocks: number | null;
  dribbles_attempts: number | null;
  dribbles_success: number | null;
  dribbled_past: number | null;
  key_passes: number | null;
  crosses: number | null;
  aerials_won: number | null;
  aerials_lost: number | null;
  passes_total: number | null;
  passes_accurate: number | null;
  xg: number | null;
  xa: number | null;
}

function parseMatch(html: string): AdvRow[] {
  const $ = cheerio.load(html);
  const out: AdvRow[] = [];
  // FBref tables: stats_<side>_<category>
  const sides: Array<"home" | "away"> = ["home", "away"];
  const cats = ["summary", "passing", "pass_types", "defense", "possession", "misc"];
  // We'll collect per (side,name) into a map.
  const byKey = new Map<string, AdvRow>();
  const getKey = (side: "home" | "away", name: string) => `${side}::${norm(name)}`;
  const ensure = (side: "home" | "away", name: string): AdvRow => {
    const k = getKey(side, name);
    let r = byKey.get(k);
    if (!r) {
      r = {
        name,
        teamSide: side,
        tackles: null,
        interceptions: null,
        clearances: null,
        blocks: null,
        dribbles_attempts: null,
        dribbles_success: null,
        dribbled_past: null,
        key_passes: null,
        crosses: null,
        aerials_won: null,
        aerials_lost: null,
        passes_total: null,
        passes_accurate: null,
        xg: null,
        xa: null,
      };
      byKey.set(k, r);
    }
    return r;
  };

  for (const side of sides) {
    for (const cat of cats) {
      const tableId = `stats_${side}_${cat}`;
      const table = $(`table#${tableId}`);
      if (!table.length) continue;
      table.find("tbody tr").each((_, tr) => {
        const $tr = $(tr);
        const name = $tr.find("th[data-stat='player'] a, td[data-stat='player'] a").first().text().trim()
          || $tr.find("th[data-stat='player']").first().text().trim();
        if (!name || name === "Squad Total") return;
        const r = ensure(side, name);
        const get = (stat: string) => $tr.find(`td[data-stat='${stat}'], th[data-stat='${stat}']`).first().text().trim();
        if (cat === "summary") {
          r.xg = num(get("xg"));
          r.xa = num(get("xa"));
        }
        if (cat === "passing") {
          r.passes_total = num(get("passes"));
          r.passes_accurate = num(get("passes_pct")) === null ? num(get("passes_completed")) : num(get("passes_completed"));
          r.key_passes = num(get("assisted_shots"));
          r.crosses = (r.crosses ?? null) ?? num(get("crosses"));
        }
        if (cat === "pass_types") {
          if (r.crosses === null) r.crosses = num(get("crosses"));
        }
        if (cat === "defense") {
          r.tackles = num(get("tackles"));
          r.interceptions = num(get("interceptions"));
          r.clearances = num(get("clearances"));
          r.blocks = num(get("blocks"));
        }
        if (cat === "possession") {
          r.dribbles_attempts = num(get("dribbles"));
          r.dribbles_success = num(get("dribbles_completed"));
          r.dribbled_past = num(get("dribbled_past"));
          if (r.key_passes === null) r.key_passes = num(get("key_passes"));
        }
        if (cat === "misc") {
          r.aerials_won = num(get("aerials_won"));
          r.aerials_lost = num(get("aerials_lost"));
        }
      });
    }
  }
  return [...byKey.values()];
}

// Map a player name to our players table for a given team.
function findPlayerId(name: string, teamId: string): string | null {
  const rows = db
    .prepare("SELECT id, full_name, short_name FROM players WHERE team_id = ?")
    .all(teamId) as Array<{ id: string; full_name: string; short_name: string | null }>;
  const n = norm(name);
  for (const r of rows) {
    if (norm(r.full_name) === n) return r.id;
    if (r.short_name && norm(r.short_name) === n) return r.id;
  }
  // fuzzy: contains
  for (const r of rows) {
    if (norm(r.full_name).includes(n) || n.includes(norm(r.full_name))) return r.id;
  }
  return null;
}

const entries = Object.entries(matchMap);
const filtered = TEAM_ARG
  ? entries.filter(([espnMatchId]) => {
      // filter by team not directly; allow all if no easy filter
      return true;
    })
  : entries;

let done = 0;
for (const [espnMatchId, fbrefId] of filtered) {
  const url = `https://fbref.com/en/matches/${fbrefId}/`;
  console.log(`[fetch] ${espnMatchId} ${url}`);
  let html: string;
  try {
    html = await fetchHtml(url);
  } catch (e) {
    console.error(`[err] ${espnMatchId}: ${String(e)}`);
    await sleep(5000);
    continue;
  }
  const rows = parseMatch(html);
  // Determine home/away team ids from our match row.
  const m = db
    .prepare("SELECT home_team_id, away_team_id FROM matches WHERE id = ?")
    .get(espnMatchId) as { home_team_id: string; away_team_id: string } | undefined;
  if (!m) {
    console.warn(`[skip] unknown match ${espnMatchId}`);
    await sleep(5000);
    continue;
  }
  const now = new Date().toISOString();
  for (const r of rows) {
    const teamId = r.teamSide === "home" ? m.home_team_id : m.away_team_id;
    const playerId = findPlayerId(r.name, teamId);
    if (!playerId) {
      console.warn(`[nomatch] ${r.name} (${teamId})`);
      continue;
    }
    db.prepare(
      `INSERT INTO match_player_advanced_stats
       (match_id, player_id, tackles, interceptions, clearances, blocks, dribbles_attempts, dribbles_success, dribbled_past, key_passes, crosses, aerials_won, aerials_lost, passes_total, passes_accurate, xg, xa, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
       ON CONFLICT(match_id, player_id) DO UPDATE SET
         tackles=excluded.tackles, interceptions=excluded.interceptions, clearances=excluded.clearances, blocks=excluded.blocks,
         dribbles_attempts=excluded.dribbles_attempts, dribbles_success=excluded.dribbles_success, dribbled_past=excluded.dribbled_past,
         key_passes=excluded.key_passes, crosses=excluded.crosses, aerials_won=excluded.aerials_won, aerials_lost=excluded.aerials_lost,
         passes_total=excluded.passes_total, passes_accurate=excluded.passes_accurate, xg=excluded.xg, xa=excluded.xa, updated_at=excluded.updated_at`,
    ).run(
      espnMatchId,
      playerId,
      r.tackles,
      r.interceptions,
      r.clearances,
      r.blocks,
      r.dribbles_attempts,
      r.dribbles_success,
      r.dribbled_past,
      r.key_passes,
      r.crosses,
      r.aerials_won,
      r.aerials_lost,
      r.passes_total,
      r.passes_accurate,
      r.xg,
      r.xa,
      now,
    );
  }
  done++;
  if (done % 5 === 0) console.log(`[progress] ${done}/${filtered.length}`);
  await sleep(5000);
}
console.log(`[done] processed ${done} matches`);
