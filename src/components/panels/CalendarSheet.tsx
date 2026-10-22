import { useMemo, useState } from "react";
import { BottomSheet } from "../BottomSheet";
import { dayKey } from "../DateStrip";
import { ChevronLeftIcon, ChevronRightIcon } from "../icons";
import { useI18n } from "../../i18n/context";
import {
  addJalaliMonths,
  jalaliMonthIndex,
  jalaliMonthLength,
  jalaliToGregorian,
  JALALI_MONTHS_FA,
  toJalali,
} from "../../lib/jalali";
import { cx } from "../../lib/cx";
import { selectionHaptic } from "../../lib/telegram";

/**
 * Persian gets its own calendar SYSTEM, not a transliterated month list: the
 * sheet under Persian runs on the Solar Hijri (Jalali) calendar — فروردین
 * first, Jalali year, Jalali day numbers — while the underlying cells stay
 * real `Date` objects so day keys and match dots never disagree. English keeps
 * the Gregorian month list. The year and day numbers still come from Intl,
 * because "۲۱" is not "21" in another font.
 */
const MONTH_NAMES_EN = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

/**
 * Weekday headers. The grid keeps the Sunday-first order in both languages —
 * only the names flip, so the two languages read the same grid.
 */
const DOW_EN = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const DOW_FA = ["شن", "یک", "دو", "سه", "چه", "پن", "جمع"];

/**
 * How many months the sheet may travel from today — 3 back, 3 ahead. The
 * month grid can only land on whole months of the active calendar, so the
 * clamp compares month indices of that calendar; the day feed covers the
 * full range (see Matches).
 */
const HORIZON_MONTHS = 3;

/**
 * The month under construction, one calendar per language: Jalali {jy, jm}
 * (1-based months) under Persian, Gregorian {y, m} (0-based) under English.
 */
interface MonthView {
  y: number;
  /** 1-based under Persian, 0-based under English — never mixed. */
  m: number;
}

/** Gregorian month arithmetic on a 0-based index (Dec→Jan rollover free). */
function addGregorianMonths(y: number, m: number, delta: number): MonthView {
  const idx = y * 12 + m + delta;
  return { y: Math.floor(idx / 12), m: ((idx % 12) + 12) % 12 };
}

/** Jalali month offset reshaped to a view tile (addJalaliMonths speaks {jy, jm}). */
function offsetJalali(jy: number, jm: number, delta: number): MonthView {
  const r = addJalaliMonths(jy, jm, delta);
  return { y: r.jy, m: r.jm };
}

/** Clamp a view into the reachable ±HORIZON_MONTHS band of its calendar. */
function clampView(view: MonthView, min: MonthView, max: MonthView): MonthView {
  if (view.y * 12 + view.m < min.y * 12 + min.m) return min;
  if (view.y * 12 + view.m > max.y * 12 + max.m) return max;
  return view;
}

/**
 * Month-view date picker — the jump-to-any-day escape hatch at the end of the
 * date strip.
 *
 * The strip covers three weeks; this covers today ± 3 months, in the ACTIVE
 * calendar (Solar Hijri in Persian, Gregorian in English), so a user looking
 * for a match months away hunts for it in their own month names without
 * browsing outside the synced fixture window. It is a picker first: a day
 * outside any fixtures shows no dot, and picking an empty day lands on the
 * feed's "no matches on this day" state rather than a lie.
 */
export function CalendarSheet({
  open,
  onClose,
  selected,
  onSelect,
  daysWithMatches,
}: {
  open: boolean;
  onClose: () => void;
  selected: Date;
  onSelect: (date: Date) => void;
  /** Day keys (DateStrip's `dayKey` format) that have at least one match. */
  daysWithMatches?: Set<string>;
}) {
  const { t, lang } = useI18n();
  const isFa = lang === "fa";
  const digits = useMemo(
    () => new Intl.NumberFormat(isFa ? "fa-IR" : undefined, { useGrouping: false }),
    [isFa],
  );

  // The reachable band, anchored at TODAY's month of each calendar. Computed
  // per render from the clock (cheap math), so an app left open across a month
  // boundary drifts its clamp along instead of sticking.
  const [minView, maxView] = useMemo<[MonthView, MonthView]>(() => {
    const now = new Date();
    if (isFa) {
      const t = toJalali(now);
      return [
        offsetJalali(t.jy, t.jm, -HORIZON_MONTHS),
        offsetJalali(t.jy, t.jm, HORIZON_MONTHS),
      ];
    }
    return [
      addGregorianMonths(now.getFullYear(), now.getMonth(), -HORIZON_MONTHS),
      addGregorianMonths(now.getFullYear(), now.getMonth(), HORIZON_MONTHS),
    ];
  }, [isFa]);

  // The month on screen. Re-opening the sheet always lands on the selected
  // day's month (clamped into the band) — otherwise a user who browsed to a
  // far month would come back to it after picking a day elsewhere.
  const [view, setView] = useState<MonthView>(() => clampView(viewOf(selected, isFa), minView, maxView));
  // Open/close phase, so the reset above runs on the open EDGE and not on
  // every render (the selected date is a fresh object each minute).
  const [wasOpen, setWasOpen] = useState(open);
  if (open && !wasOpen) {
    setWasOpen(true);
    setView(clampView(viewOf(selected, isFa), minView, maxView));
  }
  if (!open && wasOpen) setWasOpen(false);

  const monthName = isFa ? JALALI_MONTHS_FA[view.m - 1] : MONTH_NAMES_EN[view.m];
  const dowNames = isFa ? DOW_FA : DOW_EN;

  /** The month's days as real Dates, padded to whole weeks. */
  const cells = useMemo(() => {
    const out: Array<Date | null> = [];
    const first = isFa ? jalaliToGregorian(view.y, view.m, 1) : new Date(view.y, view.m, 1);
    const days = isFa ? jalaliMonthLength(view.y, view.m) : lastGregDay(view.y, view.m);
    // Leading blanks: the month's first day sits in its own weekday column.
    // Both languages read the grid Saturday-first in Persian (Sat=0) and
    // Sunday-first in English, so the shift survives the calendar switch.
    const startDow = isFa ? (first.getDay() + 1) % 7 : first.getDay();
    for (let i = 0; i < startDow; i++) out.push(null);
    if (isFa) {
      for (let d = 1; d <= days; d++) out.push(jalaliToGregorian(view.y, view.m, d));
    } else {
      for (let d = 1; d <= days; d++) out.push(new Date(view.y, view.m, d));
    }
    // Trailing blanks fill the last row.
    while (out.length % 7 !== 0) out.push(null);
    return out;
  }, [view.y, view.m, isFa]);

  const todayKey = dayKey(new Date());
  const selectedKey = dayKey(selected);

  const atMin = isFa
    ? jalaliMonthIndex(view.y, view.m) <= jalaliMonthIndex(minView.y, minView.m)
    : view.y * 12 + view.m <= minView.y * 12 + minView.m;
  const atMax = isFa
    ? jalaliMonthIndex(view.y, view.m) >= jalaliMonthIndex(maxView.y, maxView.m)
    : view.y * 12 + view.m >= maxView.y * 12 + maxView.m;

  const prevMonth = () =>
    setView((v) => (isFa ? offsetJalali(v.y, v.m, -1) : addGregorianMonths(v.y, v.m, -1)));
  const nextMonth = () =>
    setView((v) => (isFa ? offsetJalali(v.y, v.m, 1) : addGregorianMonths(v.y, v.m, 1)));

  return (
    <BottomSheet open={open} onClose={onClose} title={t("calendar.title")}>
      {/* Month navigation. The chevrons point at the side they move to, and
          mirror themselves in Persian — the document direction flips the row,
          so a fixed left arrow would point away from the month it opens.
          At the band's edge the step is a no-op and the chevron dimmed: the
          clamp, not a silently-drifting grid, is what holds the horizon. */}
      <div className="mb-4 flex items-center justify-between">
        <button
          type="button"
          onClick={prevMonth}
          disabled={atMin}
          aria-label={t("calendar.prevMonth")}
          className={cx(
            "grid h-11 w-11 flex-none place-items-center rounded-lg border transition-colors duration-[var(--t-fast)] active:scale-[0.96]",
            atMin ? "border-line/50 text-ink-3/60" : "border-line text-ink-2 hover:bg-elevated",
          )}
        >
          <ChevronLeftIcon className="rtl:-scale-x-100" />
        </button>
        <span className="min-w-0 flex-1 truncate text-center text-md font-bold text-ink">
          {monthName} {digits.format(view.y)}
        </span>
        <button
          type="button"
          onClick={nextMonth}
          disabled={atMax}
          aria-label={t("calendar.nextMonth")}
          className={cx(
            "grid h-11 w-11 flex-none place-items-center rounded-lg border transition-colors duration-[var(--t-fast)] active:scale-[0.96]",
            atMax ? "border-line/50 text-ink-3/60" : "border-line text-ink-2 hover:bg-elevated",
          )}
        >
          <ChevronRightIcon />
        </button>
      </div>

      {/* Back to today. The sheet opens on the selected day's month, so after
          browsing to a far month the current week is many taps away; this is
          the one tap back. 44px tall, like every other control in the sheet. */}
      <button
        type="button"
        onClick={() => {
          selectionHaptic();
          onSelect(new Date());
          onClose();
        }}
        className="mb-4 flex h-11 w-full items-center justify-center rounded-lg border border-line text-sm font-bold text-ink-2 transition-colors duration-[var(--t-fast)] hover:bg-elevated active:scale-[0.98]"
      >
        {t("matches.today")}
      </button>

      {/* Weekday header. */}
      <div className="mb-1 grid grid-cols-7 gap-1">
        {dowNames.map((dow) => (
          <div key={dow} className="text-center text-xs font-bold text-ink-3">
            {dow}
          </div>
        ))}
      </div>

      {/* The month. In Persian mode the numbers are the JALALI day of the
          cell — the Jalali month can straddle two Gregorian months, and the
          display must follow the name in the header, not the host calendar. */}
      <div className="grid grid-cols-7 gap-1">
        {cells.map((day, index) => {
          if (!day) {
            // Blank cell: it holds the grid's place so the first of the month
            // lands in its own weekday column.
            return <span key={`blank-${index}`} aria-hidden="true" />;
          }
          const key = dayKey(day);
          const isToday = key === todayKey;
          const isSelected = key === selectedKey;
          const hasMatches = daysWithMatches?.has(key) ?? false;
          const dayNum = isFa ? toJalali(day).jd : day.getDate();
          return (
            <button
              key={key}
              type="button"
              aria-pressed={isSelected}
              aria-current={isToday ? "date" : undefined}
              onClick={() => {
                selectionHaptic();
                onSelect(day);
                onClose();
              }}
              className={cx(
                "flex min-h-11 flex-col items-center justify-center gap-0.5 rounded-lg border text-sm font-bold transition-colors duration-[var(--t-fast)] active:scale-[0.96]",
                isSelected
                  ? "border-volt bg-volt text-on-volt"
                  : isToday
                    ? "border-volt bg-transparent text-volt"
                    : "border-line bg-transparent text-ink",
              )}
            >
              <span className="num-display tabular-nums">{digits.format(dayNum)}</span>
              {hasMatches ? (
                // A day with fixtures carries a dot, so a busy Saturday reads as
                // busy before the tap. The selected day's fill IS the marker.
                <span
                  aria-hidden="true"
                  className={cx(
                    "mt-0.5 h-1 w-1 rounded-full",
                    isSelected ? "bg-on-volt" : "bg-volt",
                  )}
                />
              ) : (
                // Keeps every cell the same height whether or not it has a dot.
                <span aria-hidden="true" className="mt-0.5 h-1 w-1" />
              )}
            </button>
          );
        })}
      </div>
    </BottomSheet>
  );
}

/** The view (month tile) the given date belongs to, in the active calendar. */
function viewOf(date: Date, isFa: boolean): MonthView {
  if (isFa) {
    const j = toJalali(date);
    return { y: j.jy, m: j.jm };
  }
  return { y: date.getFullYear(), m: date.getMonth() };
}

/** Last local day of a Gregorian month (day-before-first-of-next). */
function lastGregDay(y: number, m: number): number {
  return new Date(y, m + 1, 0).getDate();
}
