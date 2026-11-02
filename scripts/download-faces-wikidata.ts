import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { mkdir, writeFile } from "node:fs/promises";
import sharp from "sharp";
import { getDb, all } from "../server/db/index.ts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const FACES_DIR = path.join(ROOT, "public", "faces");
const CREDITS_PATH = path.join(FACES_DIR, "credits.json");
const REJECTS_PATH = path.join(ROOT, "scripts", "face-rejects-wikidata.txt");
const UA = "VKickBot/1.0 (contact: github.com/BoogymanMOE/VKick)";
const SEARCH_DELAY_MS = 2000;
const teamQidMap = JSON.parse(fs.readFileSync(path.join(ROOT, "scripts", "team-qid-map.json"), "utf8"));
const top5Qids = new Set(Object.values(teamQidMap));

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const normalize = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

async function fetchJson(url: string): Promise<any> {
  for (let attempt = 0; attempt <= 6; attempt++) {
    const res = await fetch(url, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(20_000) });
    if (res.status === 429 || res.status === 503) {
      const retry = parseInt(res.headers.get("retry-after") ?? "10", 10);
      await sleep((retry || 10) * 1000 * (attempt + 1));
      continue;
    }
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  }
  throw new Error("max retries");
}

async function searchEntities(name: string): Promise<Array<{ id: string; label: string; description?: string; aliases?: string[] }>> {
  const url = `https://www.wikidata.org/w/api.php?action=wbsearchentities&search=${encodeURIComponent(name)}&language=en&format=json&limit=5`;
  const json = await fetchJson(url);
  return json?.search ?? [];
}

async function fetchClaims(qids: string[]): Promise<Record<string, any>> {
  if (qids.length === 0) return {};
  const url = `https://www.wikidata.org/w/api.php?action=wbgetentities&ids=${qids.join("|")}&props=claims&format=json`;
  const json = await fetchJson(url);
  return json?.entities ?? {};
}

function p18Filename(claims: any): string | null {
  const p18 = claims?.P18?.[0]?.mainsnak?.datavalue?.value;
  return typeof p18 === "string" ? p18 : null;
}

function p54Teams(claims: any): string[] {
  const arr = claims?.P54 ?? [];
  return arr.map((c: any) => c?.mainsnak?.datavalue?.value?.id).filter(Boolean);
}

function hasOccupation(claims: any, qid: string): boolean {
  const arr = claims?.P106 ?? [];
  return arr.some((c: any) => c?.mainsnak?.datavalue?.value?.id === qid);
}

async function downloadWebp(url: string, dest: string): Promise<boolean> {
  for (let attempt = 0; attempt <= 2; attempt++) {
    try {
      const res = await fetch(url, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(20_000) });
      if (res.status === 404) return false;
      if (!res.ok) { if (attempt === 2) return false; await sleep(1000); continue; }
      const ct = res.headers.get("content-type") ?? "";
      if (!ct.toLowerCase().startsWith("image/")) return false;
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.length === 0) { if (attempt === 2) return false; await sleep(1000); continue; }
      const webp = await sharp(buf).resize(192, 192, { fit: "inside", withoutEnlargement: true }).webp({ quality: 80 }).toBuffer();
      await writeFile(dest, webp);
      return true;
    } catch (e) {
      if (attempt === 2) return false;
      await sleep(1000);
    }
  }
  return false;
}

async function main() {
  await mkdir(FACES_DIR, { recursive: true });
  const db = getDb();
  const missingIds = fs.readFileSync(path.join(ROOT, "scripts", "players-without-face.txt"), "utf8")
    .split("\n").map((l) => l.split("\t")[2]).filter(Boolean);
  // dedupe
  const unique = [...new Set(missingIds)];
  console.log("Missing players to try via Wikidata:", unique.length);

  const players = all<{ id: string; full_name: string; short_name: string | null; team_id: string; league: string }>(
    db,
    `SELECT p.id, p.full_name, p.short_name, p.team_id, t.league FROM players p JOIN teams t ON t.id=p.team_id WHERE p.id IN (${unique.map(() => "?").join(",")})`,
    unique,
  );
  const byId = new Map(players.map((p) => [p.id, p]));

  const rejects: string[] = [];
  const credits = JSON.parse(fs.readFileSync(CREDITS_PATH, "utf8"));
  const creditIds = new Set(credits.map((c: any) => c.player_id));

  let downloaded = 0;
  for (let i = 0; i < unique.length; i++) {
    const id = unique[i];
    const p = byId.get(id);
    if (!p) continue;
    const dest = path.join(FACES_DIR, `${id}.webp`);
    if (fs.existsSync(dest)) continue; // already has face
    const teamQid = teamQidMap[p.team_id];

    try {
      const hits = await searchEntities(p.full_name);
      await sleep(SEARCH_DELAY_MS);
      const normName = p.full_name.toLowerCase();
      const exact = hits.filter((h) => h.label.toLowerCase() === normName || (h.aliases ?? []).some((a) => a.toLowerCase() === normName));
      if (exact.length === 0) {
        rejects.push(`${id}\t${p.full_name}\t${p.team_id}\t${p.league}\tno wikidata match`);
        continue;
      }
      const claimsMap = await fetchClaims(exact.map((h) => h.id));
      // pick best candidate
      let chosen: { qid: string; claims: any } | null = null;
      for (const h of exact) {
        const claims = claimsMap[h.id] ?? {};
        if (!hasOccupation(claims, "Q937857")) continue;
        const teams = p54Teams(claims);
        const current = teamQid ? teams.includes(teamQid) : false;
        const top5 = teams.some((t: string) => top5Qids.has(t));
        if (!current && !top5) continue;
        chosen = { qid: h.id, claims };
        break;
      }
      if (!chosen) {
        rejects.push(`${id}\t${p.full_name}\t${p.team_id}\t${p.league}\tno footballer claim`);
        continue;
      }
      const filename = p18Filename(chosen.claims);
      if (!filename) {
        rejects.push(`${id}\t${p.full_name}\t${p.team_id}\t${p.league}\tno P18`);
        continue;
      }
      const url = `https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(filename.replace(/_/g, " "))}?width=200`;
      const ok = await downloadWebp(url, dest);
      if (ok) {
        downloaded++;
        if (!creditIds.has(id)) {
          credits.push({ player_id: id, player_name: p.full_name, source_url: url, author: null, license: null });
          creditIds.add(id);
        }
      } else {
        rejects.push(`${id}\t${p.full_name}\t${p.team_id}\t${p.league}\tdownload failed`);
      }
    } catch (e) {
      rejects.push(`${id}\t${p.full_name}\t${p.team_id}\t${p.league}\terror: ${String(e)}`);
    }
    if (i % 10 === 0) {
      fs.writeFileSync(REJECTS_PATH, rejects.join("\n") + (rejects.length ? "\n" : ""));
      fs.writeFileSync(CREDITS_PATH, JSON.stringify(credits, null, 2) + "\n");
      console.log(`Wikidata pass: ${i + 1}/${unique.length}, downloaded ${downloaded}, rejected ${rejects.length}`);
    }
  }
  fs.writeFileSync(REJECTS_PATH, rejects.join("\n") + (rejects.length ? "\n" : ""));
  fs.writeFileSync(CREDITS_PATH, JSON.stringify(credits, null, 2) + "\n");
  console.log(`DONE: downloaded ${downloaded}, rejected ${rejects.length}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
