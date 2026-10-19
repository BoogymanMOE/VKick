/** Persian-Indic digit table — FA mode renders every number in this script. */
const FA_DIGITS = ["۰", "۱", "۲", "۳", "۴", "۵", "۶", "۷", "۸", "۹"];

/**
 * Convert Western digits to Persian-Indic; everything else passes through.
 * Persian reads left-to-right within a number, so ordering is preserved.
 */
export function toFaDigits(value: number | string): string {
  return String(value).replace(/[0-9]/g, (d) => FA_DIGITS[Number(d)]);
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
