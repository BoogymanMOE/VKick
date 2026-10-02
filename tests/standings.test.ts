/**
 * The form guide: last results per club, folded from finished matches. It is a
 * derived strip on the league table, so an off-by-one here silently shows a
 * club's history shifted by a game — worth pinning down.
 */
import { strict as assert } from "node:assert";
import { foldForm, type FormMatchRow } from "../server/standings/form.js";

const match = (home: string, away: string, homeScore: number, awayScore: number): FormMatchRow => ({
  home_team_id: home,
  away_team_id: away,
  home_score: homeScore,
  away_score: awayScore,
});

/** Walking the newest-first rows gives each club its own last five. */
function testFormFolding(): void {
  // Newest first, as the standings query orders it.
  const rows = [
    match("A", "B", 2, 0), // A win, B loss
    match("C", "A", 1, 1), // A draw
    match("A", "C", 0, 3), // A loss
    match("B", "C", 4, 1), // B win, C loss
  ];
  const form = foldForm(rows);

  // Oldest first: loss, draw, win — for a club that reads left to right.
  assert.equal(form.A, "LDW", "the strip runs oldest to newest");
  // B's only two: the 4-1 over C came first, then the 0-2 at A.
  assert.equal(form.B, "WL", "away results are read from the away side's score");
  // C: the 3-1 loss at B is the oldest, then the 3-0 win at A, then the home
  // draw — C is on both sides of this list, so a double-count would lengthen it.
  assert.equal(form.C, "LWD", "both sides of every match are counted once");
  assert.equal(form.D, undefined, "a club with no finished match has no strip");
}

/** Only the most recent `limit` results are kept, and never more. */
function testFormLimit(): void {
  // Newest first: three wins, then three losses.
  const rows = [
    match("A", "B", 1, 0),
    match("A", "B", 1, 0),
    match("A", "B", 1, 0),
    match("A", "B", 0, 1),
    match("A", "B", 0, 1),
    match("A", "B", 0, 1),
  ];
  assert.equal(foldForm(rows, 6).A, "LLLWWW", "an open limit keeps the whole run");
  assert.equal(foldForm(rows).A, "LLWWW", "the default strip is five long");
  assert.equal(foldForm(rows, 2).A, "WW", "the cap drops the oldest result, never the newest");
}

export function runStandingsTests(): void {
  testFormFolding();
  testFormLimit();
  console.log("  standings: form folding, home/away sides and the result cap OK");
}
