/**
 * Download current-season player photos from Wikimedia Commons + Wikipedia.
 *
 * Approach: per-player Wikidata search (name + team disambiguation), fetch P18;
 * if no P18, fall back to Wikipedia pageimages (infobox photo); if no Wikidata
 * match at all, search Wikipedia directly with team name.
 *
 * Usage:
 *   npm run download-faces-wiki
 *   npm run download-faces-wiki -- --team=112
 *   npm run download-faces-wiki -- --league=ita.1
 *   npm run download-faces-wiki -- --limit=50
 *   npm run download-faces-wiki -- --refresh
 *
 * Runtime: ~70-90 min full run. Manual only (exceeds Render build cap).
 *
 * Realistic coverage ceiling: ~70-75% of top-5-league first-team squads.
 * Wikidata P18 + Wikipedia infobox photos combined still miss ~25-30% of
 * players (typically youth call-ups, recent transfers without Wikipedia
 * articles, and lower-profile squad members). PlayerAvatar's team-colored
 * initials fallback handles these cases gracefully.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { mkdir, writeFile } from "node:fs/promises";
import sharp from "sharp";
import { getDb } from "../server/db/index.ts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const FACES_DIR = path.join(ROOT, "public", "faces");
const MANIFEST_PATH = path.join(FACES_DIR, "manifest.json");
const MAP_PATH = path.join(ROOT, "scripts", "team-qid-map.json");
const CHECKPOINT_PATH = path.join(ROOT, "scripts", "download-faces-wiki-progress.json");
const CREDITS_PATH = path.join(FACES_DIR, "credits.json");
const LEAGUES = ["eng.1", "esp.1", "ita.1", "ger.1", "fra.1"] as const;
const UA = "VKickBot/1.0 (contact: github.com/BoogymanMOE/VKick)";
const FOOTBALL_OCCUPATIONS = new Set(["Q937143", "Q11515143"]);
const SEARCH_DELAY_MS = 1000;
const WIKI_API_DELAY_MS = 250;
const IMAGE_CONCURRENCY = 5;
const IMAGE_STAGGER_MS = 200;

const args = process.argv.slice(2);
const REFRESH = args.includes("--refresh");
const teamArg = args.find((a) => a.startsWith("--team="));
const ONLY_TEAM = teamArg ? teamArg.split("=")[1] : null;
const leagueArg = args.find((a) => a.startsWith("--league="));
const ONLY_LEAGUE = leagueArg ? leagueArg.split("=")[1] : null;
const limitArg = args.find((a) => a.startsWith("--limit="));
const LIMIT = limitArg ? parseInt(limitArg.split("=")[1], 10) : null;

interface DbPlayer {
  id: string;
  full_name: string;
  short_name: string | null;
  team_id: string;
  league: string;
}

interface SearchHit {
  id: string;
  label: string;
  description?: string;
  aliases?: string[];
}

interface Claims {
  P18?: Array<{ mainsnak: { datavalue?: { value?: string } } }>;
  P3681?: Array<{ mainsnak: { datavalue?: { value?: string } } }>;
  P54?: Array<{ mainsnak: { datavalue?: { value?: { id?: string } } } }>;
  P106?: Array<{ mainsnak: { datavalue?: { value?: { id?: string } } } }>;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function normalizeName(s: string): string {
  return s
    .replace(/ð/g, "d")
    .replace(/þ/g, "th")
    .replace(/æ/g, "ae")
    .replace(/ø/g, "o")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function isRtl(s: string): boolean {
  return /[\u0590-\u08FF]/.test(s);
}

function wikiFilenameFromImageValue(val: string): string {
  return val.replace(/ /g, "_");
}

function commonsDownloadUrl(filename: string): string {
  return `https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(filename.replace(/_/g, " "))}?width=200`;
}

async function fetchJson(url: string, init?: RequestInit): Promise<any> {
  const res = await fetch(url, init);
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res.json();
}

class Pool {
  private active = 0;
  private queue: Array<() => void> = [];
  constructor(private max: number) {}
  async run<T>(fn: () => Promise<T>): Promise<T> {
    if (this.active >= this.max) {
      await new Promise<void>((resolve) => this.queue.push(resolve));
    }
    this.active++;
    try {
      await sleep(IMAGE_STAGGER_MS);
      return await fn();
    } finally {
      this.active--;
      const next = this.queue.shift();
      if (next) next();
    }
  }
}

const pool = new Pool(IMAGE_CONCURRENCY);

async function searchEntities(name: string): Promise<SearchHit[]> {
  const url = `https://www.wikidata.org/w/api.php?action=wbsearchentities&search=${encodeURIComponent(name)}&language=en&format=json&limit=10`;
  for (let attempt = 0; attempt <= 3; attempt++) {
    try {
      const res = await fetch(url, {
        headers: { "User-Agent": UA, Accept: "application/json" },
        signal: AbortSignal.timeout(20_000),
      });
      const text = await res.text();
      if (res.status === 429 || res.status === 403) {
        await sleep(5000 * (attempt + 1));
        continue;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = JSON.parse(text);
      return (json?.search ?? []) as SearchHit[];
    } catch (e) {
      if (attempt === 3) throw e;
      await sleep(3000 * (attempt + 1));
    }
  }
  return [];
}

async function fetchClaims(qids: string[]): Promise<Record<string, Claims>> {
  if (qids.length === 0) return {};
  const url = `https://www.wikidata.org/w/api.php?action=wbgetentities&ids=${qids.join("|")}&props=claims&format=json`;
  let json: any = null;
  for (let attempt = 0; attempt <= 3; attempt++) {
    try {
      const res = await fetch(url, {
        headers: { "User-Agent": UA, Accept: "application/json" },
        signal: AbortSignal.timeout(20_000),
      });
      const text = await res.text();
      if (res.status === 429 || res.status === 403) {
        await sleep(5000 * (attempt + 1));
        continue;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      json = JSON.parse(text);
      break;
    } catch (e) {
      if (attempt === 3) throw e;
      await sleep(3000 * (attempt + 1));
    }
  }
  if (!json) return {};
  const out: Record<string, Claims> = {};
  for (const qid of qids) {
    out[qid] = (json?.entities?.[qid]?.claims ?? {}) as Claims;
  }
  return out;
}

async function fetchSitelink(qid: string): Promise<string | null> {
  const url = `https://www.wikidata.org/w/api.php?action=wbgetentities&ids=${qid}&props=sitelinks&format=json`;
  for (let attempt = 0; attempt <= 2; attempt++) {
    try {
      const res = await fetch(url, {
        headers: { "User-Agent": UA, Accept: "application/json" },
        signal: AbortSignal.timeout(20_000),
      });
      const text = await res.text();
      if (res.status === 429 || res.status === 403) {
        await sleep(3000 * (attempt + 1));
        continue;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = JSON.parse(text);
      const title = json?.entities?.[qid]?.sitelinks?.enwiki?.title;
      await sleep(WIKI_API_DELAY_MS);
      return typeof title === "string" ? title : null;
    } catch (e) {
      if (attempt === 2) return null;
      await sleep(2000 * (attempt + 1));
    }
  }
  return null;
}

async function fetchPageImage(title: string): Promise<string | null> {
  const url = `https://en.wikipedia.org/w/api.php?action=query&prop=pageimages&piprop=thumbnail&pithumbsize=200&titles=${encodeURIComponent(title)}&format=json`;
  for (let attempt = 0; attempt <= 2; attempt++) {
    try {
      const res = await fetch(url, {
        headers: { "User-Agent": UA, Accept: "application/json" },
        signal: AbortSignal.timeout(20_000),
      });
      const text = await res.text();
      if (res.status === 429 || res.status === 403) {
        await sleep(3000 * (attempt + 1));
        continue;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = JSON.parse(text);
      const pages = json?.query?.pages ?? {};
      for (const pid of Object.keys(pages)) {
        const src = pages[pid]?.thumbnail?.source;
        if (typeof src === "string") {
          await sleep(WIKI_API_DELAY_MS);
          return src;
        }
      }
      await sleep(WIKI_API_DELAY_MS);
      return null;
    } catch (e) {
      if (attempt === 2) return null;
      await sleep(2000 * (attempt + 1));
    }
  }
  return null;
}

async function searchWikipedia(query: string): Promise<Array<{ title: string; snippet: string }>> {
  const url = `https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(query)}&srnamespace=0&srlimit=5&format=json`;
  for (let attempt = 0; attempt <= 2; attempt++) {
    try {
      const res = await fetch(url, {
        headers: { "User-Agent": UA, Accept: "application/json" },
        signal: AbortSignal.timeout(20_000),
      });
      const text = await res.text();
      if (res.status === 429 || res.status === 403) {
        await sleep(3000 * (attempt + 1));
        continue;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = JSON.parse(text);
      const results = (json?.query?.search ?? []) as Array<{ title: string; snippet: string }>;
      await sleep(WIKI_API_DELAY_MS);
      return results;
    } catch (e) {
      if (attempt === 2) return [];
      await sleep(2000 * (attempt + 1));
    }
  }
  return [];
}

function hasFootballOccupation(claims: Claims): boolean {
  const occ = claims.P106 ?? [];
  return occ.some((s) => {
    const id = s?.mainsnak?.datavalue?.value?.id;
    return typeof id === "string" && FOOTBALL_OCCUPATIONS.has(id);
  });
}

function p54TeamIds(claims: Claims): string[] {
  const stmts = claims.P54 ?? [];
  return stmts
    .map((s) => s?.mainsnak?.datavalue?.value?.id)
    .filter((x): x is string => typeof x === "string");
}

function isFootballContext(hit: SearchHit, claims: Claims, top5Qids: Set<string>, teamQid: string | undefined, teamName: string): boolean {
  const desc = (hit.description ?? "").toLowerCase();
  const descFootball = desc.includes("football") || desc.includes("soccer") || desc.includes(teamName.toLowerCase());
  const occ = hasFootballOccupation(claims);
  const teams = p54TeamIds(claims);
  const hasTop5 = teams.some((t) => top5Qids.has(t));
  const hasCurrent = teamQid ? teams.includes(teamQid) : false;
  return occ || hasTop5 || hasCurrent || descFootball;
}

async function fetchCredit(url: string): Promise<{ source_url: string; author: string | null; license: string | null }> {
  const out = { source_url: url, author: null as string | null, license: null as string | null };
  try {
    const u = new URL(url);
    const segments = u.pathname.split("/").filter(Boolean);
    let filename = segments[segments.length - 1] ?? "";
    if (/^\\d+px-/i.test(filename) && segments.length >= 2) {
      filename = segments[segments.length - 2];
    }
    filename = decodeURIComponent(filename);
    if (!filename) return out;
    const apiUrl = `https://commons.wikimedia.org/w/api.php?action=query&titles=File:${encodeURIComponent(filename)}&prop=imageinfo&iiprop=extmetadata&format=json`;
    const res = await fetch(apiUrl, { headers: { "User-Agent": UA, Accept: "application/json" }, signal: AbortSignal.timeout(20_000) });
    if (!res.ok) return out;
    const json = (await res.json()) as any;
    const pages = json?.query?.pages ?? {};
    const page = Object.values(pages)[0] as any;
    const meta = page?.imageinfo?.[0]?.extmetadata ?? {};
    const artist = meta?.Artist?.value;
    const license = meta?.LicenseShortName?.value ?? meta?.License?.value ?? meta?.UsageTerms?.value;
    if (typeof artist === "string") out.author = artist.replace(/<[^>]+>/g, "").trim() || null;
    if (typeof license === "string") out.license = license.replace(/<[^>]+>/g, "").trim() || null;
  } catch {
    // leave nulls
  }
  return out;
}

async function downloadImage(url: string, dest: string, txtDest: string, name: string): Promise<boolean> {
  return pool.run(async () => {
    for (let attempt = 0; attempt <= 2; attempt++) {
      try {
        const res = await fetch(url, {
          headers: { "User-Agent": UA },
          signal: AbortSignal.timeout(20_000),
        });
        if (res.status === 404) return false;
        if (!res.ok) {
          if (attempt === 2) return false;
          await sleep(1000 * (attempt + 1));
          continue;
        }
        const ct = res.headers.get("content-type") ?? "";
        if (!ct.toLowerCase().startsWith("image/")) return false;
        const buf = Buffer.from(await res.arrayBuffer());
        if (buf.length === 0) {
          if (attempt === 2) return false;
          await sleep(1000 * (attempt + 1));
          continue;
        }
        // Resize to max 192px and convert to webp.
        const webp = await sharp(buf).resize(192, 192, { fit: "inside", withoutEnlargement: true }).webp({ quality: 80 }).toBuffer();
        await writeFile(dest, webp);
        const rtl = isRtl(name);
        const content = (rtl ? "\uFEFF" : "") + name + (rtl ? "\n" : "");
        await writeFile(txtDest, content, "utf8");
        return true;
      } catch (e) {
        if (attempt === 2) return false;
        await sleep(1000 * (attempt + 1));
      }
    }
    return false;
  });
}

interface MatchResult {
  qid: string;
  name: string;
  claims: Claims;
}

async function resolvePlayer(
  player: DbPlayer,
  teamQid: string | undefined,
  top5Qids: Set<string>,
  teamName: string,
): Promise<{ qid: string; claims: Claims; name: string } | "orphan" | "ambiguous"> {
  let hits = await searchEntities(player.full_name);
  await sleep(SEARCH_DELAY_MS);

  const normPlayer = normalizeName(player.full_name);
  let exactHits = hits.filter((h) => {
    const labelNorm = normalizeName(h.label ?? "");
    if (labelNorm === normPlayer) return true;
    const aliases = (h.aliases ?? []).map(normalizeName);
    return aliases.includes(normPlayer);
  });

  if (exactHits.length === 0 && player.short_name) {
    const hits2 = await searchEntities(player.short_name);
    await sleep(SEARCH_DELAY_MS);
    const normShort = normalizeName(player.short_name);
    exactHits = hits2.filter((h) => {
      const labelNorm = normalizeName(h.label ?? "");
      if (labelNorm === normShort) return true;
      const aliases = (h.aliases ?? []).map(normalizeName);
      return aliases.includes(normShort);
    });
    hits = hits2;
  }

  // Fallback: single football-context candidate.
  if (exactHits.length === 0) {
    const footballHits = hits.filter((h) => {
      const desc = (h.description ?? "").toLowerCase();
      return desc.includes("football") || desc.includes("soccer") || desc.includes(teamName.toLowerCase());
    });
    if (footballHits.length === 1) {
      exactHits = footballHits;
    } else if (footballHits.length > 1) {
      const teamHits = footballHits.filter((h) => (h.description ?? "").toLowerCase().includes(teamName.toLowerCase()));
      if (teamHits.length === 1) {
        exactHits = teamHits;
      } else {
        return "orphan";
      }
    } else {
      return "orphan";
    }
  }

  const qids = exactHits.map((h) => h.id);
  const claimsMap = await fetchClaims(qids);

  const candidates: Array<{ hit: SearchHit; claims: Claims; score: number; current: boolean; top5: boolean }> = [];
  for (const hit of exactHits) {
    const claims = claimsMap[hit.id] ?? {};
    const ctx = isFootballContext(hit, claims, top5Qids, teamQid, teamName);
    if (!ctx) continue;
    const teams = p54TeamIds(claims);
    const current = teamQid ? teams.includes(teamQid) : false;
    const top5 = teams.some((t) => top5Qids.has(t));
    let score = 0;
    if (current) score += 100;
    if (top5) score += 30;
    if (hasFootballOccupation(claims)) score += 20;
    const espnIds = (claims.P3681 ?? []).map((s) => s?.mainsnak?.datavalue?.value).filter(Boolean);
    if (espnIds.includes(player.id)) score += 200;
    let stmtCount = 0;
    for (const k of Object.keys(claims)) {
      stmtCount += Array.isArray((claims as any)[k]) ? (claims as any)[k].length : 0;
    }
    score += Math.min(stmtCount, 50);
    candidates.push({ hit, claims, score, current, top5 });
  }

  if (candidates.length === 0) return "orphan";

  candidates.sort((a, b) => b.score - a.score);

  if (candidates.length > 1) {
    const top = candidates[0];
    const second = candidates[1];
    const topDisambiguated = top.current || top.top5 || (top.claims.P3681 ?? []).some((s) => s?.mainsnak?.datavalue?.value === player.id);
    const secondClose = second.score >= top.score - 20;
    if (secondClose && !topDisambiguated) {
      return "ambiguous";
    }
  }

  const chosen = candidates[0];
  return { qid: chosen.hit.id, claims: chosen.claims, name: chosen.hit.label };
}

async function main(): Promise<void> {
  await mkdir(FACES_DIR, { recursive: true });

  const db = getDb();

  let teamQidMap: Record<string, string> = {};
  try {
    teamQidMap = JSON.parse(fs.readFileSync(MAP_PATH, "utf8"));
  } catch {}
  const top5Qids = new Set(Object.values(teamQidMap));

  const leaguePlaceholders = LEAGUES.map(() => "?").join(",");
  const teams = db
    .prepare(`SELECT id, name, league FROM teams WHERE league IN (${leaguePlaceholders})`)
    .all(...LEAGUES) as unknown as Array<{ id: string; name: string; league: string }>;
  const teamName = new Map<string, string>(teams.map((t) => [t.id, t.name]));

  let players = db
    .prepare(
      `SELECT p.id, p.full_name, p.short_name, p.team_id, t.league
       FROM players p JOIN teams t ON t.id = p.team_id
       WHERE t.league IN (${leaguePlaceholders})
       ORDER BY p.team_id, p.id`,
    )
    .all(...LEAGUES) as unknown as DbPlayer[];

  if (ONLY_TEAM) players = players.filter((p) => p.team_id === ONLY_TEAM);
  if (ONLY_LEAGUE) players = players.filter((p) => p.league === ONLY_LEAGUE);
  if (LIMIT && LIMIT > 0) players = players.slice(0, LIMIT);

  // checkpoint resume
  if (!REFRESH) {
    try {
      const cp = JSON.parse(fs.readFileSync(CHECKPOINT_PATH, "utf8"));
      const lastId = cp.last_player_id;
      if (lastId) {
        const idx = players.findIndex((p) => p.id === lastId);
        if (idx >= 0) players = players.slice(idx + 1);
      }
    } catch {}
  }

  const playersInScope = players.length;

  let processed = 0;
  let matched = 0;
  let downloaded = 0;
  let orphan = 0;
  let noImage = 0;
  let ambiguous = 0;
  let missing = 0;
  let wikidataP18Count = 0;
  let wikipediaPageimagesCount = 0;
  let wikipediaSearchCount = 0;

  const missingSample: Array<{ espn_id: string; name: string; team: string }> = [];
  const orphanSample: Array<{ espn_id: string; name: string; team: string }> = [];
  const ambiguousSample: Array<{ espn_id: string; name: string; team: string }> = [];

  const matchedIds = new Set<string>();
  const creditPromises: Array<Promise<{ player_id: string; source_url: string; author: string | null; license: string | null }>> = [];
  const startedAt = Date.now();

  for (let i = 0; i < players.length; i++) {
    const player = players[i];
    const espnId = player.id;
    const dest = path.join(FACES_DIR, `${espnId}.webp`);
    const txtDest = path.join(FACES_DIR, `${espnId}.txt`);

    // resumability: skip existing
    const exists = fs.existsSync(dest) && fs.statSync(dest).size > 0;
    if (exists && !REFRESH) {
      matchedIds.add(espnId);
      downloaded += 1;
      processed += 1;
      if (processed % 10 === 0) {
        await writeFile(CHECKPOINT_PATH, JSON.stringify({ last_player_id: player.id, processed, timestamp: new Date().toISOString() }) + "\n");
      }
      if (processed % 50 === 0) {
        const pct = ((processed / playersInScope) * 100).toFixed(1);
        console.log(`Player ${processed}/${playersInScope} (${pct}%) — ${downloaded} downloaded, ${orphan} orphan, ${noImage} no-image`);
      }
      continue;
    }

    const tName = teamName.get(player.team_id) ?? player.team_id;
    const teamQid = teamQidMap[player.team_id];

    let result: { qid: string; claims: Claims; name: string } | "orphan" | "ambiguous";
    try {
      result = await resolvePlayer(player, teamQid, top5Qids, tName);
    } catch (e) {
      result = "orphan";
    }

    if (result === "ambiguous") {
      ambiguous += 1;
      if (ambiguousSample.length < 10) ambiguousSample.push({ espn_id: espnId, name: player.full_name, team: tName });
    } else if (result === "orphan") {
      // Wikipedia search fallback
      let resolved = false;
      try {
        const results = await searchWikipedia(`${player.full_name} ${tName}`);
        let chosen: { title: string; snippet: string } | null = null;
        for (const r of results) {
          const snip = (r.snippet ?? "").toLowerCase().replace(/<[^>]+>/g, "");
          if (snip.includes(tName.toLowerCase()) || snip.includes("football") || snip.includes("soccer") || snip.includes("footballer")) {
            chosen = r;
            break;
          }
        }
        if (!chosen && results.length === 1) chosen = results[0];

        if (chosen) {
          const imgUrl = await fetchPageImage(chosen.title);
          if (imgUrl) {
            const ok = await downloadImage(imgUrl, dest, txtDest, chosen.title);
            if (ok) {
              wikipediaSearchCount += 1;
              matchedIds.add(espnId);
              downloaded += 1;
              resolved = true;
              creditPromises.push(fetchCredit(imgUrl).then((c) => ({ player_id: espnId, ...c })));
            } else {
              missing += 1;
              if (missingSample.length < 10) missingSample.push({ espn_id: espnId, name: chosen.title, team: tName });
            }
          }
        }
      } catch (e) {
        // fall through to orphan
      }
      if (!resolved) {
        orphan += 1;
        if (orphanSample.length < 10) orphanSample.push({ espn_id: espnId, name: player.full_name, team: tName });
      }
    } else {
      matched += 1;
      const claims = result.claims;
      const p18 = (claims.P18 ?? [])[0]?.mainsnak?.datavalue?.value;
      const wikiName = result.name;
      const qid = result.qid;

      if (p18) {
        const p18Url = commonsDownloadUrl(wikiFilenameFromImageValue(p18));
        const ok = await downloadImage(p18Url, dest, txtDest, wikiName);
        if (ok) {
          wikidataP18Count += 1;
          matchedIds.add(espnId);
          downloaded += 1;
          creditPromises.push(fetchCredit(p18Url).then((c) => ({ player_id: espnId, ...c })));
        } else {
          missing += 1;
          if (missingSample.length < 10) missingSample.push({ espn_id: espnId, name: wikiName, team: tName });
        }
      } else {
        // Wikipedia pageimages fallback via sitelink
        let resolved = false;
        try {
          const title = await fetchSitelink(qid);
          if (title) {
            const imgUrl = await fetchPageImage(title);
            if (imgUrl) {
              const ok = await downloadImage(imgUrl, dest, txtDest, title);
              if (ok) {
                wikipediaPageimagesCount += 1;
                matchedIds.add(espnId);
                downloaded += 1;
                resolved = true;
                creditPromises.push(fetchCredit(imgUrl).then((c) => ({ player_id: espnId, ...c })));
              } else {
                missing += 1;
                if (missingSample.length < 10) missingSample.push({ espn_id: espnId, name: title, team: tName });
              }
            }
          }
        } catch (e) {
          // fall through
        }
        if (!resolved && !fs.existsSync(dest)) {
          noImage += 1;
        }
      }
    }

    processed += 1;
    if (processed % 10 === 0) {
      await writeFile(CHECKPOINT_PATH, JSON.stringify({ last_player_id: player.id, processed, timestamp: new Date().toISOString() }) + "\n");
    }
    if (processed % 50 === 0) {
      const pct = ((processed / playersInScope) * 100).toFixed(1);
      console.log(`Player ${processed}/${playersInScope} (${pct}%) — ${downloaded} downloaded, ${orphan} orphan, ${noImage} no-image`);
    }

    await sleep(SEARCH_DELAY_MS);
  }

  // resolve credits (rate-limited batches)
  const credits: Array<{ player_id: string; source_url: string; author: string | null; license: string | null }> = [];
  for (let i = 0; i < creditPromises.length; i += 20) {
    const batch = creditPromises.slice(i, i + 20);
    const results = await Promise.allSettled(batch);
    for (const r of results) {
      if (r.status === "fulfilled") credits.push(r.value);
    }
  }
  try {
    await writeFile(CREDITS_PATH, JSON.stringify(credits, null, 2) + "\\n");
  } catch (e) {
    console.error("Failed to write credits:", e);
  }

  // final disk stats for matched
  let matchedFiles = 0;
  let totalBytes = 0;
  for (const id of matchedIds) {
    const f = path.join(FACES_DIR, `${id}.png`);
    try {
      const st = fs.statSync(f);
      if (st.size > 0) {
        matchedFiles += 1;
        totalBytes += st.size;
      }
    } catch {}
  }

  const manifest = {
    generated_at: new Date().toISOString(),
    source: "wikidata-p18 + wikipedia-pageimages-fallback",
    leagues: [...LEAGUES],
    total_in_scope: playersInScope,
    matched,
    downloaded: matchedFiles,
    orphan,
    no_image: noImage,
    ambiguous,
    wikidata_p18_only: wikidataP18Count,
    wikipedia_pageimages_fallback: wikipediaPageimagesCount,
    wikipedia_search_fallback: wikipediaSearchCount,
    total_size_kb: Math.round(totalBytes / 1024),
    runtime_seconds: Math.round((Date.now() - startedAt) / 1000),
    missing_sample: missingSample,
    orphan_sample: orphanSample,
    ambiguous_sample: ambiguousSample,
  };

  await writeFile(MANIFEST_PATH, JSON.stringify(manifest, null, 2) + "\n");

  console.log("");
  console.log("=== SUMMARY ===");
  console.log(`Players in scope   : ${playersInScope}`);
  console.log(`Matched (QID)      : ${matched}`);
  console.log(`Downloaded         : ${matchedFiles}`);
  console.log(`Missing (dl fail)  : ${missing}`);
  console.log(`Orphan             : ${orphan}`);
  console.log(`No image           : ${noImage}`);
  console.log(`Ambiguous          : ${ambiguous}`);
  console.log(`Wikidata P18       : ${wikidataP18Count}`);
  console.log(`Wikipedia pageimg  : ${wikipediaPageimagesCount}`);
  console.log(`Wikipedia search   : ${wikipediaSearchCount}`);
  console.log(`Total size (KB)    : ${Math.round(totalBytes / 1024)}`);
  console.log(`Runtime (s)        : ${Math.round((Date.now() - startedAt) / 1000)}`);
  console.log(`Manifest           : ${MANIFEST_PATH}`);
}

main().catch((err) => {
  console.error("FATAL:", err);
  process.exit(1);
});
