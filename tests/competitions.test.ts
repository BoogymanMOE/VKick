/**
 * The competitions catalog. Bootstrap data with one hard rule: a slug the sync
 * has promoted must appear exactly once, and anything marked `comingSoon:
 * false` must actually be polled (`ALL_COMPETITIONS`).
 *
 * This is the regression test for a real bug — `ned.1`, `por.1`, `tur.1` and
 * `sco.1` sat in both COMPETITIONS and EXTRA_COMPETITIONS, so Browse rendered
 * each one twice under a duplicate React key, once as "live scores" and once as
 * "not in your feed yet".
 *
 * The catalog is now the big five plus the two UEFA club cups. The Champions
 * League and Europa League are polled by the same sync and have no league
 * table; the assertions below pin that boundary (and keep the trimmed-away
 * extras and internationals out).
 */
import { strict as assert } from "node:assert";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { migrate } from "../server/db/schema.js";
import { competitionCatalog } from "../server/espn/catalog.js";
import { competitionCatalogWithMatches } from "../server/espn/competitions.js";
import {
  ALL_COMPETITIONS,
  COMPETITIONS,
  CUPS,
  INTERNATIONALS,
  LEAGUES,
  isCup,
} from "../server/espn/types.js";
import { EXTRA_COMPETITIONS } from "../server/espn/extra.js";

const BIG_FIVE = ["eng.1", "esp.1", "ita.1", "ger.1", "fra.1"];
const UEFA_CUPS = ["uefa.champions", "uefa.europa"];

function testCatalogHasNoDuplicates(): void {
  const catalog = competitionCatalog();
  const slugs = catalog.map((c) => c.slug);
  const unique = new Set(slugs);
  assert.equal(unique.size, slugs.length, "no slug is listed twice");
}

/** The catalog is the big five plus the two UEFA cups, all live. */
function testCatalogIsBigFivePlusUefaCups(): void {
  const catalog = competitionCatalog();
  assert.deepEqual(
    [...catalog.map((c) => c.slug)].sort(),
    [...BIG_FIVE, ...UEFA_CUPS].sort(),
    "the catalog holds the big five and the two UEFA cups",
  );
  for (const entry of catalog) {
    assert.equal(entry.comingSoon, false, `${entry.slug} is polled, so it is not coming-soon`);
    if (UEFA_CUPS.includes(entry.slug)) {
      assert.equal(entry.kind, "cup", `${entry.slug} is a cup`);
      assert.equal(entry.hasTable, false, `${entry.slug} is a knockout cup, so it has no table`);
    } else {
      assert.equal(entry.kind, "league", `${entry.slug} is a league`);
      assert.equal(entry.hasTable, true, `${entry.slug} owns a table`);
    }
  }
}

/** The source lists themselves are disjoint — the rule that prevents the bug. */
function testSourceListsAreDisjoint(): void {
  const synced = new Set<string>(COMPETITIONS.map((c) => c.slug));
  const overlap = EXTRA_COMPETITIONS.filter((c) => synced.has(c.slug)).map((c) => c.slug);
  assert.deepEqual(
    overlap,
    [],
    `promoted competitions must leave EXTRA_COMPETITIONS (still there: ${overlap.join(", ")})`,
  );
}

/** Everything the catalog advertises as synced is really in the polled set. */
function testSyncedEntriesArePolled(): void {
  const polled = new Set<string>(ALL_COMPETITIONS);
  const missing = COMPETITIONS.filter((c) => !polled.has(c.slug)).map((c) => c.slug);
  assert.deepEqual(missing, [], `live competitions not in ALL_COMPETITIONS: ${missing.join(", ")}`);
  assert.equal(
    new Set(ALL_COMPETITIONS).size,
    ALL_COMPETITIONS.length,
    "the polled set lists no competition twice",
  );
  assert.deepEqual([...LEAGUES].sort(), [...BIG_FIVE].sort(), "LEAGUES stays the big five");
}

/** Extras are browse-only: never advertised as synced, never with a table. */
function testExtrasAreComingSoon(): void {
  const catalog = competitionCatalog();
  for (const entry of catalog) {
    const isExtra = EXTRA_COMPETITIONS.some((c) => c.slug === entry.slug);
    if (!isExtra) continue;
    assert.equal(entry.comingSoon, true, `${entry.slug} is an extra, so it is coming-soon`);
    assert.equal(entry.hasTable, false, `${entry.slug} is browse-only, so it has no table`);
  }
}

/** The trimmed-away scope stays trimmed: no extras, no internationals. */
function testTrimmedScopeStaysRemoved(): void {
  assert.deepEqual(EXTRA_COMPETITIONS, [], "the browse-only extras shelf is empty");
  assert.deepEqual(CUPS, UEFA_CUPS, "the catalog carries exactly the two UEFA cups");
  assert.deepEqual(INTERNATIONALS, [], "internationals are out of the catalog");
  for (const slug of UEFA_CUPS) {
    assert.equal(isCup(slug), true, `${slug} must be treated as a cup`);
  }
  for (const slug of [...BIG_FIVE, "eng.fa", "fifa.world"]) {
    assert.equal(isCup(slug), false, `${slug} must not be treated as a cup`);
  }
}

/**
 * The API-facing catalog is the base catalog PLUS any allowed competition the
 * DB has a match for. A stale foreign league (ned.1) is NOT advertised, because
 * `/api/matches` refuses to serve it — listing it would open an empty screen.
 */
function testCatalogIncludesDbCups(): void {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vkick-comps-"));
  const db = new DatabaseSync(path.join(dir, "c.db"));
  try {
    migrate(db);
    db.exec(`
      INSERT INTO teams (id, name, short_name, league) VALUES
        ('H', 'Home FC', 'Home', 'uefa.champions'),
        ('A', 'Away FC', 'Away', 'uefa.champions'),
        ('N', 'Ned FC', 'Ned', 'ned.1');
      INSERT INTO matches (id, league, home_team_id, away_team_id, kickoff_at, status) VALUES
        ('c1', 'uefa.champions', 'H', 'A', '2026-10-18T18:00:00.000Z', 'live'),
        ('l1', 'ned.1', 'N', 'A', '2026-10-18T18:00:00.000Z', 'live');
    `);
    const catalog = competitionCatalogWithMatches(db);
    const bySlug = new Map(catalog.map((c) => [c.slug, c]));

    assert.ok(bySlug.has("uefa.champions"), "the cup is listed");
    assert.equal(bySlug.get("uefa.champions")?.kind, "cup", "uefa.champions is a cup");
    assert.equal(bySlug.get("uefa.champions")?.name, "UEFA Champions League", "a known cup gets its name");
    assert.ok(bySlug.has("uefa.europa"), "the Europa League is listed even before its first fixture");
    assert.equal(bySlug.has("ned.1"), false, "an unserved league is not advertised");

    // The base catalog names the cups itself — no duplicate row is added by the
    // DB merge (the slug is already seen, so it must not appear twice).
    assert.equal(
      competitionCatalog().some((c) => c.slug === "uefa.champions"),
      true,
    );
    assert.equal(catalog.filter((c) => c.slug === "uefa.champions").length, 1);
  } finally {
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

export function runCompetitionsTests(): void {
  testCatalogHasNoDuplicates();
  testCatalogIsBigFivePlusUefaCups();
  testSourceListsAreDisjoint();
  testSyncedEntriesArePolled();
  testExtrasAreComingSoon();
  testTrimmedScopeStaysRemoved();
  testCatalogIncludesDbCups();
  console.log(
    "  competitions: big five + UEFA cups, no duplicate slugs, unserved leagues hidden, nothing polled missing OK",
  );
}
