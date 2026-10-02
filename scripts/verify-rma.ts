import { getDb } from "../server/db/index.js";

const db = getDb();

// Get Real Madrid team_id
const rma = db.prepare("SELECT id FROM teams WHERE abbreviation = 'RMA'").get() as { id: string };
console.log("RMA team_id:", rma.id);

// 1. Team totals
const teamStats = db
  .prepare("SELECT xg, xga FROM team_understat_stats WHERE team_id = ? AND season = 2026")
  .get(rma.id);
console.log("\n=== Team totals ===");
console.log(teamStats);

// 2. Players xG
const players = db
  .prepare(
    `
  SELECT p.full_name as name, u.xg, u.xa, u.xg90, u.xa90
  FROM player_understat_stats u
  JOIN players p ON p.id = u.player_id
  WHERE u.team_id = ? AND u.season = 2026
  ORDER BY u.xg DESC
`,
  )
  .all(rma.id);
console.log("\n=== Players xG (top 10) ===");
console.table(players.slice(0, 10));

// 3. Shot situations
const situations = db
  .prepare(
    "SELECT situation, shots, goals, xg, xga FROM team_shot_situations WHERE team_id = ? AND season = 2026 ORDER BY xg DESC",
  )
  .all(rma.id);
console.log("\n=== Shot situations ===");
console.table(situations);

// 4. Name mismatch check
const unmatched = db
  .prepare(
    `
  SELECT COUNT(*) as cnt FROM players p
  LEFT JOIN player_understat_stats u ON u.player_id = p.id AND u.season = 2026
  WHERE p.team_id = ? AND u.player_id IS NULL
`,
  )
  .get(rma.id);
console.log("\n=== Unmatched players (ESPN has, Understat didn't match) ===");
console.log(unmatched);

// Also check Understat players that didn't match
const unmatched2 = db
  .prepare(
    `
  SELECT u.name FROM player_understat_stats u
  LEFT JOIN players p ON p.id = u.player_id
  WHERE u.team_id = ? AND u.season = 2026 AND p.id IS NULL
`,
  )
  .all(rma.id);
console.log("\n=== Understat players with no ESPN match ===");
console.log(unmatched2);
