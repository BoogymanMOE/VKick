/**
 * The replay's ball path. The stored timeline only publishes coordinates for
 * goals, so the path must not be built from the timeline alone — a three-goal
 * match would then shuttle the ball between three points for ninety minutes.
 * These tests pin the commentary-derived moments as the path's raw material.
 */
import { strict as assert } from "node:assert";
import { buildReplayModel, REPLAY_MINUTES } from "../src/lib/replay.js";
import type { ApiCommentaryLine, ApiReplay, ApiTimelineEvent } from "../src/lib/api.js";

const SIDES = {
  home: { id: "h", name: "Bulgaria", shortName: "BUL", color: "#ffffff" },
  away: { id: "a", name: "Estonia", shortName: "EST", color: "#0072ce" },
};

function line(sequence: number, minute: string, text: string): ApiCommentaryLine {
  return { sequence, minute_display: minute, minute_seconds: null, text };
}

function goal(id: number, minute: string, teamId: string): ApiTimelineEvent {
  return {
    id,
    match_id: "m",
    minute_display: minute,
    minute_seconds: 0,
    type: "goal",
    team_id: teamId,
    description: `Goal! Bulgaria 1, Estonia 0. Max (Bulgaria) right footed shot from the centre of the box.`,
    participants: [{ id: "p1", name: "Max" }],
    comment_count: 0,
    field_x: 88,
    field_y: 50,
    goal_y: 52,
  };
}

/** A realistic feed: goals carry real coordinates, nothing else does. */
function replayWithCommentary(
  comments: ApiCommentaryLine[],
  events: ApiTimelineEvent[],
  xg?: { team_id: string; xg: number | null; xga: number | null }[],
): ApiReplay {
  return {
    match: { id: "m", home_team_id: "h", away_team_id: "a" },
    events,
    commentary: comments,
    teamStats: [
      { team_id: "h", possession_pct: 55, shots: null, shots_on_target: null, corners: null, fouls: null },
      { team_id: "a", possession_pct: 45, shots: null, shots_on_target: null, corners: null, fouls: null },
    ],
    xg,
  } as unknown as ApiReplay;
}

function testMomentsComeFromCommentary(): void {
  // Three goals on the timeline (the only coord-carrying events), but a dozen
  // described actions — the ball path must know about all of them.
  const comments = [
    line(1, "3'", "Attempt saved. Max (Bulgaria) right footed shot from outside the box is saved."),
    line(2, "9'", "Corner, Estonia. Conceded by Dan."),
    line(3, "17'", "Sam (Estonia) wins a free kick in the attacking half."),
    line(4, "24'", "Attempt missed. John (Estonia) header from the centre of the box."),
    line(5, "38'", "Shot on target. Max (Bulgaria) left footed shot from the left side of the box."),
    line(
      6,
      "45'",
      "Goal! Bulgaria 1, Estonia 0. Max (Bulgaria) right footed shot from the centre of the box.",
    ),
    line(7, "58'", "Attempt blocked. Dan (Bulgaria) right footed shot from outside the box."),
    line(8, "66'", "Corner, Bulgaria. Conceded by Sam."),
    line(9, "74'", "Attempt saved. John (Estonia) right footed shot from more than 35 yards."),
    line(10, "83'", "Sam (Estonia) wins a free kick in the defensive half."),
  ];
  const events = [goal(1, "45", "h"), goal(2, "70", "a"), goal(3, "90", "h")];
  const model = buildReplayModel(replayWithCommentary(comments, events), SIDES);

  // Every commentary action lands, plus the two timeline goals the commentary
  // didn't describe (the 45' one was merged).
  assert.ok(model.moments.length >= 9, `expected a detailed path, got ${model.moments.length} moments`);
  assert.ok(model.moments.length > events.length, "the path is richer than the coord-carrying timeline");

  // Deterministic and ordered.
  assert.deepEqual(
    [...model.moments].sort((a, b) => a.minute - b.minute),
    model.moments,
    "moments stay in match order",
  );
  for (const m of model.moments) {
    assert.ok(Number.isFinite(m.lx) && m.lx >= 0 && m.lx <= 1, `lx in range, got ${m.lx}`);
    assert.ok(Number.isFinite(m.ly) && m.ly >= 0 && m.ly <= 1, `ly in range, got ${m.ly}`);
  }
}

/** The bug: the ball used to sit on ~3 points for the whole match. */
function testBallTravelsAcrossTheMatch(): void {
  const comments = [
    line(1, "3'", "Attempt saved. Max (Bulgaria) right footed shot from outside the box."),
    line(2, "9'", "Corner, Estonia. Conceded by Dan."),
    line(3, "17'", "Sam (Estonia) wins a free kick in the attacking half."),
    line(4, "24'", "Attempt missed. John (Estonia) header from the centre of the box."),
    line(5, "38'", "Shot on target. Max (Bulgaria) left footed shot from the left side of the box."),
    line(6, "58'", "Attempt blocked. Dan (Bulgaria) right footed shot from outside the box."),
    line(7, "66'", "Corner, Bulgaria. Conceded by Sam."),
    line(8, "74'", "Attempt saved. John (Estonia) right footed shot from more than 35 yards."),
    line(9, "83'", "Sam (Estonia) wins a free kick in the defensive half."),
  ];
  const model = buildReplayModel(replayWithCommentary(comments, [goal(1, "45", "h")]), SIDES);

  const distinct = new Set(
    model.ticks.map((tick) => `${tick.ball.lx.toFixed(2)},${tick.ball.ly.toFixed(2)}`),
  );
  // A 90-minute path with a single tracked moment must still visit far more
  // than the handful of points a coordinates-only path produced.
  assert.ok(distinct.size >= 20, `ball must travel, got ${distinct.size} distinct spots`);
  // And it must cross both teams' halves, not hang around one box.
  const lxValues = model.ticks.map((tick) => tick.ball.lx);
  assert.ok(Math.min(...lxValues) < 0.35, "ball visits the left half");
  assert.ok(Math.max(...lxValues) > 0.65, "ball visits the right half");
  // The final tick is still inside the precomputed range.
  assert.equal(model.ticks.length, REPLAY_MINUTES + 1);
  assert.ok(model.ticks.every((tick) => Number.isFinite(tick.ball.lx) && Number.isFinite(tick.ball.ly)));
}

/** Interpolation, not a hard jump: a minute between two moments sits between. */
function testBallInterpolatesBetweenMoments(): void {
  const comments = [
    line(1, "10'", "Attempt saved. Max (Bulgaria) right footed shot from outside the box."),
    line(2, "20'", "Corner, Estonia. Conceded by Dan."),
  ];
  const model = buildReplayModel(replayWithCommentary(comments, []), SIDES);
  const at10 = model.ticks[10].ball;
  const at20 = model.ticks[20].ball;
  const at15 = model.ticks[15].ball;

  assert.ok(Math.abs(at10.lx - model.moments[0].lx) < 1e-9, "ball sits on the moment at its minute");
  assert.ok(Math.abs(at20.lx - model.moments[1].lx) < 1e-9, "ball sits on the moment at its minute");
  const lo = Math.min(at10.lx, at20.lx);
  const hi = Math.max(at10.lx, at20.lx);
  assert.ok(at15.lx > lo && at15.lx < hi, `mid-minute ball between the two spots, got ${at15.lx}`);
}

/** No commentary at all: a single centre point, never a wandering invention. */
function testEmptyCommentary(): void {
  const model = buildReplayModel(replayWithCommentary([], [goal(1, "45", "h")]), SIDES);
  // The one tracked goal is the only moment.
  assert.equal(model.moments.length, 1);
  const before = model.ticks[10].ball;
  assert.ok(
    Math.abs(before.lx - model.moments[0].lx) < 1e-9,
    "before the only moment the ball holds its spot",
  );
}

/** Per-match xG rides through to the model, and absence stays null. */
function testXgMapping(): void {
  const withXg = buildReplayModel(
    replayWithCommentary(
      [],
      [],
      [
        { team_id: "h", xg: 1.75, xga: 0.9 },
        { team_id: "a", xg: 0.9, xga: 1.75 },
      ],
    ),
    SIDES,
  );
  assert.equal(withXg.xgHome, 1.75, "the home row's own xG");
  assert.equal(withXg.xgAway, 0.9, "the away row's own xG");

  const without = buildReplayModel(replayWithCommentary([], []), SIDES);
  assert.equal(without.xgHome, null, "an unmatched fixture has no xG, never a zero");
  assert.equal(without.xgAway, null);
}

export function runReplayTests(): void {
  testMomentsComeFromCommentary();
  testBallTravelsAcrossTheMatch();
  testBallInterpolatesBetweenMoments();
  testEmptyCommentary();
  testXgMapping();
  console.log("  replay: commentary-derived ball path, interpolation, empty feed and xG OK");
}
