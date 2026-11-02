import { getDb, all } from "../server/db/index.ts";
import { syncMatchSummary } from "../server/sync/service.ts";
import type { LeagueSlug } from "../server/espn/types.ts";

const db = getDb();
const rows = all<{ id: string; league: string }>(
  db,
  `SELECT m.id, m.league FROM matches m
   WHERE m.status='finished'
     AND NOT EXISTS (SELECT 1 FROM match_player_stats s WHERE s.match_id=m.id)
     AND m.league IN ('eng.1','esp.1','ita.1','ger.1','fra.1')`,
);
console.log("to backfill:", rows.length);
let done = 0, ok = 0, fail = 0;
for (const r of rows) {
  try {
    await syncMatchSummary(r.league as LeagueSlug, r.id);
    ok++;
  } catch (e) {
    fail++;
    console.error("FAIL", r.id, String(e));
  }
  done++;
  if (done % 25 === 0) console.log(`progress ${done}/${rows.length} ok=${ok} fail=${fail}`);
}
console.log(`DONE done=${done} ok=${ok} fail=${fail}`);
