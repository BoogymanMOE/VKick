/**
 * Season boundary (scoring-rules.md §8) — the data-driven label.
 *
 * The spec: a season "opens when the first tracked league starts, closes when
 * the last finishes". A fixed calendar date (Aug 1) can't express that — a
 * season that runs late, or an early-starting next season, would flip the
 * label while football says otherwise. So the ACTIVE season label follows the
 * data: it is the Aug–May label of the most recent tracked-league match whose
 * kickoff has passed.
 *
 * Consequences (both intended):
 *  - During the summer gap the finished season's label persists, so summer
 *    internationals keep scoring into the boards that just closed, and no
 *    empty "new season" board appears before any football is played.
 *  - The label flips at the new season's first tracked kickoff — the moment
 *    the season actually "opens" — even if that is weeks off the calendar
 *    date, and future-dated fixtures never flip it early.
 *
 * Tracked = the big five domestic leagues (scoring-rules.md "tracked
 * league"; cups and internationals inherit the label of the season they sit
 * inside rather than driving it). Falls back to the calendar label when the
 * data can't answer: a fresh database, no tracked matches yet, or a schema
 * without kickoff_at (minimal test mirrors).
 */
import type { DatabaseSync } from "node:sqlite";
import { get } from "../db/index.js";
import { LEAGUES } from "../espn/types.js";

/** The Aug–May European-year label for a moment ("2026-27"). */
export function seasonLabelForDate(now: Date): string {
  const y = now.getUTCFullYear();
  const startYear = now.getUTCMonth() >= 7 ? y : y - 1;
  return `${startYear}-${String(startYear + 1).slice(2)}`;
}

const TRACKED_PLACEHOLDERS = LEAGUES.map(() => "?").join(", ");

/**
 * The season the scoring tables are currently open for (leaderboards, ledger
 * stamps, streak rows). Pure read — never mutates anything.
 */
export function activeSeason(db: DatabaseSync, now: Date = new Date()): string {
  try {
    const row = get<{ kickoff_at: string }>(
      db,
      `SELECT kickoff_at FROM matches
       WHERE league IN (${TRACKED_PLACEHOLDERS}) AND kickoff_at IS NOT NULL AND kickoff_at <= ?
       ORDER BY kickoff_at DESC LIMIT 1`,
      [...LEAGUES, now.toISOString()],
    );
    if (row?.kickoff_at) return seasonLabelForDate(new Date(row.kickoff_at));
  } catch {
    /* schema without kickoff_at (minimal test mirrors) — calendar fallback */
  }
  return seasonLabelForDate(now);
}
