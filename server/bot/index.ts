import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Bot, InlineKeyboard, InputFile } from "grammy";
import { getDb, all, run, get } from "../db/index.js";
import { asPushKind, isOptedOut } from "../notifications.js";
import type { GoalAlert } from "../sync/upserts.js";

let bot: Bot | null = null;
let drainTimer: NodeJS.Timeout | null = null;

const WELCOME_TEXT =
  "Welcome to Vkick! ⚽\n\nFollow your favorite clubs and leagues, predict lineups, subs, shots and standout players, climb the season leaderboards, and rate the players who mattered most.\n\nTap below to get started.";

// Brand icon sent as the /start photo — Telegram inline buttons can't carry
// images, so the button rides on the photo's reply markup instead.
const TELEGRAM_ICON = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "public",
  "telegram-icon.png",
);

export function startBot(token: string): Bot | null {
  if (!token) return null;
  bot = new Bot(token);

  bot.command("start", async (ctx) => {
    const from = ctx.from;
    if (from) {
      const db = getDb();
      const existing = get(db, "SELECT id FROM users WHERE telegram_id = ?", [String(from.id)]);
      if (!existing) {
        const name =
          [from.first_name, from.last_name].filter(Boolean).join(" ") || from.username || `User ${from.id}`;
        run(db, "INSERT INTO users (telegram_id, display_name, created_at) VALUES (?, ?, ?)", [
          String(from.id),
          name,
          new Date().toISOString(),
        ]);
      }
    }
    const keyboard = new InlineKeyboard().webApp("⚽ Open Vkick", webAppUrl());
    let icon: Buffer | null = null;
    try {
      icon = fs.readFileSync(TELEGRAM_ICON);
    } catch {
      // Icon not shipped/found: the text-only welcome still works.
    }
    if (icon) {
      await ctx.replyWithPhoto(new InputFile(icon, "telegram-icon.png"), {
        caption: WELCOME_TEXT,
        reply_markup: keyboard,
      });
    } else {
      await ctx.reply(WELCOME_TEXT, { reply_markup: keyboard });
    }
  });

  bot.command("myteams", async (ctx) => {
    if (!ctx.from) return;
    const db = getDb();
    const user = get<{ id: number }>(db, "SELECT id FROM users WHERE telegram_id = ?", [String(ctx.from.id)]);
    if (!user) {
      await ctx.reply("Open the app first — tap the button below /start.");
      return;
    }
    const rows = all<{ name: string; short_name: string | null; league: string }>(
      db,
      `SELECT t.name, t.short_name, t.league FROM favorite_teams f JOIN teams t ON t.id = f.team_id WHERE f.user_id = ?`,
      [user.id],
    );
    if (rows.length === 0) {
      await ctx.reply("You haven't picked any clubs yet. Open the app and choose up to five!");
      return;
    }
    await ctx.reply(
      "Your clubs:\n" + rows.map((r) => `• ${r.short_name ?? r.name} (${r.league})`).join("\n"),
    );
  });

  bot.catch((err) => {
    console.error("[bot] error:", err.error ?? err);
  });

  // Long-polling: fine for v1 (no public URL needed, works behind NAT).
  // If api.telegram.org is unreachable (VPN needed on some networks), log it
  // clearly and keep the rest of the server running — polling retries on its
  // own once connectivity returns.
  void bot
    .start({
      onStart: (me) => console.log(`[bot] @${me.username} polling started`),
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
    void bot?.stop();
    if (drainTimer) clearInterval(drainTimer);
  };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);

  startPushDrain();
  return bot;
}

function webAppUrl(): string {
  return process.env.MINI_APP_URL ?? "https://example.com";
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

/** Unsendable rows (blocked bot, dead ids) are dropped after this many tries. */
const MAX_PUSH_ATTEMPTS = 5;

async function drainPushes(): Promise<void> {
  if (!bot) return;
  const db = getDb();
  const rows = all<{ id: number; telegram_id: string; text: string; attempts: number; kind: string }>(
    db,
    "SELECT id, telegram_id, text, attempts, kind FROM bot_push_queue WHERE sent_at IS NULL AND failed_at IS NULL ORDER BY id ASC LIMIT 20",
  );
  for (const row of rows) {
    // Second net behind the queue-time gate in server/notifications.ts: a
    // preference set AFTER a row was queued (or by any future queue writer)
    // still stops the send. Each kind is checked against its own Profile
    // switch, so muting goal alerts leaves lock reminders intact. Opt-outs are
    // skipped, not failed.
    if (isOptedOut(db, row.telegram_id, asPushKind(row.kind))) {
      run(db, "UPDATE bot_push_queue SET sent_at = ? WHERE id = ?", [new Date().toISOString(), row.id]);
      continue;
    }
    // Poison-pill guard: a row that keeps failing (blocked bot = 403, chat
    // deleted = 400) would retry forever, wedging the 20-row drain window so
    // newer pushes starve. Cap attempts, then mark it failed.
    if ((row.attempts ?? 0) >= MAX_PUSH_ATTEMPTS) {
      run(db, "UPDATE bot_push_queue SET failed_at = ? WHERE id = ?", [new Date().toISOString(), row.id]);
      continue;
    }
    try {
      await bot.api.sendMessage(row.telegram_id, row.text);
      run(db, "UPDATE bot_push_queue SET sent_at = ? WHERE id = ?", [new Date().toISOString(), row.id]);
    } catch (err) {
      const msg = String(err);
      console.error(`[bot] push to ${row.telegram_id} failed:`, msg.slice(0, 120));
      // Blocked bot (403) / chat not found (400): retrying is pointless.
      const dead = msg.includes("403") || msg.includes("400");
      const attempts = (row.attempts ?? 0) + 1;
      run(db, "UPDATE bot_push_queue SET attempts = ?, failed_at = ? WHERE id = ?", [
        attempts,
        dead ? new Date().toISOString() : null,
        row.id,
      ]);
    }
  }
}

export type { GoalAlert };
