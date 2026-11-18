const { DatabaseSync } = require("node:sqlite");
const db = new DatabaseSync("D:/football/data/matchday.db");
const names = ["Pavlovic","Gnabry","Kimmich","Olise","Saibari","Davies","Upamecano","Kim","Laimer","Urbig","Kane"];
for (const n of names) {
  const r = db.prepare("SELECT full_name, position, espn_position FROM players WHERE full_name LIKE ? AND team_id='132'").get("%"+n+"%");
  console.log(r.full_name, "| position:", r.position, "| espn_position:", r.espn_position);
}
// also from match_player_stats for the latest match
console.log("--- match_player_stats espn_position ---");
const rows = db.prepare("SELECT p.full_name, s.position, s.espn_position FROM match_player_stats s JOIN players p ON p.id=s.player_id WHERE s.match_id='401884754' AND s.team_id='132' AND s.started=1 ORDER BY s.formation_place").all();
for (const r of rows) console.log(r.full_name, "| pos:", r.position, "| espn:", r.espn_position, "| fp:", r.formation_place);
