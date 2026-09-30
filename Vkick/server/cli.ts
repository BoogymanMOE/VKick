/**
 * Manual data CLI — the Phase 0 fallback when ESPN's automatic pull fails
 * (or for backfills). Usage:
 *
 *   npm run sync                          # scoreboard sweep + summaries + standings
 *   npm run sync -- sync-match eng.1 401874934
 *   npm run sync -- standings
 *   npm run sync -- understat             # league-wide xG/xPts (the expected tables)
 *   npm run sync -- dev-token 12345       # print a dev auth token (needs DEV_AUTH_SECRET set)
 *   npm run sync -- --dry-run             # fetch + normalize, print, write nothing
 */
import { getDb } from "./db/index.js";
import { fetchScoreboard, fetchSummary } from "./espn/client.js";
import { LEAGUES, LEAGUES_ALL, type LeagueSlug } from "./espn/types.js";
import {
  normalizeScoreboard,
  normalizeSummaryMatch,
  normalizeRosters,
  normalizeTimeline,
  normalizeStandings,
} from "./espn/normalize.js";
import { applyScoreboard, applyStandings } from "./sync/upserts.js";
import { syncMatchSummary } from "./sync/service.js";

const args = process.argv.slice(2);
const db = getDb();
const dryRun = args.includes("--dry-run");
const cmd = args.find((a) => !a.startsWith("--")) ?? "sync-all";

function log(...parts: unknown[]): void {
  console.log(...parts);
}

async function main(): Promise<void> {
  switch (cmd) {
    case "sync-all": {
      for (const league of LEAGUES_ALL) {
        const json = await fetchScoreboard(league);
        if (dryRun) {
          const { matches } = normalizeScoreboard(json, league);
          log(`${league}: ${matches.length} matches`);
          for (const m of matches)
            log(`  ${m.kickoff_at} ${m.home_team_id} vs ${m.away_team_id} [${m.status}]`);
        } else {
          applyScoreboard(db, json, league);
          log(`${league}: scoreboard applied`);
        }
      }
      if (!dryRun) {
        // Summaries for anything live/interesting right now.
        const { syncSummaries } = await import("./sync/service.js");
        const goals = await syncSummaries();
        log(`summaries applied; ${goals.length} new goal(s) detected`);
        log("standings (domestic leagues only — cups have no table)…");
        await standings();
      }
      break;
    }
    case "sync-match": {
      const league = args[args.indexOf("sync-match") + 1] as LeagueSlug;
      const eventId = args[args.indexOf("sync-match") + 2];
      if (!league || !eventId) {
        log("usage: npm run sync -- sync-match <league> <eventId>");
        process.exit(1);
      }
      if (dryRun) {
        const json = await fetchSummary(league, eventId);
        const match = normalizeSummaryMatch(json);
        const { players, stats } = normalizeRosters(json);
        const events = normalizeTimeline(json);
        log("match:", JSON.stringify(match, null, 2));
        log(`players: ${players.length}, stat rows: ${stats.length}, timeline events: ${events.length}`);
        const sample = stats.find((s) => s.goals > 0 || s.assists > 0);
        log("sample stat row:", JSON.stringify(sample ?? stats[0], null, 2));
      } else {
        const goals = await syncMatchSummary(league, eventId);
        log(`summary applied for ${league}/${eventId}; ${goals.length} new goal(s)`);
      }
      break;
    }
    case "standings": {
      await standings();
      break;
    }
    case "rosters": {
      const { syncRosters } = await import("./sync/service.js");
      await syncRosters();
      break;
    }
    case "understat": {
      // League-wide walk only: it is what fills the expected tables, and running
      // it by hand beats waiting for the weekly cron after a fresh database.
      const { syncLeagueUnderstatTables } = await import("./sync/understat.js");
      await syncLeagueUnderstatTables();
      log("understat: league-wide season totals written");
      break;
    }
    case "dev-token": {
      const id = args[args.indexOf("dev-token") + 1];
      if (!id) {
        log("usage: npm run sync -- dev-token <telegramId>");
        process.exit(1);
      }
      const secret = process.env.DEV_AUTH_SECRET;
      if (!secret) {
        log("DEV_AUTH_SECRET is not set — add it to .env first");
        process.exit(1);
      }
      log(`dev token: dev:${id}`);
      break;
    }
    default:
      log(`unknown command: ${cmd}`);
      log(
        "commands: sync-all | sync-match <league> <eventId> | standings | rosters | understat | dev-token <id> [--dry-run]",
      );
      process.exit(1);
  }
}

async function standings(): Promise<void> {
  for (const league of LEAGUES) {
    try {
      const sb = await fetchScoreboard(league);
      const eventId = sb.events?.[0]?.id;
      if (!eventId) {
        log(`${league}: no events, skipping standings`);
        continue;
      }
      const json = await fetchSummary(league, String(eventId));
      if (dryRun) {
        log(`${league}:`, JSON.stringify(normalizeStandings(json).rows.slice(0, 5), null, 2));
      } else {
        const season = json.header?.season?.year
          ? `${json.header.season.year}-${String(json.header.season.year + 1).slice(2)}`
          : `${new Date().getUTCFullYear()}-${String(new Date().getUTCFullYear() + 1).slice(2)}`;
        applyStandings(db, json, league, season);
        log(`${league}: standings applied (${normalizeStandings(json).rows.length} rows)`);
      }
    } catch (err) {
      console.error(`${league}: standings failed:`, String(err));
    }
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
