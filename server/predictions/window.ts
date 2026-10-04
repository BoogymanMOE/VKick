/**
 * The per-mechanic open/lock windows, as pure functions.
 *
 * These used to live inside routes/predictions.ts. They moved here so the
 * prediction write path AND the history read path (`GET /api/me/predictions`)
 * build windows from one definition — the history page now surfaces the same
 * open/locked state the hub renders, and it cannot drift from what the POST
 * gate enforces. No database handle here: callers supply the match facts.
 */

/** Mechanics that only open once ESPN's official lineup is out. */
export const LINEUP_GATED = ["sub", "shot_predict", "player_watch", "versus"] as const;

export type GatedMechanic = (typeof LINEUP_GATED)[number];

export function isLineupGated(mechanic: string): mechanic is GatedMechanic {
  return (LINEUP_GATED as readonly string[]).includes(mechanic);
}

export interface LockWindow {
  opensAt: string | null;
  lockAt: string;
}

/**
 * Per-mechanic lock windows, relative to kickoff (`prediction-mechanics.md`).
 * The old single gameweek deadline is gone.
 *
 *   lineup:       2h before kickoff (deliberately earlier than ESPN's ~1h release)
 *   shot_predict: kickoff
 *   player_watch: kickoff
 *   versus:       kickoff
 *   sub:          handled separately — opens at lineup, locks at half-time
 */
export function lockWindowFor(mechanic: string, kickoffAt: string): LockWindow {
  const kickoff = new Date(kickoffAt).getTime();
  if (mechanic === "lineup") {
    return { opensAt: null, lockAt: new Date(kickoff - 2 * 3_600_000).toISOString() };
  }
  if (mechanic === "sub") {
    // Opens when the official lineup drops (~1h before kickoff per ESPN); the
    // half-time lock is enforced by status, not by wall-clock.
    return {
      opensAt: new Date(kickoff - 3_600_000).toISOString(),
      lockAt: new Date(kickoff + 60 * 60_000).toISOString(),
    };
  }
  return { opensAt: new Date(kickoff - 3_600_000).toISOString(), lockAt: new Date(kickoff).toISOString() };
}

/**
 * Whether the official lineup is out. Primary signal is `home_formation` (set
 * by the summary sync when ESPN ships the XI). Fallback: some competitions
 * send the XI in `match_player_stats` without a formation string, so both
 * sides having a starter counts as published — otherwise those leagues would
 * strand the gated mechanics forever.
 */
export function lineupPublished(homeFormation: string | null | undefined, starterTeams: number): boolean {
  return Boolean(homeFormation) || starterTeams >= 2;
}

/** A window plus the reason it is (or isn't) open. Self-describing for the UI. */
export interface PredictionWindow extends LockWindow {
  requires: "lineup" | null;
}

/**
 * Build the wire-shape window for one mechanic. Once the official lineup is
 * published, gated mechanics have no scheduled open time (`opensAt: null`) —
 * they open now, rather than waiting on the kickoff-1h clock proxy.
 */
export function windowFor(mechanic: string, kickoffAt: string, published: boolean): PredictionWindow {
  const w = lockWindowFor(mechanic, kickoffAt);
  const gated = isLineupGated(mechanic);
  return {
    ...w,
    ...(gated && published ? { opensAt: null } : {}),
    requires: gated ? "lineup" : null,
  };
}
