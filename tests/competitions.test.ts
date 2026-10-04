/**
 * The Browse competitions catalog. Bootstrap data with one hard rule: a slug
 * the sync has promoted must appear exactly once, and anything marked
 * `comingSoon: false` must actually be polled (`LEAGUES_ALL`).
 *
 * This is the regression test for a real bug — `ned.1`, `por.1`, `tur.1` and
 * `sco.1` sat in both COMPETITIONS and EXTRA_COMPETITIONS, so Browse rendered
 * each one twice under a duplicate React key, once as "live scores" and once as
 * "not in your feed yet".
 */
import { strict as assert } from "node:assert";
import { competitionCatalog } from "../server/espn/catalog.js";
import { COMPETITIONS, LEAGUES_ALL } from "../server/espn/types.js";
import { EXTRA_COMPETITIONS } from "../server/espn/extra.js";

function testCatalogHasNoDuplicates(): void {
  const catalog = competitionCatalog();
  const slugs = catalog.map((c) => c.slug);
  const unique = new Set(slugs);
  assert.equal(unique.size, slugs.length, "no slug is listed twice");
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
  const polled = new Set<string>(LEAGUES_ALL);
  const missing = COMPETITIONS.filter((c) => !polled.has(c.slug)).map((c) => c.slug);
  assert.deepEqual(missing, [], `live competitions not in LEAGUES_ALL: ${missing.join(", ")}`);
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

export function runCompetitionsTests(): void {
  testCatalogHasNoDuplicates();
  testSourceListsAreDisjoint();
  testSyncedEntriesArePolled();
  testExtrasAreComingSoon();
  console.log("  competitions: no duplicate slugs, candidates polled, extras browse-only OK");
}
