/**
 * The points ledger — the write-side of scoring-rules.md's leaderboard rules.
 *
 * Every points-awarding event appends exactly one `point_ledger` row and
 * bumps the `user_point_totals` scopes it belongs to (global, the match's
 * league, both clubs). Leaderboards read ONLY the totals table, and the
 * tiebreak (`reached_total_at`) is the ledger timestamp of the award that
 * pushed a user to their current total — recorded here at award time, never
 * recomputed (scoring-rules.md "Leaderboard rules").
 *
 * THE FIREWALL (scoring-rules.md §8 / task spec §5): only prediction
 * resolutions and streak bonuses append to the ledger. Crowd ratings and
 * comments are cosmetic/social — no code path from `crowd_ratings` or
 * `timeline_comments` reaches this module, and nothing else may import it
 * (asserted by tests/predictionScore.test.ts, ratingsNeverTouchLedger()).
 *
 * No negative scoring (§7): award() rejects negative points at the door —
 * the CHECK constraint on the table is the second net.
 */
import type { DatabaseSync } from "node:sqlite";
import { all, get, run, tx } from "../db/index.js";

/** Season label mirroring sync/service.ts's currentSeason() (Aug–May European year). */
export function currentSeasonLabel(now: Date = new Date()): string {
  const y = now.getUTCFullYear();
  const startYear = now.getUTCMonth() >= 7 ? y : y - 1;
  return `${startYear}-${String(startYear + 1).slice(2)}`;
}

export type LedgerSource = "prediction" | "streak_bonus";

export interface AwardInput {
  userId: number;
  /** NULL for streak bonuses. */
  matchId: string | null;
  source: LedgerSource;
  /** The 5 mechanics for predictions; "streak" for streak bonuses. */
  mechanic: string | null;
  points: number;
  sourceId: number; // predictions.id, or the streak_evaluations row id
  /** The match's league slug (global scope needs no extra scope). */
  league: string | null;
  /** Both clubs of the match; empty for streak bonuses. */
  teamIds: string[];
  season?: string;
}

interface TotalsRow {
  total: number;
  reached_total_at: string;
}

const insertLedger = (db: DatabaseSync) =>
  db.prepare(
    `INSERT INTO point_ledger (user_id, match_id, source, mechanic, points, scope_season, awarded_at, source_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  );

/**
 * Append one award and bump every scope it feeds:
 *   global + league:<slug> + club:<homeId> + club:<awayId>.
 * Idempotent per (source, source_id) via the ledger's UNIQUE — a re-run
 * throws on the insert inside the transaction, so totals can't double-bump.
 * Returns the ledger row id, or null when this exact award already exists.
 */
export function award(db: DatabaseSync, input: AwardInput): number | null {
  if (!Number.isInteger(input.points) || input.points < 0) {
    // §7: no negative scoring — refuse rather than clamp, so a bug upstream
    // surfaces loudly instead of silently writing a wrong (clamped) total.
    throw new Error(`ledger: refused negative award points=${input.points}`);
  }
  if (input.points === 0) {
    // Nothing to record — and bumping reached_total_at on a no-point award
    // would lie about when the user reached their current total.
    return null;
  }
  const season = input.season ?? currentSeasonLabel();
  const awardedAt = new Date().toISOString();

  try {
    return tx(db, () => {
      const info = insertLedger(db).run(
        input.userId,
        input.matchId,
        input.source,
        input.mechanic,
        input.points,
        season,
        awardedAt,
        input.sourceId,
      );
      const ledgerId = Number(info.lastInsertRowid);

      const scopes = ["global"];
      if (input.league) scopes.push(`league:${input.league}`);
      for (const teamId of input.teamIds) scopes.push(`club:${teamId}`);
      for (const scope of scopes) bumpTotal(db, input.userId, scope, season, input.points, awardedAt);

      return ledgerId;
    });
  } catch (err) {
    // UNIQUE violation = this award was already recorded: treat as no-op so
    // re-resolution can never double-pay.
    if (String(err).includes("UNIQUE")) return null;
    throw err;
  }
}

/** Increment one scope's total; reached_total_at = this award's timestamp. */
function bumpTotal(
  db: DatabaseSync,
  userId: number,
  scope: string,
  season: string,
  points: number,
  awardedAt: string,
): void {
  const existing = get<TotalsRow>(
    db,
    "SELECT total, reached_total_at FROM user_point_totals WHERE user_id = ? AND scope = ? AND scope_season = ?",
    [userId, scope, season],
  );
  if (!existing) {
    run(
      db,
      `INSERT INTO user_point_totals (user_id, scope, scope_season, total, reached_total_at)
       VALUES (?, ?, ?, ?, ?)`,
      [userId, scope, season, points, awardedAt],
    );
    return;
  }
  run(
    db,
    `UPDATE user_point_totals SET total = total + ?, reached_total_at = ? 
     WHERE user_id = ? AND scope = ? AND scope_season = ?`,
    [points, awardedAt, userId, scope, season],
  );
}

/* ------------------------------------------------------------ season boundary */

/**
 * Season boundary (scoring-rules.md §8): opens when the first followed
 * league starts, closes when the last finishes. All three views reset
 * together — implemented by stamping every user's streak row with the
 * CURRENT season label lazily, and by the season key on every totals row.
 * A user whose streak row still carries the previous season's label gets a
 * fresh streak (current=0, seasonHits=0, no thresholds paid) the next time
 * their favorite club plays. Call this when a favorite-club match resolves.
 */
export function rollSeasonIfNeeded(db: DatabaseSync, userId: number): string {
  const season = currentSeasonLabel();
  const row = get<{ scope_season: string }>(db, "SELECT scope_season FROM user_streaks WHERE user_id = ?", [
    userId,
  ]);
  if (!row) return season;
  if (row.scope_season !== season) {
    run(
      db,
      `UPDATE user_streaks
       SET current = 0, season_hits = 0, thresholds_paid = '[]', last_match_id = NULL,
           streak_active = 0, scope_season = ?, updated_at = ?`,
      [season, new Date().toISOString()],
    );
  }
  return season;
}

/* ------------------------------------------------------------ leaderboard reads */

export interface LeaderEntry {
  user_id: number;
  /** Board identity: the unique @username when set, else the display name. */
  display_name: string;
  username: string | null;
  is_you: boolean;
  total: number;
  reached_total_at: string;
  rank: number;
}

/**
 * One board read, shared by all three endpoints. Ranking: total DESC, then
 * reached_total_at ASC (whoever hit the total first ranks ahead) — the
 * exact tiebreak from scoring-rules.md, computed from award-time timestamps.
 *
 * Public identity is the @username (unique in user_credentials), falling back
 * to the display name for Telegram/guest accounts that never registered one —
 * two identical display names on a board would be indistinguishable; a
 * username never is. `viewerId` marks the caller's own row so the client can
 * highlight "you" without a second query.
 */
export function readLeaderboard(
  db: DatabaseSync,
  scope: string,
  season: string,
  limit: number,
  viewerId?: number,
): LeaderEntry[] {
  const rows = all<{
    user_id: number;
    display_name: string;
    username: string | null;
    total: number;
    reached_total_at: string;
  }>(
    db,
    `SELECT t.user_id, u.display_name, c.username, t.total, t.reached_total_at
     FROM user_point_totals t
     JOIN users u ON u.id = t.user_id
     LEFT JOIN user_credentials c ON c.user_id = u.id
     WHERE t.scope = ? AND t.scope_season = ? AND t.total > 0
     ORDER BY t.total DESC, t.reached_total_at ASC
     LIMIT ?`,
    [scope, season, limit],
  );
  return rows.map((r, i) => ({
    ...r,
    // Username handles render as @name; the fallback stays a plain name.
    display_name: r.username ? `@${r.username}` : r.display_name,
    username: r.username,
    is_you: viewerId !== undefined && r.user_id === viewerId,
    rank: i + 1,
  }));
}
