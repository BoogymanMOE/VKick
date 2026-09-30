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

/** Club goal alert. Unchanged from the pre-i18n copy when lang is `en`. */
export function goalPush(lang: PushLang, v: GoalPushVars): string {
  if (lang === "fa") {
    return `⚽ گل دقیقه ${v.minute} — ${v.club ?? "باشگاهی که دنبال می‌کنی"}\n${v.scorer}\n${v.score}`;
  }
  return `⚽ GOAL ${v.minute}' — ${v.club ?? "A club you follow"}\n${v.scorer}\n${v.score}`;
}

/** The official lineup has dropped: the Sub Predictor is open. */
export function lineupPush(lang: PushLang, v: MatchPushVars): string {
  return lang === "fa"
    ? `👥 ترکیب اعلام شد — ${v.home} - ${v.away}\nپیش‌بینی تعویض باز شد؛ در پایان نیمه اول قفل می‌شود.`
    : `👥 Lineup out — ${v.home} v ${v.away}\nThe Sub Predictor is open and locks at half-time.`;
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
