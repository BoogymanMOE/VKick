import { getDb } from "../server/db/index.js";

const db = getDb();

console.log("=== player_understat_stats ===");
const players = db
  .prepare(
    "SELECT pus.player_id, pus.understat_id, p.full_name as name, pus.xg, pus.xa, pus.xg90, pus.xa90 FROM player_understat_stats pus JOIN players p ON p.id = pus.player_id WHERE pus.team_id = '86' AND pus.season = 2026",
  )
  .all();
console.log(players);

console.log("\n=== team_understat_stats ===");
const team = db.prepare("SELECT * FROM team_understat_stats WHERE team_id = '86' AND season = 2026").get();
console.log(team);

console.log("\n=== team_shot_situations ===");
const situations = db
  .prepare("SELECT * FROM team_shot_situations WHERE team_id = '86' AND season = 2026")
  .all();
console.log(situations);
