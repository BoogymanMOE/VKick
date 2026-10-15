/**
 * The prediction win confetti's fire-once rule (`src/lib/predictionWin.ts`).
 * What matters here is the negative side: a celebration that fires on a plain
 * page open, or again on every refetch of an already-settled pick, is worse
 * than no celebration at all.
 */
import { strict as assert } from "node:assert";
import { justPaidOut, type ResolvedPick } from "../src/lib/predictionWin.js";

const pick = (mechanic: string, status: string, points_awarded: number): ResolvedPick => ({
  mechanic,
  status,
  points_awarded,
});

/** A fresh mount (no previous map) never celebrates, whatever the payload says. */
function testFirstObservation(): void {
  assert.equal(justPaidOut(null, [pick("shot_predict", "correct", 5)]), false, "opening a resolved match");
  assert.equal(justPaidOut(null, []), false, "empty payload");
}

/** Pending (or anything else) → a paying status is the win. */
function testFlip(): void {
  const pending = new Map([["shot_predict", "pending"]]);
  assert.equal(justPaidOut(pending, [pick("shot_predict", "correct", 5)]), true, "pending → correct");
  assert.equal(justPaidOut(pending, [pick("shot_predict", "partial", 2)]), true, "pending → partial");
  assert.equal(
    justPaidOut(pending, [pick("shot_predict", "correct", 5), pick("sub", "pending", 0)]),
    true,
    "one winner among pending picks is enough",
  );
}

/** A pick first seen already resolved counts as a flip — it was picked this session. */
function testNewMechanic(): void {
  assert.equal(justPaidOut(new Map(), [pick("sub", "correct", 4)]), true, "a new resolved row");
}

/** No payout, or no change: nothing fires. */
function testQuiet(): void {
  const settled = new Map([["shot_predict", "correct"]]);
  assert.equal(
    justPaidOut(settled, [pick("shot_predict", "correct", 5)]),
    false,
    "a settled pick never re-fires on refetch",
  );
  assert.equal(
    justPaidOut(new Map([["watch", "wrong"]]), [pick("watch", "wrong", 0)]),
    false,
    "a miss celebrates nothing",
  );
  assert.equal(justPaidOut(new Map([["watch", "void"]]), [pick("watch", "void", 0)]), false, "a void pays 0");
  // Any move into a paying status is a payout, so a (never-served) re-resolve
  // downward still reads as a change rather than as silence.
  assert.equal(
    justPaidOut(new Map([["watch", "correct"]]), [pick("watch", "partial", 2)]),
    true,
    "a changed paying status counts as a fresh payout",
  );
}

export function runPredictionWinTests(): void {
  testFirstObservation();
  testFlip();
  testNewMechanic();
  testQuiet();
  console.log("  predictionWin: first observation, flip, new row and no-repeat rules OK");
}
