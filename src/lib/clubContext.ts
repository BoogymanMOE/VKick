import type { Match } from "../types";

/**
 * A club's context in the fixture list: live now, else next kickoff, else last result.
 *
 * Lives apart from `components/ClubCard` so that file exports only components —
 * Fast Refresh can't patch a module that also exports plain helpers, and these
 * two are pure data lookups used by the matchday feed as well as the card.
 */
export function clubContext(teamId: string, matches: Match[]) {
  const mine = matches.filter((m) => m.home.id === teamId || m.away.id === teamId);
  const newestFirst = (a: Match, b: Match) => +new Date(b.kickoffAt) - +new Date(a.kickoffAt);
  const soonestFirst = (a: Match, b: Match) => +new Date(a.kickoffAt) - +new Date(b.kickoffAt);
  const live = mine.find((m) => m.status === "live");
  const next = mine.filter((m) => m.status === "scheduled").sort(soonestFirst)[0];
  const last = mine.filter((m) => m.status === "finished").sort(newestFirst)[0];
  return { match: live ?? next ?? last, live, next, last };
}

export function opponentOf(teamId: string, match: Match) {
  return match.home.id === teamId ? match.away : match.home;
}
