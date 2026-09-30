import { getDb } from "../server/db/index.js";

const db = getDb();
const teams = db.prepare("SELECT id, abbreviation, name FROM teams WHERE league = 'esp.1'").all();
console.log("La Liga teams:");
teams.forEach((t) => console.log(`  ${t.id} | ${t.abbreviation} | ${t.name}`));
