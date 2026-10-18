/**
 * One-time purge of banned-league rows left behind when the catalog was trimmed
 * to the five big leagues (eng.1, esp.1, ger.1, ita.1, fra.1).
 *
 * Deletes:
 *   - matches whose league is outside the allow-list;
 *   - teams outside the allow-list, EXCEPT ones a user still follows or a
 *     surviving match still references (so favorites never dangle);
 *   - standings outside the allow-list;
 *   - players whose team no longer exists.
 *
 * The children of those rows (per-match detail, season/understat caches,
 * timeline, commentary, notifications) are swept too — otherwise the database
 * is left holding rows whose parent is gone, which is exactly what the purge is
 * meant to prevent.
 *
 * Run with:  npm run purge:banned-leagues
 */
import { getDb, tx } from "../db/index.js";
import { LEAGUE_ALLOWLIST } from "../espn/catalog.js";

const db = getDb();
const slugs = [...LEAGUE_ALLOWLIST];
const placeholders = slugs.map(() => "?").join(", ");

function changes(sql: string, params: string[] = []): number {
  return Number(db.prepare(sql).run(...params).changes ?? 0);
}

// FK enforcement is per-connection and cannot change inside a transaction, so
// the sweep runs with it off: deleting a match before its commentary would
// otherwise fail on every row. The child sweep below restores consistency.
db.exec("PRAGMA foreign_keys = OFF");
try {
  const summary = tx(db, () => {
    const matches = changes(
      `DELETE FROM matches WHERE league NOT IN (${placeholders})`,
      slugs,
    );

    const teams = changes(
      `DELETE FROM teams
       WHERE league NOT IN (${placeholders})
         AND id NOT IN (SELECT team_id FROM favorite_teams)
         AND id NOT IN (
           SELECT home_team_id FROM matches
           UNION SELECT away_team_id FROM matches
         )`,
      slugs,
    );

    const standings = changes(
      `DELETE FROM standings WHERE league NOT IN (${placeholders})`,
      slugs,
    );

    const players = changes(
      `DELETE FROM players WHERE team_id NOT IN (SELECT id FROM teams)`,
    );

    /* ---------------------------------------------- orphaned children */
    changes(
      `DELETE FROM match_player_stats
       WHERE match_id NOT IN (SELECT id FROM matches)
          OR player_id NOT IN (SELECT id FROM players)
          OR team_id NOT IN (SELECT id FROM teams)`,
    );
    changes(
      `DELETE FROM timeline_events
       WHERE match_id NOT IN (SELECT id FROM matches)
          OR team_id NOT IN (SELECT id FROM teams)`,
    );
    changes(`DELETE FROM timeline_comments
            WHERE match_id NOT IN (SELECT id FROM matches)
               OR event_id NOT IN (SELECT id FROM timeline_events)`);
    changes(`DELETE FROM match_commentary
            WHERE match_id NOT IN (SELECT id FROM matches)`);
    changes(`DELETE FROM match_team_stats
            WHERE match_id NOT IN (SELECT id FROM matches)
               OR team_id NOT IN (SELECT id FROM teams)`);
    changes(`DELETE FROM match_understat_stats
            WHERE match_id NOT IN (SELECT id FROM matches)
               OR team_id NOT IN (SELECT id FROM teams)`);
    changes(`DELETE FROM player_season_stats
            WHERE player_id NOT IN (SELECT id FROM players)
               OR team_id NOT IN (SELECT id FROM teams)`);
    changes(`DELETE FROM team_season_stats WHERE team_id NOT IN (SELECT id FROM teams)`);
    changes(`DELETE FROM team_coaches WHERE team_id NOT IN (SELECT id FROM teams)`);
    changes(`DELETE FROM player_understat_stats
            WHERE player_id NOT IN (SELECT id FROM players)
               OR team_id NOT IN (SELECT id FROM teams)`);
    changes(`DELETE FROM team_understat_stats WHERE team_id NOT IN (SELECT id FROM teams)`);
    changes(`DELETE FROM team_shot_situations WHERE team_id NOT IN (SELECT id FROM teams)`);
    // Match-scoped user content: a pick/rating/notification for a match that
    // no longer exists is unreachable, so it goes with the match.
    changes(`DELETE FROM predictions WHERE match_id NOT IN (SELECT id FROM matches)`);
    changes(`DELETE FROM crowd_ratings
            WHERE match_id NOT IN (SELECT id FROM matches)
               OR player_id NOT IN (SELECT id FROM players)`);
    changes(`DELETE FROM notified_goals WHERE match_id NOT IN (SELECT id FROM matches)`);
    changes(`DELETE FROM match_notifications WHERE match_id NOT IN (SELECT id FROM matches)`);
    changes(`DELETE FROM streak_evaluations WHERE match_id NOT IN (SELECT id FROM matches)`);

    return { matches, teams, standings, players };
  });

  console.log(
    `Deleted ${summary.matches} matches, ${summary.teams} teams, ${summary.standings} standings, ${summary.players} players`,
  );
} finally {
  db.exec("PRAGMA foreign_keys = ON");
}

// A surviving violation means a row outlived its parent — report it rather than
// pretending the purge was clean.
const violations = db.prepare("PRAGMA foreign_key_check").all() as Array<Record<string, unknown>>;
if (violations.length > 0) {
  console.warn(`[purge] ${violations.length} foreign-key violation(s) remain`);
  for (const row of violations.slice(0, 20)) console.warn(row);
}
