import { getDb } from "../server/db/index.js";

const db = getDb();
const teams = db.prepare("SELECT id, abbreviation, name FROM teams WHERE league='esp.1' LIMIT 20").all();
console.log(teams);
