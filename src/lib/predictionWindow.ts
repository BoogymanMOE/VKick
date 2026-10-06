/**
 * The prediction-window state machine, in one pure place.
 *
 * The server is the authority (server/routes/predictions.ts owns the lock
 * rules and rejects out-of-window writes), but the UI has to render the same
 * verdicts: which cards are tappable, which lead the list, and whether the
 * sticky "still can pick" CTA is honest. Two components duplicating those
 * rules is how they drift — a gated mechanic opening a beat early, or a card
 * looking live after kickoff when the POST would answer LOCKED_MATCH_STARTED.
 * So both read this helper, and it is unit-tested on its own
 * (tests/predictionWindow.test.ts).
 *
 * Nothing here touches the DOM or the clock: callers pass `now`, which keeps
 * the states deterministic in tests.
 */

export type Mechanic = "lineup" | "shot_predict" | "sub" | "player_watch" | "versus";

export type MatchStatus = "scheduled" | "live" | "halftime" | "finished";

/** One mechanic's window as returned by GET /api/matches/:id/predictions. */
export interface PredictionWindow {
  /** null = no scheduled open time (open as soon as the gate allows). */
  opensAt: string | null;
  lockAt: string;
  /**
   * What the window is waiting on before it can open. `"lineup"` means the
   * official XI must be published; omitted/null means clock-only. The server
   * fills this in so the client is self-describing; when absent we fall back
   * to the canonical gated set below.
   */
  requires?: "lineup" | null;
}

/**
 * Mechanics that cannot open before ESPN publishes the official lineup. The
 * Lineup Predictor is deliberately excluded — predicting the XI before release
 * is its whole point, and it runs on its own 2h-before-kickoff lock.
 */
export const LINEUP_GATED: readonly Mechanic[] = ["sub", "shot_predict", "player_watch", "versus"];

/**
 * Whether this window waits on the official lineup. Prefers the server's
 * self-describing `requires` flag; falls back to the canonical set when the
 * payload predates the flag (or windows are empty).
 */
export function requiresLineup(mechanic: Mechanic, window?: PredictionWindow | null): boolean {
  if (window && window.requires !== undefined) return window.requires === "lineup";
  return LINEUP_GATED.includes(mechanic);
}

/**
 * "How long until this locks", as `Xh Ym`, or null once it has passed. One
 * implementation so the hub and the history page render the same string, and
 * the caller owns the clock (`now`) so it can tick it.
 */
export function formatCountdown(lockAt: string | null | undefined, now: number = Date.now()): string | null {
  if (!lockAt) return null;
  const ms = new Date(lockAt).getTime() - now;
  if (!Number.isFinite(ms) || ms <= 0) return null;
  const hours = Math.floor(ms / 3_600_000);
  const minutes = Math.floor((ms % 3_600_000) / 60_000);
  return `${hours}h ${minutes}m`;
}

export interface OpenContext {
  matchStatus: MatchStatus;
  /** True once the official lineup is out (server: GET lineupPublished). */
  lineupsPublished: boolean;
  /** Injectable clock for tests; defaults to Date.now(). */
  now?: number;
}

/**
 * Whether a mechanic's window is open for writing, mirroring the server:
 *
 *   lineup        scheduled only, until kickoff − 2h
 *   shot/watch/vs scheduled only, until kickoff — AND only once the official
 *                 lineup is published
 *   sub           scheduled (once the lineup is out) or the live first half;
 *                 half-time and full-time close it
 *
 * A `finished` or `halftime` match closes every mechanic. Non-sub mechanics
 * close the instant the match kicks off: the server rejects them with
 * LOCKED_MATCH_STARTED, so a card that still looks tappable in play is a bug.
 */
export function isOpen(
  mechanic: Mechanic,
  window: PredictionWindow | undefined | null,
  ctx: OpenContext,
): boolean {
  const now = ctx.now ?? Date.now();
  const { matchStatus, lineupsPublished } = ctx;

  if (matchStatus === "finished" || matchStatus === "halftime") return false;
  if (requiresLineup(mechanic, window) && !lineupsPublished) return false;

  if (mechanic === "sub") {
    // Live first half: the board stays editable (server: SUB rule).
    if (matchStatus === "live") return true;
    if (matchStatus !== "scheduled") return false;
    // The server clears `opensAt` the moment the XI is published; before that
    // the kickoff-1h proxy applies.
    if (!window?.opensAt) return true;
    return now >= new Date(window.opensAt).getTime();
  }

  // Clock-gated mechanics only run before kickoff.
  if (matchStatus !== "scheduled") return false;
  if (!window) return true;
  // A scheduled open time (the pre-publication clock proxy) still holds; the
  // server clears it to null when the official lineup arrives.
  if (window.opensAt && now < new Date(window.opensAt).getTime()) return false;
  return now < new Date(window.lockAt).getTime();
}
