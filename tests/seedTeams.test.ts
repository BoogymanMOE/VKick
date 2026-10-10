/**
 * The static team seed is the favorites picker's floor, so two things must
 * stay true or the picker silently shows the wrong crest/name:
 *
 *  1. Scope: every row is either a big-five club or a national side
 *     (league=""). A stray Eredivisie/Primeira row would reappear in the
 *     picker even though its league no longer gets a tab.
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
import { SEED_TEAMS } from "../server/db/seedTeams.js";
import logos from "../src/data/logos.json";
import colors from "../src/data/team-colors.json";

const BIG_FIVE = new Set(["eng.1", "esp.1", "ger.1", "ita.1", "fra.1"]);
const logosById = logos as Record<string, string>;
const colorsById = colors as Record<string, string>;

/** Scope + manifest lockstep. */
function testSeedAgainstManifests(): void {
  const seen = new Set<string>();
  for (const t of SEED_TEAMS) {
    assert.ok(!seen.has(t.id), `duplicate seed id ${t.id}`);
    seen.add(t.id);

    assert.ok(
      BIG_FIVE.has(t.league) || t.league === "",
      `${t.id} ${t.name}: league ${JSON.stringify(t.league)} is not a Top-5 slug or ""`,
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

  for (const slug of BIG_FIVE) {
    assert.ok(
      SEED_TEAMS.some((t) => t.league === slug),
      `${slug} has no seeded clubs`,
    );
  }
  assert.ok(
    SEED_TEAMS.some((t) => t.league === "" && t.name === "England"),
    'national sides are seeded with league=""',
  );
  assert.ok(
    !SEED_TEAMS.some((t) => t.league !== "" && !BIG_FIVE.has(t.league)),
    "no seed row carries a non-big-five league",
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
  console.log("  seedTeams: Top-5 scope, manifest colour/crest lockstep, idempotent boot OK");
}
