import { getDb } from "../server/db/index.js";

const db = getDb();
const team = db.prepare("SELECT id, abbreviation, name FROM teams WHERE id = '86'").get();
console.log("Team 86:", team);

const team2 = db.prepare("SELECT id, abbreviation, name FROM teams WHERE id = ?").get("86");
console.log("Team 86 (param):", team2);
