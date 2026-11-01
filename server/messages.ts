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
import { predictionsEnabled, ratingsEnabled } from "./features.js";
export type PushLang = "en" | "fa" | "de";

/** Anything that isn't `fa` or `de` is English — same default as the `users` column. */
export function asPushLang(value: unknown): PushLang {
  return String(value ?? "") === "fa" ? "fa" : String(value ?? "") === "de" ? "de" : "en";
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

/**
 * The "why am I getting this / where do I act" line, appended to pushes below.
 * Left bare in the prior copy: a push named a match but pointed nowhere, so
 * the user either opened the app and hunted for it or muted the bot entirely.
 * The Mini App is a HashRouter, so the route travels after the `#` (same shape
 * as the command-menu deep links in server/bot/index.ts).
 */
export function matchLink(matchId: string): string | null {
  const base = (process.env.MINI_APP_URL ?? "").trim().replace(/\/+$/, "");
  if (!base) return null;
  let host = "";
  try {
    host = new URL(base).hostname;
  } catch {
    return null;
  }
  // Placeholder or unset config yields no link — a dead example.com footer
  // trains users to ignore the line.
  if (!host || host === "example.com" || host.endsWith(".example.com")) return null;
  return `${base}/#/match/${matchId}`;
}

/** The line above the link — one sentence, per push language. */
export function pushFooter(lang: PushLang): string {
  if (lang === "fa") return "بازی زنده و شرح لحظه‌به‌لحظه:";
  if (lang === "de") return "Live-Scores und die Minute für Minute Timeline:";
  return "Live scores and the minute-by-minute timeline:";
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
  if (lang === "de") {
    return `⚽ GOAL ${v.minute}' — ${v.club ?? "Eine verfolgte Mannschaft"}\n${v.scorer}\n${v.score}`;
  }
  return `⚽ GOAL ${v.minute}' — ${v.club ?? "A team you follow"}\n${v.scorer}\n${v.score}`;
}

/**
 * The official lineup has dropped: the whole gated set is open. Names every
 * mechanic that just unlocked, so the push converts the gate into an action
 * instead of only announcing the XI.
 */
export function lineupPush(lang: PushLang, v: MatchPushVars): string {
  if (lang === "fa") {
    return `👥 ترکیب اعلام شد — ${v.home} - ${v.away}\nپیش‌بینی شوت، بازیکن تحت نظر، رودررو و تعویض باز شد؛ در شروع بازی قفل می‌شوند (تعویض در پایان نیمه اول).`;
  }
  if (lang === "de") {
    return `👥 Aufstellung offen — ${v.home} v ${v.away}\nShootout, Player to Watch, Versus und das Sub-Board sind offen. Auswahlen werden beim Start gesperrt (Subs in der Halbzeit).`;
  }
  return `👥 Lineup out — ${v.home} v ${v.away}\nShot, Player to Watch, Versus and the sub board are open. Picks lock at kickoff (subs at half-time).`;
}

/** Last call before everything locks at kickoff. */
export function lockPush(lang: PushLang, v: LockPushVars): string {
  if (lang === "fa") {
    return `⏰ ${v.home} - ${v.away} تا ${v.minutes} دقیقه دیگر شروع می‌شود\nانتخاب‌های شما در لحظه شروع بازی قفل می‌شوند.`;
  }
  if (lang === "de") {
    return `⏰ ${v.home} v ${v.away} startet in ${v.minutes}'\nDeine Auswahlen werden beim Start gesperrt.`;
  }
  return `⏰ ${v.home} v ${v.away} kicks off in ${v.minutes}′\nYour picks lock at kickoff.`;
}

/** Half-time: the sub board is now locked. */
export function halftimePush(lang: PushLang, v: MatchPushVars): string {
  if (lang === "fa") {
    return `⏸ پایان نیمه اول — ${v.home} ${v.score} ${v.away}\nتخته تعویض‌ها قفل شد.`;
  }
  if (lang === "de") {
    return `⏸ Halbzeit — ${v.home} ${v.score} ${v.away}\nDas Sub-Board ist nun gesperrt.`;
  }
  return `⏸ Half-time — ${v.home} ${v.score} ${v.away}\nThe Sub Predictor is locked now.`;
}

/** Full time: the 3-card rating window is open. */
export function ratingsPush(lang: PushLang, v: MatchPushVars): string {
  if (lang === "fa") {
    return `⭐ پایان بازی — ${v.home} ${v.score} ${v.away}\nبه بازیکنانی که تأثیرگذار بودند امتیاز بده (۳ کارت).`;
  }
  if (lang === "de") {
    return `⭐ Ende — ${v.home} ${v.score} ${v.away}\nBewerte die Spieler, die am meisten gepasst haben (3 Karten).`;
  }
  return `⭐ Full time — ${v.home} ${v.score} ${v.away}\nRate the players who mattered (3 cards).`;
}

/* ------------------------------------------------------------ bot commands */

/*
 * The bot's command replies, EN/FA. Copy is chosen per RECIPIENT from
 * users.language — the same rule the pushes follow — so a user who set the
 * app to Persian never gets English back from /start or /myteams.
 * Names (clubs, the app) stay as-is, matching the push convention above.
 */

export function botStartText(lang: PushLang): string {
  // Gated features must not be promised in the welcome: with a flag off the
  // buttons, tabs and screens the copy names do not exist in the app.
  const predict = predictionsEnabled();
  const rate = ratingsEnabled();

  if (lang === "fa") {
    const line = predict
      ? rate
        ? "باشگاه‌ها و لیگ‌های موردعلاقه‌ات را دنبال کن، ترکیب و تعویض و شوت و بازیکن برتر هر بازی را پیش‌بینی کن، در جدول امتیازهای فصل بالا برو و به بازیکنان تأثیرگذار امتیاز بده."
        : "باشگاه‌ها و لیگ‌های موردعلاقه‌ات را دنبال کن، ترکیب و تعویض و شوت و بازیکن برتر هر بازی را پیش‌بینی کن و در جدول امتیازهای فصل بالا برو."
      : rate
        ? "باشگاه‌ها و لیگ‌های موردعلاقه‌ات را دنبال کن، نتایج زنده را ببین، جدول‌ها را نگاه کن و به بازیکنان تأثیرگذار امتیاز بده."
        : "باشگاه‌ها و لیگ‌های موردعلاقه‌ات را دنبال کن، نتایج زنده را ببین و جدول‌ها را نگاه کن.";
    return `به Vkick خوش آمدی! ⚽\n\n${line}\n\nبرای شروع دکمه زیر را بزن.`;
  }
  if (lang === "de") {
    return "Willkommen bei Vkick! ⚽\n\nFolge deinen Lieblingsclubs und Ligas, tippe Formationen, Subs, Schüsse und auffällige Spieler, steige im Saison-Tabellen und bewertete die Spieler, die am meisten gepasst haben.";
  }

  const line = predict
    ? rate
      ? "Follow your favorite clubs and leagues, predict lineups, subs, shots and standout players, climb the season leaderboards, and rate the players who mattered most."
      : "Follow your favorite clubs and leagues, predict lineups, subs, shots and standout players, and climb the season leaderboards."
    : rate
      ? "Follow your favorite clubs and leagues, follow live scores, check every table, and rate the players who mattered most."
      : "Follow your favorite clubs and leagues, follow live scores and check every table.";
  return `Welcome to Vkick! ⚽\n\n${line}\n\nTap below to get started.`;
}

export function botNoAccountText(lang: PushLang): string {
  if (lang === "fa") return "اول برنامه را باز کن — دکمه زیر، پایین /start.";
  if (lang === "de") return "Eröffne die App erst — tippe den Knopf unterhalb von /start.";
  return "Open the app first — tap the button below /start.";
}

export function botTeamsHeader(lang: PushLang, count: number): string {
  if (lang === "fa") return `باشگاه‌های تو:\n`;
  if (lang === "de") return `Deine Clubs (${count}):\n`;
  return `Your clubs (${count}):\n`;
}

export function botNoTeamsText(lang: PushLang): string {
  if (lang === "fa") return "هنوز باشگاهی انتخاب نکرده‌ای. برنامه را باز کن و تا پنج باشگاه انتخاب کن!";
  if (lang === "de") return "Du hast noch keine Clubs ausgewählt. Öffne die App und wähle bis zu fünf aus!";
  return "You haven't picked any clubs yet. Open the app and choose up to five!";
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
      : lang === "de"
        ? [
            { command: "matches", description: "Heutige Spiele" },
            { command: "profile", description: "Dein Profil" },
            { command: "leaderboards", description: "Die Tabellen" },
          ]
        :
      [
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
    de: { text: "Drücke unten, um die heutigen Spiele zu öffnen:", button: "⚽ Spiele öffnen" },
  },
  profile: {
    en: { text: "Tap below to open your Profile:", button: "👤 Open Profile" },
    fa: { text: "برای دیدن پروفایلت دکمه زیر را بزن:", button: "👤 باز کردن پروفایل" },
    de: { text: "Drücke unten, um dein Profil zu öffnen:", button: "👤 Profil öffnen" },
  },
  leaderboards: {
    en: { text: "Tap below to open the Leaderboards:", button: "🏆 Open Leaderboards" },
    fa: { text: "برای دیدن جدول امتیازها دکمه زیر را بزن:", button: "🏆 باز کردن جدول امتیازها" },
    de: { text: "Drücke unten, um die Tabellen zu öffnen:", button: "🏆 Tabellen öffnen" },
  },
};

/** The reply for one command: a line of copy plus its web_app button label. */
export function botPageCopy(lang: PushLang, page: BotPage): BotPageCopy {
  return BOT_PAGE_COPY[page][lang];
}
