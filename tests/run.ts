/**
 * The test runner: zero dependencies, plain tsx. Fails loudly on the first
 * assertion that breaks (`node:assert` throws) and exits non-zero so CI /
 * `npm run build`-adjacent tooling can gate on it.
 */
import { runShotGridTests } from "./shotGrid.test.js";
import { runValidateTests } from "./validate.test.js";
import { runFormationTests } from "./formations.test.js";
import { runNormalizeTests } from "./normalize.test.js";
import { runPredictionScoreTests } from "./predictionScore.test.js";
import { runMigrateTests } from "./migrate.test.js";
import { runPasswordTests } from "./password.test.js";
import { runNotificationTests } from "./notifications.test.js";
import { runLivePitchTests } from "./livePitch.test.js";
import { runPitchArtTests } from "./pitchArt.test.js";
import { runUnderstatTests } from "./understat.test.js";
import { runStandingsTests } from "./standings.test.js";
import { runReplayTests } from "./replay.test.js";
import { runSeasonTests } from "./season.test.js";
import { runClientTests } from "./client.test.js";

let failed = 0;
const groups: Array<[string, () => void | Promise<void>]> = [
  ["shotGrid", runShotGridTests],
  ["validate", runValidateTests],
  ["formations", runFormationTests],
  ["normalize", runNormalizeTests],
  ["predictionScore", runPredictionScoreTests],
  ["migrate", runMigrateTests],
  ["password", runPasswordTests],
  ["notifications", runNotificationTests],
  ["livePitch", runLivePitchTests],
  ["pitchArt", runPitchArtTests],
  ["understat", runUnderstatTests],
  ["standings", runStandingsTests],
  ["replay", runReplayTests],
  ["season", runSeasonTests],
  ["client", runClientTests],
];

for (const [name, run] of groups) {
  try {
    await run();
  } catch (err) {
    failed += 1;
    console.error(`✗ ${name} FAILED:`);
    console.error(err);
  }
}

if (failed > 0) {
  console.error(`\n${failed} test group(s) failed`);
  process.exit(1);
}
console.log("\nAll tests passed");
