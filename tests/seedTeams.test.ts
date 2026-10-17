/**
 * The static team seed is the favorites picker's floor, so two things must
 * stay true or the picker silently shows the wrong crest/name:
 *
 *  1. Scope: every row is a big-five club (eng.1, esp.1, ger.1, ita.1, fra.1).
 *     The catalog was trimmed to the top 5, so a rest-of-world club or a
 *     national side (league="") reappearing here would put a team in the
 *     picker that no league tab can hold.
 *  2. Assets: every id has a bundled crest (src/data/logos.json) or an explicit
 *     remote logo_url, and its colour matches src/data/team-colors.json — the
 *     reference data the seed was cross-checked against.
 *
 * A migration integration pass then proves the seed actually lands on a fresh
 * boot and is idempotent on a restart.
 */
import { strict as assert } from "node:assert";
import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { migrate } from "../server/db/schema.js";
import * as seedModule from "../server/db/seedTeams.js";
import { SEED_TEAMS } from "../server/db/seedTeams.js";
import logos from "../src/data/logos.json";
import colors from "../src/data/team-colors.json";

/** The catalog's whole scope now: the top 5 European leagues, and nothing else. */
const BIG_FIVE_LEAGUES = ["eng.1", "esp.1", "ger.1", "ita.1", "fra.1"] as const;
const BIG_FIVE = new Set<string>(BIG_FIVE_LEAGUES);
const logosById = logos as Record<string, string>;
const colorsById = colors as Record<string, string>;

/** Scope + manifest lockstep. */
function testSeedAgainstManifests(): void {
  const seen = new Set<string>();
  for (const t of SEED_TEAMS) {
    assert.ok(!seen.has(t.id), `duplicate seed id ${t.id}`);
    seen.add(t.id);

    assert.ok(
      BIG_FIVE.has(t.league),
      `${t.id} ${t.name}: league ${JSON.stringify(t.league)} is outside the big five (the trimmed catalog is top-5 clubs only)`,
    );
    assert.ok(t.name.length > 0, `${t.id} has no name`);
    assert.ok(t.abbreviation, `${t.id} ${t.name} has no abbreviation`);

    const color = colorsById[t.id];
    assert.ok(color, `${t.id} ${t.name} has no colour in src/data/team-colors.json`);
    assert.equal(
      (t.color ?? "").toUpperCase(),
      color.toUpperCase(),
      `${t.id} ${t.name}: seed colour must match team-colors.json`,
    );

    assert.ok(
      logosById[t.id] || t.logo_url,
      `${t.id} ${t.name} has neither a bundled crest nor a logo_url fallback`,
    );
  }

  for (const slug of BIG_FIVE_LEAGUES) {
    assert.ok(
      SEED_TEAMS.some((t) => t.league === slug),
      `${slug} has no seeded clubs`,
    );
  }

  // The trimmed catalog's own boundary, not just its contents: no national
  // sides (league="") and no rest-of-world shelf are seeded any more, and the
  // `REST_OF_WORLD_LEAGUES` export that used to describe that shelf is gone.
  // A reintroduced export would silently widen the scope again, so this is the
  // assertion that keeps the trim from drifting back.
  assert.equal(
    SEED_TEAMS.filter((t) => t.league === "").length,
    0,
    'national sides (league="") are out of the trimmed catalog',
  );
  assert.ok(
    !("REST_OF_WORLD_LEAGUES" in seedModule),
    "REST_OF_WORLD_LEAGUES must stay removed — the catalog is top-5 only",
  );
  assert.ok(
    SEED_TEAMS.every((t) => BIG_FIVE.has(t.league)),
    "no seed row carries a league slug outside the big five",
  );
}

/** The seed lands on a fresh boot and does not duplicate on a restart. */
function testSeedBootsAndIsIdempotent(): void {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "verdikick-seed-")), "test.db");
  const db = new DatabaseSync(file);
  migrate(db);

  const count = (): number =>
    Number((db.prepare("SELECT COUNT(*) AS n FROM teams").get() as { n: number }).n);
  assert.equal(count(), SEED_TEAMS.length, "a fresh boot lands exactly the seed");

  const row = db.prepare("SELECT name, color, league FROM teams WHERE id = '359'").get() as
    { name: string; color: string; league: string } | undefined;
  assert.equal(row?.name, "Arsenal", "the verified name lands, not the old mismatched one");
  assert.equal(row?.league, "eng.1");

  migrate(db); // restart against an already-seeded database
  assert.equal(count(), SEED_TEAMS.length, "a restart is a no-op, never a duplicate insert");
  db.close();
}

export function runSeedTeamsTests(): void {
  testSeedAgainstManifests();
  testSeedBootsAndIsIdempotent();
  console.log("  seedTeams: top-5 scope, manifest colour/crest lockstep, idempotent boot OK");
}
