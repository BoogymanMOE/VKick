/**
 * Download current-season player photos from Wikipedia (batched MediaWiki API).
 *
 * Strategy:
 *   - For each player, try the Wikipedia article "{name} (footballer)", then the
 *     plain "{name}" article. Accept only footballers (description/categories).
 *   - Batch up to 50 titles per MediaWiki request (pageimages + description +
 *     pageprops + categories). Fetch extmetadata (author/license) in batches.
 *   - Concurrency 2, respect maxlag / 429 with backoff.
 *   - Resize to 192px, convert to webp, write credits.json.
 *
 * Usage: npm run download-faces-wiki [-- --league=eng.1] [-- --limit=50] [-- --refresh]
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { mkdir, writeFile } from "node:fs/promises";
import sharp from "sharp";
import { getDb, all } from "../server/db/index.ts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const FACES_DIR = path.join(ROOT, "public", "faces");
const CREDITS_PATH = path.join(FACES_DIR, "credits.json");
const REJECTS_PATH = path.join(ROOT, "scripts", "face-rejects.txt");
const CHECKPOINT_PATH = path.join(ROOT, "scripts", "download-faces-wiki-progress.json");
const LEAGUE_ORDER = ["eng.1", "fra.1", "esp.1", "ita.1", "ger.1"] as const;
const UA = "VKickBot/1.0 (contact: github.com/BoogymanMOE/VKick)";
const API = "https://en.wikipedia.org/w/api.php";
const BATCH = 50;
const MAX_CONCURRENCY = 2;
const MAXLAG = 5;

const args = process.argv.slice(2);
const REFRESH = args.includes("--refresh");
const leagueArg = args.find((a) => a.startsWith("--league="));
const ONLY_LEAGUE = leagueArg ? leagueArg.split("=")[1] : null;
const limitArg = args.find((a) => a.startsWith("--limit="));
const LIMIT = limitArg ? parseInt(limitArg.split("=")[1], 10) : null;

interface DbPlayer {
  id: string;
  full_name: string;
  short_name: string | null;
  team_id: string;
  team_name: string;
  league: string;
}

interface PageResult {
  title: string;
  pageid?: number;
  missing?: boolean;
  description?: string;
  pageprops?: { disambiguation?: string; [k: string]: unknown };
  categories?: Array<{ title: string }>;
  thumbnail?: { source: string; width: number; height: number };
  original?: { source: string };
}

// ---- concurrency limiter ----
let active = 0;
const queue: Array<() => void> = [];
function acquire(): Promise<void> {
  return new Promise((resolve) => {
    const tryRun = () => {
      if (active < MAX_CONCURRENCY) {
        active++;
        resolve();
      } else {
        queue.push(tryRun);
      }
    };
    tryRun();
  });
}
function release() {
  active--;
  const next = queue.shift();
  if (next) next();
}
async function withConcurrency<T>(fn: () => Promise<T>): Promise<T> {
  await acquire();
  try {
    return await fn();
  } finally {
    release();
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function isFootballPage(p: PageResult): boolean {
  if (p.missing) return false;
  if (p.pageprops?.disambiguation) return false;
  const desc = (p.description ?? "").toLowerCase();
  if (desc.includes("footballer") || desc.includes("soccer player")) return true;
  const cats = (p.categories ?? []).map((c) => c.title.toLowerCase());
  if (cats.some((c) => c.includes("football") || c.includes("soccer"))) return true;
  return false;
}

async function apiGet(params: Record<string, string>): Promise<any> {
  const full = { ...params, format: "json", maxlag: String(MAXLAG) };
  const url = API + "?" + new URLSearchParams(full).toString();
  for (let attempt = 0; attempt <= 6; attempt++) {
    try {
      const res = await fetch(url, { headers: { "User-Agent": UA, Accept: "application/json" }, signal: AbortSignal.timeout(30_000) });
      if (res.status === 429 || res.status === 503) {
        const retry = parseInt(res.headers.get("retry-after") ?? "5", 10);
        await sleep((retry || 5) * 1000 * (attempt + 1));
        continue;
      }
      const json = await res.json();
      if (json?.error?.code === "maxlag") {
        const lag = Number(json.error.lag ?? MAXLAG);
        await sleep((lag + 1) * 1000);
        continue;
      }
      if (json?.error) {
        throw new Error(`API error: ${json.error.code} ${json.error.info}`);
      }
      return json;
    } catch (e) {
      if (attempt === 6) throw e;
      await sleep(1000 * (attempt + 1));
    }
  }
  throw new Error("unreachable");
}

async function fetchPages(titles: string[]): Promise<Map<string, PageResult>> {
  if (titles.length === 0) return new Map();
  const map = new Map<string, PageResult>();
  const chunks: string[][] = [];
  for (let i = 0; i < titles.length; i += BATCH) chunks.push(titles.slice(i, i + BATCH));
  await Promise.all(chunks.map((chunk) => withConcurrency(async () => {
    const json = await apiGet({
      action: "query",
      titles: chunk.join("|"),
      prop: "pageimages|description|pageprops|categories",
      piprop: "thumbnail",
      pithumbsize: "192",
      redirects: "1",
      cllimit: "20",
    });
    const pages = json?.query?.pages ?? {};
    for (const pid of Object.keys(pages)) {
      const p = pages[pid] as PageResult;
      map.set(p.title, p);
      // also map by original title (redirects)
    }
    // map normalized titles
    const normalized = json?.query?.normalized ?? [];
    for (const n of normalized) {
      // find page with to title
      const p = map.get(n.to);
      if (p) map.set(n.from, p);
    }
  })));
  return map;
}

async function fetchImageInfo(filenames: string[]): Promise<Map<string, { author: string | null; license: string | null }>> {
  const map = new Map<string, { author: string | null; license: string | null }>();
  if (filenames.length === 0) return map;
  const chunks: string[][] = [];
  for (let i = 0; i < filenames.length; i += BATCH) chunks.push(filenames.slice(i, i + BATCH));
  await Promise.all(chunks.map((chunk) => withConcurrency(async () => {
    const titles = chunk.map((f) => "File:" + f).join("|");
    const json = await apiGet({
      action: "query",
      titles,
      prop: "imageinfo",
      iiprop: "extmetadata",
    });
    const pages = json?.query?.pages ?? {};
    for (const pid of Object.keys(pages)) {
      const p = pages[pid] as any;
      const info = p?.imageinfo?.[0];
      const meta = info?.extmetadata ?? {};
      const artist = meta?.Artist?.value;
      const license = meta?.LicenseShortName?.value ?? meta?.License?.value ?? meta?.UsageTerms?.value;
      const filename = (p.title as string).replace(/^File:/, "");
      map.set(filename, {
        author: typeof artist === "string" ? artist.replace(/<[^>]+>/g, "").trim() || null : null,
        license: typeof license === "string" ? license.replace(/<[^>]+>/g, "").trim() || null : null,
      });
    }
  })));
  return map;
}

async function downloadImage(url: string, dest: string): Promise<boolean> {
  return (async () => {
    for (let attempt = 0; attempt <= 2; attempt++) {
      try {
        const res = await fetch(url, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(20_000) });
        if (res.status === 404) return false;
        if (res.status === 429) {
          const retry = parseInt(res.headers.get("retry-after") ?? "5", 10);
          await sleep((retry || 5) * 1000);
          continue;
        }
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
        const webp = await sharp(buf).resize(192, 192, { fit: "inside", withoutEnlargement: true }).webp({ quality: 80 }).toBuffer();
        await writeFile(dest, webp);
        return true;
      } catch (e) {
        if (attempt === 2) return false;
        await sleep(1000 * (attempt + 1));
      }
    }
    return false;
  })();
}

async function main() {
  await mkdir(FACES_DIR, { recursive: true });

  const db = getDb();
  const leaguesToRun = ONLY_LEAGUE ? [ONLY_LEAGUE] : [...LEAGUE_ORDER];
  // build player list in league order
  let players: DbPlayer[] = [];
  for (const lg of leaguesToRun) {
    const rows = all<{ id: string; full_name: string; short_name: string | null; team_id: string; team_name: string; league: string }>(
      db,
      `SELECT p.id, p.full_name, p.short_name, p.team_id, t.name AS team_name, t.league
       FROM players p JOIN teams t ON t.id = p.team_id
       WHERE t.league = ?
       ORDER BY p.team_id, p.id`,
      [lg],
    );
    players.push(...rows.map((r) => ({ id: r.id, full_name: r.full_name, short_name: r.short_name, team_id: r.team_id, team_name: r.team_name, league: r.league })));
  }
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

  const total = players.length;
  console.log(`Players to process: ${total}`);
  console.log(`Estimated time: ~${Math.ceil(total / 50)} batches, ~${Math.ceil(total / 50) * 1} min`);

  let processed = 0;
  let downloaded = 0;
  let noImage = 0;
  let rejected = 0;
  const credits: Array<{ player_id: string; source_url: string; author: string | null; license: string | null }> = [];
  const rejects: string[] = [];

  // load existing rejects
  try {
    if (fs.existsSync(REJECTS_PATH)) {
      const existing = fs.readFileSync(REJECTS_PATH, "utf8").trim();
      if (existing) rejects.push(...existing.split("\n"));
    }
  } catch {}

  for (let i = 0; i < players.length; i += BATCH) {
    const batch = players.slice(i, i + BATCH);
    // skip already downloaded
    const toFetch = batch.filter((p) => !fs.existsSync(path.join(FACES_DIR, `${p.id}.webp`)));
    // still count skipped as processed
    for (const p of batch) {
      if (fs.existsSync(path.join(FACES_DIR, `${p.id}.webp`))) {
        processed++;
      }
    }
    if (toFetch.length === 0) {
      // update checkpoint
      const last = batch[batch.length - 1];
      await writeFile(CHECKPOINT_PATH, JSON.stringify({ last_player_id: last.id, processed: i + batch.length, timestamp: new Date().toISOString() }) + "\n");
      continue;
    }

    // Pass 1: footballer titles
    const ftTitles = toFetch.map((p) => `${p.full_name} (footballer)`);
    const ftPages = await fetchPages(ftTitles);

    const chosen = new Map<string, { title: string; page: PageResult }>(); // playerId -> chosen
    const needPlain: DbPlayer[] = [];

    for (const p of toFetch) {
      const title = `${p.full_name} (footballer)`;
      const page = ftPages.get(title);
      if (page && isFootballPage(page) && page.thumbnail?.source) {
        chosen.set(p.id, { title, page });
      } else {
        needPlain.push(p);
      }
    }

    // Pass 2: plain name titles
    if (needPlain.length > 0) {
      const plainTitles = needPlain.map((p) => p.full_name);
      const plainPages = await fetchPages(plainTitles);
      for (const p of needPlain) {
        const title = p.full_name;
        const page = plainPages.get(title);
        if (page && isFootballPage(page) && page.thumbnail?.source) {
          // reject disambiguation (already handled) and require unique-ish: if page title != name, still ok if football
          chosen.set(p.id, { title, page });
        } else {
          // rejected
          rejected++;
          rejects.push(`${p.id}\t${p.full_name}\t${p.team_name}\t${p.league}\tno football page`);
        }
      }
    }

    // Download images
    const chosenPlayers = toFetch.filter((p) => chosen.has(p.id));
    for (const p of chosenPlayers) {
      const { page } = chosen.get(p.id)!;
      const imgUrl = page.thumbnail!.source;
      const dest = path.join(FACES_DIR, `${p.id}.webp`);
      const ok = await downloadImage(imgUrl, dest);
      if (ok) {
        downloaded++;
        // fetch credit later in batch
      } else {
        noImage++;
        rejects.push(`${p.id}\t${p.full_name}\t${p.team_name}\t${p.league}\tdownload failed`);
      }
    }

    // Fetch imageinfo for chosen files (batch)
    const chosenFiles = chosenPlayers
      .filter((p) => fs.existsSync(path.join(FACES_DIR, `${p.id}.webp`)))
      .map((p) => {
        const url = chosen.get(p.id)!.page.thumbnail!.source;
        // extract filename from URL
        const u = new URL(url);
        const segs = u.pathname.split("/").filter(Boolean);
        let fn = segs[segs.length - 1] ?? "";
        if (/^\d+px-/i.test(fn) && segs.length >= 2) fn = segs[segs.length - 2];
        return decodeURIComponent(fn);
      });
    const infoMap = await fetchImageInfo(chosenFiles);
    for (const p of chosenPlayers) {
      if (!fs.existsSync(path.join(FACES_DIR, `${p.id}.webp`))) continue;
      const url = chosen.get(p.id)!.page.thumbnail!.source;
      const u = new URL(url);
      const segs = u.pathname.split("/").filter(Boolean);
      let fn = segs[segs.length - 1] ?? "";
      if (/^\d+px-/i.test(fn) && segs.length >= 2) fn = segs[segs.length - 2];
      fn = decodeURIComponent(fn);
      const info = infoMap.get(fn);
      credits.push({
        player_id: p.id,
        player_name: p.full_name,
        source_url: url,
        author: info?.author ?? null,
        license: info?.license ?? null,
      });
    }

    processed += batch.length;
    const last = batch[batch.length - 1];
    await writeFile(CHECKPOINT_PATH, JSON.stringify({ last_player_id: last.id, processed: i + batch.length, timestamp: new Date().toISOString() }) + "\n");

    // write rejects
    await writeFile(REJECTS_PATH, rejects.join("\n") + (rejects.length ? "\n" : ""));

    console.log(`Batch ${Math.floor(i / BATCH) + 1}: processed ${i + batch.length}/${total}, downloaded ${downloaded}, rejected ${rejected}, noImage ${noImage}`);
  }

  // merge with existing credits
  let existing: Array<{ player_id: string; source_url: string | null; author: string | null; license: string | null }> = [];
  try { existing = JSON.parse(fs.readFileSync(CREDITS_PATH, "utf8")); } catch {}
  const byId = new Map(existing.map((c) => [c.player_id, c]));
  for (const c of credits) byId.set(c.player_id, c);
  const merged = [...byId.values()];
  await writeFile(CREDITS_PATH, JSON.stringify(merged, null, 2) + "\n");
  // verify every webp has a credit entry
  const webpFiles = fs.readdirSync(FACES_DIR).filter((f) => f.endsWith(".webp"));
  const creditIds = new Set(merged.map((c) => c.player_id));
  const missingCredits = webpFiles.map((f) => f.replace(/\.webp$/, "")).filter((id) => !creditIds.has(id));
  if (missingCredits.length > 0) {
    throw new Error(`Missing credits for ${missingCredits.length} files: ${missingCredits.slice(0, 10).join(", ")}`);
  }

  // summary
  const webpCount = fs.readdirSync(FACES_DIR).filter((f) => f.endsWith(".webp")).length;
  console.log(`\n=== DONE ===`);
  console.log(`Processed: ${processed}`);
  console.log(`Downloaded: ${downloaded}`);
  console.log(`Rejected (no football page): ${rejected}`);
  console.log(`No image: ${noImage}`);
  console.log(`Total webp on disk: ${webpCount}`);
  console.log(`Credits: ${credits.length}`);
}

main().catch((err) => {
  console.error("FATAL:", err);
  process.exit(1);
});
