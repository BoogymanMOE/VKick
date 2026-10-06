/**
 * The prediction-window state machine (src/lib/predictionWindow.ts).
 *
 * Pure and clock-injected: every case passes an explicit `now`, so these are
 * exact assertions about who can pick what, when — the same verdicts the
 * Predict tab renders and the server enforces. This is what pins the bug fixed
 * in the hub: after kickoff, non-Sub mechanics must read closed rather than
 * still looking tappable until the POST rejects them.
 */
import { strict as assert } from "node:assert";
import {
  formatCountdown,
  isOpen,
  requiresLineup,
  LINEUP_GATED,
  type Mechanic,
} from "../src/lib/predictionWindow.js";

const HOUR = 3_600_000;
const T0 = Date.UTC(2026, 0, 1, 12, 0, 0); // a fixed "now"
const at = (ms: number) => new Date(ms).toISOString();

/** Kickoff three hours from T0; each mechanic locks relative to it. */
const kickoff = T0 + 3 * HOUR;
const windows = {
  lineup: { opensAt: null, lockAt: at(kickoff - 2 * HOUR), requires: null },
  sub: { opensAt: at(kickoff - HOUR), lockAt: at(kickoff + HOUR), requires: "lineup" as const },
  shot_predict: { opensAt: at(kickoff - HOUR), lockAt: at(kickoff), requires: "lineup" as const },
  player_watch: { opensAt: at(kickoff - HOUR), lockAt: at(kickoff), requires: "lineup" as const },
  versus: { opensAt: at(kickoff - HOUR), lockAt: at(kickoff), requires: "lineup" as const },
};
const open = (
  m: Mechanic,
  status: "scheduled" | "live" | "halftime" | "finished",
  published: boolean,
  now = T0,
) => isOpen(m, windows[m], { matchStatus: status, lineupsPublished: published, now });

export function runPredictionWindowTests(): void {
  // --- the lineup gate -----------------------------------------------------
  assert.equal(open("shot_predict", "scheduled", false), false, "shot waits for the XI");
  assert.equal(open("player_watch", "scheduled", false), false, "watch waits for the XI");
  assert.equal(open("versus", "scheduled", false), false, "versus waits for the XI");
  assert.equal(open("sub", "scheduled", false), false, "sub waits for the XI");
  // The Lineup Predictor is exempt: predicting before release is its point.
  assert.equal(open("lineup", "scheduled", false), true, "lineup predictor is not gated");

  // --- scheduled, published: clock windows still apply ---------------------
  assert.equal(
    open("shot_predict", "scheduled", true, kickoff - 2 * HOUR),
    false,
    "before the pre-kickoff open",
  );
  assert.equal(
    open("shot_predict", "scheduled", true, kickoff - 30 * 60_000),
    true,
    "open inside the window",
  );
  assert.equal(open("shot_predict", "scheduled", true, kickoff + 1), false, "locked at kickoff");
  assert.equal(open("lineup", "scheduled", false, kickoff - 3 * HOUR), true, "lineup opens immediately");
  assert.equal(open("lineup", "scheduled", false, kickoff - 2 * HOUR + 1), false, "lineup locks 2h out");
  assert.equal(
    open("sub", "scheduled", true, kickoff - 2 * HOUR),
    false,
    "sub not open before the hour mark",
  );
  assert.equal(
    open("sub", "scheduled", true, kickoff - 30 * 60_000),
    true,
    "sub open in the hour before kickoff",
  );

  // --- the fix: kickoff closes every non-Sub mechanic ----------------------
  assert.equal(open("shot_predict", "live", true, kickoff + 5 * 60_000), false, "shot closed in play");
  assert.equal(open("player_watch", "live", true, kickoff + 5 * 60_000), false, "watch closed in play");
  assert.equal(open("versus", "live", true, kickoff + 5 * 60_000), false, "versus closed in play");
  assert.equal(open("lineup", "live", false, kickoff + 5 * 60_000), false, "lineup closed in play");
  // Sub is the one live exception — editable through the first half.
  assert.equal(open("sub", "live", true, kickoff + 5 * 60_000), true, "sub editable while live");
  assert.equal(open("sub", "halftime", true, kickoff + 50 * 60_000), false, "sub closed at the break");
  assert.equal(open("sub", "finished", true, kickoff + 2 * HOUR), false, "sub closed at full time");
  assert.equal(open("shot_predict", "finished", true, kickoff + 2 * HOUR), false, "shot closed at full time");

  // --- self-describing requires + fallback ---------------------------------
  assert.equal(requiresLineup("shot_predict", windows.shot_predict), true, "server flag read");
  assert.equal(requiresLineup("lineup", windows.lineup), false, "null flag = clock-only");
  assert.equal(requiresLineup("shot_predict", undefined), true, "falls back to the gated set");
  assert.equal(
    LINEUP_GATED.includes("shot_predict") && !LINEUP_GATED.includes("lineup"),
    true,
    "gated set membership",
  );
  assert.equal(
    isOpen(
      "shot_predict",
      { opensAt: null, lockAt: at(kickoff) },
      { matchStatus: "scheduled", lineupsPublished: false, now: T0 },
    ),
    false,
    "a window with no requires flag still honours the canonical gate",
  );

  // --- countdown formatting -------------------------------------------------
  assert.equal(formatCountdown(at(T0 + 2 * HOUR + 5 * 60_000), T0), "2h 5m", "hours and minutes");
  assert.equal(formatCountdown(at(T0 + 45 * 60_000), T0), "0h 45m", "sub-hour shows 0h");
  assert.equal(formatCountdown(at(T0 - 1), T0), null, "past the lock = no countdown");
  assert.equal(formatCountdown(null, T0), null, "no lock time = no countdown");

  console.log("  predictionWindow: gate, clock windows, kickoff lock, self-describing requires OK");
}
