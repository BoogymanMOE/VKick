/**
 * Cup-bracket inference. These rules drive the connected tree on the Cups
 * page, so they are pinned the way the server rules are: aggregate across
 * legs, honest "undecided" when shootouts/away-goals decided a level tie,
 * and feeder links that survive partial sync windows.
 */
import { strict as assert } from "node:assert";
import { buildBracket, orderRounds, roundRank } from "../src/lib/bracket.js";
import type { Match, Team } from "../src/types.js";

let seq = 0;

function team(id: string, short: string): Team {
  return {
    id,
    name: short,
    shortName: short,
    abbreviation: short.slice(0, 3).toUpperCase(),
    color: "#123456",
    league: "PL",
  };
}

function match(opts: {
  home: Team;
  away: Team;
  round: string;
  kickoff: string;
  status?: Match["status"];
  homeScore?: number | null;
  awayScore?: number | null;
}): Match {
  seq += 1;
  return {
    id: `m${seq}`,
    gameweek: 0,
    home: opts.home,
    away: opts.away,
    kickoffAt: opts.kickoff,
    status: opts.status ?? "finished",
    homeScore: opts.homeScore ?? null,
    awayScore: opts.awayScore ?? null,
    minute: null,
    predictions: [],
    round: opts.round,
  };
}

const ARS = team("ars", "Arsenal");
const BAY = team("bay", "Bayern");
const RMA = team("rma", "Real Madrid");
const PSG = team("psg", "PSG");
const AJX = team("ajx", "Ajax");
const BEN = team("ben", "Benfica");

function testOrderRounds(): void {
  const labels = ["Semi-final", "Final", "Quarter-final", "Round of 16", "Round of 32", "1st Qualifying Round"];
  assert.deepEqual(orderRounds(labels), [
    "1st Qualifying Round",
    "Round of 32",
    "Round of 16",
    "Quarter-final",
    "Semi-final",
    "Final",
  ], "the bracket plays qualifying first and the Final last");
  assert.equal(roundRank("Final"), 0);
  assert.ok(roundRank("Quarter-final") > roundRank("Semi-final"), "later rounds rank lower (the final is 0)");
}

function testSingleLegWinner(): void {
  const b = buildBracket([
    match({ home: ARS, away: BAY, round: "Quarter-final", kickoff: "2026-03-10T20:00:00Z", homeScore: 2, awayScore: 1 }),
    match({ home: RMA, away: PSG, round: "Quarter-final", kickoff: "2026-03-11T20:00:00Z", homeScore: 0, awayScore: 0 }),
    match({ home: AJX, away: BEN, round: "Quarter-final", kickoff: "2026-03-12T20:00:00Z", status: "scheduled" }),
  ]);
  assert.equal(b.rounds.length, 1);
  const [qf] = b.rounds;
  assert.equal(qf?.ties.length, 3);
  assert.equal(qf?.ties[0]?.winnerId, "ars", "higher score advances");
  assert.equal(qf?.ties[0]?.winnerName, "Arsenal");
  assert.equal(qf?.ties[1]?.winnerId, null, "a level single leg is undecided (shootout unknown)");
  assert.equal(qf?.ties[2]?.winnerId, null, "unscheduled ties are undecided");
  assert.equal(b.connected, false, "the first round has no feeder");
}

function testTwoLegAggregate(): void {
  const b = buildBracket([
    // First leg, home Arsenal: 2-0. Second leg, venues swapped: 0-1 → agg 2-1.
    match({ home: ARS, away: BAY, round: "Semi-final", kickoff: "2026-04-10T20:00:00Z", homeScore: 2, awayScore: 0 }),
    match({ home: BAY, away: ARS, round: "Semi-final", kickoff: "2026-04-20T20:00:00Z", homeScore: 1, awayScore: 0 }),
    // RMA vs PSG: level aggregate (1-0, 0-1) → undecided.
    match({ home: RMA, away: PSG, round: "Semi-final", kickoff: "2026-04-11T20:00:00Z", homeScore: 1, awayScore: 0 }),
    match({ home: PSG, away: RMA, round: "Semi-final", kickoff: "2026-04-21T20:00:00Z", homeScore: 1, awayScore: 0 }),
  ]);
  const [sf] = b.rounds;
  assert.equal(sf?.ties.length, 2, "two legs fold into one tie");
  const arsBay = sf?.ties[0];
  assert.equal(arsBay?.aggHome, 2, "aggregate orients to the first leg's home team");
  assert.equal(arsBay?.aggAway, 1);
  assert.equal(arsBay?.winnerId, "ars");
  assert.equal(arsBay?.legs.length, 2);
  const rmaPsg = sf?.ties[1];
  assert.equal(rmaPsg?.aggHome, 1);
  assert.equal(rmaPsg?.aggAway, 1);
  assert.equal(rmaPsg?.winnerId, null, "level aggregate stays undecided");
}

function testOpenSecondLegKeepsTieUndecided(): void {
  const b = buildBracket([
    match({ home: ARS, away: BAY, round: "Quarter-final", kickoff: "2026-03-10T20:00:00Z", homeScore: 3, awayScore: 0 }),
    match({ home: BAY, away: ARS, round: "Quarter-final", kickoff: "2026-04-01T20:00:00Z", status: "scheduled" }),
  ]);
  const tie = b.rounds[0]?.ties[0];
  assert.equal(tie?.aggHome, 3, "finished legs count toward the aggregate");
  assert.equal(tie?.winnerId, null, "an open second leg keeps the tie open");
}

function testFeederLinks(): void {
  const b = buildBracket([
    // Round of 16: Arsenal and Bayern advance.
    match({ home: ARS, away: PSG, round: "Round of 16", kickoff: "2026-02-10T20:00:00Z", homeScore: 2, awayScore: 0 }),
    match({ home: BAY, away: BEN, round: "Round of 16", kickoff: "2026-02-11T20:00:00Z", homeScore: 1, awayScore: 0 }),
    // Quarter-final: winners meet.
    match({ home: ARS, away: BAY, round: "Quarter-final", kickoff: "2026-03-10T20:00:00Z", homeScore: 1, awayScore: 2 }),
  ]);
  assert.equal(b.connected, true);
  const [r16, qf] = b.rounds;
  assert.equal(qf?.ties[0]?.feeds.length, 2, "both slots trace to R16 ties");
  assert.equal(qf?.ties[0]?.feedRound, "Round of 16");
  assert.equal(r16?.ties[0]?.feeds.length, 0);
}

function testFeederSurvivesMissingRound(): void {
  const b = buildBracket([
    match({ home: ARS, away: PSG, round: "Round of 16", kickoff: "2026-02-10T20:00:00Z", homeScore: 2, awayScore: 0 }),
    // The sync window is missing the quarter-final; Arsenal reappears in the semi.
    match({ home: ARS, away: BAY, round: "Semi-final", kickoff: "2026-04-10T20:00:00Z", homeScore: 1, awayScore: 0 }),
  ]);
  assert.equal(b.connected, true, "the chain reaches back over a missing round");
  const sf = b.rounds.find((r) => r.label === "Semi-final");
  assert.equal(sf?.ties[0]?.feedRound, "Round of 16");
}

function testLiveExcludedAndEmpty(): void {
  const b = buildBracket([
    match({ home: ARS, away: BAY, round: "Final", kickoff: "2026-05-30T20:00:00Z", status: "live", homeScore: 0, awayScore: 0 }),
  ]);
  assert.equal(b.rounds.length, 0, "live matches never form ties (the page shows them separately)");
  assert.equal(b.connected, false);
  assert.deepEqual(buildBracket([]).rounds, []);
}

export function runBracketTests(): void {
  testOrderRounds();
  testSingleLegWinner();
  testTwoLegAggregate();
  testOpenSecondLegKeepsTieUndecided();
  testFeederLinks();
  testFeederSurvivesMissingRound();
  testLiveExcludedAndEmpty();
  console.log("  bracket: round order, tie folding, winner inference and feeder links OK");
}
