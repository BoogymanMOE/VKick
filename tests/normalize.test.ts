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
  notPlayedStatus,
  decidedByFromDetail,
  isNotPlayedStatus,
  normalizePosition,
  isPositional,
  normalizePositionName,
  clockSeconds,
  minuteDisplay,
  mapEventType,
  normalizeScoreboard,
  normalizeSummaryMatch,
  normalizeSummaryFacts,
  normalizeTimeline,
  normalizeRosters,
  normalizeRosterPlayers,
  normalizeTeamAvailability,
  normalizeStandings,
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

/**
 * A called-off fixture is the one case where ESPN's coarse `state: "post"`
 * lies: it also marks postponed and abandoned games that way. The wording has
 * to win, or a 0-0 that nobody played reads as a result everywhere.
 */
function testNotPlayedAndDecidedBy() {
  assert.equal(normalizeStatus("post", true, "Postponed"), "postponed");
  assert.equal(normalizeStatus("post", true, "Match Postponed"), "postponed");
  assert.equal(normalizeStatus("post", true, "Abandoned"), "abandoned");
  assert.equal(normalizeStatus("post", true, "Suspended"), "abandoned");
  assert.equal(normalizeStatus("post", true, "Cancelled"), "cancelled");
  assert.equal(normalizeStatus("post", true, "Full Time"), "finished");
  assert.equal(normalizeStatus("post", true, "FT-Pens"), "finished", "a shootout is a played result");
  assert.equal(normalizeStatus("post", true, "AET"), "finished");
  assert.equal(normalizeStatus("in", false, "Postponed"), "postponed", "wording wins over the live state");

  assert.equal(notPlayedStatus("Postponed"), "postponed");
  assert.equal(notPlayedStatus("FT"), null);
  assert.equal(notPlayedStatus(undefined), null);
  assert.ok(isNotPlayedStatus("postponed"));
  assert.ok(isNotPlayedStatus("abandoned"));
  assert.ok(isNotPlayedStatus("cancelled"));
  assert.ok(!isNotPlayedStatus("finished"));

  // How a knockout tie was separated — the only source of AET / pens truth.
  assert.equal(decidedByFromDetail("FT-Pens"), "penalties");
  assert.equal(decidedByFromDetail("Penalties"), "penalties");
  assert.equal(decidedByFromDetail("Won on penalties"), "penalties");
  assert.equal(decidedByFromDetail("After Extra Time"), "extra-time");
  assert.equal(decidedByFromDetail("AET"), "extra-time");
  assert.equal(decidedByFromDetail("FT"), null);
  assert.equal(decidedByFromDetail("Pending"), null, "\"pending\" must not read as penalties");
  assert.equal(decidedByFromDetail(undefined), null);
}

function testPositions() {
  assert.equal(normalizePosition("GK"), "GK");
  assert.equal(normalizePosition("CD-L"), "DEF");
  assert.equal(normalizePosition("AM-R"), "MID");
  assert.equal(normalizePosition("ST"), "FWD");
  assert.equal(normalizePosition("ST-L"), "FWD");
  assert.equal(normalizePosition("W-R"), "MID");
  // Goal-subtype free-kick etc. fall through the exact map...
  assert.equal(normalizePosition(undefined), "OTHER", "missing position uses the fallback group");
  assert.equal(normalizePosition("Central Defender"), "DEF");
  assert.equal(normalizePosition("Left Wing-back"), "DEF");
  assert.equal(normalizePosition("Attacker"), "FWD");
  assert.equal(normalizePosition("Mystery Role"), "OTHER");
  // "SUB" is a role marker (wasn't in the XI), never a position — callers use
  // isPositional to skip it and read the athlete's own position instead.
  assert.ok(!isPositional("SUB"), "SUB is not a position");
  assert.ok(isPositional("CD-L"), "CD-L is a position");
  assert.equal(normalizePositionName("Goalkeeper"), "GK", "roster name form");
  assert.equal(normalizePositionName("Defender"), "DEF", "roster name form");
  assert.equal(normalizePositionName("Midfielder"), "MID", "roster name form");
  assert.equal(normalizePositionName("Forward"), "FWD", "roster name form");
}

function testFullRosterAndAvailability(): void {
  const raw = {
    team: { id: "112" },
    athletes: [
      { id: "gk", fullName: "Keeper", position: { abbreviation: "G" } },
      { id: "cb", fullName: "Centre Back", position: { name: "Centre-Back" } },
      { id: "wb", fullName: "Wing Back", position: { abbreviation: "WB" } },
      { id: "cm", fullName: "Midfielder", position: { name: "Midfielder" } },
      { id: "st", fullName: "Attacker", position: { name: "Attacker" } },
      { id: "unk", fullName: "Unknown", position: { abbreviation: "MYSTERY" } },
      { id: "unk", fullName: "Duplicate row", position: { abbreviation: "MYSTERY" } },
    ],
  };
  const players = normalizeRosterPlayers(raw);
  assert.equal(players.length, 6, "all distinct roster records retained");
  assert.deepEqual(players.map((player) => player.position), ["GK", "DEF", "DEF", "MID", "FWD", "OTHER"]);
  assert.equal(new Set(players.map((player) => player.id)).size, players.length, "each player appears once");

  assert.deepEqual(
    normalizeTeamAvailability({ injuries: [
      { athlete: { id: "p1", displayName: "Player One" }, status: { name: "Out" }, details: { type: "Hamstring", returnDate: "2026-11-10" } },
      { athlete: { id: "p2", fullName: "Player Two" }, status: "Suspended", reason: "Red card" },
      { athlete: { id: "p3", fullName: "Player Three" }, status: "Doubtful" },
    ] }),
    [
      { player_id: "p1", player_name: "Player One", status: "injured", reason: "Hamstring", expected_return: "2026-11-10" },
      { player_id: "p2", player_name: "Player Two", status: "suspended", reason: "Red card", expected_return: null },
      { player_id: "p3", player_name: "Player Three", status: "doubtful", reason: null, expected_return: null },
    ],
  );
  assert.deepEqual(normalizeTeamAvailability({}), [], "empty report normalizes to an empty cacheable result");
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

/**
 * Postponed fixtures and shootout results on the scoreboard walk: a called-off
 * game must not keep a score, and a tie decided on spot kicks must carry both
 * the level score it finished 120 minutes on and the shootout tally.
 */
function testScoreboardNonPlayedAndShootout() {
  const event = (
    id: string,
    description: string,
    scores: [string, string],
    homePens?: string,
    awayPens?: string,
  ) => ({
    id,
    date: "2026-10-28T20:00:00Z",
    competitions: [
      {
        status: { type: { state: "post", completed: true, description } },
        competitors: [
          {
            homeAway: "home",
            score: scores[0],
            shootoutScore: homePens,
            team: { id: "10", displayName: "Home FC" },
          },
          {
            homeAway: "away",
            score: scores[1],
            shootoutScore: awayPens,
            team: { id: "20", displayName: "Away FC" },
          },
        ],
      },
    ],
  });
  const { matches } = normalizeScoreboard(
    {
      events: [
        event("900", "Postponed", ["0", "0"]),
        event("901", "FT-Pens", ["2", "2"], "4", "3"),
        event("902", "AET", ["1", "0"]),
      ],
    },
    "uefa.champions",
  );
  const [postponed, shootout, extraTime] = matches;
  assert.ok(postponed && shootout && extraTime);
  assert.equal(postponed.status, "postponed");
  assert.equal(postponed.home_score, null, "a postponed fixture carries no score");
  assert.equal(postponed.away_score, null, "a postponed fixture carries no score");
  assert.equal(shootout.status, "finished");
  assert.equal(shootout.home_score, 2, "the 120-minute score stays the score");
  assert.equal(shootout.home_pens, 4);
  assert.equal(shootout.away_pens, 3);
  assert.equal(shootout.decided_by, "penalties");
  assert.equal(extraTime.decided_by, "extra-time");
  assert.equal(extraTime.home_pens, null, "no shootout → no pens score");
  assert.equal(postponed.decided_by, null);
}

/**
 * The pre-match facts a viewer looks for before kickoff: where, who referees,
 * how many came. The shootout tally and the AET marker ride along so a tie
 * that finished 1-1 and was won 4-3 on spot kicks reads as such.
 */
function testSummaryFactsAndShootout() {
  const raw = {
    header: {
      id: "760500",
      league: { slug: "uefa.champions" },
      season: { year: 2026 },
      competitions: [
        {
          id: "760500",
          date: "2026-05-30T19:00:00Z",
          status: {
            type: { state: "post", completed: true, description: "FT-Pens", displayClock: "FT" },
          },
          competitors: [
            {
              homeAway: "home",
              score: "1",
              shootoutScore: "4",
              team: { id: "132", displayName: "Bayern", abbreviation: "FCB" },
            },
            {
              homeAway: "away",
              score: "1",
              shootoutScore: "3",
              team: { id: "86", displayName: "Real Madrid", abbreviation: "RMA" },
            },
          ],
        },
      ],
    },
    gameInfo: {
      venue: { fullName: "Allianz Arena", address: { city: "Munich" } },
      officials: [
        { displayName: "Assistant Referee One", position: { name: "Assistant Referee" } },
        { displayName: "Michael Oliver", position: { name: "Referee" } },
        { displayName: "VAR Room", position: { name: "Video Assistant Referee" } },
      ],
      attendance: 75000,
    },
  };
  const facts = normalizeSummaryFacts(raw);
  assert.equal(facts.venue, "Allianz Arena · Munich");
  assert.equal(facts.referee, "Michael Oliver", "assistants and VAR never count as the referee");
  assert.equal(facts.attendance, 75000);
  assert.deepEqual(normalizeSummaryFacts({}), { venue: null, referee: null, attendance: null });

  const match = normalizeSummaryMatch(raw);
  assert.equal(match.status, "finished");
  assert.equal(match.home_score, 1, "the 120-minute score, not the shootout");
  assert.equal(match.away_score, 1);
  assert.equal(match.home_pens, 4);
  assert.equal(match.away_pens, 3);
  assert.equal(match.decided_by, "penalties");
  assert.equal(match.venue, "Allianz Arena · Munich");
  assert.equal(match.referee, "Michael Oliver");
  assert.equal(match.attendance, 75000);
  assert.equal(match.minute_display, null, "a finished match has no clock");
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
  testNotPlayedAndDecidedBy();
  testPositions();
  testFullRosterAndAvailability();
  testClock();
  testEventTypes();
  testScoreboard();
  testScoreboardNonPlayedAndShootout();
  testSummaryFactsAndShootout();
  testRoundExtraction();
  testTimeline();
  testRosters();
  testStandingsV2();
  console.log(
    "  normalize: status, postponements, positions, clock, event types, scoreboard, shootouts, rounds, timeline, rosters, standings OK",
  );
}

/**
 * League TABLES come from the v2 `/standings` feed, which nests under
 * `children[].standings.entries` and — unlike the per-match summary's standings
 * block — publishes pointsFor/pointsAgainst. The summary shape omits them
 * entirely, which is what previously left every league table's goal-difference
 * column reading zero.
 */
function testStandingsV2() {
  const v2 = {
    uid: "s:600~l:23",
    id: "23",
    name: "English Premier League",
    children: [
      {
        standings: {
          entries: [
            {
              team: {
                id: "382",
                displayName: "Manchester City",
                shortDisplayName: "Man City",
                abbreviation: "MNC",
                color: "99c5ea",
                logos: [{ href: "https://a.espncdn.com/i/teamlogos/soccer/500/382.png" }],
              },
              stats: [
                { name: "gamesPlayed", value: 5 },
                { name: "wins", value: 5 },
                { name: "ties", value: 0 },
                { name: "losses", value: 0 },
                { name: "points", value: 15 },
                { name: "pointsFor", value: 13 },
                { name: "pointsAgainst", value: 5 },
                { name: "rank", value: 1 },
              ],
            },
            {
              team: {
                id: "364",
                displayName: "Liverpool",
                shortDisplayName: "Liverpool",
                abbreviation: "LIV",
                color: "c8102e",
                logos: [{ href: "https://a.espncdn.com/i/teamlogos/soccer/500/364.png" }],
              },
              stats: [
                { name: "gamesPlayed", value: 5 },
                { name: "wins", value: 3 },
                { name: "ties", value: 1 },
                { name: "losses", value: 1 },
                { name: "points", value: 10 },
                { name: "pointsFor", value: 9 },
                { name: "pointsAgainst", value: 7 },
                { name: "rank", value: 2 },
              ],
            },
          ],
        },
      },
      // A second child group (promotion/relegation splits) must be walked too.
      {
        standings: {
          entries: [
            {
              team: { id: "999", displayName: "Some Other Club", abbreviation: "SOC" },
              stats: [
                { name: "gamesPlayed", value: 5 },
                { name: "points", value: 4 },
                { name: "pointsFor", value: 4 },
                { name: "pointsAgainst", value: 14 },
                { name: "rank", value: 20 },
              ],
            },
          ],
        },
      },
    ],
  };

  const { teams, rows } = normalizeStandings(v2, "eng.1");
  assert.equal(rows.length, 3, "every child group is walked");
  assert.equal(teams.length, 3);

  const city = rows.find((r) => r.team_id === "382")!;
  assert.equal(city.played, 5);
  assert.equal(city.wins, 5);
  assert.equal(city.draws, 0);
  assert.equal(city.losses, 0);
  assert.equal(city.points, 15);
  assert.equal(city.rank, 1);
  assert.equal(city.goals_for, 13, "pointsFor maps to goals_for");
  assert.equal(city.goals_against, 5, "pointsAgainst maps to goals_against");

  const t = teams.find((x) => x.id === "382")!;
  assert.equal(t.name, "Manchester City");
  assert.equal(t.short_name, "Man City");
  assert.equal(t.abbreviation, "MNC");
  assert.equal(t.color, "#99c5ea");
  assert.equal(t.logo_url, "https://a.espncdn.com/i/teamlogos/soccer/500/382.png");
  assert.equal(t.league, "eng.1", "league comes from the caller, not the payload");

  // The regression that started all this: GD must be computable.
  assert.equal(city.goals_for! - city.goals_against!, 8, "GD column is real, not zero");

  // The summary shape still parses — team id off the entry, name off the string,
  // and goals for/against honestly null (ESPN does not publish them there).
  const summary = {
    header: { league: { slug: "eng.1" } },
    standings: {
      groups: [
        {
          standings: {
            entries: [
              {
                id: "382",
                team: "Manchester City",
                logo: [{ href: "https://a.espncdn.com/i/teamlogos/soccer/500/382.png" }],
                stats: [
                  { name: "gamesPlayed", value: 5 },
                  { name: "wins", value: 5 },
                  { name: "ties", value: 0 },
                  { name: "losses", value: 0 },
                  { name: "points", value: 15 },
                  { name: "rank", value: 1 },
                ],
              },
            ],
          },
        },
      ],
    },
  };
  const s = normalizeStandings(summary).rows[0]!;
  assert.equal(s.team_id, "382");
  assert.equal(s.points, 15);
  assert.equal(s.goals_for, null, "summary has no goals-for; null beats a fake 0");
  assert.equal(s.goals_against, null);

  // A stats entry with a null/undefined value must not become NaN.
  const withNull = normalizeStandings({
    children: [
      {
        standings: {
          entries: [
            {
              team: { id: "1", displayName: "X" },
              stats: [
                { name: "pointsFor", value: null },
                { name: "points", value: undefined },
              ],
            },
          ],
        },
      },
    ],
  }).rows[0]!;
  assert.equal(withNull.goals_for, null);
  assert.equal(withNull.points, null);
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
