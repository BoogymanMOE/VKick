import { getDb } from "../server/db/index.js";

const db = getDb();
const bar = db.prepare("SELECT id, abbreviation FROM teams WHERE abbreviation = 'BAR'").get();
console.log("BAR:", bar);
