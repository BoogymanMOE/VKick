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

/**
 * Yesterday … +3 as local calendar days. `setDate` (not millisecond arithmetic)
 * because a DST change makes one local day 23 or 25 hours long.
 */
function buildDays(): Date[] {
  const today = startOfDay(new Date());
  return [-1, 0, 1, 2, 3].map((offset) => {
    const d = new Date(today);
    d.setDate(today.getDate() + offset);
    return d;
  });
}

export function DateStrip({ selected, onSelect, daysWithMatches }: DateStripProps) {
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

  return (
    // A group of pressable day buttons, not a tablist: they are toggles with an
    // explicit pressed state, and role=tab would promise arrow-key semantics
    // this row does not implement.
    <div
      className="mt-4 flex items-center gap-1 overflow-x-auto px-[var(--space-page-x,16px)]"
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
            className={`min-h-11 flex-1 flex flex-col items-center justify-center gap-0.5 rounded-[12px] border px-1 text-center transition-colors duration-[var(--t-fast)] active:scale-[0.96] ${
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
  );
}
