/**
 * Prediction resolver — settles the five mechanics once the data they need is
 * in the database. ALL point math lives in server/scoring/predictionScore.ts
 * (pure functions mirroring scoring-rules.md); this file only gathers inputs
 * from the DB, applies the outcome, and records awards.
 *
 * Every settled prediction with points > 0 appends exactly one point_ledger
 * row (server/scoring/ledger.ts), which bumps the global/league/club totals.
 * Zero-point settlements write no ledger row. After a match's rows are
 * settled, the users' favorite-club streaks are re-evaluated
 * (server/scoring/streak.ts). Ratings and comments never reach any of this.
 *
 * Resolution windows (prediction-mechanics.md):
 * - lineup / shot_predict / sub / versus : as soon as the match is finished
 * - player_watch                         : match finished + the ratings window,
 *   so the crowd component has settled (stat component is known at full time)
 *
 * Trigger points (both wired in startResolverLoop):
 *  - a match flips to 'finished'  -> resolve its fast mechanics
 *  - hourly sweep                 -> player_watch after the window; also a
 *    catch-up safety net for anything the flip missed
 *
 * Table shape note: predictions has UNIQUE(user_id, match_id, mechanic), so
 * each mechanic is ONE row per user per match — the Sub Predictor's whole
 * board is one row, and "last write wins" at submit time.
 */
import { getDb, all, run, get } from "../db/index.js";
import {
  scoreLineup,
  scoreSubs,
  scoreShotPredict,
  scorePlayerWatch,
  scoreVersus,
} from "../scoring/predictionScore.js";
import { award } from "../scoring/ledger.js";
import { evaluateStreakForUser } from "../scoring/streak.js";
import { zoneForFieldPosition, type ShotZone } from "../scoring/shotZones.js";
import { cellCenter } from "../scoring/shotGrid.js";
import type {
  LineupPayload,
  SubPayload,
  ShotPredictPayload,
  PlayerWatchPayload,
  VersusPayload,
} from "./validate.js";

/** Ratings must have cooled before Player to Watch settles (24h window). */
const WATCH_WINDOW_HOURS = 24;
/**
 * After the window + this grace period, a pick whose crowd data is still too
 * sparse settles with whatever the stat gate alone decides (0 or the MVP
 * bonus) instead of staying pending forever.
 */
const WATCH_FORCE_AFTER_HOURS = WATCH_WINDOW_HOURS + 24;

interface PendingRow {
  id: number;
  user_id: number;
  match_id: string;
  mechanic: string;
  payload: string;
}

const db = getDb();

function settle(
  row: PendingRow,
  status: "correct" | "wrong" | "partial" | "void",
  points: number,
  breakdown: Record<string, number>,
): void {
  run(
    db,
    `UPDATE predictions
     SET status = ?, points_awarded = ?, breakdown = ?, resolved_at = ?
     WHERE id = ?`,
    [status, points, JSON.stringify(breakdown), new Date().toISOString(), row.id],
  );
  if (points > 0) recordAward(row, points);
}

/**
 * The ledger write for one resolved prediction: one row, bumping global +
 * the match's league board + both clubs' boards. Ratings/comments have no
 * path here — only resolved prediction rows do (scoring-rules.md firewall).
 */
function recordAward(row: PendingRow, points: number): void {
  const match = get<{ league: string; home_team_id: string; away_team_id: string }>(
    db,
    "SELECT league, home_team_id, away_team_id FROM matches WHERE id = ?",
    [row.match_id],
  );
  const ledgerId = award(db, {
    userId: row.user_id,
    matchId: row.match_id,
    source: "prediction",
    mechanic: row.mechanic,
    points,
    sourceId: row.id,
    league: match?.league ?? null,
    teamIds: match ? [match.home_team_id, match.away_team_id] : [],
  });
  if (ledgerId !== null) {
    // A new award may have changed this user's favorite-club streak picture.
    evaluateStreakForUser(db, row.user_id, row.match_id);
  }
}

/* ------------------------------------------------------------ shared helpers */

/** Highest single-fixture stat score in the match = the match MVP (concept.md). */
function matchMvp(matchId: string): { player_id: string; stat_score: number } | null {
  return (
    get<{ player_id: string; stat_score: number }>(
      db,
      `SELECT player_id, stat_score FROM match_player_stats
       WHERE match_id = ? AND stat_score IS NOT NULL
       ORDER BY stat_score DESC LIMIT 1`,
      [matchId],
    ) ?? null
  );
}

/** Per-player crowd rating aggregates for a match (vote floor applied by the scorer). */
function crowdBoard(matchId: string): Array<{ player_id: string; avg: number; votes: number }> {
  return all<{ player_id: string; avg: number; votes: number }>(
    db,
    `SELECT player_id, AVG(rating) AS avg, COUNT(*) AS votes
     FROM crowd_ratings WHERE match_id = ?
     GROUP BY player_id`,
    [matchId],
  );
}

/** Every player who featured, with normalized position + stat score. */
function positionRows(
  matchId: string,
): Array<{ player_id: string; position: string | null; stat_score: number | null }> {
  return all<{ player_id: string; position: string | null; stat_score: number | null }>(
    db,
    `SELECT s.player_id, p.position, s.stat_score
     FROM match_player_stats s
     LEFT JOIN players p ON p.id = s.player_id
     WHERE s.match_id = ?`,
    [matchId],
  );
}

/* ------------------------------------------------------------ per-mechanic resolvers */

function resolveLineup(row: PendingRow, payload: LineupPayload): void {
  const starters = new Set(
    all<{ player_id: string }>(
      db,
      "SELECT player_id FROM match_player_stats WHERE match_id = ? AND started = 1",
      [row.match_id],
    ).map((r) => r.player_id),
  );
  const formationRow = get<{ home_formation: string | null; away_formation: string | null }>(
    db,
    "SELECT home_formation, away_formation FROM matches WHERE id = ?",
    [row.match_id],
  );
  // The pick doesn't carry a side (any fixture is predictable), so accept
  // either side's recorded formation — lenient on purpose for v1.
  const formations = new Set(
    [formationRow?.home_formation, formationRow?.away_formation].filter((f): f is string => Boolean(f)),
  );

  const { points, breakdown } = scoreLineup(payload, { starterIds: starters, formations });
  const status =
    points === 0
      ? "wrong"
      : (breakdown.formationBonus ?? 0) > 0 || (breakdown.startersCorrect ?? 0) >= 8
        ? "correct"
        : "partial";
  settle(row, status, points, breakdown);
}

function resolveShotPredict(row: PendingRow, payload: ShotPredictPayload): void {
  // Located shots by the picked player: ESPN fills fieldPositionX/Y on goal
  // events (and some non-goal events in some leagues). Kinds come from the
  // event type; a shot event without coordinates can't place a zone, so it
  // is not scoreable for zone points (the +2 falls back to the stat sheet).
  // Located shot events for the match; goals always carry participants, and
  // non-goal shot events (when a league provides them) list the shooter too.
  const events = all<{
    type: string;
    participants: string | null;
    field_x: number | null;
    field_y: number | null;
  }>(
    db,
    `SELECT type, participants, field_x, field_y FROM timeline_events
     WHERE match_id = ? AND type IN ('goal', 'shot', 'shot_on_target', 'shot_off_target')
       AND field_x IS NOT NULL AND field_y IS NOT NULL`,
    [row.match_id],
  );
  const picked = events.filter((e) => {
    try {
      const parts = JSON.parse(e.participants ?? "[]") as Array<{ id?: string }>;
      return Array.isArray(parts) && parts.some((p) => p?.id === payload.playerId);
    } catch {
      return false;
    }
  });
  // Goal events always belong to their listed participants; when no
  // participant list matches (older data), fall back to all match shots so a
  // correctly-placed zone is not voided by a sync gap. Slight leniency, on
  // purpose: the alternative is mostly-zero boards (scoring-rules.md caveats).
  // The fallback is NOT silent: the breakdown records it so a future "why did
  // I get X" panel can show that the score came from a teammate's located
  // shot, not the picked player's own (and so exploitation can be revisited).
  const usedFallback = picked.length === 0;
  const events2 = usedFallback ? events : picked;

  const located = events2.map((e) => ({
    kind: e.type === "goal" ? ("goal" as const) : ("on_target" as const),
    fieldPositionX: e.field_x as number,
    fieldPositionY: e.field_y as number,
  }));
  const counts = get<{ shots: number; shots_on_target: number }>(
    db,
    "SELECT shots, shots_on_target FROM match_player_stats WHERE match_id = ? AND player_id = ?",
    [row.match_id, payload.playerId],
  );

  // The payload stores the zone as a grid point (6×4, row 0 = attacking);
  // map its centre to field coordinates, then classify into one of the 6
  // zones. Geometry helper from shotGrid.ts (client mirrors it).
  const center = cellCenter(payload.grid.gridX, payload.grid.gridY);
  const zone: ShotZone = zoneForFieldPosition(center.x, center.y);
  const result = scoreShotPredict(zone, {
    locatedShots: located,
    counts: { shots: counts?.shots ?? 0, shotsOnTarget: counts?.shots_on_target ?? 0 },
  });
  // `lenientSoT` is scoreShotPredict's own stat-tally flag; `zoneFromFallback`
  // is the resolver-level flag: zone/goal points came from the all-shots
  // fallback (a teammate's located shot) rather than the picked player's own.
  const breakdown =
    usedFallback && result.points > 0 ? { ...result.breakdown, zoneFromFallback: 1 } : result.breakdown;
  settle(row, result.status, result.points, breakdown);
}

function resolveSub(row: PendingRow, payload: SubPayload): void {
  // Every substitution event of the match, participants[0]=on, [1]=off.
  const events = all<{ participants: string | null }>(
    db,
    "SELECT participants FROM timeline_events WHERE match_id = ? AND type = 'substitution'",
    [row.match_id],
  );
  const actual: Array<{ offId: string; onId: string }> = [];
  for (const e of events) {
    try {
      const parsed = JSON.parse(e.participants ?? "[]");
      if (Array.isArray(parsed) && parsed.length >= 2) {
        actual.push({ onId: String(parsed[0]?.id ?? ""), offId: String(parsed[1]?.id ?? "") });
      }
    } catch {
      continue;
    }
  }

  const { points, breakdown } = scoreSubs(payload, actual);
  const status = points === 0 ? "wrong" : (breakdown.fullPairs ?? 0) > 0 ? "correct" : "partial";
  settle(row, status, points, breakdown);
}

function resolvePlayerWatch(row: PendingRow, payload: PlayerWatchPayload, force = false): void {
  const { outcome, points, breakdown } = scorePlayerWatch({
    pick: payload,
    positionRows: positionRows(row.match_id),
    crowd: crowdBoard(row.match_id),
    mvpPlayerId: matchMvp(row.match_id)?.player_id ?? null,
    // Grace window elapsed → sparse crowd data settles as a failed crowd gate
    // (MVP bonus can still pay; the 8 cannot) instead of pending forever.
    force,
  });

  if (outcome === "pending") {
    // Crowd never reached the vote floor for this player yet. Keep pending so
    // the next sweep can settle it if late votes arrive (bounded by force).
    return;
  }

  settle(
    row,
    outcome === "void"
      ? "void"
      : outcome === "correct"
        ? "correct"
        : outcome === "partial"
          ? "partial"
          : "wrong",
    points,
    breakdown,
  );
}

function resolveVersus(row: PendingRow, payload: VersusPayload): void {
  // Both picks must belong to opposite sides of THIS match, or the duel is
  // nonsense — validate against the stored fixture, not just the payload.
  const match = get<{ home_team_id: string; away_team_id: string }>(
    db,
    "SELECT home_team_id, away_team_id FROM matches WHERE id = ?",
    [row.match_id],
  );
  const sideOf = (playerId: string): string | null =>
    get<{ team_id: string }>(db, "SELECT team_id FROM players WHERE id = ?", [playerId])?.team_id ?? null;

  const aTeam = sideOf(payload.playerAId);
  const bTeam = sideOf(payload.playerBId);
  const valid =
    match &&
    new Set([match.home_team_id, match.away_team_id]).has(aTeam ?? "") &&
    new Set([match.home_team_id, match.away_team_id]).has(bTeam ?? "") &&
    aTeam !== bTeam;
  if (!valid) {
    settle(row, "void", 0, { note: 0 });
    return;
  }

  const statScores: Record<string, number> = {};
  for (const id of [payload.playerAId, payload.playerBId]) {
    statScores[id] =
      get<{ stat_score: number | null }>(
        db,
        "SELECT stat_score FROM match_player_stats WHERE match_id = ? AND player_id = ?",
        [row.match_id, id],
      )?.stat_score ?? 0;
  }

  const { outcome, points, breakdown } = scoreVersus({ pick: payload, statScores });
  settle(row, outcome === "void" ? "void" : outcome === "correct" ? "correct" : "wrong", points, breakdown);
}

const RESOLVERS: Record<string, (row: PendingRow, payload: unknown) => void> = {
  lineup: (r, p) => resolveLineup(r, p as LineupPayload),
  shot_predict: (r, p) => resolveShotPredict(r, p as ShotPredictPayload),
  sub: (r, p) => resolveSub(r, p as SubPayload),
  versus: (r, p) => resolveVersus(r, p as VersusPayload),
};

/* ------------------------------------------------------------ triggers */

/** Resolve every pending fast mechanic for one finished match. */
function resolveMatchFast(row: { match_id: string }): void {
  const pending = all<PendingRow>(
    db,
    `SELECT id, user_id, match_id, mechanic, payload FROM predictions
     WHERE match_id = ? AND status = 'pending'
       AND mechanic IN ('lineup', 'shot_predict', 'sub', 'versus')`,
    [row.match_id],
  );
  const touchedUsers = new Set<number>();
  for (const p of pending) {
    try {
      let payload: unknown;
      try {
        payload = JSON.parse(p.payload);
      } catch {
        settle(p, "void", 0, { note: 0 }); // unparseable: void, don't crash the loop
        continue;
      }
      const resolver = RESOLVERS[p.mechanic];
      if (resolver) (resolver as (r: PendingRow, pay: unknown) => void)(p, payload);
      touchedUsers.add(p.user_id);
    } catch (err) {
      console.error(
        `[resolver] ${p.mechanic} ${p.match_id} user ${p.user_id} failed:`,
        String(err).slice(0, 200),
      );
    }
  }
  // Streak sweeps are idempotent and pending-gated — safe to fan out.
  for (const userId of touchedUsers) {
    try {
      evaluateStreakForUser(db, userId, row.match_id);
    } catch (err) {
      console.error(`[resolver] streak user ${userId} failed:`, String(err).slice(0, 200));
    }
  }
}

/** Hourly sweep: player_watch after its window + catch-up for stragglers. */
export function resolveDue(): void {
  // 1) Player to Watch picks whose ratings window has closed.
  const dueMatches = all<{ match_id: string; kickoff_at: string }>(
    db,
    `SELECT DISTINCT p.match_id, m.kickoff_at FROM predictions p
     JOIN matches m ON m.id = p.match_id
     WHERE p.status = 'pending' AND p.mechanic = 'player_watch'
       AND m.status = 'finished'
       AND m.kickoff_at <= ?`,
    [new Date(Date.now() - WATCH_WINDOW_HOURS * 3_600_000).toISOString()],
  );
  for (const m of dueMatches) {
    // Grace elapsed → force-settle sparse-crowd picks instead of waiting.
    const force = new Date(m.kickoff_at).getTime() <= Date.now() - WATCH_FORCE_AFTER_HOURS * 3_600_000;
    const pending = all<PendingRow>(
      db,
      `SELECT id, user_id, match_id, mechanic, payload FROM predictions
       WHERE match_id = ? AND mechanic = 'player_watch' AND status = 'pending'`,
      [m.match_id],
    );
    for (const p of pending) {
      try {
        resolvePlayerWatch(p, JSON.parse(p.payload) as PlayerWatchPayload, force);
      } catch (err) {
        console.error(
          `[resolver] player_watch ${p.match_id} user ${p.user_id} failed:`,
          String(err).slice(0, 200),
        );
      }
    }
  }

  // 2) Catch-up: any finished match that still has fast-mechanic pendings
  //    (covers a crash between the status flip and resolution, and any match
  //    that finished while the server was down).
  const stragglers = all<{ match_id: string }>(
    db,
    `SELECT DISTINCT p.match_id FROM predictions p
     JOIN matches m ON m.id = p.match_id
     WHERE p.status = 'pending' AND p.mechanic IN ('lineup', 'shot_predict', 'sub', 'versus')
       AND m.status = 'finished'`,
  );
  for (const m of stragglers) resolveMatchFast(m);
}

/** Called from the sync layer whenever a match just flipped to finished. */
export function resolveMatchOnFinish(matchId: string): void {
  try {
    resolveMatchFast({ match_id: matchId });
  } catch (err) {
    console.error(`[resolver] on-finish ${matchId} failed:`, String(err).slice(0, 200));
  }
}

let started = false;

/** Hourly catch-up sweep. Fast mechanics resolve on the finish trigger. */
export function startResolverLoop(): void {
  if (started) return;
  started = true;
  setInterval(() => {
    try {
      resolveDue();
    } catch (err) {
      console.error("[resolver] sweep error:", String(err).slice(0, 200));
    }
  }, 60 * 60_000);
  // Run once shortly after boot so a restart catches up quickly.
  setTimeout(() => {
    try {
      resolveDue();
    } catch (err) {
      console.error("[resolver] boot sweep error:", String(err).slice(0, 200));
    }
  }, 30_000);
}

// Re-exported so the sync layer can call a single import point.
export { resolveMatchOnFinish as onMatchFinished };
export type { PendingRow };
