/**
 * Understat normalization: the expected-points, PPDA and shot-situation maths
 * that the xG panel reads. This is the one place a scrape is turned into
 * numbers, so a silent drift here shows up as a wrong table on screen rather
 * than as an error.
 */
import { strict as assert } from "node:assert";
import {
  matchLeagueHistory,
  matchResultsToMatches,
  normalizeShotSituationsFromApi,
  normalizeTeamHistoryFromApi,
  normalizePlayersFromApi,
} from "../server/understat/normalize.js";
import { ABBR_BY_SLUG } from "../server/understat/ids.js";

type HistoryInput = Parameters<typeof normalizeTeamHistoryFromApi>[0];

/** A full Understat history row with sensible zeroes, then the fields we test. */
const row = (over: Record<string, unknown>) => ({
  h_a: "h",
  xG: 0,
  xGA: 0,
  npxG: 0,
  npxGA: 0,
  ppda: { att: 0, def: 0 },
  ppda_allowed: { att: 0, def: 0 },
  deep: 0,
  deep_allowed: 0,
  scored: 0,
  missed: 0,
  xpts: 0,
  result: "w",
  date: "2026-01-01",
  wins: 0,
  draws: 0,
  loses: 0,
  pts: 0,
  npxGD: 0,
  ...over,
});

function historyOf(rows: Array<Record<string, unknown>>): HistoryInput {
  return {
    Manchester_City: { id: "9", title: "Manchester City", history: rows },
  } as unknown as HistoryInput;
}

/** Season sums add up, and PPDA is a ratio of totals, not a mean of ratios. */
function testTeamHistoryAggregation(): void {
  const totals = normalizeTeamHistoryFromApi(
    historyOf([
      // A small game and a big one: averaging the two per-match PPDA (1.0 and
      // 20.0 = 10.5) would be wrong; the season ratio is 21/12 = 1.75.
      row({ xG: 1.5, xGA: 0.5, npxG: 1.4, npxGA: 0.4, xpts: 3, deep: 10, ppda: { att: 1, def: 1 } }),
      row({ xG: 2.0, xGA: 1.1, npxG: 1.9, npxGA: 1.0, xpts: 1, deep: 24, ppda: { att: 20, def: 11 } }),
    ]),
  ).Manchester_City;

  assert.equal(totals.team_id, "9");
  assert.equal(totals.matches, 2, "counts the matches it walked");
  assert.ok(Math.abs(totals.xg - 3.5) < 1e-9, `xG sums, got ${totals.xg}`);
  assert.ok(Math.abs(totals.xga - 1.6) < 1e-9, `xGA sums, got ${totals.xga}`);
  assert.ok(Math.abs(totals.xpts - 4) < 1e-9, `expected points sum, got ${totals.xpts}`);
  assert.equal(totals.deep, 34, "deep completions sum");
  assert.ok(Math.abs((totals.ppda ?? 0) - 1.75) < 1e-9, `PPDA is att/def of totals, got ${totals.ppda}`);
}

/** No defensive actions recorded means no PPDA, not Infinity or NaN. */
function testTeamHistoryWithoutPpda(): void {
  const totals = normalizeTeamHistoryFromApi(historyOf([row({ xG: 1, xGA: 1 })])).Manchester_City;
  assert.equal(totals.ppda, null, "PPDA stays null when the feed has no ratio");
  assert.ok(Number.isFinite(totals.xg), "the other sums are still numbers");
}

/** The five fixed shot types survive, with the against-side filled in. */
function testShotSituations(): void {
  const situations = normalizeShotSituationsFromApi({
    OpenPlay: { shots: "120", goals: "14", xG: "15.4", against: { shots: "90", goals: "9", xG: "10.1" } },
    FromCorner: { shots: "40", goals: "3", xG: "3.2", against: { shots: "20", goals: "1", xG: "1.8" } },
    // No `against` block at all: must default to zeroes, not throw.
    Penalty: { shots: "5", goals: "4", xG: "3.9" },
  });

  assert.deepEqual(
    situations.map((s) => s.situation),
    ["Open play", "From corner", "Penalty"],
    "only the situations present are returned, in the fixed order",
  );
  assert.equal(situations[0].shots, 120, "string counts are parsed");
  assert.ok(Math.abs(situations[0].xg - 15.4) < 1e-9, "xG is a float, not an int");
  assert.ok(Math.abs(situations[0].xga - 10.1) < 1e-9, "the against side is kept");
  assert.equal(situations[2].goals_against, 0, "a missing against block reads as zero");
}

/** Per-90 rates are minutes-guarded so a bench player never divides by zero. */
function testPlayerRates(): void {
  const [starter] = normalizePlayersFromApi([
    {
      id: "1",
      player_name: "A Player",
      position: "F M S",
      team_title: "City",
      games: "20",
      time: "1800",
      goals: "10",
      assists: "5",
      shots: "60",
      key_passes: "30",
      xG: "9.5",
      xA: "4.0",
    },
  ]);
  assert.equal(starter.position, "FWD", "a forward's primary role wins");
  assert.ok(Math.abs(starter.sh90 - 3) < 1e-9, `shots per 90, got ${starter.sh90}`);
  assert.ok(Math.abs(starter.xg90 - 0.475) < 1e-9, `xG per 90, got ${starter.xg90}`);

  const [unused] = normalizePlayersFromApi([
    {
      id: "2",
      player_name: "Bench",
      position: "M",
      team_title: "City",
      games: "0",
      time: "0",
      goals: "0",
      assists: "0",
      shots: "0",
      key_passes: "0",
      xG: "0",
      xA: "0",
    },
  ]);
  assert.equal(unused.xg90, 0, "no minutes means no rate, never NaN");
  assert.equal(unused.sh90, 0, "no minutes means no shot rate, never NaN");
}

/**
 * The league-wide walk keys its rows by Understat's own team title, so matching
 * back to our club ids is guesswork unless the abbreviation join is exact. A
 * wrong join puts another club's expected points on a row, which is worse than
 * a row with none, so the drop-on-miss behaviour is the test that matters here.
 */
function testLeagueTeamMatching(): void {
  assert.equal(
    ABBR_BY_SLUG.Manchester_City,
    "MCI",
    "the abbreviation map is the inverse of the team slugs, not hand-written",
  );

  const history = normalizeTeamHistoryFromApi({
    Manchester_City: { id: "1", title: "Manchester City", history: [row({ xG: 2, xGA: 1, xpts: 3 })] },
    Arsenal: { id: "2", title: "Arsenal", history: [row({ xG: 1, xGA: 1, xpts: 1 })] },
    Brentford: { id: "3", title: "Brentford", history: [row({ xG: 3, xGA: 3, xpts: 0 })] },
  } as unknown as HistoryInput);
  const teams = [
    { id: "espn-mci", abbreviation: "MCI" },
    // ESPN's casing isn't guaranteed; the join must not be case-sensitive.
    { id: "espn-ars", abbreviation: "ars" },
  ];
  const matched = matchLeagueHistory(history, teams, ABBR_BY_SLUG);

  assert.deepEqual(
    matched.map((m) => m.team_id).sort(),
    ["espn-ars", "espn-mci"],
    "only clubs we can name get a row — an unmapped club is dropped",
  );
  const city = matched.find((m) => m.team_id === "espn-mci");
  assert.ok(Math.abs((city?.stats.xpts ?? 0) - 3) < 1e-9, "the club keeps its own xPts");

  // Understat sometimes hands the title with spaces; it still has to land.
  const spaced = matchLeagueHistory(
    { "Manchester City": history.Manchester_City } as unknown as Record<
      string,
      typeof history.Manchester_City
    >,
    teams,
    ABBR_BY_SLUG,
  );
  assert.deepEqual(
    spaced.map((m) => m.team_id),
    ["espn-mci"],
    "a space-form key still resolves",
  );
}

/**
 * Per-match xG pairing. Understat's league history has no opponent name, so a
 * fixture is only trusted when side + both goal counts + a within-a-day date
 * all agree with exactly one ESPN match. An ambiguous pairing is dropped.
 */
function testMatchXgMatching(): void {
  const history = normalizeTeamHistoryFromApi(
    historyOf([
      row({ h_a: "h", scored: 2, missed: 1, xG: 1.9, xGA: 0.8, date: "2026-08-15 14:00:00" }),
      row({ h_a: "a", scored: 0, missed: 0, xG: 0.6, xGA: 1.2, date: "2026-08-22" }),
      row({ h_a: "h", scored: 3, missed: 1, xG: 2.4, xGA: 0.5, date: "2026-08-29" }),
    ]),
  ).Manchester_City;

  assert.equal(history.results.length, 3, "the walk keeps every result per match");
  assert.equal(history.results[0].is_home, true, "home/away comes from h_a");
  assert.ok(Math.abs((history.results[0].xg ?? 0) - 1.9) < 1e-9, "the club's own xG is kept");

  const matched = matchResultsToMatches(history.results, [
    { id: "m1", kickoff_at: "2026-08-15T14:00:00Z", is_home: true, goals_for: 2, goals_against: 1 },
    { id: "m2", kickoff_at: "2026-08-22T19:00:00Z", is_home: false, goals_for: 0, goals_against: 0 },
    // Wrong scoreline: no row, never a guessed one.
    { id: "m3", kickoff_at: "2026-08-29T14:00:00Z", is_home: true, goals_for: 1, goals_against: 1 },
  ]);
  assert.deepEqual(
    matched.map((m) => m.match_id),
    ["m1", "m2"],
    "only clean matches land",
  );
  assert.ok(Math.abs((matched[0].xg ?? 0) - 1.9) < 1e-9, "xG is the club's own");
  assert.ok(Math.abs((matched[0].xga ?? 0) - 0.8) < 1e-9, "xGA is what it conceded");
  assert.ok(matched[1].xg != null && Math.abs(matched[1].xg - 0.6) < 1e-9, "away perspective kept");

  // A kickoff that crosses midnight in UTC still lands inside the day window.
  const nextDay = matchResultsToMatches(history.results, [
    { id: "m4", kickoff_at: "2026-08-16T00:30:00Z", is_home: true, goals_for: 2, goals_against: 1 },
  ]);
  assert.deepEqual(
    nextDay.map((m) => m.match_id),
    ["m4"],
    "±1 day tolerates a timezone slip",
  );

  // Two identical scorelines in the same window: ambiguous, so dropped.
  const ambiguous = matchResultsToMatches(
    [
      { date: "2026-09-01", is_home: true, goals_for: 1, goals_against: 1, xg: 1, xga: 1 },
      { date: "2026-09-02", is_home: true, goals_for: 1, goals_against: 1, xg: 2, xga: 2 },
    ],
    [{ id: "m5", kickoff_at: "2026-09-01T15:00:00Z", is_home: true, goals_for: 1, goals_against: 1 }],
  );
  assert.deepEqual(ambiguous, [], "an ambiguous pairing is dropped, never guessed");

  // No final score yet → nothing to match against.
  const unplayed = matchResultsToMatches(history.results, [
    { id: "m6", kickoff_at: "2026-08-15T14:00:00Z", is_home: true, goals_for: null, goals_against: null },
  ]);
  assert.deepEqual(unplayed, [], "an unplayed fixture never matches");
}

export function runUnderstatTests(): void {
  testTeamHistoryAggregation();
  testTeamHistoryWithoutPpda();
  testShotSituations();
  testPlayerRates();
  testLeagueTeamMatching();
  testMatchXgMatching();
  console.log(
    "  understat: history sums, PPDA ratio, situations, per-90 rates, league and per-match xG matching OK",
  );
}
