import { getDb } from "../server/db/index.js";

const db = getDb();

// Check if foreign key works
try {
  db.prepare(
    `
    INSERT INTO team_understat_stats (team_id, season, league, last_synced_at)
    VALUES ('86', 2023, 'esp.1', 1234567890)
  `,
  ).run();
  console.log("Insert succeeded");
} catch (e) {
  console.log("Insert failed:", e);
}

// Check table schema
const schema = db.prepare("SELECT sql FROM sqlite_master WHERE name = 'team_understat_stats'").get();
console.log("Schema:", schema);

// Check teams table schema
const schema2 = db.prepare("SELECT sql FROM sqlite_master WHERE name = 'teams'").get();
console.log("Teams schema:", schema2);
