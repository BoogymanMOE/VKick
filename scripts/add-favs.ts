import { getDb } from "../server/db/index.js";

const db = getDb();

// Add a test user
const user = db
  .prepare(
    `
  INSERT OR IGNORE INTO users (telegram_id, display_name, created_at)
  VALUES ('123456789', 'Test User', ?)
`,
  )
  .run(new Date().toISOString());

// Get some team IDs
const teams = db
  .prepare("SELECT id FROM teams WHERE abbreviation IN ('RMA', 'BAR', 'ALA', 'GET', 'VAL')")
  .all();
console.log("Teams to add as favorites:", teams);

// Add favorites
for (const t of teams) {
  try {
    db.prepare(
      `
      INSERT OR IGNORE INTO favorite_teams (user_id, team_id, created_at)
      VALUES ((SELECT id FROM users WHERE telegram_id = '123456789'), ?, ?)
    `,
    ).run(t.id, new Date().toISOString());
    console.log(`Added favorite: ${t.id}`);
  } catch (e) {
    console.log(`Failed: ${t.id}`, e);
  }
}

console.log("Done adding favorites");
