import { syncTeamUnderstat } from "../server/sync/understat.js";

async function main() {
  const abbr = process.argv[2] ?? "ALA";
  const teamId = Number(process.argv[3] ?? 1);
  const league = "esp.1";
  // Override season for testing with a completed season
  process.env.UNDERSTAT_TEST_SEASON = "2023";
  await syncTeamUnderstat(abbr, teamId, league);
  console.log("done");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
