import cron from "node-cron";
import { fetchScoreboard, fetchStandings, fetchSummary, fetchTeamRoster } from "../espn/client.js";
import { LEAGUES, pollWindow, type LeagueSlug } from "../espn/types.js";
import { getDb, all } from "../db/index.js";
import { applyScoreboard, applySummary, applyStandings, applyRoster, type GoalAlert } from "./upserts.js";
import { onMatchFinished } from "../predictions/resolver.js";
import { syncAllFavoriteTeamsUnderstat, syncLeagueUnderstatTables } from "./understat.js";
import { queueGoalAlerts, queueMatchdayAlerts } from "../notifications.js";
import { broadcast } from "../live/sse.js";
// Sentinel: the loop's own failure detector — every pass below records its
// outcome here, and the hourly check turns a dead loop or stale live matches
// into one cooldown-gated alert (console at minimum, Telegram when wired).
import {
  checkAndAlert,
  recordSyncPassFail,
  recordSyncPassOk,
} from "./sentinel.js";

const db = getDb();

/** A live/halftime match whose kickoff is older than this is treated as stuck. */
const STUCK_LIVE_MS = 4 * 3_600_000;

function log(msg: string): void {
  console.log(`[sync ${new Date().toISOString()}] ${msg}`);
}

function datesAroundToday(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10).replace(/-/g, "");
}

/**
 * Poll the scoreboards of all competitions (big five + UEFA cups) across a
 * date window. This is the cheap sweep — one HTTP call per competition.
 */
export async function syncScoreboards(days = 0): Promise<GoalAlert[]> {
  return syncScoreboardWindow(days, days);
}

/**
 * Sweep scoreboards for every day in [back days ago .. forward days ahead].
 * Without a date argument ESPN only serves its default window, so future
 * fixtures beyond it were invisible — users couldn't browse next week's
 * games (or predict them). One call per league per day in the window.
 * Forward window of 21+ days covers international breaks where the next
 * matchday can be 2+ weeks out.
 *
 * The arguments are a CEILING, not the window actually used: each competition
 * clamps them to its own budget (`pollWindow`). The catalog is ~26 competitions
 * now, and walking every one of them across the same 23-day span is how a
 * fixture sweep becomes rate-limiting — the international calendars only need
 * days around a fixed matchday, so they opt out of the long lookahead here.
 */
export async function syncScoreboardWindow(backDays: number, forwardDays: number): Promise<GoalAlert[]> {
  const goals: GoalAlert[] = [];
  for (const league of LEAGUES) {
    const win = pollWindow(league);
    const offsets: number[] = [];
    for (let d = -Math.min(backDays, win.back); d <= Math.min(forwardDays, win.forward); d++) {
      offsets.push(d);
    }
    for (const off of offsets) {
      try {
        const dateArg = off === 0 ? undefined : datesAroundToday(off);
        const json = await fetchScoreboard(league, dateArg);
        applyScoreboard(db, json, league);
        if (off === 0) {
          // Live-summary fan-out only makes sense for today's slate.
          const live = all<{ id: string }>(
            db,
            "SELECT id FROM matches WHERE league = ? AND status = 'live'",
            [league],
          );
          for (const m of live) {
            goals.push(...(await syncMatchSummary(league, m.id)));
          }
        }
      } catch (err) {
        // The manual-override CLI (`npm run sync`) is the fallback when this
        // keeps failing — log loudly and move on to the next league.
        console.error(`[sync] scoreboard ${league} (${off}) FAILED:`, String(err));
      }
    }
  }
  return goals;
}

/**
 * How far ahead fixtures are kept sweepable. The matchday calendar spans
 * today ± 3 months, so its range query needs real fixture rows that far out —
 * the routine 21-day lookahead stops well short of that.
 */
export const FIXTURE_HORIZON_DAYS = 95;

/**
 * The fixture horizon: every day from just past the routine lookahead out to
 * `FIXTURE_HORIZON_DAYS`, so the ± 3-month calendar query returns real games
 * instead of quiet months. Far-future fixtures move rarely (rescheduling
 * clusters within weeks of kickoff), so a DAILY pass is enough upkeep — the
 * 6h window sweep stays narrow and stays the thing that keeps statuses fresh.
 *
 * Load accounting: with the big-five catalog this is ~75 days × 5 leagues ≈
 * 375 scoreboard calls a day, sequential, once daily — deliberately cheaper
 * per sweep than widening the 6h pass would have been.
 */
export async function syncFixtureHorizon(): Promise<GoalAlert[]> {
  const goals: GoalAlert[] = [];
  for (const league of LEAGUES) {
    const win = pollWindow(league);
    const from = Math.max(1, win.forward) + 1;
    for (let off = from; off <= FIXTURE_HORIZON_DAYS; off++) {
      try {
        const json = await fetchScoreboard(league, datesAroundToday(off));
        applyScoreboard(db, json, league);
      } catch (err) {
        // Same contract as syncScoreboardWindow: log loudly, keep walking —
        // one dead day must not strand the rest of the horizon.
        console.error(`[sync] horizon ${league} (${off}) FAILED:`, String(err));
      }
    }
  }
  return goals;
}

/**
 * Matches currently being summarized. The live summary pass and the live pulse
 * BOTH fan out to syncMatchSummary, and each loop has its own overlap guard —
 * so nothing stopped them from working the same match at the same time: a
 * doubled ESPN fetch, and a race on the notified_goals claim that could drop a
 * goal alert mid-match. One shared in-flight set closes both.
 */
const summariesInFlight = new Set<string>();

/**
 * Missed-flip repairs that were attempted but did not change the row (see the
 * scheduled branch in `syncSummaries`). In-memory on purpose — same rule as
 * the rate limiter: this server is one process, and a restart re-trying once
 * immediately is harmless.
 */
const reconcileBackoff = new Map<string, number>();
const RECONCILE_RETRY_MS = 30 * 60_000;

/** Pull the full summary for a single match and store it. */
export async function syncMatchSummary(league: LeagueSlug, matchId: string): Promise<GoalAlert[]> {
  // Already being worked by the other loop; it will return this match's goals.
  if (summariesInFlight.has(matchId)) return [];
  summariesInFlight.add(matchId);
  try {
    const json = await fetchSummary(league, matchId);
    const { match, goals } = applySummary(db, json, league);
    // Settle lineup/shot_plot/sub/versus predictions the moment a match is
    // final (player_watch follows on the hourly sweep after its 24h window).
    if (match.status === "finished") onMatchFinished(match.id);
    return goals;
  } catch (err) {
    console.error(`[sync] summary ${league}/${matchId} FAILED:`, String(err));
    return [];
  } finally {
    summariesInFlight.delete(matchId);
  }
}

/**
 * Summary pass: refresh every match that needs it right now.
 * - live matches: always (this runs every minute from the cron loop)
 * - recent finishers: once more to lock in final stats
 * - upcoming within 3h: once, so lineups/formations appear
 * - past-kickoff fixtures still marked scheduled: the missed-flip repair in the
 *   scheduled branch below
 */
export async function syncSummaries(): Promise<GoalAlert[]> {
  const goals: GoalAlert[] = [];
  const now = Date.now();
  const candidates = all<{
    id: string;
    league: string;
    status: string;
    kickoff_at: string;
    last_synced_at: string | null;
  }>(
    db,
    `SELECT id, league, status, kickoff_at, last_synced_at FROM matches
     WHERE status IN ('live', 'scheduled', 'finished')
     ORDER BY kickoff_at ASC`,
  );
  for (const m of candidates) {
    const kickoff = new Date(m.kickoff_at).getTime();
    const hoursToKickoff = (kickoff - now) / 3_600_000;
    const lastSync = m.last_synced_at ? new Date(m.last_synced_at).getTime() : 0;
    const hoursSinceSync = (now - lastSync) / 3_600_000;

    let should = false;
    if (m.status === "live" || m.status === "halftime") should = true;
    else if (m.status === "finished") {
      // Never-synced finished matches count as fresh (backfill), then settle.
      if (!m.last_synced_at)
        should = hoursToKickoff > -24 * 30; // current season window
      else should = hoursSinceSync > 1 && hoursSinceSync < 26;
    } else if (m.status === "scheduled" && hoursToKickoff < 3 && hoursToKickoff > -0.25) {
      // Inside ~90 min of kickoff ESPN ships the official XI around the hour
      // mark, and the lineup gate opens the shot/watch/versus/sub mechanics at
      // that instant. Polling on the wider 15-min sweep left the gate shut for
      // up to a quarter of an hour after the XI was actually out, so the final
      // stretch runs on its own tighter lane.
      const cadenceHours = hoursToKickoff < 1.5 ? NEAR_KICKOFF_SECONDS / 3_600 : 0.25;
      should = hoursSinceSync > cadenceHours;
    } else if (m.status === "scheduled" && hoursToKickoff <= -0.25 && hoursToKickoff > -24 * 7) {
      // MISSED FLIP: the box was down at kickoff, or ESPN answered with a shape
      // we could not parse, and this fixture would otherwise read "scheduled"
      // forever — every sweep looks forward, nothing ever looks back (measured:
      // 17 international fixtures sat four days past kickoff in that state,
      // rendering as upcoming fixtures with a countdown into the past).
      // One summary retry every 30 min repairs the status, runs the final-whistle
      // settle path for predictions, then stops trying after a week; older rows
      // are left to `npm run sync -- sync-match <league> <id>`.
      //
      // `last_synced_at` only moves when a summary APPLIES, so a fixture ESPN
      // never answers for (cancelled, pruned) would otherwise be re-polled on
      // every 60s pass — the per-match backoff caps that at one call / 30 min.
      const retriedAt = reconcileBackoff.get(m.id) ?? 0;
      should = hoursSinceSync > 0.5 && retriedAt < now;
      if (should) reconcileBackoff.set(m.id, now + RECONCILE_RETRY_MS);
    }

    if (!should) continue;
    goals.push(...(await syncMatchSummary(m.league as LeagueSlug, m.id)));
  }
  return goals;
}

/**
 * Stuck-live reconciliation: a match still marked live/halftime whose kickoff is
 * more than four hours past. The per-minute summary pass already re-fetches
 * every live row, but if ESPN cannot resolve it (or answers with the same stale
 * status) the row never moves. This is the explicit second attempt on the
 * slower 10-minute cadence, so a genuinely finished match settles instead of
 * reading as live forever. The read-time fallback in server/matches/reconcile.ts
 * is what guarantees the API never serves it as live regardless.
 */
export async function reconcileStuckLive(): Promise<number> {
  const cutoff = new Date(Date.now() - STUCK_LIVE_MS).toISOString();
  const stuck = all<{ id: string; league: string }>(
    db,
    `SELECT id, league FROM matches
     WHERE status IN ('live','halftime') AND kickoff_at <= ?`,
    [cutoff],
  );
  let reconciled = 0;
  for (const m of stuck) {
    try {
      const json = await fetchSummary(m.league as LeagueSlug, m.id);
      const { match } = applySummary(db, json, m.league);
      if (match.status === "finished") reconciled += 1;
    } catch (err) {
      console.error(`[sync] stuck-match reconcile ${m.league}/${m.id} FAILED:`, String(err));
    }
  }
  if (reconciled > 0) log(`stuck matches reconciled to finished: ${reconciled}`);
  return reconciled;
}

/**
 * Squad pass: pull the full roster for every club we have stored. ESPN gives
 * no batch endpoint, so this is one call per club — hence weekly (plus a
 * manual `npm run sync -- rosters`), not per-minute.
 *
 * Clubs that only show up in European fixtures have no league of their own, so
 * their competition is inferred from their most recent match (uefa.champions,
 * uefa.europa, uefa.europa.conf, the domestic cups). Without it the Lineup
 * Predictor had no squad to show for exactly the clubs fans bet on in Europe.
 */
export async function syncRosters(): Promise<void> {
  // Only roster big-five clubs: outside leagues are not polled, so no roster
  // endpoint is called for them. Non-big-five teams keep whatever squad data
  // they got from a cup/European fixture summary (if any).
  // SQLite can't reference a SELECT alias (inferred_league) inside WHERE, so
  // the query wraps the rows in a derived table to filter on that alias.
  const teams = all<{ id: string; league: string; inferred_league: string; name: string }>(
    db,
    `SELECT s.id, s.league, s.inferred_league, s.name
     FROM (
       SELECT t.id, t.league, t.name,
              COALESCE((SELECT m.league FROM matches m
                        WHERE m.home_team_id = t.id OR m.away_team_id = t.id
                        ORDER BY m.kickoff_at DESC LIMIT 1), '') AS inferred_league
       FROM teams t
     ) s
     WHERE s.league IN (${LEAGUES.map(() => "?").join(",")})
        OR s.inferred_league IN (${LEAGUES.map(() => "?").join(",")})
     ORDER BY s.name ASC`,
    [...LEAGUES, ...LEAGUES],
  );
  let ok = 0;
  let skipped = 0;
  for (const t of teams) {
    const league = (t.league || t.inferred_league) as LeagueSlug;
    if (!league) {
      skipped += 1;
      console.error(`[sync] roster ${t.name} skipped: no league to query`);
      continue;
    }
    try {
      const json = await fetchTeamRoster(league, t.id);
      applyRoster(db, json, league);
      ok += 1;
    } catch (err) {
      console.error(`[sync] roster ${league}/${t.name} FAILED:`, String(err));
    }
    await new Promise((r) => setTimeout(r, 1_500)); // ~40 calls/min, polite
  }
  log(
    `rosters: ${ok}/${teams.length - skipped} squads refreshed${skipped ? ` (${skipped} skipped, no league)` : ""}`,
  );
}

/**
 * Season standings for every domestic league in the catalog (big five + the
 * wider domestic set) — cups and internationals correctly have no table.
 *
 * Pulls the v2 `/standings` endpoint, one call per league, rather than digging
 * a standings block out of a per-match summary. The summary block omits goals
 * for/against entirely, which is what left every league table's goal-difference
 * column reading zero; v2 carries the full stat set. It is also one request per
 * league instead of a summary fetch, and it doesn't depend on a fixture
 * existing for the league first.
 */
export async function syncStandings(): Promise<void> {
  const season = currentSeason();
  for (const league of LEAGUES) {
    try {
      const json = await fetchStandings(league, seasonStartYear(season));
      applyStandings(db, json, league, season);
      log(`standings ${league}: ok`);
    } catch (err) {
      console.error(`[sync] standings ${league} FAILED:`, String(err));
    }
  }
}

/** "2026-27" -> 2026. ESPN's standings endpoint wants the season START year. */
function seasonStartYear(season: string): number {
  return Number.parseInt(season.slice(0, 4), 10) || new Date().getUTCFullYear();
}

/**
 * Goal-alert fan-out lives in server/notifications.ts (queueGoalAlerts), which
 * takes the db handle as an argument and serves the international favorites
 * shelf exactly like the clubs — the followers query filters on team ids only.
 */
function currentSeason(): string {
  const now = new Date();
  const y = now.getUTCFullYear();
  // European season spans Aug–May; label like 2026-27
  const startYear = now.getUTCMonth() >= 7 ? y : y - 1;
  return `${startYear}-${String(startYear + 1).slice(2)}`;
}

/** Dev/CI escape hatch: SKIP_CRON=1 runs the API without the ESPN sync
 *  loops, so local fixtures (e.g. a match forced `live` for UI work) stay
 *  untouched and ESPN is never queried. */
const cronEnabled = process.env.SKIP_CRON !== "1";

/**
 * How often the summary pass pulls ESPN while matches are live, in seconds.
 * Default 60. This is the HEAVY pass — rosters, player stats, commentary,
 * boxscore — one call per live match. Stats don't change meaningfully faster
 * than this, so there's no reason to hammer ESPN for them. Hard floor 15s.
 * See LIVE_PULSE_SECONDS for the fast lane that moves scores and minutes.
 */
export const LIVE_SUMMARY_SECONDS = (() => {
  const n = parseInt(process.env.LIVE_SUMMARY_SECONDS ?? "", 10);
  if (!Number.isFinite(n)) return 60;
  return Math.min(3600, Math.max(15, n));
})();

/**
 * The fast lane: how often the LIVE PULSE sweeps today's scoreboards, in
 * seconds. One lightweight call per competition carries every match's score,
 * minute and status — the numbers a fan actually watches. Default 15s, floor
 * 10s: 26 competitions at the floor is a brief burst of ~2 calls/sec, which
 * ESPN tolerates, while a sub-10s sweep starts drawing 429s on whole sweeps.
 */
export const LIVE_PULSE_SECONDS = (() => {
  const n = parseInt(process.env.LIVE_PULSE_SECONDS ?? "", 10);
  if (!Number.isFinite(n)) return 15;
  return Math.min(3600, Math.max(10, n));
})();

/**
 * The near-kickoff lane: how often `syncSummaries` re-checks a SCHEDULED match
 * once it is within ~90 min of kickoff, in seconds. Default 150 (~every 2.5
 * min), floor 60. This is a narrow slice of the schedule (a handful of matches
 * at once), so the tighter cadence costs a few extra summary fetches, not a
 * sweep — and it is what lets the official-lineup gate open within minutes of
 * ESPN publishing the XI instead of waiting out the 15-min sweep.
 */
export const NEAR_KICKOFF_SECONDS = (() => {
  const n = parseInt(process.env.NEAR_KICKOFF_SECONDS ?? "", 10);
  if (!Number.isFinite(n)) return 150;
  return Math.min(3600, Math.max(60, n));
})();

/**
 * Overlap guards. cron has no idea a pass overran its tick: a slow ESPN
 * response (>60s) used to stack a second summary pass on the first, doubling
 * the request load exactly when ESPN was already struggling. A boolean per
 * loop makes an overrun skip ticks instead of queueing them.
 */
let started = false;
let summariesRunning = false;
let scoreboardsRunning = false;
let windowRunning = false;
let horizonRunning = false;
let pulseRunning = false;

/** Start the cron loops. Called once from server/index.ts. */
export function startSyncLoop(): void {
  if (started) return;
  started = true;

  // Initial sweep on boot: populate the feed immediately instead of waiting
  // up to 6 hours for the cron window. Covers 1 day back and 21 days forward.
  void syncScoreboardWindow(1, 21).catch((err) => console.error("[sync] initial window sweep error:", err));
  console.log("[sync] triggering initial standings sweep on boot...");
  void syncStandings().catch((err) => console.error("[sync] initial standings sweep error:", err));
  // And the fixture horizon, so a fresh install has the ± 3-month calendar
  // range populated within minutes of boot rather than at the next daily tick.
  horizonRunning = true;
  void syncFixtureHorizon()
    .then(() => recordSyncPassOk())
    .catch((err) => console.error("[sync] initial horizon sweep error:", err))
    .finally(() => {
      horizonRunning = false;
    });

  // The live loop: summary of live matches every LIVE_SUMMARY_SECONDS.
  // A plain interval (not cron) because the cadence is env-configurable and
  // cron's finest useful step granularity doesn't fit arbitrary seconds.
  // The overlap guard makes an overrun skip ticks, so a slow pass under a
  // fast interval degrades gracefully instead of stacking.
  let lastMatchdayRun = 0; // matchday reminders stay on a ~60s cadence
  if (cronEnabled) {
    const liveTimer = setInterval(() => {
      if (summariesRunning) {
        log("summary pass still running — skipping this tick");
        return;
      }
      summariesRunning = true;
      void (async () => {
        try {
          const goals = await syncSummaries();
          queueGoalAlerts(db, goals);
          for (const g of goals) {
            broadcast("update", { matchId: g.matchId, type: "goal" });
          }
          // Matchday reminders read the statuses and formations the summary
          // pass just refreshed — but they only need to run about once a
          // minute even when the live loop is much faster.
          if (Date.now() - lastMatchdayRun >= 60_000) {
            lastMatchdayRun = Date.now();
            const matchday = queueMatchdayAlerts(db);
            if (matchday > 0) log(`matchday pushes queued: ${matchday}`);
          }
          recordSyncPassOk();
        } catch (err) {
          recordSyncPassFail();
          console.error("[sync] live loop error:", err);
        } finally {
          summariesRunning = false;
        }
      })();
    }, LIVE_SUMMARY_SECONDS * 1000);
    // Never keep the process alive just for the loop (tests, CLI reuse).
    liveTimer.unref?.();

    // The LIVE PULSE: today's scoreboards every LIVE_PULSE_SECONDS. One
    // cheap call per competition refreshes score + minute + status for every
    // live match at once — that's what makes the app feel like a live feed.
    // Goal alerts ride here too: between summary passes this loop is the
    // first to notice a new score on the scoreboard.
    const pulseTimer = setInterval(() => {
      if (pulseRunning) return;
      pulseRunning = true;
      void syncScoreboards()
        .then((goals) => {
          queueGoalAlerts(db, goals);
          for (const g of goals) {
            broadcast("update", { matchId: g.matchId, type: "goal" });
          }
          recordSyncPassOk();
        })
        .catch((err) => {
          recordSyncPassFail();
          console.error("[sync] live pulse error:", err);
        })
        .finally(() => {
          pulseRunning = false;
        });
    }, LIVE_PULSE_SECONDS * 1000);
    pulseTimer.unref?.();
  } else {
    log("SKIP_CRON=1 — live sync loops disabled (dev fixtures stay untouched)");
  }

  // Every 10 minutes: scoreboard sweep for all leagues (catches new fixtures,
  // status flips that the live pass misses).
  cron.schedule("*/10 * * * *", () => {
    if (scoreboardsRunning) {
      log("scoreboard pass still running — skipping this tick");
      return;
    }
    scoreboardsRunning = true;
    void syncScoreboards()
      .then(() => reconcileStuckLive())
      .then(() => recordSyncPassOk())
      .catch((err) => {
        recordSyncPassFail();
        console.error("[sync] scoreboard loop error:", err);
      })
      .finally(() => {
        scoreboardsRunning = false;
      });
  });

  // Daily: standings refresh.
  const hour = parseInt(process.env.SYNC_DAILY_HOUR ?? "4", 10);
  cron.schedule(`0 ${hour} * * *`, () => {
    void syncStandings().catch((err) => console.error("[sync] standings loop error:", err));
  });

  // Daily, a little after the standings tick: the fixture horizon, so the
  // ± 3-month calendar range keeps real games far beyond the 21-day window
  // sweep. Its own overlap guard + its own hour keeps one slow ESPN stretch
  // from colliding with anything else.
  cron.schedule(`50 ${hour} * * *`, () => {
    if (horizonRunning) {
      log("horizon pass still running — skipping this tick");
      return;
    }
    horizonRunning = true;
    void syncFixtureHorizon()
      .then(() => recordSyncPassOk())
      .catch((err) => {
        recordSyncPassFail();
        console.error("[sync] horizon loop error:", err);
      })
      .finally(() => {
        horizonRunning = false;
      });
  });

  // Every 6h: fixture window sweep so future fixtures exist for browsing and
  // predicting before they enter ESPN's default window. The 21-day lookahead
  // covers international breaks where the next matchday is 2+ weeks out — but
  // each competition clamps it to its own budget (see `pollWindow`), because the
  // catalog's long tail does not need 23 days of requests per sweep.
  cron.schedule("15 */6 * * *", () => {
    if (windowRunning) {
      log("window pass still running — skipping this tick");
      return;
    }
    windowRunning = true;
    void syncScoreboardWindow(1, 21)
      .then(() => recordSyncPassOk())
      .catch((err) => {
        recordSyncPassFail();
        console.error("[sync] window loop error:", err);
      })
      .finally(() => {
        windowRunning = false;
      });
  });

  // Weekly: full squads (one ESPN call per club — keep it slow on purpose).
  // Moved to 4:30am to avoid overlap with Understat at 5am.
  cron.schedule("30 4 * * 2", () => {
    void syncRosters().catch((err) => console.error("[sync] roster loop error:", err));
  });

  // Hourly: the staleness heartbeat. A dead loop or live matches far past
  // their sync window is the one failure the app's users FEEL and no error
  // SURFACE shows — this turns it into a message (Telegram when ALERT_CHAT_ID
  // and the bot token are both set, the server log otherwise), water-falled to
  // at most one alert per cooldown inside checkAndAlert.
  cron.schedule("5 * * * *", () => {
    const chatId = (process.env.ALERT_CHAT_ID ?? "").trim();
    try {
      const check = checkAndAlert(db, (text) => {
        console.error(`[sentinel] ALERT: ${text}`);
        if (!chatId) return;
        void (async () => {
          try {
            const { getBot } = await import("../bot/index.js");
            const b = getBot();
            if (b) await b.api.sendMessage(chatId, text);
          } catch (err) {
            console.error("[sentinel] telegram alert failed:", String(err).slice(0, 120));
          }
        })();
      });
      if (check.problem && !check.alerted) log(`sentinel (cooldown) — ${check.problem}`);
    } catch (err) {
      console.error("[sentinel] check failed:", String(err).slice(0, 200));
    }
  });

  // Weekly: Understat xG/xA/shot situations per favorite team.
  // Runs at 5am UTC Tuesday — after weekend matches have settled.
  cron.schedule("0 5 * * 2", async () => {
    console.log("[cron] understat weekly sync starting");
    try {
      // League-wide first: it seeds the season totals for every side in the big
      // five (the expected tables), then the per-club walk fills in players and
      // shot situations for the followed clubs on top.
      await syncLeagueUnderstatTables();
      await syncAllFavoriteTeamsUnderstat();
      console.log("[cron] understat weekly sync complete");
    } catch (err) {
      console.error("[cron] understat sync failed:", err);
    }
  });

  log(
    `loops started (live pulse ${LIVE_PULSE_SECONDS}s, summaries ${LIVE_SUMMARY_SECONDS}s, near-kickoff ${NEAR_KICKOFF_SECONDS}s, scoreboards 10m, window 6h per-competition, standings daily @${hour}:00, rosters weekly, understat weekly)`,
  );
}
