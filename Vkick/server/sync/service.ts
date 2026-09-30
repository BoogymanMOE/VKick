import cron from "node-cron";
import { fetchScoreboard, fetchSummary, fetchTeamRoster } from "../espn/client.js";
import { LEAGUES_ALL, LEAGUES, pollWindow, type LeagueSlug } from "../espn/types.js";
import { getDb, all, get } from "../db/index.js";
import { applyScoreboard, applySummary, applyStandings, applyRoster, type GoalAlert } from "./upserts.js";
import { onMatchFinished } from "../predictions/resolver.js";
import { syncAllFavoriteTeamsUnderstat, syncLeagueUnderstatTables } from "./understat.js";
import { enqueuePush, queueMatchdayAlerts, teamFollowers } from "../notifications.js";
import { goalPush } from "../messages.js";

const db = getDb();

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
  for (const league of LEAGUES_ALL) {
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
    log(`scoreboard ${league}: window ok`);
  }
  return goals;
}

/** Pull the full summary for a single match and store it. */
export async function syncMatchSummary(league: LeagueSlug, matchId: string): Promise<GoalAlert[]> {
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
  }
}

/**
 * Summary pass: refresh every match that needs it right now.
 * - live matches: always (this runs every minute from the cron loop)
 * - recent finishers: once more to lock in final stats
 * - upcoming within 3h: once, so lineups/formations appear
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
    } else if (m.status === "scheduled" && hoursToKickoff < 3 && hoursToKickoff > -0.25)
      should = hoursSinceSync > 0.25;

    if (!should) continue;
    goals.push(...(await syncMatchSummary(m.league as LeagueSlug, m.id)));
  }
  return goals;
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
  const teams = all<{ id: string; league: string; inferred_league: string; name: string }>(
    db,
    `SELECT t.id, t.league, t.name,
            COALESCE((SELECT m.league FROM matches m
                      WHERE m.home_team_id = t.id OR m.away_team_id = t.id
                      ORDER BY m.kickoff_at DESC LIMIT 1), '') AS inferred_league
     FROM teams t
     ORDER BY t.name ASC`,
  );
  let ok = 0;
  let skipped = 0;
  // Chunked with pauses: ~100 clubs x 1 call each in one tight loop looked
  // like an attack to ESPN's rate limiter and got syncs killed mid-run.
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

/** Season standings for the big five domestic leagues (cups have no table). */
export async function syncStandings(): Promise<void> {
  for (const league of LEAGUES) {
    try {
      const json = await fetchSummary(league, await firstEventId(league));
      applyStandings(db, json, league, currentSeason());
      log(`standings ${league}: ok`);
    } catch (err) {
      console.error(`[sync] standings ${league} FAILED:`, String(err));
    }
  }
}

async function firstEventId(league: LeagueSlug): Promise<string> {
  const row = get<{ id: string }>(
    db,
    "SELECT id FROM matches WHERE league = ? ORDER BY kickoff_at DESC LIMIT 1",
    [league],
  );
  if (row) return row.id;
  const json = await fetchScoreboard(league);
  const ev = json.events?.[0];
  if (!ev) throw new Error(`no events for ${league}`);
  return String(ev.id);
}

function currentSeason(): string {
  const now = new Date();
  const y = now.getUTCFullYear();
  // European season spans Aug–May; label like 2026-27
  const startYear = now.getUTCMonth() >= 7 ? y : y - 1;
  return `${startYear}-${String(startYear + 1).slice(2)}`;
}

/**
 * Fan out goal alerts to every user following the scoring club. The push
 * preferences are enforced at queue time (here) AND at send time (the bot's
 * drain), both through server/notifications.ts: a user with goals=0 never gets
 * a row in bot_push_queue, so the bot cannot send what was never queued, and a
 * toggle flipped after queueing still stops the send. The Profile switch is a
 * real switch, not a cosmetic one.
 */
export function queueGoalAlerts(goals: GoalAlert[]): number {
  if (goals.length === 0) return 0;
  let queued = 0;
  for (const g of goals) {
    if (!g.scoringTeamId) continue;
    const team = get<{ name: string; short_name: string }>(
      db,
      "SELECT name, short_name FROM teams WHERE id = ?",
      [g.scoringTeamId],
    );
    // Copy is rendered per recipient so each follower gets their own language,
    // and the missing-club placeholder lives in messages.ts per language.
    const club = team?.short_name ?? team?.name ?? null;
    const score = `${g.homeScore}-${g.awayScore}`;
    for (const r of teamFollowers(db, g.scoringTeamId, "goal")) {
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

let started = false;

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
 * Overlap guards. cron has no idea a pass overran its tick: a slow ESPN
 * response (>60s) used to stack a second summary pass on the first, doubling
 * the request load exactly when ESPN was already struggling. A boolean per
 * loop makes an overrun skip ticks instead of queueing them.
 */
let summariesRunning = false;
let scoreboardsRunning = false;
let windowRunning = false;
let pulseRunning = false;

/** Start the cron loops. Called once from server/index.ts. */
export function startSyncLoop(): void {
  if (started) return;
  started = true;

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
          queueGoalAlerts(goals);
          // Matchday reminders read the statuses and formations the summary
          // pass just refreshed — but they only need to run about once a
          // minute even when the live loop is much faster.
          if (Date.now() - lastMatchdayRun >= 60_000) {
            lastMatchdayRun = Date.now();
            const matchday = queueMatchdayAlerts(db);
            if (matchday > 0) log(`matchday pushes queued: ${matchday}`);
          }
        } catch (err) {
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
        .then((goals) => queueGoalAlerts(goals))
        .catch((err) => console.error("[sync] live pulse error:", err))
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
      .catch((err) => console.error("[sync] scoreboard loop error:", err))
      .finally(() => {
        scoreboardsRunning = false;
      });
  });

  // Daily: standings refresh.
  const hour = parseInt(process.env.SYNC_DAILY_HOUR ?? "4", 10);
  cron.schedule(`0 ${hour} * * *`, () => {
    void syncStandings().catch((err) => console.error("[sync] standings loop error:", err));
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
      .catch((err) => console.error("[sync] window loop error:", err))
      .finally(() => {
        windowRunning = false;
      });
  });

  // Weekly: full squads (one ESPN call per club — keep it slow on purpose).
  // Moved to 4:30am to avoid overlap with Understat at 5am.
  cron.schedule("30 4 * * 2", () => {
    void syncRosters().catch((err) => console.error("[sync] roster loop error:", err));
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
    `loops started (live pulse ${LIVE_PULSE_SECONDS}s, summaries ${LIVE_SUMMARY_SECONDS}s, scoreboards 10m, window 6h per-competition, standings daily @${hour}:00, rosters weekly, understat weekly)`,
  );
}
