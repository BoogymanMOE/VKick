/**
 * Stuck-match reconciliation: a live/halftime row long past kickoff must never
 * be served as live. The read-time rule (server/matches/reconcile.ts) is what
 * the feed and match page rely on when the sync loop could not repair the row.
 */
import { strict as assert } from "node:assert";
import { isStaleLive, settleStaleLive, settleStaleLiveAll } from "../server/matches/reconcile.js";

const NOW = new Date("2026-10-18T18:00:00.000Z");
const HOUR = 3_600_000;

export function runMatchReconcileTests(): void {
  const base = { id: "m1", home_score: 1, away_score: 0 };

  // (a) a stale live match is served as finished, keeping its last known score.
  const stale = settleStaleLive(
    { ...base, status: "live", kickoff_at: new Date(NOW.getTime() - 6 * HOUR).toISOString() },
    NOW,
  );
  assert.equal(stale.status, "finished", "a live match 6h past kickoff is served finished");
  assert.equal(stale.home_score, 1, "the last known score is kept");
  assert.equal(stale.away_score, 0, "the last known score is kept");

  // Half-time is the same case: a break never lasts a day.
  const staleHt = settleStaleLive(
    { ...base, status: "halftime", kickoff_at: new Date(NOW.getTime() - 26 * HOUR).toISOString() },
    NOW,
  );
  assert.equal(staleHt.status, "finished", "a half-time match a day past kickoff is served finished");

  // (b) a fresh live match is untouched.
  const fresh = settleStaleLive(
    { ...base, status: "live", kickoff_at: new Date(NOW.getTime() - 30 * 60_000).toISOString() },
    NOW,
  );
  assert.equal(fresh.status, "live", "a live match 30 min in is untouched");

  // A scheduled match is never rewritten — it is not the live path.
  const scheduled = settleStaleLive(
    { ...base, status: "scheduled", kickoff_at: new Date(NOW.getTime() - 26 * HOUR).toISOString() },
    NOW,
  );
  assert.equal(scheduled.status, "scheduled", "a scheduled match is never rewritten");
  const finished = settleStaleLive(
    { ...base, status: "finished", kickoff_at: new Date(NOW.getTime() - 26 * HOUR).toISOString() },
    NOW,
  );
  assert.equal(finished.status, "finished", "a finished match is never rewritten");

  // The boundary: exactly 5h is not yet stale, 5h + 1ms is.
  assert.equal(
    isStaleLive({ status: "live", kickoff_at: new Date(NOW.getTime() - 5 * HOUR).toISOString() }, NOW),
    false,
    "exactly 5h past kickoff is not yet stale",
  );
  assert.equal(
    isStaleLive({ status: "live", kickoff_at: new Date(NOW.getTime() - 5 * HOUR - 1).toISOString() }, NOW),
    true,
    "5h + 1ms past kickoff is stale",
  );

  // The list form settles only the stale rows.
  const rows = settleStaleLiveAll(
    [
      { ...base, id: "a", status: "live", kickoff_at: new Date(NOW.getTime() - 6 * HOUR).toISOString() },
      { ...base, id: "b", status: "live", kickoff_at: new Date(NOW.getTime() - 10 * 60_000).toISOString() },
    ],
    NOW,
  );
  assert.equal(rows[0]?.status, "finished", "the stale row is settled");
  assert.equal(rows[1]?.status, "live", "the fresh row is left alone");

  console.log("  matchReconcile: stale live/halftime served finished, fresh live untouched OK");
}
