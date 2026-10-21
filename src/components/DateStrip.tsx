import { useMemo } from "react";
import { useI18n } from "../i18n/context";

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

/** Chips per row. One row, never a carousel: seven is what fits at 360px. */
const STRIP_DAYS = 7;
/** Default window: yesterday … today+5, so yesterday's results AND today show. */
const DEFAULT_START = -1;
/** Slot (0-based) a far-picked day lands in when the window re-centres: the 4th. */
const SELECTED_SLOT = 3;

/**
 * Whole local calendar days from `b` to `a`. Built from the local Y/M/D
 * triplets through UTC, so a DST change (a 23 or 25 hour local day) never
 * shifts the difference by one and `toISOString()` is never involved.
 */
const dayDiff = (a: Date, b: Date) =>
  Math.round(
    (Date.UTC(a.getFullYear(), a.getMonth(), a.getDate()) -
      Date.UTC(b.getFullYear(), b.getMonth(), b.getDate())) /
      86_400_000,
  );

/**
 * Offset from today of the window's first chip.
 *
 * The window only moves when it has to: a day inside the default week keeps the
 * strip where it is (tapping tomorrow must not shuffle the row under the
 * thumb). A day picked from the calendar sheet — or reached past the week —
 * re-centres so that day is the 4th chip, which keeps three earlier days
 * (results) and three later ones (fixtures) reachable by one tap.
 */
function windowStart(selected: Date, today: Date): number {
  const offset = dayDiff(selected, today);
  if (offset >= DEFAULT_START && offset <= DEFAULT_START + STRIP_DAYS - 1) {
    return DEFAULT_START;
  }
  return offset - SELECTED_SLOT;
}

/**
 * Seven local calendar days starting at `start` (a day offset from today).
 * `setDate` (not millisecond arithmetic) because a DST change makes one local
 * day 23 or 25 hours long.
 */
function buildDays(today: Date, start: number): Date[] {
  return Array.from({ length: STRIP_DAYS }, (_, index) => {
    const day = new Date(today);
    day.setDate(today.getDate() + start + index);
    return day;
  });
}

/**
 * The matchday strip: exactly seven day chips across the full content width,
 * no horizontal scrolling and nothing clipped.
 *
 * The calendar lives in the header now (see `Matches`) — a 44px icon button
 * wedged beside 56px chips made the row read as eight uneven targets.
 */
export function DateStrip({ selected, onSelect, daysWithMatches }: DateStripProps) {
  const { t, lang } = useI18n();
  const locale = lang === "fa" ? "fa-IR" : undefined;
  // Localized day number: Farsi reads ۱۴ not 14.
  const digits = useMemo(() => new Intl.NumberFormat(locale, { useGrouping: false }), [locale]);
  // The chip's accessible name is the full date. `calendar: "gregory"` keeps
  // fa-IR on the same day number the chip prints (fa-IR's default Persian
  // calendar would name a different day than the digits show).
  const fullDate = useMemo(
    () =>
      new Intl.DateTimeFormat(locale, {
        weekday: "long",
        day: "numeric",
        month: "long",
        calendar: "gregory",
      }),
    [locale],
  );

  // Local midnight as a number: it changes once a day (the feed re-renders
  // every minute), so a strip left open past midnight rolls its window
  // forward instead of pointing at yesterday.
  const todayStamp = startOfDay(new Date()).getTime();
  const todayKey = dayKey(new Date(todayStamp));
  const selectedKey = dayKey(selected);
  // How far the selected day sits from today is what moves the window, and it
  // is a plain number — so both memos key on numbers instead of Date
  // identities: a pick inside the current week keeps the same offset and the
  // row where it is, and midnight moves the stamp.
  const windowOffset = useMemo(
    () => windowStart(selected, new Date(todayStamp)),
    [selected, todayStamp],
  );
  const days = useMemo(
    () => buildDays(new Date(todayStamp), windowOffset),
    [todayStamp, windowOffset],
  );

  return (
    // A group of pressable day buttons, not a tablist: they are toggles with an
    // explicit pressed state, and role=tab would promise arrow-key semantics
    // this row does not implement. No overflow container: each chip's invisible
    // hit band (after:-inset-x-1) reaches into the 6px gaps instead.
    //
    // -inset-x-1, not -inset-x-0.5: an absolutely positioned ::after is offset
    // from the PADDING box, so the 1px border already eats one of the 2px — a
    // half-step band left only 1px outside the visible edge (43.7px tappable at
    // 360). One step reaches 3px out on each side: 47.7px at 360, and the
    // neighbouring band still stops 3px short of it in the 6px gap.
    <div role="group" aria-label={t("dateStrip.label")} className="flex items-stretch gap-1.5">
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
            aria-label={fullDate.format(day)}
            onClick={() => onSelect(day)}
            className={`relative flex h-14 min-w-0 flex-1 flex-col items-center justify-center gap-0.5 rounded-xl border text-center transition-all duration-[var(--t-fast)] active:scale-[0.96] after:absolute after:-inset-x-1 after:inset-y-0 after:content-[''] ${
              isSelected
                ? "border-volt bg-volt text-on-volt active:bg-volt/80"
                : isToday
                  ? "border-volt bg-transparent text-volt active:bg-volt/15"
                  : "border-line bg-transparent text-ink-3 active:bg-line/20"
            }`}
          >
            <span className="text-xs font-bold leading-[14px]">
              {t(`dates.day.${DAY_NAMES[day.getDay()]}` as never)}
            </span>
            <span className="text-md font-extrabold leading-5">{digits.format(day.getDate())}</span>
            {isToday ? (
              <span
                aria-hidden="true"
                className={`h-1 w-1 rounded-full ${isSelected ? "bg-on-volt" : "bg-volt"}`}
              />
            ) : hasMatches && !isSelected ? (
              // Days with fixtures get a dot so the user can scan without
              // tapping; the selected chip needs no marker (the volt fill IS
              // the marker).
              <span aria-hidden="true" className="h-0.5 w-0.5 rounded-full bg-ink-3" />
            ) : null}
          </button>
        );
      })}
    </div>
  );
}
