import { fetchTeamData } from "../server/understat/client.js";
import { normalizeShotSituationsFromApi } from "../server/understat/normalize.js";

async function main() {
  const data = await fetchTeamData("Real_Madrid", 2023);
  console.log("Statistics type:", typeof data.statistics);
  console.log("Statistics keys:", Object.keys(data.statistics));
  console.log("Situation type:", typeof data.statistics.situation);
  console.log("Situation keys:", Object.keys(data.statistics.situation));

  const situations = normalizeShotSituationsFromApi(data.statistics.situation);
  console.log("Normalized situations:", situations);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
