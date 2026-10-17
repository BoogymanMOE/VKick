/**
 * Push copy, EN/FA — the bot's own catalogue.
 *
 * The server cannot use the client's `src/i18n/strings.ts` (different build,
 * and the browser bundle never reaches the server), so the wording lives here
 * and is chosen per RECIPIENT from `users.language`. That column is the reason
 * this file exists at all: before it the server had no idea what language anyone
 * read, so every push was English no matter what the app was showing.
 *
 * Terminology is lifted from the app's Persian strings rather than translated
 * fresh — "Sub Predictor" is "پیش‌بینی تعویض" and half-time is "پایان نیمه اول"
 * there, so they are here too. A user who reads the app in Persian should never
 * meet a different word in a notification.
 *
 * Deliberately NOT localized: club and player names, which stay as ESPN gives
 * them. The client translates those via `src/i18n/names.ts`, a ~200-entry table
 * that lives in the browser bundle; the server has no access to it, and copying
 * it here would mean two tables drifting apart. Numbers in interpolated values
 * (scores, minutes) stay Latin too, matching how the app renders scorelines.
 */
import { predictionsEnabled } from "./features.js";
export type PushLang = "en" | "fa";

/** Anything that isn't `fa` is English — same default as the `users` column. */
export function asPushLang(value: unknown): PushLang {
  return String(value ?? "") === "fa" ? "fa" : "en";
}

export interface GoalPushVars {
  minute: string;
  /** Null when the scoring team's row is gone — each language has a placeholder. */
  club: string | null;
  scorer: string;
  score: string;
}

export interface MatchPushVars {
  home: string;
  away: string;
  score: string;
}

export interface LockPushVars {
  home: string;
  away: string;
  minutes: number;
}

/**
 * Goal alert — for a club or a national team (both are "a team you follow").
 * The fallback names neither shape, so an international favorite's push never
 * calls Brazil a club when the team row is missing.
 */
export function goalPush(lang: PushLang, v: GoalPushVars): string {
  if (lang === "fa") {
    return `⚽ گل دقیقه ${v.minute} — ${v.club ?? "تیمی که دنبال می‌کنی"}\n${v.scorer}\n${v.score}`;
  }
  return `⚽ GOAL ${v.minute}' — ${v.club ?? "A team you follow"}\n${v.scorer}\n${v.score}`;
}

/**
 * The official lineup has dropped: the whole gated set is open. Names every
 * mechanic that just unlocked, so the push converts the gate into an action
 * instead of only announcing the XI.
 */
export function lineupPush(lang: PushLang, v: MatchPushVars): string {
  return lang === "fa"
    ? `👥 ترکیب اعلام شد — ${v.home} - ${v.away}\nپیش‌بینی شوت، بازیکن تحت نظر، رودررو و تعویض باز شد؛ در شروع بازی قفل می‌شوند (تعویض در پایان نیمه اول).`
    : `👥 Lineup out — ${v.home} v ${v.away}\nShot, Player to Watch, Versus and the sub board are open. Picks lock at kickoff (subs at half-time).`;
}

/** Last call before everything locks at kickoff. */
export function lockPush(lang: PushLang, v: LockPushVars): string {
  return lang === "fa"
    ? `⏰ ${v.home} - ${v.away} تا ${v.minutes} دقیقه دیگر شروع می‌شود\nانتخاب‌های شما در لحظه شروع بازی قفل می‌شوند.`
    : `⏰ ${v.home} v ${v.away} kicks off in ${v.minutes}′\nYour picks lock at kickoff.`;
}

/** Half-time: the sub board is now locked. */
export function halftimePush(lang: PushLang, v: MatchPushVars): string {
  return lang === "fa"
    ? `⏸ پایان نیمه اول — ${v.home} ${v.score} ${v.away}\nتخته تعویض‌ها قفل شد.`
    : `⏸ Half-time — ${v.home} ${v.score} ${v.away}\nThe Sub Predictor is locked now.`;
}

/** Full time: the 3-card rating window is open. */
export function ratingsPush(lang: PushLang, v: MatchPushVars): string {
  return lang === "fa"
    ? `⭐ پایان بازی — ${v.home} ${v.score} ${v.away}\nبه بازیکنانی که تأثیرگذار بودند امتیاز بده (۳ کارت).`
    : `⭐ Full time — ${v.home} ${v.score} ${v.away}\nRate the players who mattered (3 cards).`;
}

/* ------------------------------------------------------------ bot commands */

/*
 * The bot's command replies, EN/FA. Copy is chosen per RECIPIENT from
 * users.language — the same rule the pushes follow — so a user who set the
 * app to Persian never gets English back from /start or /myteams.
 * Names (clubs, the app) stay as-is, matching the push convention above.
 */

export function botStartText(lang: PushLang): string {
  // With predictions gated off the welcome must not promise them: the buttons,
  // tabs and leaderboards it names no longer exist in the app.
  if (!predictionsEnabled()) {
    return lang === "fa"
      ? "به Vkick خوش آمدی! ⚽\n\nباشگاه‌ها و لیگ‌های موردعلاقه‌ات را دنبال کن، نتایج زنده را ببین، جدول‌ها را نگاه کن و به بازیکنان تأثیرگذار امتیاز بده.\n\nبرای شروع دکمه زیر را بزن."
      : "Welcome to Vkick! ⚽\n\nFollow your favorite clubs and leagues, follow live scores, check every table, and rate the players who mattered most.\n\nTap below to get started.";
  }
  return lang === "fa"
    ? "به Vkick خوش آمدی! ⚽\n\nباشگاه‌ها و لیگ‌های موردعلاقه‌ات را دنبال کن، ترکیب و تعویض و شوت و بازیکن برتر هر بازی را پیش‌بینی کن، در جدول امتیازهای فصل بالا برو و به بازیکنان تأثیرگذار امتیاز بده.\n\nبرای شروع دکمه زیر را بزن."
    : "Welcome to Vkick! ⚽\n\nFollow your favorite clubs and leagues, predict lineups, subs, shots and standout players, climb the season leaderboards, and rate the players who mattered most.\n\nTap below to get started.";
}

export function botNoAccountText(lang: PushLang): string {
  return lang === "fa"
    ? "اول برنامه را باز کن — دکمه زیر، پایین /start."
    : "Open the app first — tap the button below /start.";
}

export function botTeamsHeader(lang: PushLang, count: number): string {
  return lang === "fa" ? `باشگاه‌های تو:\n` : `Your clubs (${count}):\n`;
}

export function botNoTeamsText(lang: PushLang): string {
  return lang === "fa"
    ? "هنوز باشگاهی انتخاب نکرده‌ای. برنامه را باز کن و تا پنج باشگاه انتخاب کن!"
    : "You haven't picked any clubs yet. Open the app and choose up to five!";
}

/* ---------------------------------------------------- bot command menu */

/*
 * The commands Telegram lists behind the "/" button, plus the reply each one
 * sends. Both live here together so the menu label and the reply can never
 * drift apart, and so Persian users get Persian in the MENU too: grammy's
 * setMyCommands takes a language_code, and server/bot/index.ts registers one
 * list per language — the same per-recipient rule the pushes follow.
 *
 * The command names are also the route names of the Mini App
 * (/#/matches, /#/profile, /#/leaderboards), which is what makes the deep link
 * one string concatenation instead of a lookup table.
 */

/** A screen the bot can deep-link into. */
export type BotPage = "matches" | "profile" | "leaderboards";

export interface BotCommandSpec {
  command: string;
  description: string;
}

/**
 * The command list registered with Telegram. Descriptions are kept short —
 * Telegram truncates the menu, and it is a menu, not a pitch.
 */
export function botCommandMenu(lang: PushLang): BotCommandSpec[] {
  const menu =
    lang === "fa"
      ? [
          { command: "matches", description: "بازی‌های امروز" },
          { command: "profile", description: "پروفایل شما" },
          { command: "leaderboards", description: "جدول امتیازها" },
        ]
      : [
          { command: "matches", description: "View today's fixtures" },
          { command: "profile", description: "View your profile" },
          { command: "leaderboards", description: "View the leaderboards" },
        ];
  // The leaderboards are a prediction surface: with the flag off the command
  // would open a screen the app no longer routes.
  return predictionsEnabled() ? menu : menu.filter((c) => c.command !== "leaderboards");
}

export interface BotPageCopy {
  /** The line above the button. */
  text: string;
  /** Label of the inline button that opens this page in the Mini App. */
  button: string;
}

const BOT_PAGE_COPY: Record<BotPage, Record<PushLang, BotPageCopy>> = {
  matches: {
    en: { text: "Tap below to open today's fixtures:", button: "⚽ Open Matches" },
    fa: { text: "برای دیدن بازی‌های امروز دکمه زیر را بزن:", button: "⚽ باز کردن بازی‌ها" },
  },
  profile: {
    en: { text: "Tap below to open your Profile:", button: "👤 Open Profile" },
    fa: { text: "برای دیدن پروفایلت دکمه زیر را بزن:", button: "👤 باز کردن پروفایل" },
  },
  leaderboards: {
    en: { text: "Tap below to open the Leaderboards:", button: "🏆 Open Leaderboards" },
    fa: { text: "برای دیدن جدول امتیازها دکمه زیر را بزن:", button: "🏆 باز کردن جدول امتیازها" },
  },
};

/** The reply for one command: a line of copy plus its web_app button label. */
export function botPageCopy(lang: PushLang, page: BotPage): BotPageCopy {
  return BOT_PAGE_COPY[page][lang];
}
