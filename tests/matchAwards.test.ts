import { strict as assert } from "node:assert";
import { getDb } from "../server/db/index.js";
import { computeMatchAwards } from "../server/scoring/matchAwards.js";

export function runMatchAwardsTests(): void {
  const db = getDb();
  // A finished match with goals: MVP should be a goal scorer, not null.
  {
    const awards = computeMatchAwards(db, "401874963");
    assert.ok(awards.mvp, "mvp present for finished match");
    assert.ok(awards.mvp!.reason.length > 0, "mvp has a reason");
    assert.ok(awards.honorable.length <= 2, "at most 2 honorable mentions");
  }
  // Unknown match: no awards.
  {
    const awards = computeMatchAwards(db, "does-not-exist");
    assert.strictEqual(awards.mvp, null, "no mvp for unknown match");
    assert.deepStrictEqual(awards.honorable, [], "no honorable for unknown match");
  }
  console.log("  matchAwards: all assertions passed");
}
