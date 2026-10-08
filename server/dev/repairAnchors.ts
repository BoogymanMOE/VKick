/**
 * One-time repair for users who follow clubs but have NO anchor club — the
 * rows the onboarding anchor race left behind (the anchor PUT 404'd before
 * the follow landed, silently). The invariant is "exactly one anchor per
 * user"; this sets the EARLIEST followed club (`created_at` ASC, `rowid` as
 * the tiebreak) as the anchor for every user missing one.
 *
 *   npm run repair:anchors              # DRY RUN — prints what it would do
 *   npm run repair:anchors -- --apply   # write the fix
 *
 * Dry-run is the default on purpose: a repair script that writes on its first
 * invocation is a foot-gun. Safe on production data when run with the real
 * SQLITE_PATH — it only flips `favorite_teams.is_favorite` on users that have
 * zero anchors, and never touches anyone already healthy.
 */
import { getDb, all, get, run, tx, type DB } from "../db/index.js";

export interface RepairReport {
  apply: boolean;
  /** Users with at least one followed team. */
  scanned: number;
  /** Healthy: exactly one anchor already. */
  healthy: number;
  /** Zero anchors but ≥1 follow — the race's victims, the repair target. */
  repairable: number;
  /** Fixed in this run (0 in dry-run). */
  repaired: number;
  /** Anomaly: more than one anchor row. Reported, never touched. */
  multiAnchor: number;
  /** Users who follow nothing — nothing to anchor, skipped. */
  noFavorites: number;
  /** user_id → team_id chosen (earliest follow) for every repairable user. */
  picks: Array<{ userId: number; teamId: string }>;
}

interface UserRow {
  user_id: number;
  n: number;
  anchors: number;
}

/** Find and (optionally) repair zero-anchor users. Pure SQL, no network. */
export function repairAnchors(db: DB, options: { apply?: boolean } = {}): RepairReport {
  const apply = options.apply ?? false;

  const rows = all<UserRow>(
    db,
    `SELECT user_id, COUNT(*) AS n, COALESCE(SUM(is_favorite), 0) AS anchors
       FROM favorite_teams
      GROUP BY user_id`,
  );

  const report: RepairReport = {
    apply,
    scanned: rows.length,
    healthy: 0,
    repairable: 0,
    repaired: 0,
    multiAnchor: 0,
    noFavorites: 0,
    picks: [],
  };

  for (const row of rows) {
    if (row.anchors === 1) {
      report.healthy += 1;
      continue;
    }
    if (row.anchors > 1) {
      // The PUT clears every row before setting one, so this should not
      // exist; report it, but don't silently rewrite data nobody asked for.
      report.multiAnchor += 1;
      continue;
    }

    // Zero anchors: the earliest follow becomes the anchor.
    const earliest = get<{ team_id: string }>(
      db,
      `SELECT team_id FROM favorite_teams
        WHERE user_id = ?
        ORDER BY created_at ASC, rowid ASC
        LIMIT 1`,
      [row.user_id],
    );
    if (!earliest) continue; // unreachable (COUNT(*) > 0), belt and braces

    report.repairable += 1;
    report.picks.push({ userId: row.user_id, teamId: earliest.team_id });

    if (apply) {
      tx(db, () => {
        run(db, "UPDATE favorite_teams SET is_favorite = 0 WHERE user_id = ?", [row.user_id]);
        run(db, "UPDATE favorite_teams SET is_favorite = 1 WHERE user_id = ? AND team_id = ?", [
          row.user_id,
          earliest.team_id,
        ]);
      });
      report.repaired += 1;
    }
  }

  report.noFavorites = get<{ n: number }>(
    db,
    `SELECT COUNT(*) AS n FROM users u
      WHERE NOT EXISTS (SELECT 1 FROM favorite_teams f WHERE f.user_id = u.id)`,
  )!.n;

  return report;
}

function main(): void {
  const apply = process.argv.slice(2).includes("--apply");
  const db = getDb();
  const report = repairAnchors(db, { apply });

  console.log(
    `[repair-anchors] ${apply ? "APPLY" : "DRY RUN"} (SQLITE_PATH=${process.env.SQLITE_PATH ?? "./data/matchday.db"})`,
  );
  console.log(`  users with follows scanned : ${report.scanned}`);
  console.log(`  healthy (exactly 1 anchor) : ${report.healthy}`);
  console.log(`  no anchor, repairable      : ${report.repairable}`);
  console.log(`  no follows, skipped        : ${report.noFavorites}`);
  console.log(`  multi-anchor anomalies     : ${report.multiAnchor} (reported only, untouched)`);

  if (!apply) {
    if (report.repairable > 0) {
      console.log("\n  would set the earliest followed club as anchor for:");
      for (const pick of report.picks.slice(0, 10)) {
        console.log(`    user ${pick.userId} → team ${pick.teamId}`);
      }
      if (report.picks.length > 10) console.log(`    …and ${report.picks.length - 10} more`);
      console.log("\n  re-run with --apply to write.");
    }
    return;
  }

  console.log(`  repaired                  : ${report.repaired}`);

  // Verify against the database, not against our own bookkeeping.
  const stillBroken = get<{ n: number }>(
    db,
    `SELECT COUNT(*) AS n FROM (
        SELECT user_id FROM favorite_teams
         GROUP BY user_id
        HAVING COALESCE(SUM(is_favorite), 0) = 0
     )`,
  )!.n;
  const healthyNow = get<{ n: number }>(
    db,
    `SELECT COUNT(*) AS n FROM (
        SELECT user_id FROM favorite_teams
         GROUP BY user_id
        HAVING COALESCE(SUM(is_favorite), 0) = 1
     )`,
  )!.n;
  console.log(`  verify — zero-anchor users left: ${stillBroken} · healthy users now: ${healthyNow}`);
  if (stillBroken !== 0) {
    console.error("[repair-anchors] FAILED verification: zero-anchor users remain");
    process.exit(1);
  }
}

main();
