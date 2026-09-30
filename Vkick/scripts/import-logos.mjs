#!/usr/bin/env node
/**
 * Local logo importer — dev tool, NOT part of the sync loop. Companion to
 * fetch-logos.mjs, which pulls crests from ESPN's CDN; this one sources them
 * from a checked-out crest collection on disk (default ./football-logos-master).
 *
 *   npm run import-logos                     match + import (skips existing)
 *   node scripts/import-logos.mjs --dry-run  report only, no writes
 *   node scripts/import-logos.mjs --force    re-import over existing files
 *   node scripts/import-logos.mjs --limit 5  smoke-test on N teams
 *   node scripts/import-logos.mjs --normalize-only
 *                                            re-scale every crest in place,
 *                                            whatever source it came from
 *   node scripts/import-logos.mjs --src <dir>       nested collection (default
 *                                            ./football-logos-master/logos)
 *   node scripts/import-logos.mjs --flat-src <dir>  flat rest-of-world dump
 *                                            (default ./512x512)
 *
 * Two sources, tried in order:
 *   1. the nested collection (--src), one folder per league, "Club Name.png"
 *   2. the flat dump (--flat-src), one directory of "club-slug.football-logos.cc.png"
 * The flat one is a FALLBACK: it is only consulted for a club the nested
 * source couldn't place, so existing crests are never swapped for a worse
 * match. It is what covers the rest of the world — the European qualifying
 * long tail (Pafos, Riga FC, Kairat Almaty) and national teams, which the
 * nested collection doesn't carry at all.
 *
 * Reads teams from the local database (SQLITE_PATH, --db, or ./data/matchday.db),
 * matches each club to a crest file by name (see ALIASES for the hand-curated
 * ones fuzzy matching can't resolve), and writes:
 *   public/logos/<espnTeamId>.png  — 96px optimized PNG, same pipeline as
 *                                   fetch-logos.mjs so the two sources are
 *                                   interchangeable
 *   src/data/logos.json             — manifest { teamId: "<id>.png" }
 *
 * Clubs with no crest in the source collection keep whatever file they already
 * have (typically the ESPN download), so coverage only ever grows.
 */
import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import { ARTWORK_PX, CANVAS_PX, normalizeCrest, toWebp } from "./logo-normalize.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT_DIR = path.join(ROOT, "public", "logos");
const DATA_DIR = path.join(ROOT, "src", "data");

const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const flag = (name) => args.includes(name);
const DB_PATH = process.env.SQLITE_PATH ?? opt("--db", path.join(ROOT, "data", "matchday.db"));
const SOURCE_DIR = path.resolve(ROOT, opt("--src", path.join(ROOT, "football-logos-master", "logos")));
const FLAT_SRC = path.resolve(ROOT, opt("--flat-src", path.join(ROOT, "512x512")));
/** The naming convention of the flat dump; also used to recognise it. */
const FLAT_SUFFIX = /\.football-logos\.cc$/i;
/** Pseudo-folder for flat entries, so `pick()`'s league preference ignores them. */
const FLAT_FOLDER = "(flat)";
const LIMIT = opt("--limit", null) ? parseInt(opt("--limit", "0"), 10) : null;
const ACCEPT = 0.9;

/** League folder per ESPN league code — breaks ties between same-named crests. */
const LEAGUE_FOLDER = {
  "eng.1": "England - Premier League",
  "esp.1": "Spain - LaLiga",
  "fra.1": "France - Ligue 1",
  "ger.1": "Germany - Bundesliga",
  "ita.1": "Italy - Serie A",
  "ned.1": "Netherlands - Eredivisie",
  "por.1": "Portugal - Liga Portugal",
  "den.1": "Denmark - Superliga",
  "sco.1": "Scotland - Scottish Premiership",
  "gre.1": "Greece - Super League 1",
  "tur.1": "Turkiye - Super Lig",
  "aut.1": "Austria - Bundesliga",
  "bel.1": "Belgium - Jupiler Pro League",
  "bul.1": "Bulgaria - efbet Liga",
  "cro.1": "Croatia - SuperSport HNL",
  "cze.1": "Czech Republic - Chance Liga",
  "nor.1": "Norway - Eliteserien",
  "pol.1": "Poland - PKO BP Ekstraklasa",
  "rou.1": "Romania - SuperLiga",
  "rus.1": "Russia - Premier Liga",
  "srb.1": "Serbia - Super liga Srbije",
  "swe.1": "Sweden - Allsvenskan",
  "sui.1": "Switzerland - Super League",
  "isr.1": "Israel - Ligat ha'Al",
  "ukr.1": "Ukraine - Premier Liga",
};

/** Club-name noise that carries no identity: legal forms, founding years, cities. */
const STOP = new Set([
  "fc",
  "cf",
  "afc",
  "ac",
  "as",
  "sc",
  "ss",
  "ssc",
  "uss",
  "us",
  "ud",
  "cd",
  "rc",
  "rcd",
  "fk",
  "sk",
  "sv",
  "vfl",
  "vfb",
  "tsv",
  "tsg",
  "bsc",
  "fsv",
  "sd",
  "sdz",
  "spv",
  "sge",
  "gk",
  "ca",
  "club",
  "calcio",
  "if",
  "ik",
  "bk",
  "ff",
  "aif",
  "ks",
  "ko",
  "sl",
  "kv",
  "kaa",
  "kk",
  "de",
  "do",
  "da",
  "del",
  "la",
  "el",
  "of",
  "the",
  "cp",
  "cpx",
]);

/** Explicit wins where normalized names still differ. Key: club name, value: source file. */
const ALIASES = {
  "Athletic Bilbao": "Athletic Bilbao.png",
  "Deportivo Alavés": "Deportivo Alavés.png",
  Deportivo: "Deportivo A Coruña.png",
  "Celta Vigo": "Celta de Vigo.png",
  Málaga: "Málaga CF.png",
  Levante: "Levante UD.png",
  Getafe: "Getafe CF.png",
  "Rayo Vallecano": "Rayo Vallecano.png",
  "AJ Auxerre": "AJ Auxerre.png",
  Lens: "RC Lens.png",
  Strasbourg: "RC Strasbourg Alsace.png",
  Troyes: "ESTAC Troyes.png",
  "Le Mans": "Le Mans FC.png",
  Lorient: "FC Lorient.png",
  Toulouse: "FC Toulouse.png",
  Lille: "LOSC Lille.png",
  Nice: "OGC Nice.png",
  Lyon: "Olympique Lyon.png",
  Marseille: "Olympique Marseille.png",
  Brest: "Stade Brestois 29.png",
  Angers: "Angers SCO.png",
  "Paris Saint-Germain": "Paris Saint-Germain.png",
  Mainz: "1.FSV Mainz 05.png",
  "FC Cologne": "1.FC Köln.png",
  "Union Berlin": "1.FC Union Berlin.png",
  "Bayer Leverkusen": "Bayer 04 Leverkusen.png",
  "Borussia Mönchengladbach": "Borussia Mönchengladbach.png",
  "Werder Bremen": "SV Werder Bremen.png",
  "Schalke 04": "FC Schalke 04.png",
  Hoffenheim: "TSG 1899 Hoffenheim.png",
  "SV Elversberg": "SV 07 Elversberg.png",
  "SC Paderborn 07": "SC Paderborn 07.png",
  Atalanta: "Atalanta BC.png",
  "Inter Milan": "Inter Milan.png",
  Internazionale: "Inter Milan.png",
  "AC Milan": "AC Milan.png",
  Monza: "AC Monza.png",
  Fiorentina: "ACF Fiorentina.png",
  Lecce: "US Lecce.png",
  Sassuolo: "US Sassuolo.png",
  Genoa: "Genoa CFC.png",
  Como: "Como 1907.png",
  Parma: "Parma Calcio 1913.png",
  Frosinone: "Frosinone Calcio.png",
  Cagliari: "Cagliari Calcio.png",
  Napoli: "SSC Napoli.png",
  Lazio: "SS Lazio.png",
  Udinese: "Udinese Calcio.png",
  Torino: "Torino FC.png",
  Venezia: "Venezia FC.png",
  Bologna: "Bologna FC 1909.png",
  Juventus: "Juventus FC.png",
  "AS Roma": "AS Roma.png",
  Ajax: "Ajax Amsterdam.png",
  "Ajax Amsterdam": "Ajax Amsterdam.png",
  "AZ Alkmaar": "AZ Alkmaar.png",
  "FC Twente": "FC Twente Enschede.png",
  "NEC Nijmegen": "NEC Nijmegen.png",
  "PSV Eindhoven": "PSV Eindhoven.png",
  "Feyenoord Rotterdam": "Feyenoord Rotterdam.png",
  Sporting: "Sporting CP.png",
  "Sporting CP": "Sporting CP.png",
  Benfica: "SL Benfica.png",
  Braga: "SC Braga.png",
  Porto: "FC Porto.png",
  "FC Porto": "FC Porto.png",
  "F.C. København": "FC Copenhagen.png",
  "FC Midtjylland": "FC Midtjylland.png",
  "FC Nordsjælland": "FC Nordsjaelland.png",
  Celtic: "Celtic FC.png",
  Hearts: "Heart of Midlothian FC.png",
  "OFI CRETE": "OFI Crete.png",
  Olympiacos: "Olympiacos Piraeus.png",
  Panathinaikos: "Panathinaikos.png",
  "AEK Athens": "AEK Athens.png",
  "Red Bull Salzburg": "Red Bull Salzburg.png",
  "RB Salzburg": "Red Bull Salzburg.png",
  "LASK Linz": "LASK.png",
  "Sturm Graz": "SK Sturm Graz.png",
  "KAA Gent": "KAA Gent.png",
  Anderlecht: "RSC Anderlecht.png",
  "Club Brugge": "Club Brugge KV.png",
  "Sint-Truidense": "Sint-Truidense VV.png",
  "Union St.-Gilloise": "Union Saint-Gilloise.png",
  "CSKA Sofia": "CSKA Sofia.png",
  "Levski Sofia": "Levski Sofia.png",
  "Dinamo Zagreb": "GNK Dinamo Zagreb.png",
  "Hajduk Split": "HNK Hajduk Split.png",
  Jablonec: "FK Jablonec.png",
  "Viktoria Plzen": "FC Viktoria Plzen.png",
  "Sparta Prague": "AC Sparta Prague.png",
  "Slavia Prague": "SK Slavia Prague.png",
  "Jagiellonia Bialystok": "Jagiellonia Bialystok.png",
  "Lech Poznan": "Lech Poznan.png",
  "Bodo/Glimt": "FK BodoGlimt.png",
  Lillestrom: "Lillestrom SK.png",
  AGF: "Aarhus GF.png",
  "Hamburg SV": "Hamburger SV.png",
  "Hapoel Be'er": "Hapoel Beer Sheva.png",
  /* Same first word as Sporting CP, different club — never fuzzy-match these. */
  "Sporting Hortaleza": null,
  "Sporting de Alcázar": null,
  /* Substring of AD Ceuta, a different club — the flat dump's `ceuta` is the
     senior side. Caught by the full-name fuzzy pass, not the exact one. */
  "Ceuta 6 de Junio": null,
  "Viking FK": "Viking FK.png",
  "SK Brann": "SK Brann.png",
  Mjällby: "Mjällby AIF.png",
  "FC Thun": "FC Thun.png",
  "FC Lugano": "FC Lugano.png",
  "Sabah FK": null,
  "Shakhtar Donetsk": "Shakhtar Donetsk.png",
  "Red Star Belgrade": "Red Star Belgrade.png",
  "Red Star": "Red Star Belgrade.png",
  Besiktas: "Besiktas JK.png",
  Fenerbahce: "Fenerbahce.png",
  Galatasaray: "Galatasaray.png",
  Trabzonspor: "Trabzonspor.png",
  "Kauno Zalgiris": null,
  /* These three live in the flat rest-of-world dump under a shorter slug than
     their full name, so pin them by hand rather than fuzzy-matching. */
  "Kairat Almaty": "Kairat",
  "Borac Banja Luka": "Borac",
  "KuPS Kuopio": "KuPS",
  Pafos: "Pafos",
  "Aris Thessaloniki": null,
  "Iberia 1999": null,
  "Riga FC": null,
  "Lincoln Red Imps": null,
  "Inter D'Escalades": null,
  Nordsjaelland: "FC Nordsjaelland.png",
  "CSU Craiova": "Universitatea Craiova.png",
  Nord: null,
};

/**
 * Letters NFD can't decompose: ø, æ, ł, ß and friends. Without this,
 * "Lillestrøm SK.png" and a club listed as "Lillestrom" never line up.
 */
const TRANSLIT = {
  ø: "o",
  Ø: "O",
  æ: "ae",
  Æ: "AE",
  œ: "oe",
  Œ: "OE",
  ß: "ss",
  đ: "d",
  Đ: "D",
  ð: "d",
  Ð: "D",
  ł: "l",
  Ł: "L",
  þ: "th",
  Þ: "Th",
  ı: "i",
  İ: "I",
  ŀ: "l",
  Ŀ: "L",
  ŉ: "n",
};
const TRANSLIT_RE = new RegExp(
  `[${Object.keys(TRANSLIT)
    .map((c) => c.replace(/[\\\]^\-]/g, "\\$&"))
    .join("")}]`,
  "g",
);

/** Latin letters only, diacritics folded, everything else a separator. */
function normalize(value) {
  return String(value ?? "")
    .replace(TRANSLIT_RE, (ch) => TRANSLIT[ch])
    .replace(/[\u2018\u2019\u02bc'’`´]/g, " ")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, " ")
    .trim()
    .toLowerCase();
}

/** Folded, whitespace-free key — matches "FK BodøGlimt.png" to "FK BodoGlimt.png". */
function foldKey(value) {
  return normalize(path.basename(String(value ?? ""), ".png")).replace(/ /g, "");
}

function tokenize(value) {
  return normalize(value)
    .split(" ")
    .filter((t) => t.length > 0 && !STOP.has(t));
}

function tokenKey(tokens) {
  return [...tokens].sort().join(" ");
}

/** 1.0 = same club, ~0.9 = one name nested in the other, lower = guesswork. */
function score(teamTokens, fileTokens) {
  if (teamTokens.size === 0 || fileTokens.size === 0) return 0;
  const a = tokenKey(teamTokens);
  const b = tokenKey(fileTokens);
  if (a === b) return 1;
  const [small, large] = a.length <= b.length ? [teamTokens, fileTokens] : [fileTokens, teamTokens];
  const everyShared = [...small].every((t) => large.has(t));
  if (everyShared) return 0.9 + Math.min(0.09, (large.size - small.size) * 0.03);
  let shared = 0;
  for (const t of small) if (large.has(t)) shared++;
  return (shared / large.size) * 0.8;
}

function walk(dir, onFile) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, onFile);
    else if (entry.name.toLowerCase().endsWith(".png")) onFile(full);
  }
}

function buildIndex(dir, { flat = false } = {}) {
  const byKey = new Map();
  const byFold = new Map();
  if (!dir || !fs.existsSync(dir)) {
    throw new Error(`source folder not found: ${dir} (pass --src <dir>)`);
  }
  let count = 0;
  walk(dir, (file) => {
    count++;
    const raw = path.basename(file, ".png");
    // The flat dump names files as a kebab-case slug with a site suffix
    // ("manchester-city.football-logos.cc.png"); the nested collection uses
    // the club's own name ("Manchester City.png"). Fold both to plain tokens.
    const base = flat ? raw.replace(FLAT_SUFFIX, "").replace(/-/g, " ") : raw;
    const folder = flat ? FLAT_FOLDER : path.basename(path.dirname(file));
    const tokens = new Set(tokenize(base));
    const entry = { file, base, folder, tokens, size: fs.statSync(file).size };
    const key = tokenKey(tokens);
    if (!byKey.has(key)) byKey.set(key, []);
    byKey.get(key).push(entry);
    byFold.set(foldKey(base), entry);
  });
  console.log(`source crests: ${count} in ${path.relative(ROOT, dir)}`);
  return { byKey, byFold };
}

/**
 * Resolve an explicit ALIASES filename against every source, nested first.
 * Aliases used to be looked up in the nested collection only, so pinning a
 * club to a file that lives in the flat dump would have silently done nothing.
 */
function findByFold(sources, alias) {
  const key = foldKey(alias);
  for (const { index } of sources) {
    const hit = index.byFold.get(key);
    if (hit) return hit;
  }
  return null;
}

function pick(candidates, league) {
  const want = LEAGUE_FOLDER[league];
  const hit = candidates.find((c) => c.folder === want);
  return hit ?? candidates[0];
}

/**
 * Best crest for one club: highest score wins, ties go to the most specific
 * name (fewest extra tokens — "FC Barcelona" over "RCD Espanyol Barcelona"),
 * then to the league the club actually plays in.
 */
function bestCandidate(sources, team) {
  const wanted = LEAGUE_FOLDER[team.league];
  let best = null;
  let bestRank = null;
  // Sources are searched in caller order (nested collection, then the flat
  // dump) and ranked purely on score, so the fallback only wins when the
  // primary source genuinely had nothing better.
  for (const { index, shortNames = true } of sources) {
    for (const tokens of teamTokens(team, shortNames)) {
      for (const [fileKey, entries] of index.byKey) {
        const s = score(tokens, new Set(fileKey.split(" ").filter(Boolean)));
        if (s < ACCEPT) continue;
        const entry = pick(entries, team.league);
        const rank = [s, -entry.tokens.size, entry.folder === wanted ? 1 : 0];
        if (bestRank === null || rank.some((v, i) => v !== bestRank[i] && v > bestRank[i])) {
          best = entry;
          bestRank = rank;
        }
      }
    }
  }
  return { entry: best, score: bestRank ? bestRank[0] : 0 };
}

/**
 * Exact-name lookup with no fuzzy scoring.
 *
 * A `null` ALIASES entry means "this club's name collides with a bigger club's,
 * so never fuzzy-match it" — Sporting Hortaleza must not inherit Sporting CP's
 * crest. Those clubs still get a chance, but only on an identical token key,
 * which is exactly how the flat dump's full-club slugs line up ("Pafos FC" ->
 * "pafos", "Lincoln Red Imps" -> "lincoln red imps") while "Sporting Hortaleza"
 * and "Sporting de Alcázar" find nothing and are correctly left alone.
 */
function exactCandidate(index, team) {
  if (!index) return null;
  // Full name only, for the same reason the fuzzy fallback ignores short names:
  // an exact hit on an abbreviated name is how a smaller club inherits its
  // better-known neighbour's crest.
  for (const tokens of teamTokens(team, false)) {
    const entries = index.byKey.get(tokenKey(tokens));
    if (entries?.length) return entries[0];
  }
  return null;
}

/**
 * Name variants worth probing: full name, short name, and a year-free form.
 *
 * `includeShort` is off for the flat dump. Short names drop the very words that
 * distinguish two clubs — ESPN lists "Ceuta 6 de Junio" with a short name of
 * "Ceuta", and the flat dump's `ceuta` file is AD Ceuta, a different club — so
 * the fallback matches on the full name only. The nested collection keeps both,
 * as it always has.
 */
function teamTokens(team, includeShort = true) {
  const out = [];
  const seen = new Set();
  for (const name of [team.name, includeShort ? team.short_name : null].filter(Boolean)) {
    for (const tokens of [tokenize(name), tokenize(name).filter((t) => !/^\d+$/.test(t))]) {
      const key = tokenKey(tokens);
      if (tokens.length === 0 || seen.has(key)) continue;
      seen.add(key);
      out.push(new Set(tokens));
    }
  }
  return out;
}

function writeManifest() {
  const manifest = {};
  for (const f of fs.readdirSync(OUT_DIR)) {
    const m = f.match(/^(.+)\.png$/);
    if (m) manifest[m[1]] = f;
  }
  fs.writeFileSync(path.join(DATA_DIR, "logos.json"), JSON.stringify(manifest, null, 2) + "\n");
  return Object.keys(manifest).length;
}

/** The <picture> source beside a crest PNG; PNG stays the fallback. */
function webpDest(pngPath) {
  return pngPath.replace(/\.png$/, ".webp");
}

/** Re-scale every crest already in public/logos, whatever its source. */
async function normalizeOnly() {
  const files = fs.readdirSync(OUT_DIR).filter((f) => f.endsWith(".png"));
  let done = 0;
  let already = 0;
  const skipped = [];
  for (const f of files) {
    const p = path.join(OUT_DIR, f);
    const meta = await sharp(p).metadata();
    let resized = true;
    if (meta.width === CANVAS_PX && meta.height === CANVAS_PX) {
      const art = await sharp(p).trim({ threshold: 10 }).toBuffer({ resolveWithObject: true });
      if (Math.max(art.info.width, art.info.height) <= ARTWORK_PX + 2) resized = false;
    }
    const webp = path.join(OUT_DIR, f.replace(/\.png$/, ".webp"));
    if (!resized && fs.existsSync(webp)) {
      already++;
      continue;
    }
    const raw = fs.readFileSync(p);
    const out = resized ? await normalizeCrest(raw) : raw;
    if (!out) {
      skipped.push(f);
      continue;
    }
    const encoded = await toWebp(out);
    if (!flag("--dry-run")) {
      if (resized) fs.writeFileSync(p, out);
      if (encoded) fs.writeFileSync(webp, encoded);
    }
    done++;
  }
  console.log(
    `normalized: ${done}${flag("--dry-run") ? " (dry run)" : ""}, already done: ${already}, skipped: ${skipped.length}`,
  );
  for (const s of skipped) console.log(`  unreadable: ${s}`);
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.mkdirSync(DATA_DIR, { recursive: true });

  if (flag("--normalize-only")) {
    await normalizeOnly();
    return;
  }

  const index = buildIndex(SOURCE_DIR);
  const flatIndex = fs.existsSync(FLAT_SRC) ? buildIndex(FLAT_SRC, { flat: true }) : null;
  if (!flatIndex) {
    console.log(`(no flat source at ${path.relative(ROOT, FLAT_SRC)} — pass --flat-src <dir>)`);
  }
  const sources = flatIndex ? [{ index }, { index: flatIndex }] : [{ index }];
  if (!fs.existsSync(DB_PATH)) throw new Error(`database not found: ${DB_PATH}`);
  const db = new DatabaseSync(DB_PATH, { readonly: true });
  let teams = db.prepare("SELECT id, name, short_name, league FROM teams ORDER BY id").all();
  db.close();
  if (LIMIT) teams = teams.slice(0, LIMIT);

  const rows = [];
  for (const team of teams) {
    const id = String(team.id);
    const dest = path.join(OUT_DIR, `${id}.png`);
    const alias = Object.hasOwn(ALIASES, team.name) ? ALIASES[team.name] : undefined;

    let source = null;
    let how = "";
    let best = 0;
    if (alias === null) {
      // Never fuzzy-matched (the name collides with a bigger club's), but an
      // exact slug hit in the flat dump is still trustworthy — that is how the
      // clubs behind the old nulls (Pafos, Riga, Kairat) finally get a crest.
      const exact = exactCandidate(flatIndex, team);
      if (!exact) {
        rows.push({ id, name: team.name, how: "not in source", best: 0 });
        continue;
      }
      source = exact;
      how = "exact";
      best = 1;
    }
    if (!source && alias) {
      const hit = findByFold(sources, alias);
      if (hit) {
        source = hit;
        how = "alias";
        best = 1;
      }
    }
    if (!source) {
      const found = bestCandidate(sources, team);
      if (found.entry) {
        source = found.entry;
        best = found.score;
        how = "auto";
      }
    }

    if (!source) {
      rows.push({ id, name: team.name, how: "no match", best });
      continue;
    }
    const exists = fs.existsSync(dest);
    if (exists && !flag("--force")) {
      rows.push({
        id,
        name: team.name,
        how: "kept existing",
        best,
        source: source.base,
        folder: source.folder,
      });
      continue;
    }
    const raw = fs.readFileSync(source.file);
    const processed = await normalizeCrest(raw);
    if (!processed) {
      rows.push({ id, name: team.name, how: "skip (unreadable crest)", best });
      continue;
    }
    const webp = await toWebp(processed);
    if (!flag("--dry-run")) {
      fs.writeFileSync(dest, processed);
      if (webp) fs.writeFileSync(webpDest(dest), webp);
    }
    rows.push({
      id,
      name: team.name,
      how: flag("--dry-run") ? `would import (${how})` : `imported (${how})`,
      best,
      source: source.base,
      folder: source.folder,
    });
  }

  const width = Math.max(...rows.map((r) => r.name.length), 10);
  let imported = 0;
  let kept = 0;
  let missed = 0;
  for (const r of rows) {
    if (r.how.startsWith("imported") || r.how.startsWith("would import")) imported++;
    else if (r.how === "kept existing") kept++;
    else missed++;
    const src = r.source ? `${r.source}  [${r.folder}]` : "";
    console.log(
      `${r.id.padStart(7)}  ${r.name.padEnd(width)}  ${r.how.padEnd(26)} ${r.best.toFixed(2)}  ${src}`,
    );
  }
  const missing = rows.filter((r) => r.how === "no match" || r.how === "not in source");
  console.log(`\nteams: ${rows.length}, matched: ${imported + kept}, unmatched: ${missed}`);
  console.log(`from repo: ${imported}, already on disk: ${kept}`);
  if (missing.length) {
    console.log(`\nNO CREST IN SOURCE (${missing.length}):`);
    for (const m of missing) console.log(`  ${m.id}  ${m.name}`);
  }
  if (!flag("--dry-run")) console.log(`\nmanifest: ${writeManifest()} entries -> src/data/logos.json`);
}

await main();
