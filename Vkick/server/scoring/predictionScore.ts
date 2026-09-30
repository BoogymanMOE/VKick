/**
 * Pure prediction scoring — `scoring-rules.md` implemented as functions.
 *
 * No database, no I/O: every function takes plain data and returns points +
 * a breakdown that mirrors the doc's line items, so the UI can show a
 * transparent "why did I get X" panel and the tests can pin every rule.
 * The resolver (server/predictions/resolver.ts) gathers the inputs from the
 * DB and calls these; nothing else computes points anywhere in the codebase.
 *
 * The one global invariant (scoring-rules.md §7): every mechanic is
 * zero-or-positive. Wrong predictions never subtract — asserted in tests.
 */
import type {
  LineupPayload,
  SubPayload,
  PlayerWatchPayload,
  VersusPayload,
} from "../predictions/validate.js";
import { zoneForFieldPosition, type ShotZone } from "./shotZones.js";

/* ------------------------------------------------------------ constants */

export const POINTS = {
  lineupPerStarter: 1,
  lineupFormationBonus: 5,
  lineupMax: 16, // 11 starters + 5 formation

  subOff: 1,
  subOn: 1,
  subPerPairMax: 2,
  subMax: 10, // 5 fully-correct pairs

  shotZoneExact: 5,
  shotZoneAdjacent: 2,
  shotOnTargetBonus: 2,
  shotGoalBonus: 5,
  shotMax: 12, // exact + on target + goal

  watchBase: 8,
  watchMvpBonus: 4,
  watchMax: 12,

  versusWin: 3,

  streak: { 3: 2, 5: 5, 10: 10 } as Record<number, number>,
  streakThresholds: [3, 5, 10],
} as const;

/* ------------------------------------------------------------ lineup */

export interface ActualLineup {
  starterIds: Set<string>;
  /** e.g. "4-3-3" — as recorded for either side (resolver is lenient on sides). */
  formations: Set<string>;
}

/**
 * +1 per correctly named starter (max 11), +5 if the predicted formation is
 * one of the recorded ones. Never negative: hit counts and the bonus are
 * both floored at 0 by construction.
 */
export function scoreLineup(
  payload: LineupPayload,
  actual: ActualLineup,
): { points: number; breakdown: Record<string, number> } {
  const startersCorrect = payload.playerIds.filter((id) => actual.starterIds.has(id)).length;
  const formationBonus = actual.formations.has(payload.formation) ? POINTS.lineupFormationBonus : 0;
  const points = Math.max(0, startersCorrect) + formationBonus;
  return { points, breakdown: { startersCorrect, formationBonus } };
}

/* ------------------------------------------------------------ subs */

/** One actual substitution event: who came off, who replaced them. */
export interface ActualSub {
  offId: string;
  onId: string;
}

/**
 * Per predicted pair: +1 for the player off, +1 more for the replacement.
 * A pair pays its +1 "on" point only when the same actual event contained
 * both players — pairing a predicted pair across two different real events
 * would make the "replacement" guess meaningless.
 */
export function scoreSubs(
  payload: SubPayload,
  actual: ActualSub[],
): { points: number; breakdown: Record<string, number> } {
  let offPoints = 0;
  let onPoints = 0;
  let fullPairs = 0;
  for (const pair of payload.subs) {
    const event = actual.find((a) => a.offId === pair.offId);
    if (!event) continue;
    offPoints += POINTS.subOff;
    if (event.onId === pair.onId) {
      onPoints += POINTS.subOn;
      fullPairs += 1;
    }
  }
  const points = offPoints + onPoints;
  return {
    points,
    breakdown: { pairsPredicted: payload.subs.length, offCorrect: offPoints, onCorrect: onPoints, fullPairs },
  };
}

/* ------------------------------------------------------------ shot predictor */

export interface LocatedShot {
  kind: "goal" | "on_target" | "off_target";
  fieldPositionX: number;
  fieldPositionY: number;
}

/** Counts for the lenient +2: the picked player's shot tallies from the stat sheet. */
export interface PlayerShotCounts {
  shots: number;
  shotsOnTarget: number;
}

export interface ShotScoringInput {
  /** Located shots by the picked player (ESPN coordinates exist on goals, mostly). */
  locatedShots: LocatedShot[];
  /** Stat-sheet tallies for the picked player (lenient +2 SoT bonus). */
  counts: PlayerShotCounts;
}

export interface ShotScoreResult {
  points: number;
  status: "correct" | "partial" | "wrong";
  breakdown: Record<string, number>;
}

/**
 * Shot Predictor: one player, one zone (scoring-rules.md §3).
 *
 * The picked player's shots are scored one by one and the BEST shot pays the
 * zone+goal part: zone match GATES the shot ("wrong zone: 0"), so a goal
 * outside the predicted/adjacent zone pays nothing (5 exact + 5 goal; 2
 * adjacent + 5 goal). The +2 on-target bonus is stat-tally-scoped (user's
 * lenient adjudication decision): it pays whenever the stat sheet shows ≥1
 * shot on target, independent of zone outcomes — ESPN locates almost only
 * goals, so zone-level SoT checking is usually impossible (scoring-rules.md
 * "Data caveats").
 */
export function scoreShotPredict(zone: ShotZone, input: ShotScoringInput): ShotScoreResult {
  // Best single shot: max over located shots of (zone points + goal bonus,
  // the latter only when the shot itself hit the predicted/adjacent zone).
  let zonePoints = 0;
  let exact = 0;
  let adjacent = 0;
  let goalBonus = 0;
  for (const shot of input.locatedShots) {
    const adjacency = zoneAdjacency(zone, zoneForFieldPosition(shot.fieldPositionX, shot.fieldPositionY));
    if (adjacency === "none") continue; // wrong zone: this shot scores nothing
    const zp = adjacency === "exact" ? POINTS.shotZoneExact : POINTS.shotZoneAdjacent;
    const gb = shot.kind === "goal" ? POINTS.shotGoalBonus : 0;
    if (zp + gb > zonePoints + goalBonus) {
      zonePoints = zp;
      exact = adjacency === "exact" ? 1 : 0;
      adjacent = adjacency === "adjacent" ? 1 : 0;
      goalBonus = gb;
    }
  }

  const onTargetBonus = input.counts.shotsOnTarget > 0 ? POINTS.shotOnTargetBonus : 0;
  const points = zonePoints + onTargetBonus + goalBonus;
  const status = goalBonus > 0 ? "correct" : points > 0 ? "partial" : "wrong";
  return {
    points,
    status,
    breakdown: {
      zonePoints,
      zoneExact: exact,
      zoneAdjacent: adjacent,
      onTargetBonus,
      goalBonus,
      // The +2 paid without any zone hit — pure stat-sheet leniency.
      lenientSoT: zonePoints === 0 && onTargetBonus > 0 ? 1 : 0,
    },
  };
}

/* ------------------------------------------------------------ player watch */

export interface PositionStatRow {
  player_id: string;
  position: string | null; // GK / DEF / MID / FWD (players.position)
  stat_score: number | null; // statScore.ts total (match_player_stats.stat_score)
}

/** One player's aggregate crowd rating (from crowd_ratings, ≥ MIN_VOTES). */
export interface CrowdEntry {
  player_id: string;
  avg: number;
  votes: number;
}

export interface WatchScoringInput {
  pick: PlayerWatchPayload;
  /** Every player who featured in the match (stat score may be null). */
  positionRows: PositionStatRow[];
  /** Crowd entries meeting the minimum-vote floor. */
  crowd: CrowdEntry[];
  /** The match MVP's player id (highest stat score), or null. */
  mvpPlayerId: string | null;
  /** True after the grace window: sparse crowd data settles as a failed
   *  crowd gate (MVP bonus can still pay; the 8 cannot) instead of pending. */
  force?: boolean;
}

export interface WatchScoreResult {
  /** "pending" = crowd data still too sparse to settle — resolver keeps the row open. */
  outcome: "correct" | "partial" | "wrong" | "void" | "pending";
  points: number;
  breakdown: Record<string, number>;
}

/** Minimum crowd votes for a player's rating to count (scoring-rules.md §4). */
export const WATCH_MIN_VOTES = 5;

/**
 * Position crowd average with the fallback ladder (scoring-rules.md §4):
 * 1. OTHER same-position players with ≥ WATCH_MIN_VOTES votes
 * 2. all other featured players (same vote floor)
 * 3. no data at all — returned as null; caller treats the crowd gate as failed
 *    unless force-settling applies (see scorePlayerWatch).
 * The picked player is always excluded: a player is measured against their
 * position peers, never against an average they're part of (a solo-position
 * player would otherwise never beat their own average).
 */
export function positionCrowdAverage(
  rows: PositionStatRow[],
  crowd: CrowdEntry[],
  position: string | null,
  excludePlayerId: string,
): number | null {
  // The vote floor is applied here so every caller gets the same policy.
  const qualified = crowd.filter((c) => c.votes >= WATCH_MIN_VOTES);
  const crowdByPlayer = new Map(qualified.map((c) => [c.player_id, c]));
  const avgOf = (ids: string[]): number | null => {
    const vals = ids
      .map((id) => crowdByPlayer.get(id)?.avg)
      .filter((v): v is number => typeof v === "number");
    if (vals.length === 0) return null;
    return vals.reduce((a, b) => a + b, 0) / vals.length;
  };

  const others = rows.filter((r) => r.player_id !== excludePlayerId);
  if (position) {
    const direct = avgOf(others.filter((r) => r.position === position).map((r) => r.player_id));
    if (direct !== null) return direct;
  }
  return avgOf(others.map((r) => r.player_id));
}

/**
 * Position stat-score average — the stat gate's threshold (scoring-rules.md
 * §4). Same ladder and same self-exclusion as positionCrowdAverage: other
 * players at the picked player's position, falling back to all other
 * featured players; null when nobody else featured.
 */
export function positionStatAverage(
  rows: PositionStatRow[],
  position: string | null,
  excludePlayerId: string,
): number | null {
  const others = rows
    .filter((r) => r.player_id !== excludePlayerId && r.stat_score !== null)
    .map((r) => r.stat_score as number);
  if (position) {
    const samePosition = rows
      .filter((r) => r.player_id !== excludePlayerId && r.position === position && r.stat_score !== null)
      .map((r) => r.stat_score as number);
    if (samePosition.length > 0) return average(samePosition);
  }
  return others.length > 0 ? average(others) : null;
}

/**
 * Player to Watch (scoring-rules.md §4): base 8 iff the player's stat score
 * AND their crowd rating both exceed the match average for their position
 * (peers excluding the pick itself, all-position fallback);
 * +4 if the pick is the match MVP. Max 12.
 *
 * "Exceeds" is strict (>): the average is not beaten by an equal score.
 * Outcome mapping:
 *  - player didn't feature (no stat row)        -> void  (pick never raced)
 *  - stat gate fails                            -> wrong (0 pts) — settles
 *    immediately; crowd sparsity must not hold good picks hostage, and a
 *    below-average stat score already decides the mechanic.
 *  - stat gate passes but crowd data too sparse -> pending (resolver waits
 *    for the sweep; late ratings may still arrive)
 *  - both gates pass                            -> correct (8 [+4 MVP])
 *  - both fail? can't happen: stat fail settles first.
 */
export function scorePlayerWatch(input: WatchScoringInput): WatchScoreResult {
  const mine = input.positionRows.find((r) => r.player_id === input.pick.playerId);
  if (!mine || mine.stat_score === null) {
    return { outcome: "void", points: 0, breakdown: { note: 0 } };
  }

  const statAvg = positionStatAverage(input.positionRows, mine.position, input.pick.playerId);
  const statPasses = statAvg !== null && mine.stat_score > statAvg;

  const mvpBonus = input.mvpPlayerId === input.pick.playerId ? POINTS.watchMvpBonus : 0;
  if (!statPasses) {
    return {
      outcome: "wrong",
      points: 0,
      breakdown: {
        statScore: mine.stat_score,
        statAvg: round2(statAvg ?? 0),
        statGate: 0,
        mvpBonus,
      },
    };
  }

  const posAvg = positionCrowdAverage(input.positionRows, input.crowd, mine.position, input.pick.playerId);
  const mineEntry = input.crowd
    .filter((c) => c.votes >= WATCH_MIN_VOTES)
    .find((c) => c.player_id === input.pick.playerId);
  if (!mineEntry || posAvg === null) {
    // Crowd data too sparse. Stay pending... unless the grace window closed
    // (force): then the crowd gate counts as failed — the MVP bonus can
    // still pay, the 8 never can without the crowd verdict (§4).
    if (!input.force) {
      return { outcome: "pending", points: 0, breakdown: { statScore: mine.stat_score, statGate: 1 } };
    }
    return {
      outcome: mvpBonus > 0 ? "correct" : "partial",
      points: mvpBonus,
      breakdown: {
        statScore: mine.stat_score,
        statAvg: round2(statAvg),
        statGate: 1,
        crowdGate: 0,
        forcedByWindow: 1,
        mvpBonus,
      },
    };
  }

  const crowdPasses = mineEntry.avg > posAvg;
  const base = crowdPasses ? POINTS.watchBase : 0;
  const points = base + mvpBonus;
  const outcome = crowdPasses || mvpBonus > 0 ? "correct" : "partial";
  return {
    outcome,
    points,
    breakdown: {
      statScore: mine.stat_score,
      statAvg: round2(statAvg),
      statGate: 1,
      crowdAvg: round1(mineEntry.avg),
      crowdPosAvg: round2(posAvg),
      crowdGate: crowdPasses ? 1 : 0,
      mvpBonus,
    },
  };
}

/* ------------------------------------------------------------ versus */

export interface VersusScoringInput {
  pick: VersusPayload;
  /** stat_score per player for this match (statScore.ts output). */
  statScores: Record<string, number>;
}

/**
 * Versus Mode (scoring-rules.md §5): stat score only, +3 for a correct pick,
 * 0 otherwise, no partial credit. Ties void — nobody gains from a coin flip.
 * The user's pick is playerA.
 */
export function scoreVersus(input: VersusScoringInput): {
  outcome: "correct" | "wrong" | "void";
  points: number;
  breakdown: Record<string, number>;
} {
  const a = input.statScores[input.pick.playerAId] ?? 0;
  const b = input.statScores[input.pick.playerBId] ?? 0;
  const outcome = a === b ? "void" : a > b ? "correct" : "wrong";
  return {
    outcome,
    points: outcome === "correct" ? POINTS.versusWin : 0,
    breakdown: { playerA: a, playerB: b },
  };
}

/* ------------------------------------------------------------ streak */

export interface StreakState {
  /** Consecutive favorite-club hits before this match (≥ 0). */
  current: number;
  /** Total hits recorded in the current season run (for thresholds). */
  seasonHits: number;
  /** Bonuses already paid per threshold (dedupes re-resolution). */
  thresholdsPaid: number[]; // e.g. [3, 5] — 10 not yet crossed
  /** Last favorite-club match this streak recorded, for idempotency. */
  lastMatchId: string | null;
  /** Whether the streak is currently alive (not reset by a miss). */
  active: 0 | 1;
}

export interface StreakUpdate {
  state: StreakState;
  /** Points awarded by THIS update (0, +2, +5 or +10) — one-time at crossing. */
  bonusAwarded: number;
  /** Which threshold was crossed by this update, if any. */
  thresholdCrossed: number | null;
}

/**
 * Streak state machine (scoring-rules.md §6). Favorite-club matches only.
 * hit=true extends the run; hit=false resets it to zero (including the
 * "made no predictions at all" case — the caller passes hit=false for that).
 *
 * Thresholds pay exactly once per season: crossing 4→5 pays the +5; 5→6 pays
 * nothing extra until 10. seasonHits only ever grows within the season (it
 * feeds threshold bookkeeping) while current resets on a miss.
 * Re-evaluating the same match is a no-op (idempotent re-resolution).
 */
export function updateStreak(state: StreakState, matchId: string, hit: boolean): StreakUpdate {
  if (state.lastMatchId === matchId) {
    return { state, bonusAwarded: 0, thresholdCrossed: null };
  }

  const next: StreakState = {
    ...state,
    lastMatchId: matchId,
    active: hit ? 1 : 0,
  };

  if (!hit) {
    next.current = 0;
    return { state: next, bonusAwarded: 0, thresholdCrossed: null };
  }

  next.current = state.current + 1;
  next.seasonHits = state.seasonHits + 1;

  for (const threshold of POINTS.streakThresholds) {
    if (next.seasonHits >= threshold && !state.thresholdsPaid.includes(threshold)) {
      next.thresholdsPaid = [...state.thresholdsPaid, threshold];
      return { state: next, bonusAwarded: POINTS.streak[threshold] ?? 0, thresholdCrossed: threshold };
    }
  }
  return { state: next, bonusAwarded: 0, thresholdCrossed: null };
}

/* ------------------------------------------------------------ helpers */

function average(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

const round1 = (v: number) => Math.round(v * 10) / 10;
const round2 = (v: number) => Math.round(v * 100) / 100;

/* ------------------------------------------------------------ zone adjacency */

export type ZoneAdjacency = "exact" | "adjacent" | "none";

/** Mirrors the adjacency map table in scoring-rules.md §3 — keep in sync. */
const ADJACENCY: Record<ShotZone, Partial<Record<ShotZone, true>>> = {
  inside_left: { inside_center: true, outside_left: true },
  inside_center: { inside_left: true, inside_right: true, outside_center: true },
  inside_right: { inside_center: true, outside_right: true },
  outside_left: { outside_center: true, inside_left: true },
  outside_center: { outside_left: true, outside_right: true, inside_center: true },
  outside_right: { outside_center: true, inside_right: true },
};

/**
 * "exact" = same zone; "adjacent" = edge-sharing zone per the fixed map
 * (e.g. left-inside is adjacent to center-inside and left-outside, never to
 * right-anything); "none" = wrong zone.
 */
export function zoneAdjacency(predicted: ShotZone, actual: ShotZone): ZoneAdjacency {
  if (predicted === actual) return "exact";
  return ADJACENCY[predicted][actual] ? "adjacent" : "none";
}
