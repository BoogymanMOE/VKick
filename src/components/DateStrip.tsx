import { useEffect, useLayoutEffect, useMemo, useRef } from "react";
import { useI18n } from "../i18n/context";
import { CalendarIcon } from "./icons";
import { haptic } from "../lib/telegram";

/**
 * Catalog keys, not display labels: `dates.day.*` carries the short day name in
 * every language (Farsi ships single letters), so the lookup is the same in
 * both — building a Farsi key here instead rendered `dates.day.ج` on the chip.
 */
const DAY_NAMES = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const;

interface DateStripProps {
  selected: Date;
  onSelect: (date: Date) => void;
  /** Day keys (same format as `dayKey`) that have at least one match — the
   *  chip carries a small dot so a quiet Saturday reads as quiet before the
   *  tap. Absent = no dots (call sites without the data unchanged). */
  daysWithMatches?: Set<string>;
  /** Opens the month picker for the days the strip cannot reach. Absent =
   *  no calendar button (call sites without a picker unchanged). */
  onOpenCalendar?: () => void;
}

const startOfDay = (d: Date) => {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
};

/**
 * Local calendar-day key — never `toISOString()`, which is UTC and files a
 * local midnight east of UTC under the previous day. Exported so call sites
 * that precompute per-day facts (the fixture dots) build keys that are
 * guaranteed to match the chips' own keys.
 */
export const dayKey = (d: Date) => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;

/**
 * 13 days back … 7 days forward (21 chips) as local calendar days — the past
 * two weeks and the coming week. `setDate` (not millisecond arithmetic)
 * because a DST change makes one local day 23 or 25 hours long.
 */
const DAY_OFFSETS = [
  -13, -12, -11, -10, -9, -8, -7, -6, -5, -4, -3, -2, -1, 0, 1, 2, 3, 4, 5, 6, 7,
];

function buildDays(): Date[] {
  const today = startOfDay(new Date());
  return DAY_OFFSETS.map((offset) => {
    const d = new Date(today);
    d.setDate(today.getDate() + offset);
    return d;
  });
}

export function DateStrip({
  selected,
  onSelect,
  daysWithMatches,
  onOpenCalendar,
}: DateStripProps) {
  const { t, lang } = useI18n();
  const locale = lang === "fa" ? "fa-IR" : undefined;
  // Localized day number: Farsi reads ۱۴ not 14.
  const digits = useMemo(
    () => new Intl.NumberFormat(locale, { useGrouping: false }),
    [locale],
  );

  // Recomputed when the calendar day changes, so a strip left open past
  // midnight rolls its window forward instead of pointing at yesterday.
  const todayKey = dayKey(new Date());
  const days = useMemo(buildDays, [todayKey]);
  const selectedKey = dayKey(selected);

  const containerRef = useRef<HTMLDivElement>(null);

  // Land on today, centered, before the first paint the user sees: a 21-chip
  // strip opens on its left end otherwise, which is two weeks of nothing.
  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const todayChip = container.querySelector<HTMLElement>('[aria-current="date"]');
    todayChip?.scrollIntoView({ behavior: "auto", inline: "center", block: "nearest" });
  }, []);

  // A picked day (a chip tap, or a date chosen in the calendar sheet) comes to
  // the middle too — the selected chip is the one thing that must never sit
  // half off-screen. `nearest` keeps the page itself from scrolling.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const selectedChip = container.querySelector<HTMLElement>('[aria-pressed="true"]');
    selectedChip?.scrollIntoView({ behavior: "smooth", inline: "center", block: "nearest" });
  }, [selectedKey]);

  return (
    // A group of pressable day buttons, not a tablist: they are toggles with an
    // explicit pressed state, and role=tab would promise arrow-key semantics
    // this row does not implement.
    <div className="flex items-center gap-1">
      {/* Scrollable day chips */}
      <div
        ref={containerRef}
        className="date-strip flex flex-1 items-center gap-1 overflow-x-auto px-[var(--space-page-x,16px)] pb-1"
        style={{ scrollbarWidth: "none" }}
        role="group"
        aria-label={t("dateStrip.label")}
      >
        {days.map((day) => {
          const key = dayKey(day);
          const isToday = key === todayKey;
          const isSelected = key === selectedKey;
          const hasMatches = daysWithMatches?.has(key) ?? false;
          return (
            <button
              key={key}
              type="button"
              aria-pressed={isSelected}
            // "Today" keeps its own marker even when another day is selected,
            // so the user always knows where they are in the week.
            aria-current={isToday ? "date" : undefined}
            onClick={() => onSelect(day)}
            className={`min-h-11 min-w-[52px] flex-none flex flex-col items-center justify-center gap-0.5 rounded-lg border px-2 py-2 text-center transition-all duration-[var(--t-fast)] active:scale-[0.96] ${
              isSelected
                ? "border-volt bg-volt text-on-volt active:bg-volt/80"
                : isToday
                  ? "border-volt bg-transparent text-volt active:bg-volt/15"
                  : "border-line bg-transparent text-ink-3 active:bg-line/20"
            }`}
          >
            <span className="text-xs font-bold">
              {t(`dates.day.${DAY_NAMES[day.getDay()]}` as never)}
            </span>
            <span className="text-md font-bold leading-none">
              {digits.format(day.getDate())}
            </span>
            {isToday ? (
              <span
                aria-hidden="true"
                className={`mt-0.5 h-1 w-1 rounded-full ${isSelected ? "bg-on-volt" : "bg-volt"}`}
              />
            ) : hasMatches && !isSelected ? (
              // Days with fixtures get a 2px dot so the user can scan without
              // tapping; the selected chip needs no marker (the volt fill IS
              // the marker).
              <span aria-hidden="true" className="mt-0.5 h-0.5 w-0.5 rounded-full bg-ink-3" />
            ) : null}
          </button>
        );
        })}
      </div>
      {/* Calendar button — OUTSIDE the scroll container, always visible at the end */}
      {onOpenCalendar ? (
        <button
          type="button"
          onClick={() => {
            haptic("light");
            onOpenCalendar();
          }}
          aria-label={t("calendar.open")}
          className="flex-none grid h-11 w-11 place-items-center rounded-lg border border-line bg-surface text-ink-2 transition-colors duration-[var(--t-fast)] hover:bg-elevated active:scale-[0.96] me-[var(--space-page-x,16px)]"
        >
          <CalendarIcon className="h-5 w-5" />
        </button>
      ) : null}
      {/* Trailing spacer: a scroll container's end padding is not part of its
          scrollable overflow on every engine, so the last chip would sit flush
          against the screen edge. The spacer carries that padding instead. */}
      <span
        aria-hidden="true"
        className="w-[var(--space-page-x,16px)] flex-none"
      />
    </div>
  );
}
