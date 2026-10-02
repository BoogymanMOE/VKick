import { syncAllFavoriteTeamsUnderstat } from "../server/sync/understat.js";

async function main() {
  await syncAllFavoriteTeamsUnderstat();
  console.log("Cron test done");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
