/**
 * ============================================================================
 *  DEMO DATA — DEV ONLY. NEVER RUN THIS IN PRODUCTION.
 * ============================================================================
 *
 * Seeds a handful of fake users with predictions, crowd ratings and (through
 * the real `award()` ledger path) leaderboard totals, so a fresh checkout has
 * something to look at: a populated Profile, a non-empty "my predictions"
 * list, rating cards on match pages, and a board with more than one name on it.
 *
 * Two deliberate design rules:
 *
 *  1. It writes through the SAME code the app uses. Points come from
 *     `scoreLineup` (server/scoring/predictionScore.ts) and are awarded with
 *     `award()` (server/scoring/ledger.ts) — never hand-written into
 *     `user_point_totals`. A demo board that disagreed with the real scorer
 *     would be worse than no demo board, because it would hide bugs instead
 *     of showing them.
 *
 *  2. It reads REAL synced data (finished matches, real players, real
 *     formations). It never invents matches, teams or athletes — inventing
 *     them would produce rows referencing team ids that no endpoint can
 *     resolve, and every page showing them would 404.
 *
 * Production is refused up front: `assertNotProduction` throws before a single
 * query runs, and the entry point (seed-demo.ts) exits non-zero. The script
 * also never mints credentials — no `user_credentials`, no `user_sessions` —
 * so demo accounts cannot log in through the username path. The only way in is
 * the dev-token escape hatch (`dev:<telegramId>`, server/telegram/verify.ts),
 * which server/index.ts already refuses to boot with under NODE_ENV=production.
 *
 * Everything is tagged with telegram_id 9000NN and a "Demo …" display name, so
 * `--reset` can wipe exactly this data and nothing else.
 */
import type { DatabaseSync } from "node:sqlite";
import { all, get, run, tx, type Bindings } from "../db/index.js";
import { award } from "../scoring/ledger.js";
import { scoreLineup, type ActualLineup } from "../scoring/predictionScore.js";
import { validatePayload } from "../predictions/validate.js";

/* ------------------------------------------------------------ safety */

/**
 * Refuse to seed anything that smells like production. Called first thing in
 * `seedDemoData`, before the DB is touched, so a mis-typed env var can never
 * leave half a demo dataset behind.
 *
 * `prod` is checked alongside `production` because it is the other spelling
 * people actually type, and this is the one guard between a seeded demo
 * database and a live leaderboard.
 */
export function assertNotProduction(env: Record<string, string | undefined>): void {
  const raw = (env.NODE_ENV ?? "").trim().toLowerCase();
  if (raw === "production" || raw === "prod") {
    throw new Error(
      "seed-demo refuses to run: NODE_ENV=production. Demo users, predictions and " +
        "leaderboard totals would be indistinguishable from real ones once they hit a " +
        "live board. Unset NODE_ENV (or set it to development) and try again.",
    );
  }
}

/* ------------------------------------------------------------ demo cohort (pure) */

/** Demo telegram ids start here — the `--reset` sweep keys off this range. */
export const DEMO_TELEGRAM_ID_BASE = 900001;
/**
 * Upper bound of the demo id range, exclusive.
 *
 * Wide enough that the cohort can exceed 100 users: own-rank-beyond-the-page
 * only means anything on a board longer than the page limit, and a 100-id range
 * made `--users 120` impossible to test.
 */
export const DEMO_TELEGRAM_ID_END = DEMO_TELEGRAM_ID_BASE + 1000;
/** Cohort ceiling. Generous, but bounded so a typo cannot write 10k rows. */
export const DEMO_USER_MAX = 500;

/**
 * The synthetic cohort. Ids are consecutive so `--reset` can find them with one
 * range scan, and they sit far above real Telegram ids so a demo user can never
 * collide with a real one.
 *
 * Names are deliberately plain: a demo board full of "Ali R. ★" would look like
 * real traffic in a screenshot, and the point of the seed is to be obviously fake.
 */
export function planDemoUsers(count: number): Array<{ telegramId: string; displayName: string }> {
  const n = Math.max(1, Math.min(DEMO_USER_MAX, Math.trunc(Number.isFinite(count) ? count : 1)));
  return Array.from({ length: n }, (_, i) => ({
    telegramId: String(DEMO_TELEGRAM_ID_BASE + i),
    displayName: `Demo User ${i + 1}`,
  }));
}

/**
 * How many of the actual XI each demo user gets right.
 *
 * 11 every time would be a perfect prediction each match and 0 would never
 * score — both make for a boring, misleadingly tidy board. This is what a real
 * cohort's hit rate looks like: mostly 4–9 correct, occasionally a shocker in
 * both directions. `skill` is a 0..1 knob so the ladder can be nudged without
 * editing the arithmetic.
 */
export function correctStarterCount(skill: number, rng: () => number): number {
  const clamped = Math.max(0, Math.min(1, Number.isFinite(skill) ? skill : 0));
  const base = 4 + Math.round(clamped * 5); // 4..9
  const jitter = Math.round((rng() - 0.5) * 4); // -2..+2
  return Math.max(0, Math.min(11, base + jitter));
}

/**
 * Build a plausible XI: the first `correctCount` actual starters, padded out to
 * 11 with squad players who did NOT start.
 *
 * Padding strictly from the bench matters for more than legality. `validatePayload`
 * rejects duplicate ids, so a "repeat the last one" filler would throw the whole
 * submission away; and padding from starters the caller did *not* ask for would
 * silently score as extra correct picks, making the demo's hit rate drift away
 * from the `correctStarterCount` the board is supposed to be showing.
 *
 * Returns fewer than 11 when the bench is too thin to pad — the caller skips
 * those fixtures rather than shipping an illegal payload.
 */
export function mixLineup(actualStarters: string[], squad: string[], correctCount: number): string[] {
  const starters = [...new Set(actualStarters)];
  const starterSet = new Set(starters);
  const xi: string[] = [];
  const seen = new Set<string>();

  for (const id of starters) {
    if (xi.length >= Math.min(correctCount, 11)) break;
    seen.add(id);
    xi.push(id);
  }
  for (const id of squad) {
    if (xi.length >= 11) break;
    if (seen.has(id) || starterSet.has(id)) continue;
    seen.add(id);
    xi.push(id);
  }
  return xi;
}

/** Deterministic PRNG, so a re-run reproduces the same demo board. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * A crowd rating drawn from a bell around 7, over the full 1..10 range.
 *
 * The rating histogram is grouped into 10 integer buckets and rendered as a
 * real distribution, so a seed that only ever emits 6..9 leaves four buckets
 * permanently empty and the chart looks broken. This one gives every bucket a
 * realistic chance of being hit while still clustering the way real fan
 * ratings do.
 */
const RATING_POOL = [2, 3, 4, 4, 5, 5, 5, 6, 6, 6, 6, 7, 7, 7, 7, 7, 7, 8, 8, 8, 8, 9, 9, 10];

export function demoRating(rng: () => number): number {
  return RATING_POOL[Math.min(RATING_POOL.length - 1, Math.floor(rng() * RATING_POOL.length))] as number;
}

/* ------------------------------------------------------------ db helpers */

interface MatchRow {
  id: string;
  league: string;
  home_team_id: string;
  away_team_id: string;
  kickoff_at: string;
  home_formation: string | null;
  away_formation: string | null;
}

interface PlayerRow {
  id: string;
}

const FORMATION_RE = /^[1-5](-[1-5]){2,4}$/;

/**
 * Insert and hand back the new rowid. `run()` from server/db intentionally
 * returns nothing, but the ledger's idempotency key (source, source_id) needs
 * the prediction id *before* the award — so inserts here go through prepare()
 * directly rather than bending a shared helper into a second job.
 */
function insertId(db: DatabaseSync, sql: string, params: Bindings = []): number {
  const stmt = db.prepare(sql);
  const info = Array.isArray(params) ? stmt.run(...params) : stmt.run(params);
  return Number(info.lastInsertRowid);
}

/** Insert-or-ignore; returns true when a row was actually written. */
function insertIfNew(db: DatabaseSync, sql: string, params: Bindings = []): boolean {
  const stmt = db.prepare(sql);
  const info = Array.isArray(params) ? stmt.run(...params) : stmt.run(params);
  return Number(info.changes) > 0;
}

/** Only formations the payload validator accepts are worth predicting. */
function pickFormation(m: MatchRow, rng: () => number): string {
  const candidates = [m.home_formation, m.away_formation].filter(
    (f): f is string => !!f && FORMATION_RE.test(f),
  );
  if (candidates.length === 0) return "4-3-3";
  return candidates[Math.floor(rng() * candidates.length)] ?? "4-3-3";
}

/** Real XI when rosters are synced; otherwise the first 22 squad players. */
function actualFor(db: DatabaseSync, m: MatchRow): ActualLineup & { squad: string[] } {
  const starters = all<{ player_id: string }>(
    db,
    "SELECT player_id FROM match_player_stats WHERE match_id = ? AND started = 1 ORDER BY player_id",
    [m.id],
  ).map((r) => r.player_id);

  const squad = all<PlayerRow>(
    db,
    `SELECT id FROM players
     WHERE team_id IN (?, ?) AND active = 1 ORDER BY id LIMIT 40`,
    [m.home_team_id, m.away_team_id],
  ).map((r) => r.id);

  // Fewer than 11 starters recorded means the XI is unknown; falling back to
  // the squad keeps the prediction scored against a self-consistent guess
  // instead of dropping the fixture entirely.
  const starterIds = starters.length >= 11 ? starters : squad.slice(0, 22);
  const formations = new Set<string>();
  if (m.home_formation) formations.add(m.home_formation);
  if (m.away_formation) formations.add(m.away_formation);
  return { starterIds: new Set(starterIds), formations, squad };
}

const MATCH_COLS = "id, league, home_team_id, away_team_id, kickoff_at, home_formation, away_formation";

/* ------------------------------------------------------------ the seed */

export interface SeedReport {
  users: number;
  predictions: number;
  resolved: number;
  ratings: number;
  awards: number;
  totalPoints: number;
  matchesUsed: number;
  skipped: string[];
}

export interface SeedOptions {
  /** Cohort size. Clamped to 1..20 by planDemoUsers. */
  users?: number;
  /** Finished matches to spread predictions across. */
  matches?: number;
  /** Cohort skill 0..1 — how well the demo users predict. */
  skill?: number;
  /** Remove any previous demo rows first. */
  reset?: boolean;
  now?: Date;
}

/**
 * Delete every row this script could have written, for demo users only.
 *
 * Foreign keys are not enforced at runtime here (no `PRAGMA foreign_keys=ON`),
 * so children have to be swept explicitly — a half-swept user would leave
 * predictions and ledger rows pointing at a nonexistent user_id and quietly
 * corrupt every board that reads totals by user.
 */
export function clearDemoData(db: DatabaseSync): number {
  const ids = all<{ id: number }>(db, "SELECT id FROM users WHERE telegram_id >= ? AND telegram_id < ?", [
    DEMO_TELEGRAM_ID_BASE,
    DEMO_TELEGRAM_ID_END,
  ]).map((r) => r.id);
  if (ids.length === 0) return 0;

  const slots = ids.map(() => "?").join(", ");
  const p = (table: string) => run(db, `DELETE FROM ${table} WHERE user_id IN (${slots})`, [...ids]);

  return tx(db, () => {
    for (const table of [
      "streak_evaluations",
      "user_streaks",
      "timeline_comments",
      "crowd_ratings",
      "predictions",
      "point_ledger",
      "user_point_totals",
      "referral_redemptions",
      "referral_codes",
      "followed_leagues",
      "favorite_teams",
      "user_notification_prefs",
      "user_sessions",
      "user_credentials",
    ]) {
      try {
        p(table);
      } catch {
        // Not in this schema version — nothing of ours to clean there.
      }
    }
    run(db, `DELETE FROM users WHERE id IN (${slots})`, [...ids]);
    return ids.length;
  });
}

/**
 * Seed the demo cohort. Throws on a production env, returns a report the
 * caller prints.
 *
 * Re-runnable: `reset: true` gives a clean slate, and without it the ledger's
 * UNIQUE(source, source_id) means an award that already landed is a no-op
 * rather than a double-pay.
 */
export function seedDemoData(db: DatabaseSync, opts: SeedOptions = {}): SeedReport {
  assertNotProduction(process.env);

  const now = opts.now ?? new Date();
  const nowIso = now.toISOString();
  const rng = mulberry32(0x5eed);
  const skipped: string[] = [];

  if (opts.reset) clearDemoData(db);

  const finished = all<MatchRow>(
    db,
    `SELECT ${MATCH_COLS} FROM matches
     WHERE status = 'finished' AND kickoff_at <= ?
     ORDER BY kickoff_at DESC LIMIT ?`,
    [nowIso, Math.max(1, opts.matches ?? 12)],
  );
  if (finished.length === 0) {
    throw new Error(
      "seed-demo: no finished matches in the database. Run `npm run sync` first — the seed " +
        "attaches predictions to real fixtures rather than inventing them.",
    );
  }

  const upcoming = all<MatchRow>(
    db,
    `SELECT ${MATCH_COLS} FROM matches WHERE kickoff_at > ? ORDER BY kickoff_at ASC LIMIT 5`,
    [nowIso],
  );

  const cohort = planDemoUsers(opts.users ?? 6);
  const leagues = [...new Set(finished.map((m) => m.league))].slice(0, 3);
  const report: SeedReport = {
    users: 0,
    predictions: 0,
    resolved: 0,
    ratings: 0,
    awards: 0,
    totalPoints: 0,
    matchesUsed: finished.length,
    skipped,
  };

  tx(db, () => {
    cohort.forEach((plan, idx) => {
      // Skill decays across the cohort so the board has a real ordering
      // instead of everyone tied on identical predictions.
      const skill = Math.max(0, Math.min(1, (opts.skill ?? 0.65) - idx * 0.08));

      const existing = get<{ id: number }>(db, "SELECT id FROM users WHERE telegram_id = ?", [
        plan.telegramId,
      ]);
      const userId =
        existing?.id ??
        insertId(db, "INSERT INTO users (telegram_id, display_name, created_at) VALUES (?, ?, ?)", [
          plan.telegramId,
          plan.displayName,
          nowIso,
        ]);
      report.users++;

      // Favourites: the anchor club plus the club it faced, so the follow list
      // and the matchday view both have something to show.
      const first = finished[idx % finished.length]!;
      for (const [i, teamId] of [first.home_team_id, first.away_team_id].entries()) {
        run(
          db,
          `INSERT INTO favorite_teams (user_id, team_id, is_favorite, created_at) VALUES (?, ?, ?, ?)
           ON CONFLICT(user_id, team_id) DO UPDATE SET is_favorite = excluded.is_favorite`,
          [userId, teamId, i === 0 ? 1 : 0, nowIso],
        );
      }
      for (const league of leagues) {
        insertIfNew(
          db,
          `INSERT INTO followed_leagues (user_id, league, created_at) VALUES (?, ?, ?)
           ON CONFLICT(user_id, league) DO NOTHING`,
          [userId, league, nowIso],
        );
      }

      // Predictions on finished matches: scored for real, then awarded.
      for (const match of finished) {
        const actual = actualFor(db, match);
        if (actual.squad.length < 11) {
          skipped.push(`${match.id}: no players synced for this fixture`);
          continue;
        }
        const payload = {
          playerIds: mixLineup([...actual.starterIds], actual.squad, correctStarterCount(skill, rng)),
          formation: pickFormation(match, rng),
        };
        if (payload.playerIds.length !== 11) continue;
        // Round-trip through the real validator: a demo row the API would
        // reject is a demo row that makes the UI look broken.
        const validated = validatePayload("lineup", payload);
        if (!validated || !("playerIds" in validated)) continue;

        const prior = get<{ id: number }>(
          db,
          "SELECT id FROM predictions WHERE user_id = ? AND match_id = ? AND mechanic = 'lineup'",
          [userId, match.id],
        );
        const predictionId =
          prior?.id ??
          insertId(
            db,
            `INSERT INTO predictions (user_id, match_id, mechanic, payload, locked_at)
             VALUES (?, ?, 'lineup', ?, ?)`,
            [
              userId,
              match.id,
              JSON.stringify(payload),
              // Locked an hour before kickoff, the way the real route stamps it.
              new Date(new Date(match.kickoff_at).getTime() - 3_600_000).toISOString(),
            ],
          );
        report.predictions++;

        const { points, breakdown } = scoreLineup(validated, actual);
        if (points === 0) continue;
        run(
          db,
          `UPDATE predictions
           SET status = ?, points_awarded = ?, breakdown = ?, resolved_at = ?
           WHERE id = ?`,
          [
            points >= 16 ? "correct" : "partial",
            points,
            JSON.stringify(breakdown),
            match.kickoff_at,
            predictionId,
          ],
        );
        report.resolved++;

        const ledgerId = award(db, {
          userId,
          matchId: match.id,
          source: "prediction",
          mechanic: "lineup",
          points,
          sourceId: predictionId,
          league: match.league,
          teamIds: [match.home_team_id, match.away_team_id],
        });
        if (ledgerId !== null) {
          report.awards++;
          report.totalPoints += points;
        }
      }

      // Crowd ratings on real players of real finished matches — cosmetic, so
      // they never reach the ledger (scoring-rules.md §8 firewall).
      //
      // Round-robin rather than slice(idx, idx+2): with a cohort larger than
      // the match list, indexing by user left every user past the end with
      // nothing, and the rating distribution — which is grouped PER MATCH and
      // hidden below MIN_VOTES_TO_SHOW — stayed too sparse to render at all.
      for (let k = 0; k < 2; k++) {
        const match = finished[(idx + k) % finished.length]!;
        const players = all<PlayerRow>(
          db,
          `SELECT p.id FROM match_player_stats s
           JOIN players p ON p.id = s.player_id
           WHERE s.match_id = ? AND (s.goals > 0 OR s.shots_on_target > 0)
           ORDER BY s.goals DESC, s.shots_on_target DESC LIMIT 3`,
          [match.id],
        );
        for (const p of players) {
          if (
            insertIfNew(
              db,
              `INSERT INTO crowd_ratings (user_id, player_id, match_id, rating, comment, created_at)
               VALUES (?, ?, ?, ?, ?, ?)
               ON CONFLICT(user_id, player_id, match_id) DO NOTHING`,
              [userId, p.id, match.id, demoRating(rng), "Held his shape all afternoon.", match.kickoff_at],
            )
          ) {
            report.ratings++;
          }
        }
      }

      // A pending prediction on the next fixture, so "my predictions" shows a
      // live card rather than only a history of resolved ones.
      const next = upcoming[idx % Math.max(1, upcoming.length)];
      if (next) {
        const actual = actualFor(db, next);
        if (actual.squad.length >= 11) {
          const payload = {
            playerIds: actual.squad.slice(0, 11),
            formation: pickFormation(next, rng),
          };
          if (validatePayload("lineup", payload)) {
            if (
              insertIfNew(
                db,
                `INSERT INTO predictions (user_id, match_id, mechanic, payload, locked_at)
                 VALUES (?, ?, 'lineup', ?, ?)
                 ON CONFLICT(user_id, match_id, mechanic) DO NOTHING`,
                [userId, next.id, JSON.stringify(payload), nowIso],
              )
            ) {
              report.predictions++;
            }
          }
        }
      }
    });
  });

  return report;
}
