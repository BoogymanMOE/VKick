#!/usr/bin/env node
/**
 * One-time (re-runnable) logo bundler — dev tool, NOT part of the sync loop.
 *
 *   npm run fetch-logos                          fetch missing + regen outputs
 *   node scripts/fetch-logos.mjs --manifest-only  regen manifest from the folder
 *   node scripts/fetch-logos.mjs --force          re-download everything
 *   node scripts/fetch-logos.mjs --limit 5        smoke-test on 5 teams
 *
 * Reads teams from the local database (SQLITE_PATH, --db, or ./data/matchday.db),
 * downloads each crest from its ESPN source URL, and writes:
 *   public/logos/<espnTeamId>.png  — 96px canvas PNG, artwork trimmed and
 *                                     normalized to one footprint (see
 *                                     scripts/logo-normalize.mjs); largest
 *                                     in-app use is the 48px badge, 2x retina
 *   public/logos/<espnTeamId>.webp — same crest, what the browser downloads
 *   src/data/logos.json            — manifest { teamId: "<id>.png" }
 *   src/data/team-colors.json      — { teamId: "#RRGGBB" } from ESPN, falling
 *                                     back to the bundled logo's dominant
 *                                     color, then a neutral default
 *   src/data/team-overrides.json   — created ONCE as {}; never touched again
 *                                     (hand edits win, re-runs can't clobber)
 *
 * Safe to re-run: existing files are skipped, failures retry 3x and are
 * printed at the end. Override workflow: drop <teamId>.png into public/logos
 * and re-run with --manifest-only.
 */
import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import { normalizeCrest, toWebp } from "./logo-normalize.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT_DIR = path.join(ROOT, "public", "logos");
const DATA_DIR = path.join(ROOT, "src", "data");
const NEUTRAL = "#7B958C"; // == TEAM_FALLBACK (src/lib/colors.ts)
const RETRIES = 3;

const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const flag = (name) => args.includes(name);
const DB_PATH = process.env.SQLITE_PATH ?? opt("--db", path.join(ROOT, "data", "matchday.db"));
const LIMIT = opt("--limit", null) ? parseInt(opt("--limit", "0"), 10) : null;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function espnUrl(team) {
  if (team.logo_url) return team.logo_url;
  return `https://a.espncdn.com/i/teamlogos/soccer/500/${team.id}.png`;
}

async function download(url) {
  let last = null;
  for (let attempt = 1; attempt <= RETRIES; attempt++) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(20000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.length < 512) throw new Error(`suspiciously small (${buf.length}b)`);
      return buf;
    } catch (err) {
      last = err;
      await sleep(500 * attempt);
    }
  }
  throw last;
}

/** Dominant opaque color of a PNG: 12px thumbnail, alpha>128, 4-bit buckets. */
async function dominantColor(pngBuffer) {
  try {
    const { data, info } = await sharp(pngBuffer)
      .resize(12, 12, { fit: "fill" })
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    const votes = new Map();
    for (let i = 0; i < info.size; i += info.channels) {
      const a = data[i + 3];
      if (a !== undefined && a < 128) continue;
      const key = ((data[i] >> 4) << 8) | ((data[i + 1] >> 4) << 4) | (data[i + 2] >> 4);
      votes.set(key, (votes.get(key) ?? 0) + 1);
    }
    if (votes.size === 0) return null;
    let best = 0;
    let bestCount = -1;
    for (const [k, n] of votes)
      if (n > bestCount) {
        best = k;
        bestCount = n;
      }
    const r = ((best >> 8) & 0xf) * 17;
    const g = ((best >> 4) & 0xf) * 17;
    const b = (best & 0xf) * 17;
    return (
      "#" +
      [r, g, b]
        .map((v) => v.toString(16).padStart(2, "0"))
        .join("")
        .toUpperCase()
    );
  } catch {
    return null;
  }
}

function normalizeHex(raw) {
  if (!raw) return null;
  const m = String(raw)
    .trim()
    .match(/^#?([0-9a-fA-F]{6})$/);
  return m ? `#${m[1].toUpperCase()}` : null;
}

/** ESPN's "no brand color" sentinel — treated as missing, not as black. */
function isMissingColor(hex) {
  return !hex || hex === "#000000";
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.mkdirSync(DATA_DIR, { recursive: true });

  const overridesPath = path.join(DATA_DIR, "team-overrides.json");
  if (!fs.existsSync(overridesPath)) {
    fs.writeFileSync(overridesPath, "{}\n");
    console.log("created empty src/data/team-overrides.json (hand-edit; never overwritten)");
  }

  if (flag("--manifest-only")) {
    writeManifest();
    return;
  }

  if (!fs.existsSync(DB_PATH)) throw new Error(`database not found: ${DB_PATH}`);
  const db = new DatabaseSync(DB_PATH, { readonly: true });
  let teams = db.prepare("SELECT id, name, logo_url, color FROM teams ORDER BY id").all();
  db.close();
  if (LIMIT) teams = teams.slice(0, LIMIT);
  console.log(`teams in db: ${teams.length}`);

  let fetched = 0;
  let skipped = 0;
  let bytes = 0;
  const failures = [];
  const colors = {};
  for (const team of teams) {
    const file = `${team.id}.png`;
    const dest = path.join(OUT_DIR, file);
    let buffer = null;
    if (fs.existsSync(dest) && !flag("--force")) {
      skipped++;
      try {
        buffer = fs.readFileSync(dest);
        bytes += buffer.length;
      } catch {
        /* count below instead */
      }
    } else {
      try {
        const raw = await download(espnUrl(team));
        const processed = await normalizeCrest(raw);
        if (!processed) throw new Error("could not process image");
        fs.writeFileSync(dest, processed);
        const webp = await toWebp(processed);
        if (webp) fs.writeFileSync(dest.replace(/\.png$/, ".webp"), webp);
        buffer = processed;
        bytes += processed.length;
        fetched++;
      } catch (err) {
        failures.push({ id: String(team.id), name: team.name, error: String(err?.message ?? err) });
        continue;
      }
    }
    // Color chain: ESPN -> bundled-logo dominant -> neutral default.
    const espn = normalizeHex(team.color);
    if (!isMissingColor(espn)) {
      colors[String(team.id)] = espn;
    } else if (buffer) {
      colors[String(team.id)] = (await dominantColor(buffer)) ?? NEUTRAL;
    } else {
      colors[String(team.id)] = NEUTRAL;
    }
  }

  fs.writeFileSync(path.join(DATA_DIR, "team-colors.json"), JSON.stringify(colors, null, 2) + "\n");
  const manifestCount = writeManifest();

  const files = fs.readdirSync(OUT_DIR).filter((f) => f.endsWith(".png"));
  const totalBytes = files.reduce((n, f) => {
    try {
      return n + fs.statSync(path.join(OUT_DIR, f)).size;
    } catch {
      return n;
    }
  }, 0);
  console.log(
    `fetched: ${fetched}, skipped: ${skipped}, files: ${files.length}, total: ${(totalBytes / 1024).toFixed(0)} KB, manifest: ${manifestCount}`,
  );
  if (failures.length > 0) {
    console.log("FAILED:");
    for (const f of failures) console.log(`  ${f.id} ${f.name}: ${f.error}`);
  }
}

/** Manifest = every png in the folder (covers hand-dropped overrides too). */
function writeManifest() {
  const manifest = {};
  for (const f of fs.readdirSync(OUT_DIR)) {
    const m = f.match(/^(.+)\.png$/);
    if (m) manifest[m[1]] = f;
  }
  fs.writeFileSync(path.join(DATA_DIR, "logos.json"), JSON.stringify(manifest, null, 2) + "\n");
  console.log(`manifest: ${Object.keys(manifest).length} entries -> src/data/logos.json`);
  return Object.keys(manifest).length;
}

await main();
