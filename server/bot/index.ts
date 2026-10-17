import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Bot, InlineKeyboard, InputFile } from "grammy";
import { getDb, all, run, get } from "../db/index.js";
import { asPushKind, isOptedOut, shouldSkipPredictionPush, shouldSkipRatingsPush } from "../notifications.js";
import {
  asPushLang,
  botCommandMenu,
  botNoAccountText,
  botNoTeamsText,
  botPageCopy,
  botStartText,
  botTeamsHeader,
  type BotPage,
  type PushLang,
} from "../messages.js";
import { predictionsEnabled } from "../features.js";
import type { GoalAlert } from "../sync/upserts.js";

let bot: Bot | null = null;
let drainTimer: NodeJS.Timeout | null = null;

export function getBot(): Bot | null {
  return bot;
}

// Brand icon sent as the /start photo — Telegram inline buttons can't carry
// images, so the button rides on the photo's reply markup instead.
const TELEGRAM_ICON = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "public",
  "telegram-icon.png",
);

/*
 * The Mini App screens behind the command menu, in menu order. The names are
 * deliberately the same ones the app uses for its routes (/matches,
 * /profile, /leaderboards) and for the commands themselves, so the command
 * list, the deep links and the router cannot disagree about where a button
 * lands.
 */
/**
 * The deep-link pages behind the command menu, in menu order. A function, not a
 * constant: the leaderboards screen is a prediction surface, so the list has to
 * follow the flag rather than the moment this module was imported.
 */
function botPages(): BotPage[] {
  return predictionsEnabled() ? ["matches", "profile", "leaderboards"] : ["matches", "profile"];
}

/**
 * Every command handler, registered on a bot that is not polling yet.
 *
 * Kept separate from startBot so a test can register the handlers on a bot of
 * its own and dispatch a real update through grammy for real — command
 * parsing, middleware, the lot. The menu is only worth having if the button it
 * sends actually carries the deep link, and only grammy can settle that.
 */
export function registerHandlers(bot: Bot): void {
  bot.command("start", async (ctx) => {
    const from = ctx.from;
    let lang: "en" | "fa" = "en";
    if (from) {
      const db = getDb();
      const existing = get<{ id: number; language: string | null }>(
        db,
        "SELECT id, language FROM users WHERE telegram_id = ?",
        [String(from.id)],
      );
      if (!existing) {
        const name =
          [from.first_name, from.last_name].filter(Boolean).join(" ") || from.username || `User ${from.id}`;
        run(db, "INSERT INTO users (telegram_id, display_name, created_at) VALUES (?, ?, ?)", [
          String(from.id),
          name,
          new Date().toISOString(),
        ]);
      } else {
        // A returning user gets the language they chose in the app.
        lang = asPushLang(existing.language);
      }
    }
    const keyboard = new InlineKeyboard().webApp("⚽ Open Vkick", webAppUrl());
    let icon: Buffer | null = null;
    try {
      icon = fs.readFileSync(TELEGRAM_ICON);
    } catch {
      // Icon not shipped/found: the text-only welcome still works.
    }
    const text = botStartText(lang);
    if (icon) {
      await ctx.replyWithPhoto(new InputFile(icon, "telegram-icon.png"), {
        caption: text,
        reply_markup: keyboard,
      });
    } else {
      await ctx.reply(text, { reply_markup: keyboard });
    }
  });

  // Command-menu entries. Each one answers with a single button that opens the
  // Mini App straight on that screen: tapping /matches in Telegram's menu and
  // landing on the feed instead would make the menu worse than useless.
  for (const page of botPages()) {
    bot.command(page, async (ctx) => {
      const copy = botPageCopy(userLang(ctx.from?.id), page);
      await ctx.reply(copy.text, {
        reply_markup: new InlineKeyboard().webApp(copy.button, deepLink(page)),
      });
    });
  }

  bot.command("myteams", async (ctx) => {
    if (!ctx.from) return;
    const db = getDb();
    const user = get<{ id: number; language: string | null }>(
      db,
      "SELECT id, language FROM users WHERE telegram_id = ?",
      [String(ctx.from.id)],
    );
    if (!user) {
      await ctx.reply(botNoAccountText(asPushLang(null)));
      return;
    }
    const lang = asPushLang(user.language);
    const rows = all<{ name: string; short_name: string | null; league: string }>(
      db,
      `SELECT t.name, t.short_name, t.league FROM favorite_teams f JOIN teams t ON t.id = f.team_id WHERE f.user_id = ?`,
      [user.id],
    );
    if (rows.length === 0) {
      await ctx.reply(botNoTeamsText(lang));
      return;
    }
    await ctx.reply(
      botTeamsHeader(lang, rows.length) +
        rows.map((r) => `• ${r.short_name ?? r.name} (${r.league})`).join("\n"),
    );
  });

  bot.catch((err) => {
    console.error("[bot] error:", err.error ?? err);
  });
}

export function startBot(token: string): Bot | null {
  if (!token) return null;
  const instance = new Bot(token);
  bot = instance;
  registerHandlers(instance);

  // Long-polling: fine for v1 (no public URL needed, works behind NAT).
  // If api.telegram.org is unreachable (VPN needed on some networks), log it
  // clearly and keep the rest of the server running — polling retries on its
  // own once connectivity returns.
  void instance
    .start({
      onStart: (me) => {
        console.log(`[bot] @${me.username} polling started`);
        // Reachability is already proven at this point, so a failure here means
        // the call itself was rejected — not that the network is down.
        void registerCommands(instance);
      },
    })
    .catch((err) => {
      console.error(
        `[bot] could not reach api.telegram.org (${String(err).slice(0, 120)})\n` +
          `      The API keeps running without the bot. If this network blocks\n` +
          `      Telegram, start your VPN/proxy and restart the server.`,
      );
    });

  // Graceful shutdown
  const stop = () => {
    void instance.stop();
    if (drainTimer) clearInterval(drainTimer);
  };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);

  startPushDrain();
  return instance;
}

function webAppUrl(): string {
  return process.env.MINI_APP_URL ?? "https://example.com";
}

/**
 * Mini App deep link for one screen.
 *
 * The SPA is a HashRouter, so the route travels after the `#` and Telegram
 * opens the app directly on that page. A trailing slash on MINI_APP_URL (which
 * people do paste) is trimmed — otherwise the link is `...//#/matches`, and
 * what Telegram does with a doubled slash is not something to find out in
 * production.
 */
export function deepLink(page: BotPage): string {
  return `${webAppUrl().replace(/\/+$/, "")}/#/${page}`;
}

/**
 * The language a user picked in the app, from `users.language`. Defaults to
 * English for anyone the bot has never met, matching the pushes and /start.
 * Without this every menu reply would be English regardless of the app's UI.
 */
function userLang(telegramId: number | undefined): PushLang {
  if (telegramId === undefined) return "en";
  const row = get<{ language: string | null }>(getDb(), "SELECT language FROM users WHERE telegram_id = ?", [
    String(telegramId),
  ]);
  return asPushLang(row?.language);
}

/**
 * Register Telegram's command menu (the "/" button), one list per language.
 * Idempotent, so each boot simply re-asserts it; the call is free and the menu
 * is the only discoverable entry point besides /start.
 *
 * Called from the polling start callback on purpose: registering before the
 * bot is reachable only earns a connection error on a machine that has to
 * bring a VPN up first, and the menu is not worth that noise.
 */
export async function registerCommands(bot: Bot): Promise<void> {
  try {
    await bot.api.setMyCommands(botCommandMenu("en"));
    await bot.api.setMyCommands(botCommandMenu("fa"), { language_code: "fa" });
  } catch (err) {
    console.error(`[bot] could not register the command menu: ${String(err).slice(0, 120)}`);
  }
}

/**
 * Push drain: the sync layer queues alerts in SQLite; the bot sends them.
 * Keeping send-retries out of the sync loop keeps polling timing stable.
 */
function startPushDrain(): void {
  if (drainTimer) return;
  drainTimer = setInterval(() => {
    void drainPushes();
  }, 3_000);
}

/**
 * Unsendable rows (blocked bot, dead ids) are dropped after this many tries.
 * Transient failures get exponential backoff between them: at the 3s drain
 * cadence the old cap of 5 gave Telegram 15 SECONDS to recover before a
 * matchday push was lost for good.
 */
const MAX_PUSH_ATTEMPTS = 8;
/** Longest wait between retries (also caps a 429's own retry_after). */
const MAX_BACKOFF_MS = 15 * 60_000;
const BASE_BACKOFF_MS = 30_000;

/**
 * One pass at a time. The timer fires every 3s and a full window of 20 sends
 * takes longer than that, so an unguarded second pass would SELECT the same
 * unsent rows and deliver them twice — the same overlap rule every sync loop
 * already follows.
 */
let draining = false;

function backoffMs(attempts: number): number {
  return Math.min(BASE_BACKOFF_MS * 2 ** Math.max(0, attempts - 1), MAX_BACKOFF_MS);
}

/** 403 (bot blocked) and 400 (chat gone / bad id) can never succeed. */
function isPermanentPushError(msg: string): boolean {
  return (
    /\b40[03]\b/.test(msg) || /chat not found|bot was blocked|user is deactivated|PEER_ID_INVALID/i.test(msg)
  );
}

/** Telegram's flood-control wait, when the error carries one. */
function telegramRetryAfterMs(err: unknown): number | null {
  const params = (err as { parameters?: { retry_after?: unknown } } | null | undefined)?.parameters;
  const v = params?.retry_after;
  return typeof v === "number" && v > 0 ? Math.min(v * 1000, MAX_BACKOFF_MS) : null;
}

async function drainPushes(): Promise<void> {
  if (!bot || draining) return;
  draining = true;
  try {
    const db = getDb();
    const now = Date.now();
    const rows = all<{ id: number; telegram_id: string; text: string; attempts: number; kind: string }>(
      db,
      `SELECT id, telegram_id, text, attempts, kind
       FROM bot_push_queue
      WHERE sent_at IS NULL AND failed_at IS NULL AND next_attempt_at <= ?
      ORDER BY id ASC LIMIT 20`,
      [now],
    );
    for (const row of rows) {
      // Second net behind the queue-time gate in server/notifications.ts: a
      // preference set AFTER a row was queued (or by any future queue writer)
      // still stops the send. Each kind is checked against its own Profile
      // switch, so muting goal alerts leaves lock reminders intact. Opt-outs are
      // skipped, not failed.
      //
      // The flag gate comes first: with predictions off there is no screen to
      // act on a lineup/lock/half-time reminder, and the switch that used to
      // mute it is hidden — those rows are retired as sent-without-delivery
      // rather than delivered late if the flag ever comes back.
      const kind = asPushKind(row.kind);
      if (
        shouldSkipPredictionPush(kind) ||
        shouldSkipRatingsPush(kind) ||
        isOptedOut(db, row.telegram_id, kind)
      ) {
        run(db, "UPDATE bot_push_queue SET sent_at = ? WHERE id = ?", [new Date().toISOString(), row.id]);
        continue;
      }
      try {
        await bot.api.sendMessage(row.telegram_id, row.text);
        run(db, "UPDATE bot_push_queue SET sent_at = ? WHERE id = ?", [new Date().toISOString(), row.id]);
      } catch (err) {
        const msg = String(err);
        const attempts = (row.attempts ?? 0) + 1;
        // Permanent (blocked bot, chat gone): drop it now, retrying is waste.
        // Transient: back off exponentially instead — a Telegram blip now costs
        // minutes, not the 15 seconds of total budget this used to allow.
        if (isPermanentPushError(msg) || attempts >= MAX_PUSH_ATTEMPTS) {
          run(db, "UPDATE bot_push_queue SET attempts = ?, failed_at = ? WHERE id = ?", [
            attempts,
            new Date().toISOString(),
            row.id,
          ]);
          console.error(
            `[bot] push to ${row.telegram_id} dropped after ${attempts} attempt(s):`,
            msg.slice(0, 120),
          );
          continue;
        }
        const waitMs = telegramRetryAfterMs(err) ?? backoffMs(attempts);
        run(db, "UPDATE bot_push_queue SET attempts = ?, next_attempt_at = ? WHERE id = ?", [
          attempts,
          now + waitMs,
          row.id,
        ]);
        console.error(
          `[bot] push to ${row.telegram_id} failed (attempt ${attempts}/${MAX_PUSH_ATTEMPTS}, retry in ${Math.round(waitMs / 1000)}s):`,
          msg.slice(0, 120),
        );
      }
    }
  } finally {
    draining = false;
  }
}

export type { GoalAlert };
