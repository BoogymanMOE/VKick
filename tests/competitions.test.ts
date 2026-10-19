/**
 * The Browse competitions catalog. Bootstrap data with one hard rule: a slug
 * the sync has promoted must appear exactly once, and anything marked
 * `comingSoon: false` must actually be polled (`LEAGUES`).
 *
 * This is the regression test for a real bug — `ned.1`, `por.1`, `tur.1` and
 * `sco.1` sat in both COMPETITIONS and EXTRA_COMPETITIONS, so Browse rendered
 * each one twice under a duplicate React key, once as "live scores" and once as
 * "not in your feed yet".
 *
 * The catalog was then trimmed to the top-5 European leagues: `LEAGUES_ALL`
 * (the union of synced + incoming) is gone, `EXTRA_COMPETITIONS`, `CUPS` and
 * `INTERNATIONALS` are empty, and `isCup` is false everywhere. The assertions
 * below pin that boundary so the trim cannot drift back one slug at a time.
 */
import { strict as assert } from "node:assert";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { migrate } from "../server/db/schema.js";
import { competitionCatalog } from "../server/espn/catalog.js";
import { competitionCatalogWithMatches } from "../server/espn/competitions.js";
import { COMPETITIONS, CUPS, INTERNATIONALS, LEAGUES, isCup } from "../server/espn/types.js";
import { EXTRA_COMPETITIONS } from "../server/espn/extra.js";

const BIG_FIVE = ["eng.1", "esp.1", "ita.1", "ger.1", "fra.1"];

function testCatalogHasNoDuplicates(): void {
  const catalog = competitionCatalog();
  const slugs = catalog.map((c) => c.slug);
  const unique = new Set(slugs);
  assert.equal(unique.size, slugs.length, "no slug is listed twice");
}

/** The catalog is exactly the big five, all of them live and all with a table. */
function testCatalogIsExactlyTheBigFive(): void {
  const catalog = competitionCatalog();
  assert.deepEqual(
    [...catalog.map((c) => c.slug)].sort(),
    [...BIG_FIVE].sort(),
    "the catalog holds the big five and nothing else",
  );
  for (const entry of catalog) {
    assert.equal(entry.comingSoon, false, `${entry.slug} is polled, so it is not coming-soon`);
    assert.equal(entry.hasTable, true, `${entry.slug} is a league, so it owns a table`);
    assert.equal(entry.kind, "league", `${entry.slug} is a league`);
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
  const polled = new Set<string>(LEAGUES);
  const missing = COMPETITIONS.filter((c) => !polled.has(c.slug)).map((c) => c.slug);
  assert.deepEqual(missing, [], `live competitions not in LEAGUES: ${missing.join(", ")}`);
  assert.equal(new Set(LEAGUES).size, LEAGUES.length, "the polled set lists no league twice");
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

/** The trimmed-away scope stays trimmed: no extras, no cups, no internationals. */
function testTrimmedScopeStaysRemoved(): void {
  assert.deepEqual(EXTRA_COMPETITIONS, [], "the browse-only extras shelf is empty");
  assert.deepEqual(CUPS, [], "cups are out of the catalog");
  assert.deepEqual(INTERNATIONALS, [], "internationals are out of the catalog");
  for (const slug of [...BIG_FIVE, "uefa.champions", "eng.fa", "fifa.world"]) {
    assert.equal(isCup(slug), false, `${slug} must not be treated as a cup`);
  }
}

/**
 * The API-facing catalog is the big five PLUS whatever the DB has a match for:
 * a cup with fixtures must be listed (so Cups/Browse name it), and the base
 * catalog must not have changed to include it on its own.
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

    assert.ok(bySlug.has("uefa.champions"), "the cup with a match is listed");
    assert.equal(bySlug.get("uefa.champions")?.kind, "cup", "uefa.champions is a cup");
    assert.equal(bySlug.get("uefa.champions")?.name, "UEFA Champions League", "a known cup gets its name");
    assert.ok(bySlug.has("ned.1"), "the league with a match is listed");
    assert.equal(bySlug.get("ned.1")?.kind, "league", "ned.1 is a league");
    assert.equal(bySlug.get("ned.1")?.name, "Dutch Eredivisie", "a known league gets its name");

    // The base catalog is untouched: the cup is added by the API layer, not by
    // silently widening the pinned big-five list.
    assert.equal(competitionCatalog().some((c) => c.slug === "uefa.champions"), false);
  } finally {
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

export function runCompetitionsTests(): void {
  testCatalogHasNoDuplicates();
  testCatalogIsExactlyTheBigFive();
  testSourceListsAreDisjoint();
  testSyncedEntriesArePolled();
  testExtrasAreComingSoon();
  testTrimmedScopeStaysRemoved();
  testCatalogIncludesDbCups();
  console.log(
    "  competitions: big-five-only catalog, no duplicate slugs, DB cups listed, nothing polled missing OK",
  );
}
