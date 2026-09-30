import { getDb } from "../server/db/index.js";

const db = getDb();
db.prepare("DELETE FROM team_understat_stats WHERE team_id = '86' AND season = 2026").run();
db.prepare("DELETE FROM player_understat_stats WHERE team_id = '86' AND season = 2026").run();
db.prepare("DELETE FROM team_shot_situations WHERE team_id = '86' AND season = 2026").run();
console.log("Cleared test data");
