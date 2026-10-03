/**
 * The matchday feed's SQL window — extracted from the route so it can be
 * tested against a real SQLite file instead of only being exercised through
 * HTTP.
 *
 * Why this exists: the feed used to be `ORDER BY kickoff_at ASC LIMIT 300`.
 * That is not a relevance ordering, it's "the oldest 300 rows in the table" —
 * fine on day one, and progressively worse as history accumulates. Once the
 * table outgrew the cap the nearest fixtures were being dropped entirely and
 * the top of the feed was two-year-old internationals.
 *
 * What the matchday screen actually wants is a WINDOW:
 *   - anything in progress right now (live or half-time), unconditionally;
 *   - recent finished results, because the club rows fall back to "last
 *     result" when a club has no live or upcoming fixture;
 *   - the next fortnight of fixtures, which is the whole point of the screen.
 *
 * The client still splits the response into live / upcoming / finished
 * sections itself, so this only decides WHICH matches are eligible.
 */

/** Finished results stay eligible this many days back (inclusive). */
export const FINISHED_LOOKBACK_DAYS = 3;
/** Upcoming fixtures stay eligible this many days ahead (inclusive). */
export const UPCOMING_LOOKAHEAD_DAYS = 14;
/** Default cap on the window. Generous enough for a fortnight of the catalog. */
export const FEED_LIMIT = 300;

/** Statuses that mean "in progress right now" — always inside the window. */
const IN_PROGRESS = ["live", "halftime"];

export interface FeedQuery {
  league?: string | null;
  /** Exact day, YYYY-MM-DD. Wins over the window when set. */
  date?: string | null;
  /** Inclusive lower bound, YYYY-MM-DD. */
  from?: string | null;
  /** Inclusive upper bound, YYYY-MM-DD. */
  to?: string | null;
  limit?: number | string | null;
  /** Injectable clock so tests are deterministic. */
  now?: Date;
}

export interface FeedSql {
  /** The WHERE clause, parameters applied in order. */
  where: string;
  params: Array<string | number>;
  /** The ORDER BY tail, describing the ordering chosen. */
  orderBy: string;
  limit: number;
  /** Which shape was used — useful for tests and for logging. */
  mode: "range" | "day" | "window" | "all";
  /** The resolved past/future cutoffs (null unless mode === "window"). */
  past: string | null;
  future: string | null;
}

/** `YYYY-MM-DD` for `days` away from `now` (UTC). */
export function isoDayOffset(now: Date, days: number): string {
  const d = new Date(now.getTime());
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** First 10 chars of an ISO timestamp — the day key matches are stored under. */
function dayOf(iso: string): string {
  return iso.slice(0, 10);
}

function clampLimit(raw: number | string | null | undefined): number {
  const n = Number.parseInt(String(raw ?? ""), 10);
  if (!Number.isFinite(n) || n <= 0) return FEED_LIMIT;
  return Math.min(500, n);
}

/**
 * Live first, then the next fixtures soonest-first, then results newest-first.
 * The client re-sorts within each section (favorites float up), so this exists
 * to make the RAW response sensible — a live match must never be buried under
 * 300 rows of finished football.
 */
const FEED_ORDER = `
       CASE m.status WHEN 'live' THEN 0 WHEN 'halftime' THEN 0 WHEN 'scheduled' THEN 1 ELSE 2 END,
       CASE WHEN m.status = 'finished' THEN m.kickoff_at END DESC,
       m.kickoff_at ASC`;

/**
 * Build the WHERE clause + params + ordering for the feed.
 *
 * Precedence: an explicit `from` AND `to` is an inclusive range; a single `date`
 * is one day; otherwise the relevance window applies. `league` always composes.
 */
export function buildFeedQuery(q: FeedQuery = {}): FeedSql {
  const clauses: string[] = ["1=1"];
  const params: Array<string | number> = [];
  const limit = clampLimit(q.limit);

  if (q.league) {
    clauses.push("m.league = ?");
    params.push(q.league);
  }

  const from = q.from ? dayOf(q.from) : null;
  const to = q.to ? dayOf(q.to) : null;
  const date = q.date ? dayOf(q.date) : null;

  if (from && to) {
    // Explicit range, inclusive of both end days. Deliberately ignores status:
    // "show me this week's fixtures" should not filter by whether they are done.
    clauses.push("substr(m.kickoff_at, 1, 10) BETWEEN ? AND ?");
    params.push(from, to);
    return { where: clauses.join(" AND "), params, orderBy: FEED_ORDER, limit, mode: "range", past: null, future: null };
  }

  if (date) {
    // One specific day, whatever its status.
    clauses.push("substr(m.kickoff_at, 1, 10) = ?");
    params.push(date);
    return { where: clauses.join(" AND "), params, orderBy: FEED_ORDER, limit, mode: "day", past: null, future: null };
  }

  // Relevance window. `from`/`to` each pin their own end when given alone.
  const now = q.now ?? new Date();
  const past = from ?? isoDayOffset(now, -FINISHED_LOOKBACK_DAYS);
  const future = to ?? isoDayOffset(now, UPCOMING_LOOKAHEAD_DAYS);
  const placeholders = IN_PROGRESS.map(() => "?").join(", ");
  clauses.push(`(
      m.status IN (${placeholders})
      OR (m.status = 'finished' AND substr(m.kickoff_at, 1, 10) >= ?)
      OR (m.status = 'scheduled' AND substr(m.kickoff_at, 1, 10) <= ?)
    )`);
  params.push(...IN_PROGRESS, past, future);
  return { where: clauses.join(" AND "), params, orderBy: FEED_ORDER, limit, mode: "window", past, future };
}