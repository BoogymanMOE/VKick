/**
 * Scoring engine tests — `scoring-rules.md` pinned as executable rules:
 * every mechanic at min/max/zero, the zone-adjacency map, the streak state
 * machine (thresholds, resets, one-time pays), the no-negative invariant,
 * and the ratings/comments firewall over a real in-memory SQLite database.
 */
import { strict as assert } from "node:assert";
import { DatabaseSync } from "node:sqlite";
import {
  POINTS,
  scoreLineup,
  scoreSubs,
  scoreShotPredict,
  scorePlayerWatch,
  scoreVersus,
  updateStreak,
  zoneAdjacency,
  positionCrowdAverage,
  WATCH_MIN_VOTES,
  type StreakState,
} from "../server/scoring/predictionScore.js";
import { award, readLeaderboard, currentSeasonLabel } from "../server/scoring/ledger.js";
import { evaluateStreak } from "../server/scoring/streak.js";
import type {
  LineupPayload,
  SubPayload,
  VersusPayload,
  PlayerWatchPayload,
} from "../server/predictions/validate.js";

const XI: LineupPayload = {
  playerIds: ["1", "2", "3", "4", "5", "6", "7", "8", "9", "10", "11"],
  formation: "4-3-3",
};
const SUBS: SubPayload = {
  subs: [
    { offId: "101", onId: "201" },
    { offId: "102", onId: "202" },
  ],
};
const WATCH: PlayerWatchPayload = { playerId: "9" };
const VERSUS: VersusPayload = { playerAId: "9", playerBId: "4" };

/* ------------------------------------------------------------ lineup */

function testLineup() {
  // Max: all 11 starters + formation.
  const max = scoreLineup(XI, {
    starterIds: new Set(XI.playerIds),
    formations: new Set(["4-3-3"]),
  });
  assert.equal(max.points, POINTS.lineupMax, "lineup max = 16");
  assert.deepEqual(max.breakdown, { startersCorrect: 11, formationBonus: 5 });

  // Zero: nobody right, formation wrong.
  const zero = scoreLineup(XI, { starterIds: new Set(["99"]), formations: new Set(["5-4-1"]) });
  assert.equal(zero.points, 0, "lineup zero = 0");
  assert.equal(zero.breakdown.startersCorrect, 0);

  // Min boundary: formation bonus alone can pay.
  const formationOnly = scoreLineup(XI, { starterIds: new Set(), formations: new Set(["4-3-3"]) });
  assert.equal(formationOnly.points, 5, "formation bonus pays without starter hits");

  // Min: one starter right, no formation.
  const one = scoreLineup(XI, { starterIds: new Set(["7"]), formations: new Set(["4-4-2"]) });
  assert.equal(one.points, 1, "one starter = 1 point");
}

/* ------------------------------------------------------------ subs */

function testSubs() {
  const actual = [
    { offId: "101", onId: "201" }, // full pair
    { offId: "102", onId: "999" }, // off right, replacement wrong
  ];
  const full = scoreSubs(SUBS, actual);
  assert.equal(full.points, 3, "full pair +1 off +2 on... = 1+2 and 1 = 3");
  assert.deepEqual(full.breakdown, { pairsPredicted: 2, offCorrect: 2, onCorrect: 1, fullPairs: 1 });

  // Zero: no pair matches.
  const zero = scoreSubs(SUBS, [{ offId: "900", onId: "901" }]);
  assert.equal(zero.points, 0, "no matching subs = 0");

  // Max: 5 fully correct pairs.
  const fivePairs: SubPayload = {
    subs: Array.from({ length: 5 }, (_, i) => ({ offId: String(i + 1), onId: String(i + 11) })),
  };
  const max = scoreSubs(
    fivePairs,
    Array.from({ length: 5 }, (_, i) => ({ offId: String(i + 1), onId: String(i + 11) })),
  );
  assert.equal(max.points, POINTS.subMax, "sub max = 10");

  // The +1 "on" point does NOT pay across two different real events.
  const crossEvent = scoreSubs({ subs: [{ offId: "101", onId: "202" }] }, [
    { offId: "101", onId: "777" },
    { offId: "102", onId: "202" },
  ]);
  assert.equal(crossEvent.points, 1, "cross-event pairing pays the off point only");
}

/* ------------------------------------------------------------ zones + shots */

function testAdjacency() {
  // Exact.
  assert.equal(zoneAdjacency("inside_left", "inside_left"), "exact");
  // The doc's example: left-inside touches center-inside and left-outside,
  // never right-anything.
  assert.equal(zoneAdjacency("inside_left", "inside_center"), "adjacent");
  assert.equal(zoneAdjacency("inside_left", "outside_left"), "adjacent");
  assert.equal(zoneAdjacency("inside_left", "inside_right"), "none");
  assert.equal(zoneAdjacency("inside_left", "outside_right"), "none");
  // Symmetry of the map.
  assert.equal(zoneAdjacency("outside_center", "inside_center"), "adjacent");
  assert.equal(zoneAdjacency("inside_center", "outside_center"), "adjacent");
  // Corners are not adjacent diagonally.
  assert.equal(zoneAdjacency("outside_left", "inside_right"), "none");
  assert.equal(zoneAdjacency("outside_left", "outside_right"), "none");
  // Every zone maps over the full domain without crashing.
  for (const a of [
    "inside_left",
    "inside_center",
    "inside_right",
    "outside_left",
    "outside_center",
    "outside_right",
  ] as const) {
    for (const b of [
      "inside_left",
      "inside_center",
      "inside_right",
      "outside_left",
      "outside_center",
      "outside_right",
    ] as const) {
      const r = zoneAdjacency(a, b);
      assert.ok(r === "exact" || r === "adjacent" || r === "none", `total map for ${a}->${b}`);
    }
  }
}

function testShotPredict() {
  const counts = { shots: 3, shotsOnTarget: 2 };

  // Max 12: exact zone + on target + goal.
  const max = scoreShotPredict("inside_center", {
    locatedShots: [{ kind: "goal", fieldPositionX: 95, fieldPositionY: 50 }],
    counts,
  });
  assert.equal(max.points, POINTS.shotMax, "shot max = 12");
  assert.equal(max.status, "correct");
  assert.deepEqual(max.breakdown, {
    zonePoints: 5,
    zoneExact: 1,
    zoneAdjacent: 0,
    onTargetBonus: 2,
    goalBonus: 5,
    lenientSoT: 0,
  });

  // Adjacent zone (outside_center: edge of the box), on-target shot:
  // 2 zone + 2 stat-tally SoT = 4.
  const adjacent = scoreShotPredict("inside_center", {
    locatedShots: [{ kind: "on_target", fieldPositionX: 75, fieldPositionY: 50 }],
    counts,
  });
  assert.equal(adjacent.points, 4, "adjacent + stat-tally SoT = 4");
  assert.equal(adjacent.status, "partial");
  assert.equal(adjacent.breakdown.zoneAdjacent, 1);

  // Wrong zone: the goal gates on the zone, but the stat-tally SoT +2 still
  // pays (user's lenient decision: the bonus follows the tally, not the shot).
  const wrongZoneGoal = scoreShotPredict("inside_center", {
    locatedShots: [{ kind: "goal", fieldPositionX: 95, fieldPositionY: 5 }],
    counts,
  });
  assert.equal(wrongZoneGoal.points, 2, "wrong-zone goal = 0 zone/goal + 2 lenient SoT");
  assert.equal(wrongZoneGoal.status, "partial");
  assert.equal(wrongZoneGoal.breakdown.lenientSoT, 1);

  // Zero: no shots at all (no tally, no located shots).
  const none = scoreShotPredict("inside_center", {
    locatedShots: [],
    counts: { shots: 0, shotsOnTarget: 0 },
  });
  assert.equal(none.points, 0, "no shots = 0");

  // Best single shot pays the zone+goal part: a goal in-zone beats an
  // earlier adjacent on-target attempt (5+5 vs 2).
  const best = scoreShotPredict("inside_center", {
    locatedShots: [
      { kind: "on_target", fieldPositionX: 90, fieldPositionY: 40 }, // adjacent 2
      { kind: "goal", fieldPositionX: 95, fieldPositionY: 50 }, // exact 5 + goal 5
    ],
    counts,
  });
  assert.equal(best.points, 12, "best single shot (5 zone + 5 goal) + 2 SoT = 12");

  // Off-target located shot in-zone: zone pays, no SoT bonus (off_target
  // kind is for completeness; the tally covers the +2).
  const offTargetInZone = scoreShotPredict("inside_center", {
    locatedShots: [{ kind: "off_target", fieldPositionX: 95, fieldPositionY: 50 }],
    counts: { shots: 2, shotsOnTarget: 0 },
  });
  assert.equal(offTargetInZone.points, 5, "exact zone, off-target shot = zone points only");
}

/* ------------------------------------------------------------ watch */

function rows(entries: Array<[string, string | null, number | null]>) {
  return entries.map(([player_id, position, stat_score]) => ({ player_id, position, stat_score }));
}

function testWatch() {
  // Fixture: FWD picks. Peers: other FWD stat avg = 6, MID avg = 3.
  const positionRows = rows([
    ["9", "FWD", 10],
    ["11", "FWD", 2],
    ["8", "MID", 4],
    ["4", "DEF", 2],
  ]);
  const crowd = [
    { player_id: "9", avg: 7.5, votes: 6 },
    { player_id: "11", avg: 5.0, votes: 6 },
    { player_id: "8", avg: 4.0, votes: 6 },
  ];

  // Max 12: both gates pass + MVP.
  const max = scorePlayerWatch({ pick: WATCH, positionRows, crowd, mvpPlayerId: "9" });
  assert.equal(max.outcome, "correct");
  assert.equal(max.points, POINTS.watchMax, "watch max = 12");

  // Base only: gates pass, no MVP. FWD peer avg = (10+2)/2 = 6 → 10 > 6 passes;
  // crowd: FWD peer = 5.0 → 7.5 > 5.0 passes.
  const base = scorePlayerWatch({ pick: WATCH, positionRows, crowd, mvpPlayerId: "11" });
  assert.equal(base.points, POINTS.watchBase, "both gates pass = 8");

  // Zero: stat gate fails (MID pick below MID peers).
  const statFail = scorePlayerWatch({
    pick: { playerId: "8" },
    positionRows,
    crowd,
    mvpPlayerId: "9",
  });
  assert.equal(statFail.outcome, "wrong");
  assert.equal(statFail.points, 0, "stat gate fail = 0 even with MVP? no: MVP id is 9");
  // MVP bonus must NOT pay on a failed stat gate.
  assert.equal(statFail.breakdown.mvpBonus, 0);

  // Zero: crowd gate fails (stat gate passes — peers are beaten on stats,
  // but the crowd rates the peers higher).
  const crowdFailRows = rows([
    ["9", "FWD", 10],
    ["11", "FWD", 12],
    ["8", "MID", 4],
    ["4", "DEF", 2],
  ]);
  const crowdFail = scorePlayerWatch({
    pick: { playerId: "11" },
    positionRows: crowdFailRows,
    crowd,
    mvpPlayerId: null,
  });
  assert.equal(crowdFail.points, 0, "crowd gate fail = 0");
  assert.equal(crowdFail.outcome, "partial");
  assert.equal(crowdFail.breakdown.statGate, 1);
  assert.equal(crowdFail.breakdown.crowdGate, 0);

  // A (tie-broken) MVP whose stat gate fails still scores 0: the strict
  // match-MVP always passes the stat gate mathematically, so this case can
  // only arise from a top-score tie — no bonus on top of a failed gate.
  const mvpGateFail = scorePlayerWatch({
    pick: { playerId: "4" },
    positionRows,
    crowd,
    mvpPlayerId: "4",
  });
  assert.equal(mvpGateFail.points, 0, "failed stat gate = 0 even for a tie-broken MVP");
  assert.equal(mvpGateFail.outcome, "wrong");

  // Void: pick didn't feature.
  const voided = scorePlayerWatch({ pick: { playerId: "777" }, positionRows, crowd, mvpPlayerId: null });
  assert.equal(voided.outcome, "void");
  assert.equal(voided.points, 0);

  // Pending: stat gate passes, crowd too sparse (own votes < floor) → stays open.
  const pending = scorePlayerWatch({
    pick: WATCH,
    positionRows,
    crowd: [{ player_id: "9", avg: 7.5, votes: WATCH_MIN_VOTES - 1 }],
    mvpPlayerId: null,
  });
  assert.equal(pending.outcome, "pending", "sparse crowd stays pending");
  // ...unless force-settling after the grace window: crowd gate fails, MVP can pay.
  const forced = scorePlayerWatch({
    pick: WATCH,
    positionRows,
    crowd: [{ player_id: "9", avg: 7.5, votes: WATCH_MIN_VOTES - 1 }],
    mvpPlayerId: "9",
    force: true,
  });
  assert.equal(forced.points, POINTS.watchMvpBonus, "force-settle pays MVP only");
  assert.equal(forced.breakdown.forcedByWindow, 1);

  // Position average ladder: solo DEF pick measures against all others.
  const ladder = positionCrowdAverage(positionRows, crowd, "DEF", "4");
  // DEF peers: none at DEF (excluding self) → fallback to all others' crowd.
  assert.equal(ladder, (7.5 + 5.0 + 4.0) / 3, "crowd average falls back to all positions");
}

/* ------------------------------------------------------------ versus */

function testVersus() {
  // Correct: +3.
  const win = scoreVersus({ pick: VERSUS, statScores: { "9": 10, "4": 2 } });
  assert.equal(win.outcome, "correct");
  assert.equal(win.points, POINTS.versusWin, "versus win = 3");

  // Wrong: 0, no partial credit.
  const loss = scoreVersus({ pick: VERSUS, statScores: { "9": 2, "4": 10 } });
  assert.equal(loss.outcome, "wrong");
  assert.equal(loss.points, 0);

  // Tie: void, nobody gains.
  const tie = scoreVersus({ pick: VERSUS, statScores: { "9": 5, "4": 5 } });
  assert.equal(tie.outcome, "void");
  assert.equal(tie.points, 0, "tie voids, 0 points");
}

/* ------------------------------------------------------------ streak (pure) */

const freshStreak = (): StreakState => ({
  current: 0,
  seasonHits: 0,
  thresholdsPaid: [],
  lastMatchId: null,
  active: 0,
});

function testStreakMachine() {
  // Build to 3 → +2 one time.
  const s = freshStreak();
  const m1 = updateStreak(s, "m1", true);
  assert.equal(m1.bonusAwarded, 0);
  const m2 = updateStreak(m1.state, "m2", true);
  assert.equal(m2.bonusAwarded, 0);
  const m3 = updateStreak(m2.state, "m3", true);
  assert.equal(m3.bonusAwarded, 2, "third consecutive hit pays +2");
  assert.equal(m3.thresholdCrossed, 3);

  // 4th hit: nothing; 5th: +5.
  const m4 = updateStreak(m3.state, "m4", true);
  assert.equal(m4.bonusAwarded, 0, "past the threshold pays nothing extra");
  const m5 = updateStreak(m4.state, "m5", true);
  assert.equal(m5.bonusAwarded, 5, "crossing 5 pays +5");

  // 6..9: nothing. 10: +10.
  let state = m5.state;
  for (let i = 6; i <= 9; i++) {
    state = updateStreak(state, `m${i}`, true).state;
  }
  const m10 = updateStreak(state, "m10", true);
  assert.equal(m10.bonusAwarded, 10, "crossing 10 pays +10");
  assert.equal(m10.state.seasonHits, 10);
  assert.deepEqual(
    [...m10.state.thresholdsPaid].sort((a, b) => a - b),
    [3, 5, 10],
  );

  // Miss resets current but keeps season bookkeeping.
  const miss = updateStreak(m10.state, "m11", false);
  assert.equal(miss.state.current, 0, "miss resets the streak");
  assert.equal(miss.state.active, 0);
  assert.equal(miss.state.seasonHits, 10, "season hits persist through a miss");
  assert.deepEqual(miss.state.thresholdsPaid, [3, 5, 10], "thresholds stay paid");

  // Rebuild: current grows again but NO threshold repays this season.
  const again3 = updateStreak(miss.state, "m12", true).state;
  updateStreak(again3, "m13", true);
  const again4 = updateStreak(updateStreak(again3, "m13", true).state, "m14", true);
  assert.equal(again4.state.current, 3, "current rebuilt to 3");
  assert.equal(again4.bonusAwarded, 0, "thresholds pay once per season");
  assert.equal(again4.state.seasonHits, 13);

  // No predictions at all = miss (caller passes hit=false).
  const noPreds = updateStreak(freshStreak(), "mX", false);
  assert.equal(noPreds.state.current, 0);

  // Idempotent re-evaluation of the same match is a no-op.
  const replay = updateStreak(m5.state, "m5", true);
  assert.equal(replay.bonusAwarded, 0, "same match re-evaluation pays nothing");
  assert.equal(replay.state.current, m5.state.current);
}

/* ------------------------------------------------------------ no negatives */

function testNoNegative() {
  const payloads = [XI, SUBS, WATCH, VERSUS];
  for (const p of payloads) {
    if ("playerIds" in p) {
      assert.ok(scoreLineup(p, { starterIds: new Set(), formations: new Set() }).points >= 0);
    }
    if ("subs" in p) assert.ok(scoreSubs(p, []).points >= 0);
    if ("playerAId" in p) assert.ok(scoreVersus({ pick: p, statScores: {} }).points >= 0);
  }
  // Hostile stat scores: versus never goes negative.
  assert.ok(scoreVersus({ pick: VERSUS, statScores: { "9": -99, "4": -50 } }).points >= 0);
  assert.ok(
    scorePlayerWatch({
      pick: WATCH,
      positionRows: rows([
        ["9", "FWD", -10],
        ["11", "FWD", -20],
      ]),
      crowd: [],
      mvpPlayerId: null,
    }).points >= 0,
  );
  // Streak bonuses are defined positive constants.
  for (const t of POINTS.streakThresholds) assert.ok(POINTS.streak[t] > 0);
}

/* ------------------------------------------------------------ firewall + DB */

/**
 * The ratings/comments firewall, over a real database: awards flow only from
 * predictions and streak bonuses; stuffing crowd_ratings and comments with
 * rows must not move any total.
 */
async function testRatingsNeverTouchLedger(): Promise<void> {
  const db = new DatabaseSync(":memory:");
  // Minimal schema mirror — the real migration is heavy; the ledger needs
  // users, matches, point_ledger, user_point_totals (+ predictions/streak
  // tables for the streak path).
  db.exec(`
    CREATE TABLE users (id INTEGER PRIMARY KEY AUTOINCREMENT, display_name TEXT NOT NULL);
    -- Board identity join: usernames (when present) win over display names.
    CREATE TABLE user_credentials (
      user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      username TEXT NOT NULL UNIQUE
    );
    CREATE TABLE matches (
      id TEXT PRIMARY KEY, league TEXT NOT NULL,
      home_team_id TEXT NOT NULL, away_team_id TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'finished'
    );
    CREATE TABLE predictions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL, match_id TEXT NOT NULL, mechanic TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending', points_awarded INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE favorite_teams (
      user_id INTEGER NOT NULL, team_id TEXT NOT NULL, is_favorite INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE point_ledger (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL, match_id TEXT, source TEXT NOT NULL, mechanic TEXT,
      points INTEGER NOT NULL CHECK (points >= 0), scope_season TEXT NOT NULL,
      awarded_at TEXT NOT NULL, source_id INTEGER NOT NULL, UNIQUE(source, source_id)
    );
    CREATE TABLE user_point_totals (
      user_id INTEGER NOT NULL, scope TEXT NOT NULL, scope_season TEXT NOT NULL,
      total INTEGER NOT NULL DEFAULT 0, reached_total_at TEXT NOT NULL,
      PRIMARY KEY (user_id, scope, scope_season)
    );
    CREATE TABLE user_streaks (
      user_id INTEGER PRIMARY KEY, current INTEGER NOT NULL DEFAULT 0,
      season_hits INTEGER NOT NULL DEFAULT 0, thresholds_paid TEXT NOT NULL DEFAULT '[]',
      last_match_id TEXT, streak_active INTEGER NOT NULL DEFAULT 0, scope_season TEXT NOT NULL DEFAULT '',
      updated_at TEXT NOT NULL
    );
    CREATE TABLE streak_evaluations (
      id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, match_id TEXT NOT NULL,
      hit INTEGER NOT NULL, bonus INTEGER NOT NULL DEFAULT 0, evaluated_at TEXT NOT NULL,
      UNIQUE(user_id, match_id)
    );
    CREATE TABLE crowd_ratings (
      id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL,
      player_id TEXT NOT NULL, match_id TEXT NOT NULL, rating INTEGER NOT NULL,
      comment TEXT, created_at TEXT NOT NULL
    );
    CREATE TABLE timeline_comments (
      id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL,
      match_id TEXT NOT NULL, text TEXT NOT NULL, created_at TEXT NOT NULL
    );
  `);

  db.prepare("INSERT INTO users (display_name) VALUES (?)").run("tester");
  db.prepare("INSERT INTO matches (id, league, home_team_id, away_team_id) VALUES (?, ?, ?, ?)").run(
    "m1",
    "eng.1",
    "57",
    "64",
  );
  // The user's favorite club plays m1.
  db.prepare("INSERT INTO favorite_teams (user_id, team_id, is_favorite) VALUES (?, ?, ?)").run(1, "57", 1);
  // One resolved, point-scoring prediction on m1 (lineup 5 pts).
  db.prepare(
    "INSERT INTO predictions (user_id, match_id, mechanic, status, points_awarded) VALUES (?, ?, 'lineup', 'correct', 5)",
  ).run(1, "m1");
  // ...and a PILE of ratings and comments.
  for (let i = 0; i < 50; i++) {
    db.prepare(
      "INSERT INTO crowd_ratings (user_id, player_id, match_id, rating, comment, created_at) VALUES (?, ?, ?, ?, ?, ?)",
    ).run(1, `p${i}`, "m1", 10, "amazing", new Date().toISOString());
    db.prepare("INSERT INTO timeline_comments (user_id, match_id, text, created_at) VALUES (?, ?, ?, ?)").run(
      1,
      "m1",
      "cheap comment farming",
      new Date().toISOString(),
    );
  }

  // Award the prediction's points through the ledger.
  const ledgerId = award(db, {
    userId: 1,
    matchId: "m1",
    source: "prediction",
    mechanic: "lineup",
    points: 5,
    sourceId: 1,
    league: "eng.1",
    teamIds: ["57", "64"],
  });
  assert.ok(ledgerId !== null, "award recorded");

  // Ledger holds exactly ONE row, from the prediction.
  const ledgerRows = db.prepare("SELECT COUNT(*) AS n FROM point_ledger").get() as { n: number };
  assert.equal(ledgerRows.n, 1, "ratings/comments produced no ledger rows");

  // Scopes: global 5, league 5, both clubs 5 — nothing from the 50 ratings.
  const scopes = db
    .prepare("SELECT scope, total FROM user_point_totals WHERE user_id = 1 ORDER BY scope")
    .all() as Array<{ scope: string; total: number }>;
  assert.deepEqual(
    scopes.map((s) => s.scope),
    ["club:57", "club:64", "global", "league:eng.1"],
    "one award bumps exactly global + league + both clubs",
  );
  assert.ok(
    scopes.every((s) => s.total === 5),
    "every scope got exactly the prediction's 5 points",
  );

  // Idempotent re-award (re-resolution) doesn't double-pay.
  const again = award(db, {
    userId: 1,
    matchId: "m1",
    source: "prediction",
    mechanic: "lineup",
    points: 5,
    sourceId: 1,
    league: "eng.1",
    teamIds: ["57", "64"],
  });
  assert.equal(again, null, "duplicate award is a no-op");
  const totalsAfter = (
    db.prepare("SELECT total FROM user_point_totals WHERE scope = 'global' AND user_id = 1").get() as {
      total: number;
    }
  ).total;
  assert.equal(totalsAfter, 5, "re-award didn't double-pay");

  // Zero-point awards write nothing (tiebreak integrity).
  const zero = award(db, {
    userId: 1,
    matchId: "m1",
    source: "prediction",
    mechanic: "versus",
    points: 0,
    sourceId: 2,
    league: "eng.1",
    teamIds: ["57", "64"],
  });
  assert.equal(zero, null, "zero-point award writes no ledger row");

  // Negative points are refused outright (§7).
  assert.throws(
    () =>
      award(db, {
        userId: 1,
        matchId: "m1",
        source: "prediction",
        mechanic: "versus",
        points: -3,
        sourceId: 3,
        league: "eng.1",
        teamIds: ["57", "64"],
      }),
    /negative/,
    "negative award refused",
  );

  // Tiebreak: reached_total_at is set at award time — earlier award wins ties.
  const board = readLeaderboard(db, "global", currentSeasonLabel(), 10);
  assert.equal(board.length, 1);
  assert.equal(board[0].total, 5);
  assert.ok(board[0].reached_total_at.length > 0);

  // Board identity: no username row → display name fallback; with one → @handle.
  assert.equal(board[0].display_name, "tester", "no username renders the display name");
  assert.equal(board[0].username, null);
  db.prepare("INSERT INTO user_credentials (user_id, username) VALUES (?, ?)").run(1, "striker10");
  const boardWithHandle = readLeaderboard(db, "global", currentSeasonLabel(), 10);
  assert.equal(boardWithHandle[0].display_name, "@striker10", "username renders as @handle");
  assert.equal(boardWithHandle[0].username, "striker10");
  // Viewer flag: only the caller's own row is marked is_you.
  assert.equal(boardWithHandle[0].is_you, false, "anonymous read marks nobody");
  assert.equal(
    readLeaderboard(db, "global", currentSeasonLabel(), 10, 1)[0].is_you,
    true,
    "viewer id marks their row",
  );
  assert.equal(readLeaderboard(db, "global", currentSeasonLabel(), 10, 2)[0].is_you, false);

  // Streak end-to-end over the DB: hit (award exists, nothing pending) →
  // streak extends; thresholds pay through the ledger exactly once.
  // (The resolver awards through the ledger before sweeping streaks — mirror
  // that here: award first, then evaluate.)
  db.prepare("INSERT INTO users (display_name) VALUES (?)").run("second");
  db.prepare("INSERT INTO favorite_teams (user_id, team_id, is_favorite) VALUES (?, ?, ?)").run(2, "57", 1);
  db.prepare(
    "INSERT INTO predictions (user_id, match_id, mechanic, status, points_awarded) VALUES (?, ?, 'versus', 'correct', 3)",
  ).run(2, "m1");
  const awardUser2 = (matchId: string, sourceId: number) =>
    award(db, {
      userId: 2,
      matchId,
      source: "prediction",
      mechanic: "versus",
      points: 3,
      sourceId,
      league: "eng.1",
      teamIds: ["57", "64"],
    });
  assert.ok(awardUser2("m1", 10) !== null, "user 2's m1 award recorded");

  const first = await evaluateStreak(db, 2, "m1");
  assert.equal(first.skipped, false, "first evaluation runs");
  assert.equal(first.hit, true, "award on record = hit");
  assert.equal(first.bonusAwarded, 0, "hit 1 pays no bonus");

  const replay = await evaluateStreak(db, 2, "m1");
  assert.equal(replay.skipped, true, "re-evaluation is a no-op");

  // Pending predictions block evaluation (watch may still land).
  db.prepare(
    "INSERT INTO predictions (user_id, match_id, mechanic, status, points_awarded) VALUES (?, ?, 'player_watch', 'pending', 0)",
  ).run(2, "m2");
  db.prepare("INSERT INTO matches (id, league, home_team_id, away_team_id) VALUES (?, ?, ?, ?)").run(
    "m2",
    "eng.1",
    "57",
    "64",
  );
  const blocked = await evaluateStreak(db, 2, "m2");
  assert.equal(blocked.skipped, true, "pending predictions block evaluation");

  // Resolve it as a miss (settled 0 points → no ledger row) → streak resets.
  db.prepare("UPDATE predictions SET status = 'wrong' WHERE user_id = 2 AND match_id = 'm2'").run();
  const miss = await evaluateStreak(db, 2, "m2");
  assert.equal(miss.hit, false, "no awards = miss");
  const streakRow = db.prepare("SELECT current, streak_active FROM user_streaks WHERE user_id = 2").get() as {
    current: number;
    streak_active: number;
  };
  assert.equal(streakRow.current, 0, "miss resets the streak");
  assert.equal(streakRow.streak_active, 0);

  // Threshold pay-out over the DB: 3 hits in a row → +2 exactly once.
  for (let i = 3; i <= 5; i++) {
    db.prepare("INSERT INTO matches (id, league, home_team_id, away_team_id) VALUES (?, ?, ?, ?)").run(
      `m${i}`,
      "eng.1",
      "57",
      "64",
    );
    db.prepare(
      "INSERT INTO predictions (user_id, match_id, mechanic, status, points_awarded) VALUES (?, ?, 'versus', 'correct', 3)",
    ).run(2, `m${i}`);
    assert.ok(awardUser2(`m${i}`, 20 + i) !== null, `user 2's m${i} award recorded`);
    await evaluateStreak(db, 2, `m${i}`);
  }
  const bonuses = db
    .prepare("SELECT COUNT(*) AS n FROM point_ledger WHERE user_id = 2 AND source = 'streak_bonus'")
    .get() as { n: number };
  assert.equal(bonuses.n, 1, "exactly one threshold bonus recorded");
  const bonusRow = db
    .prepare("SELECT points FROM point_ledger WHERE user_id = 2 AND source = 'streak_bonus'")
    .get() as { points: number };
  assert.equal(bonusRow.points, 2, "the 3-hit threshold paid +2");

  db.close();
}

export async function runPredictionScoreTests(): Promise<void> {
  testLineup();
  testSubs();
  testAdjacency();
  testShotPredict();
  testWatch();
  testVersus();
  testStreakMachine();
  testNoNegative();
  await testRatingsNeverTouchLedger();
  console.log("  predictionScore: mechanics, adjacency, streak, no-negatives, ratings firewall OK");
}
