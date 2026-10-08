/**
 * Account deletion — the one place a user's entire footprint is removed.
 *
 * The deletion is deliberately COLUMN-DRIVEN rather than a hard-coded list of
 * tables: every table in `sqlite_master` that carries one of the owner columns
 * below is swept, so a table added later is covered automatically. The columns
 * are the four ways a row can name a user in this schema:
 *   user_id           — favorites, leagues, predictions, ratings, comments,
 *                       ledger, totals, streaks, sessions, credentials, prefs,
 *                       referral_codes
 *   referrer_user_id  — referral_redemptions (the user invited someone)
 *   invitee_user_id   — referral_redemptions (the user redeemed a code)
 *   telegram_id       — bot_push_queue, match_notifications (push bookkeeping
 *                       is keyed by the Telegram/synthetic id, not user_id)
 *
 * Everything happens in ONE transaction, child rows before the `users` row:
 * the schema's FK children are not all ON DELETE CASCADE (favorites, ledger,
 * referrals all reference users(id) without one), so the order matters.
 *
 * Other users are untouched by construction — only rows naming THIS user are
 * deleted — so no leaderboard recomputation is needed. The only visible effect
 * on anyone else is that redemptions naming this user disappear from the
 * referral graph, which is exactly the intent (the friend is gone).
 */
import type { DB } from "./index.js";
import { all, tx } from "./index.js";

/** Columns that mean "this row belongs to a user". */
const OWNER_COLUMNS = ["user_id", "referrer_user_id", "invitee_user_id"] as const;

export interface AccountDeletionReport {
  /** Rows removed per table; tables with no rows are absent. */
  deleted: Record<string, number>;
  /** Total rows removed across every table (including the users row). */
  total: number;
}

/**
 * Remove every row owned by `userId` (whose Telegram/synthetic id is
 * `telegramId`) in one transaction, then the `users` row itself. Returns the
 * per-table row counts for the caller to log.
 */
export function deleteAccountData(db: DB, userId: number, telegramId: string): AccountDeletionReport {
  return tx(db, () => {
    const tables = all<{ name: string }>(
      db,
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
    );

    const deleted: Record<string, number> = {};
    let total = 0;
    const removeFrom = (table: string, column: string, value: number | string): void => {
      const res = db.prepare(`DELETE FROM ${table} WHERE ${column} = ?`).run(value);
      const n = Number(res.changes ?? 0);
      if (n > 0) {
        deleted[table] = (deleted[table] ?? 0) + n;
        total += n;
      }
    };

    for (const { name } of tables) {
      // The users row is removed LAST, after every FK child is gone.
      if (name === "users") continue;
      const columns = new Set(
        (db.prepare(`PRAGMA table_info(${name})`).all() as Array<{ name: string }>).map((c) => c.name),
      );
      for (const column of OWNER_COLUMNS) {
        if (columns.has(column)) removeFrom(name, column, userId);
      }
      if (columns.has("telegram_id")) removeFrom(name, "telegram_id", telegramId);
    }

    const removed = db.prepare("DELETE FROM users WHERE id = ?").run(userId);
    deleted.users = Number(removed.changes ?? 0);
    total += deleted.users;

    return { deleted, total };
  });
}
