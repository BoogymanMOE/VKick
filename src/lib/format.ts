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
