import type { MatchStatus } from "../types";

/**
 * A fixture that was never played. ESPN reports all three under "post", so
 * without this check a called-off match reads as a 0-0 result on every screen
 * that prints a score for "not scheduled".
 */
export function isNotPlayed(status: MatchStatus): boolean {
  return status === "postponed" || status === "abandoned" || status === "cancelled";
}

/** Persian-Indic digit table — FA mode renders every number in this script. */
const FA_DIGITS = ["۰", "۱", "۲", "۳", "۴", "۵", "۶", "۷", "۸", "۹"];

/**
 * Convert Western digits to Persian-Indic; everything else passes through.
 * Persian reads left-to-right within a number, so ordering is preserved.
 */
export function toFaDigits(value: number | string): string {
  return String(value).replace(/[0-9]/g, (d) => FA_DIGITS[Number(d)]);
}

/** A live clock split into its base minute and its added time. */
export interface MinuteParts {
  /** The minute as broadcast: 90 in "90'+3'". */
  base: number;
  /** Minutes added on top: 3 in "90'+3'"; 0 for a plain "54'". */
  added: number;
}

/**
 * ESPN's live clock as two numbers: "90'+3'" → {base: 90, added: 3},
 * "45+2" → {45, 2}, "54'" → {54, 0}. Null when there is no leading number
 * (some feeds send "HT" or an empty displayClock).
 *
 * Reading only the first number — the old behaviour — silently dropped the
 * added time, so a match in the 94th minute showed "90".
 */
export function parseMinute(value: string | null | undefined): MinuteParts | null {
  const match = /^\s*(\d+)\s*(?:['′]?\s*\+\s*(\d+))?/.exec(String(value ?? ""));
  if (!match) return null;
  const base = Number(match[1]);
  if (!Number.isFinite(base)) return null;
  const added = match[2] ? Number(match[2]) : 0;
  return { base, added: Number.isFinite(added) ? added : 0 };
}

/** Wall-clock label for "last synced" affordances. Pass `fa-IR` under Persian. */
export function formatClock(date: Date, locale?: string): string {
  return date.toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" });
}

/** Kickoff label: short weekday + time. Pass `fa-IR` under Persian. */
export function formatKickoff(date: Date, locale?: string): string {
  return date.toLocaleString(locale, {
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** Kickoff calendar date (day + month) for status badges. Pass `fa-IR` under Persian. */
export function formatKickoffDate(date: Date, locale?: string): string {
  return date.toLocaleDateString(locale, {
    day: "numeric",
    month: "short",
  });
}

/**
 * Splits a kickoff into weekday, clock and day period (AM/PM).
 * The period is "" for 24-hour locales such as Persian (fa-IR), where
 * `toLocaleTimeString` does not emit a dayPeriod part.
 */
export function kickoffParts(date: Date, locale?: string): { day: string; clock: string; period: string } {
  const day = new Intl.DateTimeFormat(locale, { weekday: "short" }).format(date);
  const parts = new Intl.DateTimeFormat(locale, { hour: "2-digit", minute: "2-digit" }).formatToParts(date);
  const period = parts.find((p) => p.type === "dayPeriod")?.value ?? "";
  const clock = parts
    .filter((p) => p.type !== "dayPeriod")
    .map((p) => p.value)
    .join("")
    .trim();
  return { day, clock, period };
}

/**
 * Short kickoff label: weekday + 24h time, one line.
 * EN: Sun 15:00
 * FA: یکشنبه ۱۵:۰۰ (Persian day name + Persian digits)
 * For LIVE matches this is combined with the score/minute below.
 * For FINISHED matches this is the final score + "FT" on one line.
 */
export function formatKickoffShort(date: Date, locale?: string): string {
  const day = new Intl.DateTimeFormat(locale ?? "en", { weekday: "short" }).format(date);
  const time = new Intl.DateTimeFormat(locale ?? "en", { hour: "2-digit", minute: "2-digit", hour12: false }).format(date);
  return `${day} ${time}`;
}

/**
 * Sticky date header label for grouped upcoming feeds.
 * Returns "Today" / "Tomorrow" for near dates, or a full weekday + date for
 * anything further out (e.g. "Saturday, Oct 12"). Pass `fa-IR` under Persian.
 */
export function formatDayHeader(date: Date, locale?: string): string {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const target = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const diff = Math.round((target.getTime() - today.getTime()) / 86400000);

  if (diff === 0) return "Today";
  if (diff === 1) return "Tomorrow";

  return date.toLocaleDateString(locale, {
    weekday: "long",
    day: "numeric",
    month: "short",
  });
}
