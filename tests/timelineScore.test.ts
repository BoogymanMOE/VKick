/**
 * The timeline's running score (`src/lib/timelineScore.ts`). What matters is
 * that the score beside a goal is a count of the goals BEFORE it, credited to
 * the side the event names — an off-by-one or a flipped side would print a
 * wrong scoreline next to a real goal, which is worse than printing none.
 */
import { strict as assert } from "node:assert";
import { formatScore, runningScore, type ScoredTimelineEvent } from "../src/lib/timelineScore.js";

const HOME = "359";
const AWAY = "360";

const goal = (id: string, teamId: string | null): ScoredTimelineEvent => ({
  id,
  type: "goal",
  teamId,
});
const other = (id: string, type: string): ScoredTimelineEvent => ({ id, type, teamId: HOME });

/** Each goal carries the score it produced, in home–away order. */
function testWalk(): void {
  const { byGoal, home, away } = runningScore(
    [goal("g1", HOME), other("c1", "card"), goal("g2", AWAY), goal("g3", HOME)],
    HOME,
    AWAY,
  );
  assert.deepEqual(byGoal.get("g1"), { home: 1, away: 0 }, "opener is 1-0");
  assert.deepEqual(byGoal.get("g2"), { home: 1, away: 1 }, "the reply levels it");
  assert.deepEqual(byGoal.get("g3"), { home: 2, away: 1 }, "the winner");
  assert.equal(byGoal.size, 3, "only goals get a score");
  assert.equal(home, 2);
  assert.equal(away, 1);
}

/** Non-goal events never enter the map, and no goals is an empty map. */
function testNonGoals(): void {
  const { byGoal, home, away } = runningScore(
    [other("k1", "kickoff"), other("h1", "halftime"), other("f1", "fulltime")],
    HOME,
    AWAY,
  );
  assert.equal(byGoal.size, 0, "no goals, no scoreline");
  assert.equal(home + away, 0);
}

/** A goal ESPN sent without a side leaves the tally alone rather than guessing. */
function testUnknownSide(): void {
  const { byGoal, home, away } = runningScore([goal("g1", HOME), goal("g2", null)], HOME, AWAY);
  assert.deepEqual(byGoal.get("g1"), { home: 1, away: 0 });
  assert.deepEqual(byGoal.get("g2"), { home: 1, away: 0 }, "an unattributed goal adds nothing");
  assert.equal(home, 1);
  assert.equal(away, 0);
}

/** A team id that belongs to neither side changes nothing. */
function testForeignTeam(): void {
  const { byGoal } = runningScore([goal("g1", "999")], HOME, AWAY);
  assert.deepEqual(byGoal.get("g1"), { home: 0, away: 0 });
}

/** The scoreline reads the way the app prints fixture results. */
function testFormat(): void {
  assert.equal(formatScore({ home: 3, away: 0 }), "3–0");
  assert.equal(formatScore({ home: 0, away: 0 }), "0–0");
}

export function runTimelineScoreTests(): void {
  testWalk();
  testNonGoals();
  testUnknownSide();
  testForeignTeam();
  testFormat();
  console.log("  timelineScore: goal-by-goal running score, unattributed goals, format OK");
}
