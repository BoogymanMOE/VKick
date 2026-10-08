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
import { runUnderstatTests } from "./understat.test.js";
import { runStandingsTests } from "./standings.test.js";
import { runFeedTests } from "./feed.test.js";
import { runSeasonTests } from "./season.test.js";
import { runClientTests } from "./client.test.js";
import { runRetentionTests } from "./retention.test.js";
import { runTeamGroupsTests } from "./teamGroups.test.js";
import { runVerifyTests } from "./verify.test.js";
import { runBracketTests } from "./bracket.test.js";
import { runReferralTests } from "./referral.test.js";
import { runSeedDemoTests } from "./seedDemo.test.js";
import { runGuestMergeTests } from "./guestMerge.test.js";
import { runRateLimitTests } from "./rateLimit.test.js";
import { runPredictionsGateTests } from "./predictionsGate.test.js";
import { runPickSummaryTests } from "./pickSummary.test.js";
import { runPredictionWindowTests } from "./predictionWindow.test.js";
import { runOptimisticTests } from "./optimistic.test.js";
import { runCompetitionsTests } from "./competitions.test.js";
import { runAnchorRaceTests } from "./anchorRace.test.js";
import { runLeaderboardTests } from "./leaderboard.test.js";
import { runBackupTests } from "./backup.test.js";

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
  ["understat", runUnderstatTests],
  ["standings", runStandingsTests],
  ["feed", runFeedTests],
  ["season", runSeasonTests],
  ["client", runClientTests],
  ["retention", runRetentionTests],
  ["teamGroups", runTeamGroupsTests],
  ["verify", runVerifyTests],
  ["bracket", runBracketTests],
  ["referral", runReferralTests],
  ["seedDemo", runSeedDemoTests],
  // Before rateLimit: both drive routers over getDb(), which caches one handle
  // for the whole process and cannot be reopened once a suite closes it.
  ["guestMerge", runGuestMergeTests],
  ["rateLimit", runRateLimitTests],
  ["predictionsGate", runPredictionsGateTests],
  ["pickSummary", runPickSummaryTests],
  ["predictionWindow", runPredictionWindowTests],
  ["optimistic", runOptimisticTests],
  ["competitions", runCompetitionsTests],
  ["anchorRace", runAnchorRaceTests],
  ["leaderboard", runLeaderboardTests],
  ["backup", runBackupTests],
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
