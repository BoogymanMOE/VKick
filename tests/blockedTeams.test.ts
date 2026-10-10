/**
 * The blocked-team list (server/db/blockedTeams.ts).
 *
 * Six clubs are removed by product decision. This suite pins the three places
 * that guarantee "gone": the predicate, the read-side filter, and the sync —
 * a blocked club must never be inserted, and a pre-existing row must never be
 * updated by a later sync.
 */
import { strict as assert } from "node:assert";
import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { migrate } from "../server/db/schema.js";
import { SEED_TEAMS } from "../server/db/seedTeams.js";
import {
  BLOCKED_TEAM_IDS,
  filterOutBlockedTeams,
  isBlockedTeam,
  isBlockedTeamId,
} from "../server/db/blockedTeams.js";
import { applyScoreboard } from "../server/sync/upserts.js";

function testPredicate(): void {
  for (const id of BLOCKED_TEAM_IDS) {
    assert.ok(isBlockedTeamId(id), `${id} is blocked by id`);
    assert.ok(isBlockedTeam({ id }), `${id} is blocked as a team`);
  }
  assert.ok(isBlockedTeamId(257), "numeric ids coerce");
  assert.ok(isBlockedTeam({ name: "  Boca Juniors " }), "names match trimmed/cased-down");
  assert.ok(isBlockedTeam({ name: "FLAMENGO" }));
  assert.ok(isBlockedTeam({ name: "Dynamo Kyiv" }));
  assert.ok(!isBlockedTeam({ id: "359", name: "Arsenal" }), "unrelated clubs are not blocked");
  assert.ok(!isBlockedTeamId("359"));
  assert.ok(!isBlockedTeam({}), "an empty team is not blocked");
  assert.ok(!isBlockedTeam({ name: "" }));
}

function testSeedHasNoBlockedTeams(): void {
  for (const t of SEED_TEAMS) {
    assert.ok(!isBlockedTeam(t), `${t.id} ${t.name} must not be in the static seed`);
  }
}

function testReadFilter(): void {
  const rows = [{ id: "359" }, { id: "257" }, { id: "819" }, { id: "86" }, { id: "2029" }];
  assert.deepEqual(
    filterOutBlockedTeams(rows).map((r) => r.id),
    ["359", "86"],
    "blocked rows drop out, order preserved",
  );
}

function tempDb(): { db: DatabaseSync; file: string } {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "vkick-blocked-")), "test.db");
  const db = new DatabaseSync(file);
  migrate(db);
  return { db, file };
}

/** One ESPN scoreboard event, shaped like the live payload. */
function scoreboard(homeId: string, homeName: string, awayId: string, awayName: string): unknown {
  return {
    events: [
      {
        id: "block-probe",
        date: "2026-09-26T14:00:00Z",
        competitions: [
          {
            status: { type: { state: "pre", completed: false } },
            competitors: [
              { homeAway: "home", team: { id: homeId, displayName: homeName } },
              { homeAway: "away", team: { id: awayId, displayName: awayName } },
            ],
          },
        ],
      },
    ],
  };
}

function testSyncNeverInsertsBlockedTeam(): void {
  const { db } = tempDb();
  applyScoreboard(db, scoreboard("819", "Flamengo", "86", "Real Madrid"), "esp.1");

  const blocked = db.prepare("SELECT id FROM teams WHERE id = '819'").get();
  assert.equal(blocked, undefined, "a blocked club is never inserted by the sync");
  assert.ok(db.prepare("SELECT id FROM teams WHERE id = '86'").get(), "other clubs still sync");
  // The fixture is skipped as well, or the FK on matches.home/away_team_id
  // would reject it and roll back the whole competition.
  assert.equal(
    db.prepare("SELECT id FROM matches WHERE id = 'block-probe'").get(),
    undefined,
    "a fixture involving a blocked club is not inserted",
  );
  db.close();
}

function testSyncNeverUpdatesExistingBlockedRow(): void {
  const { db } = tempDb();
  db.prepare(
    `INSERT INTO teams (id, name, short_name, abbreviation, logo_url, color, league)
     VALUES ('257', 'Rangers', 'Rangers', 'RAN', NULL, '#0000FF', 'sco.1')`,
  ).run();

  applyScoreboard(db, scoreboard("257", "RENAMED BY SYNC", "86", "Real Madrid"), "esp.1");

  const row = db.prepare("SELECT name FROM teams WHERE id = '257'").get() as { name: string } | undefined;
  assert.equal(row?.name, "Rangers", "an existing blocked row is frozen, never updated");
  db.close();
}

export function runBlockedTeamsTests(): void {
  testPredicate();
  testSeedHasNoBlockedTeams();
  testReadFilter();
  testSyncNeverInsertsBlockedTeam();
  testSyncNeverUpdatesExistingBlockedRow();
  console.log("  blockedTeams: predicate, seed exclusion, read filter, sync skip/freeze OK");
}
