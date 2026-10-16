/**
 * The running score a goal event happened at.
 *
 * A goal row on its own says "Goal — Cole Palmer" and nothing else; the score
 * it produced is what a fan actually reads the timeline for. The feed carries
 * no per-event score, but it does carry every goal in order with the team that
 * scored it (`timeline_events.team_id`, the same column the goal alerts credit
 * a scorer from — see `queueGoalAlerts`), so the score is a prefix count.
 *
 * Pure and order-dependent on purpose: the API sorts by `minute_seconds ASC`,
 * and the walk credits each goal to whichever side the event names. A goal with
 * no `team_id` (ESPN omits it on some payloads) leaves the tally untouched
 * rather than guessing a side — the timeline is honest about what it knows.
 */

/** The fields the walk reads; `TimelineEvent` satisfies this shape. */
export interface ScoredTimelineEvent {
  id: string;
  type: string;
  teamId: string | null;
}

export interface Score {
  home: number;
  away: number;
}

export interface RunningScore {
  /** Event id → the score as it stood *after* that goal. */
  byGoal: Map<string, Score>;
  /** Goals credited to each side by the walk. */
  home: number;
  away: number;
}

/**
 * Walk a chronological timeline and return the score after each goal.
 * Non-goal events are skipped; every goal gets an entry so the caller can
 * render the score next to it without guessing.
 */
export function runningScore(
  events: ScoredTimelineEvent[],
  homeTeamId: string,
  awayTeamId: string,
): RunningScore {
  const byGoal = new Map<string, Score>();
  let home = 0;
  let away = 0;
  for (const event of events) {
    if (event.type !== "goal") continue;
    if (event.teamId === homeTeamId) home += 1;
    else if (event.teamId === awayTeamId) away += 1;
    byGoal.set(event.id, { home, away });
  }
  return { byGoal, home, away };
}

/** "2–1" — the app's scoreline separator (see the TeamPage fixture rows). */
export function formatScore(score: Score): string {
  return `${score.home}–${score.away}`;
}
