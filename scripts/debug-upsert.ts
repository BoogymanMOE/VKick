import { getDb } from "../server/db/index.js";

const db = getDb();

// Test the exact upsert query
const stmt = db.prepare(`
  INSERT INTO team_understat_stats (team_id, season, league, last_synced_at)
  VALUES (?, ?, ?, ?)
  ON CONFLICT(team_id, season) DO UPDATE SET
    league=excluded.league,
    last_synced_at=excluded.last_synced_at
`);

try {
  const result = stmt.run("86", 2026, "esp.1", Date.now());
  console.log("Upsert succeeded:", result);
} catch (e) {
  console.log("Upsert failed:", e);
}

// Test with the exact function call pattern
const t = { team_id: "86", season: 2026, league: "esp.1", last_synced_at: Date.now() };
try {
  db.prepare(
    `
    INSERT INTO team_understat_stats (team_id, season, league, last_synced_at)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(team_id, season) DO UPDATE SET
      league=excluded.league,
      last_synced_at=excluded.last_synced_at
  `,
  ).run(t.team_id, t.season, t.league, t.last_synced_at);
  console.log("Object param upsert succeeded");
} catch (e) {
  console.log("Object param upsert failed:", e);
}
