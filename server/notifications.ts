/**
 * Matchday pushes: what we send, who gets it, and the ONE place the notification
 * preferences are enforced.
 *
 * Two gates, deliberately both (and deliberately here together, because two
 * copies of the same rule drift apart):
 *  - the queue-time gate means an opted-out user never gets a queue row at all,
 *    so the common case costs nothing and the queue stays small;
 *  - the send-time gate catches a preference flipped AFTER a row was queued, or
 *    a row written by some future producer that forgets to gate.
 *
 * Everything takes `db` as an argument rather than closing over `getDb()`, so
 * the producers are testable against a temp database (tests/notifications.test.ts)
 * — including queueGoalAlerts, the path that serves the international favorites
 * shelf as well as the clubs.
 *
 * Followers come from two independent sources, unioned per recipient:
 *  - CLUBS (`favorite_teams`) — one club's fans;
 *  - LEAGUES (`followed_leagues`) — everyone who wants the whole competition,
 *    which the matchday producers attach through `matchRecipients` and the goal
 *    producer through the match's own `league`. A user who follows both a club
 *    and its competition is deduped by telegram id, so a follow list never
 *    doubles a push.
 *
 * Copy is rendered per RECIPIENT from `users.language`, so a user who reads the
 * app in Persian gets Persian pushes (see server/messages.ts for the wording).
 */
import { all, get, type DB } from "./db/index.js";
import {
  asPushLang,
  goalPush,
  halftimePush,
  lineupPush,
  lockPush,
  ratingsPush,
  type PushLang,
} from "./messages.js";
import { lineupPublished } from "./predictions/window.js";

/** Every kind of push the app sends. Also the dedupe stage for matchday pushes. */
export type PushKind = "goal" | "lineup" | "lock" | "halftime" | "ratings";

/**
 * Which Profile switch owns each kind. `deadline` covers the whole prediction
 * lifecycle (the sub board opening on the lineup drop, locking at half-time,
 * everything locking at kickoff) because that is one user intent: "remind me
 * when my picks are about to be locked".
 */
export const PREF_COLUMN: Record<PushKind, "goals" | "deadline" | "ratings"> = {
  goal: "goals",
  lineup: "deadline",
  lock: "deadline",
  halftime: "deadline",
  ratings: "ratings",
};

/** Anything unrecognised (or NULL on a pre-migration row) is a goal alert. */
export function asPushKind(value: unknown): PushKind {
  const v = String(value ?? "");
  return Object.hasOwn(PREF_COLUMN, v) ? (v as PushKind) : "goal";
}

/** One person a push should reach, with the language they read the app in. */
interface PushRecipient {
  telegramId: string;
  lang: PushLang;
}

/**
 * Followers of one club who still want this kind of push. Opt-out is the model
 * (no prefs row = on), which is why the join is LEFT + NULL-tolerant.
 *
 * `column` comes from PREF_COLUMN, never from request input, so the
 * interpolation below cannot carry user data into the SQL.
 *
 * The deliverability filter matters: browser guests (`guest:<device>`),
 * username accounts (`pwd:<name>`) and dev-token users (`dev:<id>`) own rows
 * in `users` and can follow clubs, but no Telegram chat exists behind those
 * ids. Queueing for them was pure waste — in the dev DB every single row ever
 * queued targeted a `guest:` id, burned 5 retries and landed in failed_at.
 * They still get the in-app experience; they simply never enter the queue.
 */
const DELIVERABLE = `
     u.telegram_id NOT LIKE 'guest:%'
 AND u.telegram_id NOT LIKE 'pwd:%'
 AND u.telegram_id NOT LIKE 'dev:%'`;

export function teamFollowers(db: DB, teamId: string, kind: PushKind): PushRecipient[] {
  if (!teamId) return [];
  const column = PREF_COLUMN[kind];
  const rows = all<{ telegram_id: string; language: string }>(
    db,
    `SELECT DISTINCT u.telegram_id, u.language
     FROM users u
     JOIN favorite_teams f ON f.user_id = u.id
     LEFT JOIN user_notification_prefs p ON p.user_id = u.id
     WHERE f.team_id = ? AND (p.user_id IS NULL OR p.${column} = 1)
       AND ${DELIVERABLE}`,
    [teamId],
  );
  return rows.map((r) => ({ telegramId: r.telegram_id, lang: asPushLang(r.language) }));
}

/**
 * Followers of one COMPETITION, with the same opt-out + deliverability gates as
 * teamFollowers. `league` is an ESPN slug (`eng.1`, `uefa.champions`,
 * `fifa.world`) and cups/tournaments are ordinary rows in `followed_leagues`,
 * so a followed cup wakes its followers for its fixtures exactly like a league
 * does — nothing here knows the difference.
 */
export function leagueFollowers(db: DB, league: string, kind: PushKind): PushRecipient[] {
  if (!league) return [];
  const column = PREF_COLUMN[kind];
  const rows = all<{ telegram_id: string; language: string }>(
    db,
    `SELECT DISTINCT u.telegram_id, u.language
     FROM users u
     JOIN followed_leagues f ON f.user_id = u.id
     LEFT JOIN user_notification_prefs p ON p.user_id = u.id
     WHERE f.league = ? AND (p.user_id IS NULL OR p.${column} = 1)
       AND ${DELIVERABLE}`,
    [league],
  );
  return rows.map((r) => ({ telegramId: r.telegram_id, lang: asPushLang(r.language) }));
}

/**
 * Everyone with a claim on a match, deduped by telegram id: followers of EITHER
 * club, plus followers of the COMPETITION the fixture belongs to (any game in a
 * followed league or cup, even one whose clubs the user does not follow). A user
 * who follows both sides — or a club and its league — gets one push.
 *
 * Keyed by telegram id because the language travels with the recipient rather
 * than the fixture.
 */
export function matchRecipients(db: DB, matchId: string, kind: PushKind): PushRecipient[] {
  const m = get<{ home_team_id: string; away_team_id: string; league: string }>(
    db,
    "SELECT home_team_id, away_team_id, league FROM matches WHERE id = ?",
    [matchId],
  );
  if (!m) return [];
  const byId = new Map<string, PushRecipient>();
  for (const r of [
    ...teamFollowers(db, m.home_team_id, kind),
    ...teamFollowers(db, m.away_team_id, kind),
    ...leagueFollowers(db, m.league, kind),
  ]) {
    byId.set(r.telegramId, r);
  }
  return [...byId.values()];
}

/** Queue one push. The bot's drain owns delivery and retries. */
export function enqueuePush(db: DB, telegramId: string, kind: PushKind, text: string): void {
  db.prepare("INSERT INTO bot_push_queue (telegram_id, kind, text, created_at) VALUES (?, ?, ?, ?)").run(
    telegramId,
    kind,
    text,
    new Date().toISOString(),
  );
}

/** One detected goal, normalized by the sync (see sync/upserts.ts). */
export interface GoalAlertInput {
  matchId: string;
  scoringTeamId: string;
  scorerName: string;
  minute: string;
  homeScore: number;
  awayScore: number;
}

/**
 * Fan out goal alerts to every user following the scoring team — club OR
 * national side — plus every follower of the COMPETITION the goal was scored
 * in. The team side filters on team ids only, so an international favorite (a
 * league-less team row favorited from the international picker shelf) is
 * notified exactly like a Premier League one: nothing here knows or cares about
 * the club/international split. The competition side is the "follow a league,
 * hear about its games" promise — a follower of `uefa.champions` is woken by a
 * goal in it even when neither club is theirs, and a user who follows both the
 * league and the scoring club gets exactly one push.
 *
 * The push preferences are enforced at queue time (here) AND at send time
 * (the bot's drain), both through this module: a user with goals=0 never gets
 * a row in bot_push_queue, so the bot cannot send what was never queued, and
 * a toggle flipped after queueing still stops the send. The Profile switch is
 * a real switch, not a cosmetic one.
 *
 * Lives here (not in sync/service.ts) with `db` as an argument per this
 * module's testability rule — the goal path is covered by
 * tests/notifications.test.ts like every other producer.
 */
export function queueGoalAlerts(db: DB, goals: GoalAlertInput[]): number {
  if (goals.length === 0) return 0;
  let queued = 0;
  for (const g of goals) {
    if (!g.scoringTeamId) continue;
    const team = get<{ name: string; short_name: string }>(
      db,
      "SELECT name, short_name FROM teams WHERE id = ?",
      [g.scoringTeamId],
    );
    // The competition the goal belongs to comes from the stored match row, so
    // the producer needs no new field from the sync: a league follower is
    // reached for every fixture the sync files under that slug, cups included.
    const match = get<{ league: string }>(db, "SELECT league FROM matches WHERE id = ?", [g.matchId]);
    // Copy is rendered per recipient so each follower gets their own language,
    // and the missing-team placeholder lives in messages.ts per language.
    const club = team?.short_name ?? team?.name ?? null;
    const score = `${g.homeScore}-${g.awayScore}`;
    // Union + dedupe: a user who follows both the scoring club and its league
    // gets ONE goal alert, not two.
    const byId = new Map<string, PushRecipient>();
    for (const r of [
      ...teamFollowers(db, g.scoringTeamId, "goal"),
      ...leagueFollowers(db, match?.league ?? "", "goal"),
    ]) {
      byId.set(r.telegramId, r);
    }
    for (const r of byId.values()) {
      enqueuePush(
        db,
        r.telegramId,
        "goal",
        goalPush(r.lang, { minute: g.minute, club, scorer: g.scorerName, score }),
      );
      queued++;
    }
  }
  return queued;
}

/** Send-time gate: has this user switched this kind off since it was queued? */
export function isOptedOut(db: DB, telegramId: string, kind: PushKind): boolean {
  const column = PREF_COLUMN[kind];
  const row = get<{ n: number }>(
    db,
    `SELECT COUNT(*) AS n FROM user_notification_prefs p
     JOIN users u ON u.id = p.user_id
     WHERE u.telegram_id = ? AND p.${column} = 0`,
    [telegramId],
  );
  return (row?.n ?? 0) > 0;
}

/**
 * Claim a (user, match, stage) notification, returning false if it was already
 * claimed. This is what stops a per-minute sweep re-sending: without it, a match
 * sitting at "kickoff in 40 minutes" would notify on every single pass.
 * INSERT OR IGNORE + a changes() read makes the claim atomic.
 */
export function claimNotification(db: DB, telegramId: string, matchId: string, stage: string): boolean {
  const res = db
    .prepare(
      `INSERT OR IGNORE INTO match_notifications (telegram_id, match_id, stage, notified_at)
       VALUES (?, ?, ?, ?)`,
    )
    .run(telegramId, matchId, stage, new Date().toISOString());
  return Number(res.changes) > 0;
}

/** The lineup is published around an hour out; treat two as the outer edge. */
const LINEUP_WINDOW_MINUTES = 120;
/** The last call before picks lock at kickoff. */
const LOCK_WINDOW_MINUTES = 45;
/** How long after kickoff a "rate the players" push is still worth sending. */
const RATINGS_WINDOW_HOURS = 6;

interface MatchRow {
  id: string;
  status: string;
  kickoff_at: string;
  home_score: number | null;
  away_score: number | null;
  home_formation: string | null;
  /** Distinct teams with a recorded starter — the fallback half of the gate. */
  starter_teams: number;
  home: string;
  away: string;
}

/**
 * The matchday producer. Runs on the minute loop after the summary pass, so the
 * statuses and formations it reads have just been refreshed from ESPN.
 *
 * Every stage is claimed once per (user, match, stage) — see claimNotification —
 * and each only applies to a match in its window NOW. That second rule is what
 * keeps a first boot sane: a database holding months of historic fixtures must
 * not queue a flood of reminders for matches that finished long ago.
 *
 * Returns how many pushes were queued, for the loop's log line.
 */
export function queueMatchdayAlerts(db: DB, now: Date = new Date()): number {
  const nowMs = now.getTime();
  // One bounded read covers every stage: finished within the ratings window, or
  // kicking off inside the lineup window. Statuses are filtered in SQL too, so
  // the live match set is never scanned twice.
  const matches = all<MatchRow>(
    db,
    `SELECT m.id, m.status, m.kickoff_at, m.home_score, m.away_score, m.home_formation,
            th.short_name AS home, ta.short_name AS away,
            (SELECT COUNT(DISTINCT team_id) FROM match_player_stats
              WHERE match_id = m.id AND started = 1) AS starter_teams
     FROM matches m
     JOIN teams th ON th.id = m.home_team_id
     JOIN teams ta ON ta.id = m.away_team_id
     WHERE m.status IN ('scheduled', 'halftime', 'finished')
       AND m.kickoff_at >= ? AND m.kickoff_at <= ?`,
    [
      new Date(nowMs - RATINGS_WINDOW_HOURS * 3_600_000).toISOString(),
      new Date(nowMs + LINEUP_WINDOW_MINUTES * 60_000).toISOString(),
    ],
  );

  let queued = 0;
  for (const m of matches) {
    const minutesToKickoff = (new Date(m.kickoff_at).getTime() - nowMs) / 60_000;
    const score = `${m.home_score ?? 0}–${m.away_score ?? 0}`;

    if (m.status === "scheduled") {
      // Lineup drop: the formations arrive with the official lineup (~1h out)
      // and that is when the whole gated set opens (sub, shot, watch, versus).
      // The published signal is the SAME one the write gate uses — formation
      // OR both sides having a starter — so a competition that never emits a
      // formation still wakes its followers.
      if (
        lineupPublished(m.home_formation, m.starter_teams ?? 0) &&
        minutesToKickoff > 0 &&
        minutesToKickoff <= LINEUP_WINDOW_MINUTES
      ) {
        queued += emit(db, m.id, "lineup", (lang) => lineupPush(lang, { home: m.home, away: m.away, score }));
      }
      if (minutesToKickoff > 0 && minutesToKickoff <= LOCK_WINDOW_MINUTES) {
        const minutes = Math.max(1, Math.round(minutesToKickoff));
        queued += emit(db, m.id, "lock", (lang) => lockPush(lang, { home: m.home, away: m.away, minutes }));
      }
    } else if (m.status === "halftime") {
      queued += emit(db, m.id, "halftime", (lang) =>
        halftimePush(lang, { home: m.home, away: m.away, score }),
      );
    } else if (m.status === "finished") {
      queued += emit(db, m.id, "ratings", (lang) => ratingsPush(lang, { home: m.home, away: m.away, score }));
    }
  }
  return queued;
}

/**
 * The two-club variant used by every matchday stage. The copy is built per
 * recipient (not once per match) so a Persian and an English follower of the
 * same club each get their own wording.
 */
function emit(db: DB, matchId: string, stage: PushKind, copy: (lang: PushLang) => string): number {
  let sent = 0;
  for (const r of matchRecipients(db, matchId, stage)) {
    if (!claimNotification(db, r.telegramId, matchId, stage)) continue;
    enqueuePush(db, r.telegramId, stage, copy(r.lang));
    sent += 1;
  }
  return sent;
}
