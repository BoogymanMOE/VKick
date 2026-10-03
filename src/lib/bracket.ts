/**
 * Cup bracket inference, pure and DOM-free so the node runner can pin it.
 *
 * The sync carries a round label on every cup match ("Quarter-final"). That is
 * enough to rebuild the tournament's shape — which pairings exist per round,
 * who advanced (aggregate across legs for two-legged ties), and which pairing
 * fed which — without any extra endpoint. What it can NOT tell us stays
 * unknown on purpose: penalty shootouts, away-goals ties and abandonments all
 * resolve to "undecided" rather than a guess.
 *
 * Live matches are excluded by the caller before this runs (the Cups page
 * surfaces them once, in the live section) — mirroring the old byRound map.
 */
import type { Match } from "../types";

/** One pairing inside a round — a tie, possibly over two legs. */
export interface BracketTie {
  /** Stable key: `"<round>|<smaller team id>|<larger team id>"`. */
  key: string;
  /** The round label this tie belongs to. */
  round: string;
  /** First-leg orientation (by kickoff); aggregate counts by team id. */
  homeId: string;
  awayId: string;
  homeName: string;
  awayName: string;
  /** Matches in this tie, kickoff order (length 1 for single-leg). */
  legs: Match[];
  /** Goals across finished legs, oriented home/away of the first leg. */
  aggHome: number | null;
  aggAway: number | null;
  /** Inferred advancing team — null while any leg is open, level or unscored. */
  winnerId: string | null;
  winnerName: string | null;
  /** Tie keys of earlier rounds this tie's participants advanced from. */
  feeds: string[];
  /** Round label of the nearest feeder, for the "← Round of 16" caption. */
  feedRound: string | null;
}

export interface BracketRound {
  label: string;
  ties: BracketTie[];
}

export interface Bracket {
  /** Bracket play order: early rounds first, the Final last. */
  rounds: BracketRound[];
  /** True when some tie beyond the first traces back to an earlier round. */
  connected: boolean;
}

/**
 * Bracket order for round headings: Final last, semis before it, then the
 * earlier rounds. Ties fall back to alphabetical so any unexpected label
 * still groups deterministically. (Moved verbatim from the Cups page so the
 * page and the bracket builder can never disagree on an ordering.)
 */
export function roundRank(label: string): number {
  const l = label.toLowerCase();
  // Order matters: "quarter-final" and "semi-final" both contain "final".
  if (l.includes("semi")) return 1;
  if (l.includes("quarter")) return 2;
  if (l.includes("final") && !l.includes("qual")) return 0;
  const n = parseInt(l.match(/(?:round of|round)\s*(\d+)$/)?.[1] ?? "", 10);
  if (!Number.isNaN(n)) return 2 + n; // Round of 16 → 18, of 32 → 34…
  if (l.includes("round")) return 40; // unnumbered rounds after the numbered ones
  if (l.includes("qual") || l.includes("play")) return 60; // qualifying last
  return 50;
}

/** Round labels in the order the cup is played (early rounds first). */
export function orderRounds(labels: Iterable<string>): string[] {
  return [...labels].sort((a, b) => roundRank(b) - roundRank(a) || a.localeCompare(b));
}

function pairKey(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

/**
 * Build the bracket from one competition's matches (live excluded upstream).
 * Legs of the same tie — ESPN lists two-legged knockout rounds as two separate
 * matches with the same pair — fold into one tie with an aggregate.
 */
export function buildBracket(matches: Match[]): Bracket {
  // Round → (unordered pair → legs), preserving first-seen order; kickoff
  // sorting below makes it deterministic regardless of fetch order.
  const byRound = new Map<string, Map<string, Match[]>>();
  for (const m of matches) {
    const round = m.round?.trim();
    if (!round || m.status === "live") continue;
    let pairs = byRound.get(round);
    if (!pairs) {
      pairs = new Map();
      byRound.set(round, pairs);
    }
    const key = pairKey(m.home.id, m.away.id);
    const legs = pairs.get(key);
    if (legs) legs.push(m);
    else pairs.set(key, [m]);
  }

  const rounds: BracketRound[] = orderRounds(byRound.keys()).map((label) => {
    const pairs = byRound.get(label)!;
    const ties = [...pairs.values()]
      .map((legs) => legs.sort((a, b) => a.kickoffAt.localeCompare(b.kickoffAt)))
      .sort((a, b) => a[0].kickoffAt.localeCompare(b[0].kickoffAt))
      .map((legs) => makeTie(label, legs));
    return { label, ties };
  });

  // Connectivity: for each tie, trace every participant back through earlier
  // rounds to the nearest tie it won. Missing intermediate rounds (partial
  // sync windows) don't break the chain — the nearest win is the honest
 // feeder we can show.
  const winIndex: Array<Map<string, BracketTie>> = [];
  for (const round of rounds) {
    const winners = new Map<string, BracketTie>();
    for (const tie of round.ties) {
      if (tie.winnerId) winners.set(tie.winnerId, tie);
    }
    winIndex.push(winners);
  }

  let connected = false;
  rounds.forEach((round, i) => {
    for (const tie of round.ties) {
      const feeds: string[] = [];
      let feedRound: string | null = null;
      for (const teamId of [tie.homeId, tie.awayId]) {
        // Search backwards: nearest round where this team won a tie.
        for (let j = i - 1; j >= 0; j -= 1) {
          const feeder = winIndex[j]?.get(teamId);
          if (feeder && feeder.key !== tie.key) {
            if (!feeds.includes(feeder.key)) feeds.push(feeder.key);
            feedRound = feedRound ?? rounds[j].label;
            break;
          }
        }
      }
      tie.feeds = feeds;
      tie.feedRound = feedRound;
      if (feeds.length > 0) connected = true;
    }
  });

  return { rounds, connected };
}

function makeTie(round: string, legs: Match[]): BracketTie {
  const first = legs[0];
  const homeId = first.home.id;
  const awayId = first.away.id;
  // Aggregate across finished, scored legs — by team id, then re-oriented to
  // the first leg, because the second leg swaps venues.
  let homeGoals = 0;
  let awayGoals = 0;
  let scored = false;
  for (const leg of legs) {
    if (leg.status !== "finished" || leg.homeScore == null || leg.awayScore == null) continue;
    scored = true;
    if (leg.home.id === homeId) {
      homeGoals += leg.homeScore;
      awayGoals += leg.awayScore;
    } else {
      homeGoals += leg.awayScore;
      awayGoals += leg.homeScore;
    }
  }
  const aggHome = scored ? homeGoals : null;
  const aggAway = scored ? awayGoals : null;

  let winnerId: string | null = null;
  if (scored && legs.every((leg) => leg.status === "finished")) {
    if (aggHome! > aggAway!) winnerId = homeId;
    else if (aggAway! > aggHome!) winnerId = awayId;
    // Level aggregate: penalties/away-goals decided it, and we don't know how.
  }

  const winner = winnerId
    ? (legs.find((leg) => leg.home.id === winnerId)?.home ??
      legs.find((leg) => leg.away.id === winnerId)?.away)
    : undefined;

  return {
    key: `${round}|${pairKey(homeId, awayId)}`,
    round,
    homeId,
    awayId,
    homeName: first.home.shortName,
    awayName: first.away.shortName,
    legs,
    aggHome,
    aggAway,
    winnerId,
    winnerName: winner?.shortName ?? null,
    feeds: [],
    feedRound: null,
  };
}
