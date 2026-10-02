/**
 * Favorites caps per picker group — the rule that lets users follow up to
 * five national teams ON TOP of their five clubs ("only if they want").
 * The pure rule function is checked against mixed/unknown groups, and the
 * SQL that classifies a team (club / international / cup-only) runs against
 * real temp-file SQLite so the cap bucket and the picker tab stay the same
 * thing (server/db/teamGroups.ts is the single source of both).
 */
import { strict as assert } from "node:assert";
import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { migrate } from "../server/db/schema.js";
import {
  TEAM_GROUP_SQL,
  TEAM_GROUP_PARAMS,
  favoriteCapError,
  favoritesCap,
  isInternationalGroup,
  INTL_GROUP,
  OTHER_GROUP,
  MAX_CLUB_FAVORITES,
  MAX_INTERNATIONAL_FAVORITES,
} from "../server/db/teamGroups.js";

function testCapRules(): void {
  assert.equal(favoritesCap(INTL_GROUP), MAX_INTERNATIONAL_FAVORITES, "internationals get their own cap");
  assert.equal(favoritesCap("eng.1"), MAX_CLUB_FAVORITES, "a league tab is a club shelf");
  assert.equal(favoritesCap(OTHER_GROUP), MAX_CLUB_FAVORITES, "cup-only clubs are clubs");
  assert.equal(favoritesCap(null), MAX_CLUB_FAVORITES, "an unknown group defaults to the club shelf");
  assert.equal(favoritesCap(undefined), MAX_CLUB_FAVORITES, "a missing group defaults to the club shelf");
  assert.equal(isInternationalGroup("fifa.world"), false, "a competition slug is not the intl bucket");

  const clubs = ["eng.1", "esp.1", "other", "ned.1", "eng.1"];
  assert.equal(favoriteCapError(clubs, "eng.1"), "MAX_CLUBS", "a sixth club is capped");
  assert.equal(favoriteCapError(clubs, INTL_GROUP), null, "a full club shelf never blocks a national team");

  const intls = [INTL_GROUP, INTL_GROUP, INTL_GROUP, INTL_GROUP, INTL_GROUP];
  assert.equal(favoriteCapError(intls, "eng.1"), null, "a full intl shelf never blocks a club");
  assert.equal(favoriteCapError(intls, INTL_GROUP), "MAX_INTERNATIONALS", "a sixth national team is capped");

  // Mixed shelves count independently: 4 clubs + 4 internationals both fit.
  const mixed = ["eng.1", "esp.1", "other", INTL_GROUP, INTL_GROUP, INTL_GROUP, INTL_GROUP];
  assert.equal(favoriteCapError(mixed, "ita.1"), null);
  assert.equal(favoriteCapError(mixed, INTL_GROUP), null);

  // Unknown/absent groups on existing rows count as clubs (defensive default
  // matches the picker, where every non-international tab is a club shelf).
  const junk = [null, undefined, ""] as unknown as string[];
  assert.equal(favoriteCapError(junk, "eng.1"), null, "three unknown rows leave two club slots");
  assert.equal(favoriteCapError([...junk, "eng.1", "esp.1"], "ned.1"), "MAX_CLUBS", "five unknown rows fill the club shelf");
  assert.equal(favoriteCapError([...junk, "eng.1", "esp.1"], INTL_GROUP), null, "unknown rows never touch the intl shelf");
}

function tempDb(): { db: DatabaseSync; file: string } {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "vkick-teamgroups-")), "test.db");
  const db = new DatabaseSync(file);
  migrate(db);
  return { db, file };
}

function seedTeam(db: DatabaseSync, id: string, league: string): void {
  db.prepare(
    `INSERT INTO teams (id, name, short_name, abbreviation, color, league) VALUES (?, ?, ?, '', '#000000', ?)`,
  ).run(id, `Team ${id}`, id.toUpperCase(), league);
}

/** The same shaped query the favorites endpoints run, for one user. */
function favoriteGroups(db: DatabaseSync, userId: number): Array<{ team_id: string; group_key: string }> {
  return db
    .prepare(
      `SELECT f.team_id AS team_id, ${TEAM_GROUP_SQL} AS group_key
       FROM favorite_teams f JOIN teams t ON t.id = f.team_id
       WHERE f.user_id = ?`,
    )
    .all(...TEAM_GROUP_PARAMS, userId) as Array<{ team_id: string; group_key: string }>;
}

function testTeamGroupSql(): void {
  const { db } = tempDb();

  // A domestic club, a cup-only club, and two national teams (a national team
  // is any side with no league that appears in an international match).
  seedTeam(db, "arsenal", "eng.1");
  seedTeam(db, "ajax", "");
  seedTeam(db, "brazil", "");
  seedTeam(db, "scotland", "");
  db.prepare(
    `INSERT INTO matches (id, league, home_team_id, away_team_id, kickoff_at, status, home_score, away_score)
     VALUES ('m1', 'fifa.world', 'brazil', 'scotland', '2026-06-11T00:00:00.000Z', 'finished', 2, 1)`,
  ).run();

  db.prepare(`INSERT INTO users (telegram_id, display_name, created_at) VALUES ('u1', 'U1', ?)`).run(
    new Date().toISOString(),
  );
  const user = db.prepare(`SELECT id FROM users WHERE telegram_id = 'u1'`).get() as { id: number };
  for (const teamId of ["arsenal", "ajax", "brazil"]) {
    db.prepare(
      `INSERT INTO favorite_teams (user_id, team_id, is_favorite, created_at) VALUES (?, ?, 0, ?)`,
    ).run(user.id, teamId, new Date().toISOString());
  }

  const rows = favoriteGroups(db, user.id);
  const byTeam = Object.fromEntries(rows.map((r) => [r.team_id, r.group_key]));
  assert.equal(byTeam.arsenal, "eng.1", "a domestic club groups under its league slug");
  assert.equal(byTeam.ajax, OTHER_GROUP, "a cup-only club lands in the 'other' shelf");
  assert.equal(byTeam.brazil, INTL_GROUP, "a side seen in an international match is a national team");

  // The cap rule fed by that SQL: 2 club slots + 4 intl slots still free.
  const groups = rows.map((r) => r.group_key);
  assert.equal(favoriteCapError(groups, "esp.1"), null);
  assert.equal(favoriteCapError(groups, INTL_GROUP), null);
  assert.equal(
    favoriteCapError([...groups, "esp.1", "ita.1", "ger.1", "fra.1"], "ned.1"),
    "MAX_CLUBS",
    "the fifth club fills the club shelf",
  );
  assert.equal(
    favoriteCapError([...groups, INTL_GROUP, INTL_GROUP, INTL_GROUP, INTL_GROUP], INTL_GROUP),
    "MAX_INTERNATIONALS",
    "the fifth national team fills the intl shelf",
  );
}

export function runTeamGroupsTests(): void {
  testCapRules();
  testTeamGroupSql();
  console.log("  teamGroups: per-group favorites caps + picker-group SQL classification OK");
}
