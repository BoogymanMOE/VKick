/**
 * Streak orchestration — the DB side of scoring-rules.md §6, on top of the
 * pure `updateStreak` state machine in predictionScore.ts.
 *
 * A favorite-club match is evaluated AT MOST ONCE per user (UNIQUE on
 * streak_evaluations), in kickoff order, and only once the user's
 * predictions on that match are fully settled — no pending rows left. That
 * ordering matters: Player to Watch resolves up to 24h after full time, so
 * evaluating earlier could record a miss that a later award would overturn.
 *
 * A hit = ≥1 prediction award for that match in the point ledger (any of the
 * 5 mechanics, points > 0). A miss = finished match with zero awards,
 * including "made no predictions at all". A miss resets the run; a hit
 * extends it and may cross a threshold, which pays exactly once via the
 * ledger (source = 'streak_bonus', source_id = the evaluation row id).
 *
 * Concurrency: an in-process promise chain serializes evaluation per server
 * (single-node SQLite). The UNIQUE guards make double-pays impossible even
 * across restarts.
 */
import type { DatabaseSync } from "node:sqlite";
import { get, run, tx } from "../db/index.js";
import { award, rollSeasonIfNeeded, currentSeasonLabel } from "./ledger.js";
import { POINTS, updateStreak, type StreakState } from "./predictionScore.js";

interface StreakRow {
  current: number;
  season_hits: number;
  thresholds_paid: string;
  last_match_id: string | null;
  streak_active: number;
  scope_season: string;
}

/** In-process serialization — the read-check-write of user_streaks is atomic. */
let chain: Promise<unknown> = Promise.resolve();

/** The user's anchor club (favorite_teams.is_favorite = 1), or null. */
export function favoriteClubOf(db: DatabaseSync, userId: number): string | null {
  return (
    get<{ team_id: string }>(db, "SELECT team_id FROM favorite_teams WHERE user_id = ? AND is_favorite = 1", [
      userId,
    ])?.team_id ?? null
  );
}

/** Whether any prediction row for this match is still unsettled. */
function hasPendingPredictions(db: DatabaseSync, userId: number, matchId: string): boolean {
  return (
    (get<{ n: number }>(
      db,
      "SELECT COUNT(*) AS n FROM predictions WHERE user_id = ? AND match_id = ? AND status = 'pending'",
      [userId, matchId],
    )?.n ?? 0) > 0
  );
}

/**
 * Kickoff-order sweep: evaluate every finished favorite-club match for one
 * user whose predictions have fully settled. `justFinishedMatchId` (the
 * match just resolved for this user) is evaluated even if a sweep already
 * passed it while data was pending. Returns ids actually evaluated.
 */
export function evaluateStreakForUser(
  db: DatabaseSync,
  userId: number,
  justFinishedMatchId?: string,
): string[] {
  const favoriteClub = favoriteClubOf(db, userId);
  if (!favoriteClub) return [];

  const done = new Set(
    (
      db.prepare("SELECT match_id FROM streak_evaluations WHERE user_id = ?").all(userId) as Array<{
        match_id: string;
      }>
    ).map((r) => r.match_id),
  );

  const matches = (
    db
      .prepare(
        `SELECT m.id, m.kickoff_at
         FROM matches m
         WHERE (m.home_team_id = ? OR m.away_team_id = ?) AND m.status = 'finished'`,
      )
      .all(favoriteClub, favoriteClub) as Array<{ id: string; kickoff_at: string }>
  )
    .filter((m) => !done.has(m.id) || m.id === justFinishedMatchId)
    .sort((a, b) => (a.kickoff_at < b.kickoff_at ? -1 : a.kickoff_at > b.kickoff_at ? 1 : 0));

  for (const m of matches) {
    evaluateStreak(db, userId, m.id).catch((err) =>
      console.error(`[streak] user ${userId} match ${m.id} failed:`, String(err).slice(0, 200)),
    );
  }
  return matches.map((m) => m.id);
}

/**
 * Evaluate ONE favorite-club match for one user. Serialized by the chain;
 * idempotent per (user, match) — a second call returns { skipped: true }.
 */
export function evaluateStreak(
  db: DatabaseSync,
  userId: number,
  matchId: string,
): Promise<{ skipped: boolean; hit: boolean | null; bonusAwarded: number }> {
  const task = () =>
    new Promise<{ skipped: boolean; hit: boolean | null; bonusAwarded: number }>((resolve, reject) => {
      try {
        resolve(tx(db, () => evaluateStreakSync(db, userId, matchId)));
      } catch (err) {
        reject(err);
      }
    });
  const chained = chain.then(task, task);
  chain = chained.catch(() => {});
  return chained;
}

function evaluateStreakSync(
  db: DatabaseSync,
  userId: number,
  matchId: string,
): { skipped: boolean; hit: boolean | null; bonusAwarded: number } {
  // Idempotency guard (UNIQUE(user_id, match_id) is the hard net).
  const already = get<{ id: number }>(
    db,
    "SELECT id FROM streak_evaluations WHERE user_id = ? AND match_id = ?",
    [userId, matchId],
  );
  if (already) return { skipped: true, hit: null, bonusAwarded: 0 };

  const match = get<{ home_team_id: string; away_team_id: string }>(
    db,
    "SELECT home_team_id, away_team_id FROM matches WHERE id = ? AND status = 'finished'",
    [matchId],
  );
  if (!match) return { skipped: true, hit: null, bonusAwarded: 0 }; // data raced away

  if (!favoriteClubOf(db, userId)) return { skipped: true, hit: null, bonusAwarded: 0 };
  const favoriteClub = favoriteClubOf(db, userId) as string;
  if (match.home_team_id !== favoriteClub && match.away_team_id !== favoriteClub) {
    return { skipped: true, hit: null, bonusAwarded: 0 };
  }

  // Don't evaluate while any prediction is unsettled — a later award could
  // still flip a would-be miss into a hit (see the header comment).
  if (hasPendingPredictions(db, userId, matchId)) {
    return { skipped: true, hit: null, bonusAwarded: 0 };
  }

  // Season rollover: a streak row stamped with a previous season resets here
  // (scoring-rules.md §8 — all three views reset together at the boundary).
  rollSeasonIfNeeded(db, userId);

  // HIT = at least one prediction award for this match in the ledger —
  // the ledger holds exactly one row per resolved prediction with points > 0.
  const awardCount =
    get<{ n: number }>(
      db,
      `SELECT COUNT(*) AS n
       FROM point_ledger
       WHERE user_id = ? AND match_id = ? AND source = 'prediction'`,
      [userId, matchId],
    )?.n ?? 0;
  const hit = awardCount > 0;

  const state = loadStreakState(db, userId);
  const update = updateStreak(state, matchId, hit);

  // Persist the audit row FIRST (run() returns void, so prepare directly to
  // read the insert rowid), then state, then any threshold bonus.
  const evaluationId = Number(
    db
      .prepare(
        `INSERT INTO streak_evaluations (user_id, match_id, hit, bonus, evaluated_at)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(userId, matchId, hit ? 1 : 0, update.bonusAwarded, new Date().toISOString()).lastInsertRowid,
  );

  run(
    db,
    `INSERT INTO user_streaks
       (user_id, current, season_hits, thresholds_paid, last_match_id, streak_active, scope_season, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(user_id) DO UPDATE SET
       current = excluded.current,
       season_hits = excluded.season_hits,
       thresholds_paid = excluded.thresholds_paid,
       last_match_id = excluded.last_match_id,
       streak_active = excluded.streak_active,
       scope_season = excluded.scope_season,
       updated_at = excluded.updated_at`,
    [
      userId,
      update.state.current,
      update.state.seasonHits,
      JSON.stringify(update.state.thresholdsPaid),
      update.state.lastMatchId,
      update.state.active,
      currentSeasonLabel(),
      new Date().toISOString(),
    ],
  );

  // Threshold crossed → pay the one-time bonus through the ledger.
  if (update.bonusAwarded > 0) {
    const ledgerId = award(db, {
      userId,
      matchId: null,
      source: "streak_bonus",
      mechanic: `streak:${update.thresholdCrossed}`,
      points: update.bonusAwarded,
      sourceId: evaluationId,
      league: null,
      teamIds: [],
    });
    if (ledgerId === null) {
      // Already paid (ledger UNIQUE) — the evaluation row pays nothing.
      run(db, "UPDATE streak_evaluations SET bonus = 0 WHERE id = ?", [evaluationId]);
    }
  }

  return { skipped: false, hit, bonusAwarded: update.bonusAwarded };
}

function loadStreakState(db: DatabaseSync, userId: number): StreakState {
  const row = get<StreakRow>(
    db,
    "SELECT current, season_hits, thresholds_paid, last_match_id, streak_active, scope_season FROM user_streaks WHERE user_id = ?",
    [userId],
  );
  if (!row) {
    return { current: 0, seasonHits: 0, thresholdsPaid: [], lastMatchId: null, active: 0 };
  }
  return {
    current: row.current,
    seasonHits: row.season_hits,
    thresholdsPaid: JSON.parse(row.thresholds_paid) as number[],
    lastMatchId: row.last_match_id,
    active: row.streak_active ? 1 : 0,
  };
}

/** Whether a threshold bonus exists for these thresholds (doc parity helper). */
export function streakBonusFor(threshold: number): number {
  return POINTS.streak[threshold] ?? 0;
}
