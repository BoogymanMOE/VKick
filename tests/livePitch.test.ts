/**
 * The live pitch's brain: commentary → ball spot, action kind, actor/recipient,
 * distance. Pins the ESPN house-style parsing so a feed wording change fails
 * loudly here instead of rendering a wrong annotation.
 */
import { strict as assert } from "node:assert";
import {
  buildLiveModel,
  classifyLine,
  distanceFromGoal,
  shotsFromCommentary,
  type LiveSide,
} from "../src/lib/livePitch.js";

const SIDES = {
  home: { id: "462", name: "Bulgaria", shortName: "Bulgaria", color: "#ffffff" } as LiveSide,
  away: { id: "444", name: "Estonia", shortName: "Estonia", color: "#0072ce" } as LiveSide,
};

function line(sequence: number, minute: string, text: string) {
  return { sequence, minute_display: minute, minute_seconds: null, text };
}

function testClassify(): void {
  assert.equal(classifyLine("Attempt saved. Max (Estonia) right footed shot from outside the box."), "shot");
  assert.equal(classifyLine("Attempt missed. John (Bulgaria) header from the centre of the box."), "shot");
  assert.equal(
    classifyLine("Attempt blocked. Dan (Bulgaria) left footed shot from a difficult angle."),
    "shot",
  );
  assert.equal(classifyLine("Goal! Bulgaria 1, Estonia 0. Max (Estonia) from a free kick."), "goal");
  assert.equal(classifyLine("Own Goal by Sam (Estonia). Bulgaria 1, Estonia 0."), "goal");
  assert.equal(classifyLine("Corner, Bulgaria. Conceded by Sam."), "corner");
  assert.equal(classifyLine("Foul by Sam (Estonia)."), "foul");
  assert.equal(classifyLine("Max (Bulgaria) wins a free kick in the attacking half."), "freekick");
  assert.equal(classifyLine("Max (Bulgaria) is shown the yellow card for a bad foul."), "card");
  assert.equal(classifyLine("Substitution, Estonia. Max replaces Sam."), "substitution");
  // Tracked but unmappable restarts must not claim the annotation.
  assert.equal(classifyLine("Offside, Estonia. Sam is caught offside."), "none");
  assert.equal(classifyLine("Delay in match (Bulgaria)."), "none");
  assert.equal(classifyLine("Fourth official has announced 3 minutes of added time."), "none");
  assert.equal(classifyLine(""), null);
  assert.equal(classifyLine("Second Half begins Bulgaria 0, Estonia 0."), "none");
}

function testNames(): void {
  const model = buildLiveModel({
    ...SIDES,
    events: [],
    commentary: [
      line(
        1,
        "64'",
        "Attempt saved. Maksim Paskotsi (Estonia) left footed shot from outside the box is saved.",
      ),
    ],
    currentMinute: 70,
  });
  assert.equal(model.moment?.kind, "shot");
  assert.equal(model.moment?.actor, "Maksim Paskotsi");
  assert.equal(model.moment?.side, "away");
  assert.ok(
    model.moment?.distanceM && model.moment.distanceM >= 19 && model.moment.distanceM <= 21,
    `outside-the-box shot ≈ 20m, got ${model.moment?.distanceM}`,
  );
  // Away side attacking: ball must sit on the home half of the drawn pitch.
  assert.ok(model.moment.ball.lx < 0.5, `away shot lands left, got lx=${model.moment.ball.lx}`);
}

function testCorner(): void {
  const model = buildLiveModel({
    ...SIDES,
    events: [],
    commentary: [line(1, "86'", "Corner, Estonia. Conceded by Kristian Dimitrov.")],
    currentMinute: 86,
  });
  assert.equal(model.moment?.kind, "corner");
  assert.equal(model.moment?.recipient, "Kristian Dimitrov");
  assert.equal(model.moment?.side, "away");
  assert.ok(
    model.moment.ball.lx < 0.1,
    `corner ball sits at the away-attacked arc, got lx=${model.moment.ball.lx}`,
  );
}

function testGoalOverridesCommentary(): void {
  const model = buildLiveModel({
    ...SIDES,
    events: [
      {
        id: 1,
        match_id: "m",
        minute_display: "78",
        minute_seconds: 4680,
        type: "goal",
        team_id: "462",
        description:
          "Goal! Bulgaria 1, Estonia 0. Lukas Petkov (Bulgaria) right footed shot from the centre of the box.",
        participants: [{ id: "p1", name: "Lukas Petkov" }],
        comment_count: 0,
        field_x: 88,
        field_y: 50,
        goal_y: 52,
      },
    ],
    commentary: [line(1, "78'", "Attempt saved. Someone (Estonia) shot from outside the box.")],
    currentMinute: 80,
  });
  assert.equal(model.moment?.kind, "goal");
  assert.equal(model.moment?.actor, "Lukas Petkov");
  // Real tracked coordinates win over any zone guess: 88% ≈ 12m from goal.
  assert.ok(model.moment.distanceM === 13, `tracked coords → 13m, got ${model.moment?.distanceM}`);
  assert.ok(model.moment.ball.lx > 0.8, `home goal spot on the right, got lx=${model.moment.ball.lx}`);
  // The celebration ring reads the same moment.
  assert.equal(model.lastGoal?.kind, "goal");
  assert.equal(model.lastGoal?.actor, "Lukas Petkov");
}

function testLastGoalSurvivesLaterActions(): void {
  const model = buildLiveModel({
    ...SIDES,
    events: [],
    commentary: [
      line(
        1,
        "69'",
        "Goal! England 0, Czechia 2. Harry Kane (England) right footed shot from the centre of the box.",
      ),
      line(2, "71'", "Corner, England. Conceded by Pavel Sulc."),
      line(3, "74'", "Substitution, England. Max replaces Sam."),
    ],
    currentMinute: 75,
  });
  // The annotation follows the latest action…
  assert.equal(model.moment?.kind, "substitution");
  // …but the celebration stays pinned to the goal.
  assert.equal(model.lastGoal?.kind, "goal");
  assert.equal(model.lastGoal?.actor, "Harry Kane");
  assert.ok(
    model.lastGoal.ball.lx > 0.8,
    `goal spot in England's attack end, got lx=${model.lastGoal.ball.lx}`,
  );
}

function testCoordlessGoalInheritsLocalBall(): void {
  const model = buildLiveModel({
    ...SIDES,
    events: [],
    commentary: [
      line(1, "30'", "Attempt saved. Max (Bulgaria) right footed shot from outside the box."),
      line(2, "31'", "Goal! Bulgaria 1, Estonia 0. Max (Bulgaria) scores."),
    ],
    currentMinute: 32,
  });
  // No field_x on this feed: the celebration uses the spot at the goal itself
  // (the shot's zone), not the centre fallback.
  assert.equal(model.lastGoal?.kind, "goal");
  assert.ok(model.lastGoal.ball.lx > 0.7, `goal sits at the shot spot, got lx=${model.lastGoal.ball.lx}`);
}

function testSub(): void {
  const model = buildLiveModel({
    ...SIDES,
    events: [],
    commentary: [line(1, "45'", "Substitution, Bulgaria. Asen Chandarov replaces Borislav Tsonev.")],
    currentMinute: 46,
  });
  assert.equal(model.moment?.kind, "substitution");
  assert.equal(model.moment?.actor, "Asen Chandarov");
  assert.equal(model.moment?.recipient, "Borislav Tsonev");
}

function testFutureGated(): void {
  const model = buildLiveModel({
    ...SIDES,
    events: [],
    commentary: [line(1, "90'", "Attempt missed. Max (Bulgaria) shot from outside the box.")],
    currentMinute: 75,
  });
  assert.equal(model.moment, null, "an action from the future never shows");
}

function testTrail(): void {
  const model = buildLiveModel({
    ...SIDES,
    events: [],
    commentary: [
      line(1, "50'", "Foul by Max (Estonia)."),
      line(2, "50'", "Sam (Bulgaria) wins a free kick in the attacking half."),
      line(3, "64'", "Attempt saved. Maksim Paskotsi (Estonia) left footed shot from outside the box."),
      line(4, "70'", "Corner, Bulgaria. Conceded by Sam."),
    ],
    currentMinute: 72,
  });
  // Three spot-carrying moments: free kick (attacking half), shot, corner.
  assert.equal(model.trail.length, 3);
  const last = model.moment;
  assert.equal(last?.kind, "corner");
  // The trail runs oldest → newest across the halves: first spot from the
  // home free kick sits right of centre, the corner lands top-left.
  assert.ok(
    model.trail[0].lx > 0.6,
    `free-kick spot in Bulgaria's attacking half, got lx=${model.trail[0].lx}`,
  );
  assert.ok(model.trail[2].lx > 0.9, `home corner sits at the right arc, got lx=${model.trail[2].lx}`);
}

function testDistanceHelper(): void {
  const home = distanceFromGoal("home", { lx: 0.4, ly: 0.5 });
  assert.equal(home, 63, "home at 40% length → 63m from the right goal");
  assert.equal(distanceFromGoal(null, { lx: 0.4, ly: 0.5 }), null);
}

function testGoalsAndPressure(): void {
  // No tracked actions → neutral pressure, no pins.
  const empty = buildLiveModel({ ...SIDES, events: [], commentary: [], currentMinute: 10 });
  assert.equal(empty.moment, null);
  assert.equal(empty.pressure, 0.5);
  assert.deepEqual(empty.allGoals, []);

  // Two Bulgaria goals then a Bulgaria sub: all pins kept, pressure tilted
  // home, lastGoal = the second goal, moment = the sub.
  const model = buildLiveModel({
    ...SIDES,
    events: [],
    commentary: [
      line(
        1,
        "20'",
        "Goal! Bulgaria 1, Estonia 0. Max (Bulgaria) right footed shot from the centre of the box.",
      ),
      line(2, "55'", "Goal! Bulgaria 2, Estonia 0. Max (Bulgaria) header from very close range."),
      line(3, "58'", "Substitution, Bulgaria. Asen replaces Borislav."),
    ],
    currentMinute: 60,
  });
  assert.equal(model.moment?.kind, "substitution");
  assert.equal(model.lastGoal?.minuteDisplay, "55'");
  assert.equal(model.lastGoal?.actor, "Max");
  assert.equal(model.allGoals.length, 2);
  // The rhythm tape gets every tracked moment, in match order.
  assert.deepEqual(
    model.events.map((e) => e.kind),
    ["goal", "goal", "substitution"],
  );
  // The shot map accrues goals + shots: both goals here.
  assert.equal(model.shots.length, 2);
  assert.ok(model.allGoals[0].ball.lx > 0.8, `goal pins carry spots, got lx=${model.allGoals[0].ball.lx}`);
  assert.ok(model.pressure > 0.55, `one-sided game tilts pressure, got ${model.pressure}`);

  // Balanced action from both sides → pressure back near even.
  const even = buildLiveModel({
    ...SIDES,
    events: [],
    commentary: [
      line(1, "10'", "Attempt saved. Max (Bulgaria) shot from outside the box."),
      line(2, "20'", "Attempt saved. Sam (Estonia) shot from outside the box."),
    ],
    currentMinute: 25,
  });
  assert.ok(Math.abs(even.pressure - 0.5) < 0.05, `alternating actions stay near even, got ${even.pressure}`);
  // Every commentary shot lands in the map, goal shots included.
  assert.equal(even.shots.length, 2);
  assert.ok(even.shots.every((s) => s.distanceM != null));
}

/** The replay's persistent shot map runs on the same parser as the live one. */
function testShotsFromCommentary(): void {
  const shots = shotsFromCommentary(
    [
      line(1, "12'", "Attempt saved. Max (Bulgaria) right footed shot from outside the box is saved."),
      line(2, "20'", "Foul by Sam (Estonia)."),
      line(
        3,
        "34'",
        "Goal! Bulgaria 1, Estonia 0. Max (Bulgaria) left footed shot from the centre of the box.",
      ),
      line(4, "55'", "Attempt missed. Sam (Estonia) header from very close range misses to the left."),
    ],
    SIDES,
  );
  assert.equal(shots.length, 3, "every shot and goal is kept, nothing else");
  assert.deepEqual(
    shots.map((s) => s.goal),
    [false, true, false],
    "goals are flagged so the pins can own them",
  );
  assert.deepEqual(
    shots.map((s) => s.minuteNum),
    [12, 34, 55],
    "shots stay in match order with their minute",
  );
  // Home attacks right, away attacks left — the same mirroring the pitch draws.
  assert.ok(shots[0].ball.lx > 0.7, `home shot sits on the right, got lx=${shots[0].ball.lx}`);
  assert.ok(shots[2].ball.lx < 0.3, `away shot sits on the left, got lx=${shots[2].ball.lx}`);
  assert.ok(
    shots[0].distanceM != null && shots[0].distanceM >= 19 && shots[0].distanceM <= 21,
    "outside-the-box shot ≈ 20m",
  );
  // Same input, same spot — the map must not drift between renders.
  assert.deepEqual(
    shotsFromCommentary(
      [line(1, "12'", "Attempt saved. Max (Bulgaria) right footed shot from outside the box.")],
      SIDES,
    )[0].ball,
    shots[0].ball,
  );
}

export function runLivePitchTests(): void {
  testClassify();
  testNames();
  testCorner();
  testGoalOverridesCommentary();
  testLastGoalSurvivesLaterActions();
  testCoordlessGoalInheritsLocalBall();
  testSub();
  testFutureGated();
  testTrail();
  testDistanceHelper();
  testGoalsAndPressure();
  testShotsFromCommentary();
}
