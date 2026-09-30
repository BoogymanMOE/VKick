/**
 * ESPN normalization — the only file that knows ESPN's shapes. These tests pin
 * the mapping for statuses, positions, clock parsing, event typing (including
 * the goal-subtype substrings) and the scoreboard walk, so an ESPN payload
 * change breaks a test instead of silently corrupting the DB.
 */
import { strict as assert } from "node:assert";
import {
  normalizeStatus,
  statusDetailSaysHalftime,
  normalizePosition,
  isPositional,
  normalizePositionName,
  clockSeconds,
  minuteDisplay,
  mapEventType,
  normalizeScoreboard,
  normalizeTimeline,
  normalizeRosters,
  deriveMinutes,
} from "../server/espn/normalize.js";

function testStatus() {
  assert.equal(normalizeStatus("pre", false), "scheduled");
  assert.equal(normalizeStatus("in", false), "live");
  assert.equal(normalizeStatus("post", true), "finished");
  // `completed` wins even if the state string is odd.
  assert.equal(normalizeStatus("weird", true), "finished");
  assert.equal(normalizeStatus(undefined, undefined), "scheduled");

  // Halftime: ESPN stays state:"in" through the break — the detail text is
  // the signal, and it gates the Sub Predictor's lock, so pin it hard.
  assert.equal(normalizeStatus("in", false, "Halftime"), "halftime");
  assert.equal(normalizeStatus("in", false, "Half Time"), "halftime");
  assert.equal(normalizeStatus("in", false, "Half-time"), "halftime");
  assert.equal(normalizeStatus("in", false, "HT"), "halftime", "bare HT code detected");
  assert.equal(normalizeStatus("in", false, "45+2' HT"), "halftime");
  assert.equal(normalizeStatus("post", true, "HT"), "finished", "completed still wins over detail");
  assert.equal(normalizeStatus("in", false, "63'"), "live", "ordinary clock detail stays live");
  // "HT" fused into a larger token must NOT trip the boundary regex.
  assert.equal(normalizeStatus("in", false, "HT60"), "live", "word-boundary guard");
  assert.equal(normalizeStatus("in", false, "SUMHT"), "live");
  assert.equal(statusDetailSaysHalftime("Halftime"), true);
  assert.equal(statusDetailSaysHalftime(""), false);
  assert.equal(statusDetailSaysHalftime(undefined), false);
  assert.equal(statusDetailSaysHalftime("Kick Off"), false);
}

function testPositions() {
  assert.equal(normalizePosition("GK"), "GK");
  assert.equal(normalizePosition("CD-L"), "DEF");
  assert.equal(normalizePosition("AM-R"), "MID");
  assert.equal(normalizePosition("ST"), "FWD");
  assert.equal(normalizePosition("ST-L"), "FWD");
  assert.equal(normalizePosition("W-R"), "MID");
  // Goal-subtype free-kick etc. fall through the exact map...
  assert.equal(normalizePosition(undefined), "MID", "missing position defaults to MID");
  // "SUB" is a role marker (wasn't in the XI), never a position — callers use
  // isPositional to skip it and read the athlete's own position instead.
  assert.ok(!isPositional("SUB"), "SUB is not a position");
  assert.ok(isPositional("CD-L"), "CD-L is a position");
  assert.equal(normalizePositionName("Goalkeeper"), "GK", "roster name form");
  assert.equal(normalizePositionName("Defender"), "DEF", "roster name form");
  assert.equal(normalizePositionName("Midfielder"), "MID", "roster name form");
  assert.equal(normalizePositionName("Forward"), "FWD", "roster name form");
}

function testClock() {
  assert.equal(clockSeconds({ value: 3420 }), 3420, "raw value wins");
  assert.equal(clockSeconds({ displayValue: "57'" }), 3420, "57 minutes in seconds");
  assert.equal(clockSeconds({ displayValue: "45+2'" }), 2820, "stoppage time added");
  assert.equal(clockSeconds(undefined), 0, "missing clock -> 0");
  assert.equal(minuteDisplay({ displayValue: "90'+3'" }), "90+3", "quotes stripped");
  assert.equal(minuteDisplay(undefined), "?", "missing display -> ?");
}

function testEventTypes() {
  // mapEventType's contract (see normalizeTimeline) is a pre-lowercased string;
  // these mirror what the production caller passes.
  assert.equal(mapEventType("goal"), "goal");
  assert.equal(mapEventType("own goal"), "goal");
  assert.equal(mapEventType("goal - free-kick"), "goal", "subtype goal via substring");
  assert.equal(mapEventType("goal - header"), "goal");
  assert.equal(mapEventType("penalty - scored"), "goal");
  assert.equal(mapEventType("yellow card"), "card");
  assert.equal(mapEventType("second yellow card"), "card", "yellow substring");
  assert.equal(mapEventType("substitution"), "substitution");
  assert.equal(mapEventType("var decision"), "var");
  assert.equal(mapEventType("full time"), "fulltime");
  assert.equal(mapEventType("something else"), "other");
}

/** Minimal scoreboard fixture in the shape ESPN actually sends. */
function testScoreboard() {
  const json = {
    events: [
      {
        id: "704001",
        date: "2026-09-26T14:00:00Z",
        season: { year: 2026 },
        competitions: [
          {
            status: { type: { state: "in", completed: false, displayClock: "HT", description: "Halftime" } },
            competitors: [
              {
                homeAway: "home",
                score: "2",
                team: {
                  id: "359",
                  displayName: "Chelsea",
                  abbreviation: "CHE",
                  color: "034694",
                  logos: [{ href: "https://example.com/che.png" }],
                },
              },
              {
                homeAway: "away",
                score: "1",
                team: { id: "360", shortDisplayName: "Arsenal", abbreviation: "ARS" },
              },
            ],
          },
        ],
      },
      {
        id: "704002",
        date: "2026-09-27T16:30:00Z",
        competitions: [
          {
            status: { type: { state: "pre", completed: false } },
            competitors: [
              { homeAway: "home", team: { id: "361", displayName: "Widgets FC" } },
              { homeAway: "away", team: { id: "362", displayName: "Sprockets" } },
            ],
          },
        ],
      },
      {
        // Missing a competitor: must be skipped, not crash.
        id: "704003",
        competitions: [{ competitors: [{ homeAway: "home", team: { id: "363" } }] }],
      },
    ],
  };
  const { teams, matches } = normalizeScoreboard(json, "eng.1");
  assert.equal(teams.length, 4, "only well-formed events contribute teams");
  assert.equal(matches.length, 2, "malformed event skipped");
  const live = matches[0]!;
  // The fixture's detail says "Halftime" — that IS the halftime detection
  // doing its job on a realistic payload.
  assert.equal(live.status, "halftime");
  assert.equal(live.home_score, 2);
  assert.equal(live.away_score, 1);
  assert.equal(live.minute_display, "HT");
  assert.equal(live.espn_season, "2026");
  // The fixture after the (now halftime) event is scheduled as before.
  const scheduled = matches[1]!;
  assert.equal(scheduled.status, "scheduled");
  assert.equal(scheduled.home_score, null, "no scores before kickoff");
  assert.equal(scheduled.away_score, null, "no scores before kickoff");
  // The halftime fixture keeps its live-window clock label for display.
  assert.equal(matches[0].minute_display, "HT");
  // Color is normalized to #hex.
  assert.equal(teams.find((t) => t.id === "359")?.color, "#034694");
}

/** Cup round extraction: notes/headline carry the round; leagues carry none. */
function testRoundExtraction() {
  // Competition notes form (scoreboard payloads).
  const withNotes = normalizeScoreboard(
    {
      events: [
        {
          id: "801",
          date: "2026-10-28T20:00:00Z",
          competitions: [
            {
              notes: [{ headline: "UEFA Champions League " }],
              status: { type: { state: "pre", completed: false } },
              competitors: [
                { homeAway: "home", team: { id: "361", displayName: "A" } },
                { homeAway: "away", team: { id: "362", displayName: "B" } },
              ],
            },
          ],
        },
      ],
    },
    "uefa.champions",
  );
  // ESPN puts the round in the note headline after the competition name —
  // same shape as a league fixture (round absent → null) vs. a cup one.
  const withRound = normalizeScoreboard(
    {
      events: [
        {
          id: "802",
          date: "2026-10-28T20:00:00Z",
          competitions: [
            {
              notes: [{ type: "event", headline: "Quarter-final" }],
              status: { type: { state: "pre", completed: false } },
              competitors: [
                { homeAway: "home", team: { id: "361", displayName: "A" } },
                { homeAway: "away", team: { id: "362", displayName: "B" } },
              ],
            },
          ],
        },
        {
          // League event: no notes at all → no round.
          id: "803",
          date: "2026-10-28T20:00:00Z",
          competitions: [
            {
              status: { type: { state: "pre", completed: false } },
              competitors: [
                { homeAway: "home", team: { id: "361", displayName: "A" } },
                { homeAway: "away", team: { id: "362", displayName: "B" } },
              ],
            },
          ],
        },
      ],
    },
    "uefa.champions",
  );
  assert.equal(withRound.matches[0]!.round, "Quarter-final", "notes headline carries the round");
  assert.equal(withRound.matches[1]!.round, null, "no notes → no round (league shape)");
  assert.ok(withNotes.matches.length === 1, "fixture still normalizes");
}

export function runNormalizeTests(): void {
  testStatus();
  testPositions();
  testClock();
  testEventTypes();
  testScoreboard();
  testRoundExtraction();
  testTimeline();
  testRosters();
  console.log("  normalize: status, positions, clock, event types, scoreboard, rounds, timeline, rosters OK");
}

function testTimeline() {
  const json = {
    keyEvents: [
      {
        id: "e1",
        type: { text: "Goal - Header" },
        clock: { value: 3420, displayValue: "57'" },
        team: { id: "359" },
        text: "Header from six yards",
        participants: [{ athlete: { id: "101", displayName: "Cole Palmer" } }],
        fieldPositionX: 93.4,
        fieldPositionY: 51.2,
        goalPositionY: 48.8,
      },
      {
        id: "e2",
        type: { text: "Substitution" },
        clock: { displayValue: "68'" },
        text: "Sub",
        participants: [
          { athlete: { id: "102", displayName: "On Man" } },
          { athlete: { id: "103", displayName: "Off Man" } },
        ],
      },
      { type: { text: "Mystery" } }, // no text at all -> dropped
    ],
  };
  const events = normalizeTimeline(json);
  assert.equal(events.length, 2, "empty 'other' events dropped");
  const goal = events[0]!;
  assert.equal(goal.type, "goal");
  assert.equal(goal.espn_event_key, "e1");
  assert.equal(goal.minute_seconds, 3420);
  assert.equal(goal.minute_display, "57");
  assert.equal(goal.team_id, "359");
  assert.equal(goal.field_x, 93.4, "coordinates preserved for the shot plot");
  assert.equal(goal.field_y, 51.2);
  assert.deepEqual(JSON.parse(goal.participants), [{ id: "101", name: "Cole Palmer" }]);
  const sub = events[1]!;
  assert.equal(sub.type, "substitution");
  assert.equal(sub.minute_seconds, 4080);
}

/** Roster stats: minutes derivation and stat extraction. */
function testRosters() {
  const json = {
    rosters: [
      {
        homeAway: "home",
        team: { id: "359" },
        formation: "4-3-3",
        roster: [
          {
            starter: true,
            jersey: 10,
            athlete: {
              id: "101",
              displayName: "Starter One",
              shortName: "S. One",
              position: { abbreviation: "AM-R" },
            },
            stats: [{ name: "totalGoals", value: 1 }],
          },
          {
            starter: true,
            subbedOut: true,
            jersey: 8,
            athlete: { id: "102", displayName: "Subbed Out" },
            stats: [{ name: "yellowCards", value: 1 }],
          },
          {
            starter: false,
            subbedIn: true,
            jersey: 20,
            athlete: { id: "103", displayName: "Impact Sub" },
            stats: [{ name: "goalAssists", value: 1 }],
          },
          {
            starter: false,
            didNotPlay: true,
            jersey: 30,
            athlete: { id: "104", displayName: "Unused" },
            stats: [],
          },
        ],
      },
    ],
    keyEvents: [
      {
        type: { text: "Substitution" },
        clock: { displayValue: "72'" },
        participants: [
          { athlete: { id: "103" } }, // came on at 72'
          { athlete: { id: "102" } }, // went off at 72'
        ],
      },
    ],
  };

  // Minutes derivation directly (the interesting logic).
  assert.equal(deriveMinutes(json.rosters[0]!.roster[0]!, json), 90, "starter not subbed = 90");
  assert.equal(deriveMinutes(json.rosters[0]!.roster[1]!, json), 72, "starter subbed out at 72'");
  assert.equal(deriveMinutes(json.rosters[0]!.roster[2]!, json), 18, "sub on at 72' plays 18");
  assert.equal(deriveMinutes(json.rosters[0]!.roster[3]!, json), 0, "unused = 0");

  const { players, stats } = normalizeRosters(json);
  assert.equal(players.length, 4);
  assert.equal(stats.length, 4);
  assert.equal(players.find((p) => p.id === "101")?.position, "MID", "AM-R maps to MID");
  assert.equal(players.find((p) => p.id === "101")?.jersey_number, 10);
  const starter = stats.find((s) => s.player_id === "101")!;
  assert.equal(starter.goals, 1);
  assert.equal(starter.started, true);
  const subbed = stats.find((s) => s.player_id === "102")!;
  assert.equal(subbed.yellow_cards, 1);
  assert.equal(subbed.minutes_played, 72);
  const unused = stats.find((s) => s.player_id === "104")!;
  assert.equal(unused.minutes_played, 0);
  assert.equal(unused.goals, 0, "missing stat defaults to 0");
}
