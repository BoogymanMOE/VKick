import { syncTeamUnderstat } from "../server/sync/understat.js";

async function main() {
  await syncTeamUnderstat("ALA", "96", "esp.1");
  console.log("done");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
