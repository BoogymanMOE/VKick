import { useMemo, useState } from "react";
import { BottomSheet } from "../BottomSheet";
import { dayKey } from "../DateStrip";
import { ChevronLeftIcon, ChevronRightIcon } from "../icons";
import { useI18n } from "../../i18n/context";
import { cx } from "../../lib/cx";
import { selectionHaptic } from "../../lib/telegram";

/**
 * Month names for the picker header. Persian gets its own list — a
 * localized month name is not the English one in a different script — and the
 * year and the day numbers come from Intl, because "۲۱" is not "21" in
 * another font.
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
const MONTH_NAMES_FA = [
  "ژانویه",
  "فوریه",
  "مارس",
  "آوریل",
  "مه",
  "ژوئن",
  "ژوئیه",
  "اوت",
  "سپتامبر",
  "اکتبر",
  "نوامبر",
  "دسامبر",
];

/**
 * Weekday headers. The grid keeps the Sunday-first order in both languages —
 * only the names flip, so the two languages read the same grid.
 */
const DOW_EN = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const DOW_FA = ["شن", "یک", "دو", "سه", "چه", "پن", "جمع"];

/**
 * Month-view date picker — the jump-to-any-day escape hatch at the end of the
 * date strip.
 *
 * The strip covers three weeks; this covers everything, so a user looking for
 * a match two months back does not have to hunt for it in a strip that is not
 * there. It is a picker first: a day outside the synced fixture window shows
 * no dot, and picking it lands on the feed's "no matches on this day" state
 * rather than a lie.
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

  // The month on screen. Re-opening the sheet always lands on the selected
  // day's month — otherwise a user who browsed to March would come back to
  // March after picking a day in October.
  const [view, setView] = useState({
    month: selected.getMonth(),
    year: selected.getFullYear(),
  });
  // Open/close phase, so the reset above runs on the open EDGE and not on
  // every render (the selected date is a fresh object each minute).
  const [wasOpen, setWasOpen] = useState(open);
  if (open && !wasOpen) {
    setWasOpen(true);
    setView({ month: selected.getMonth(), year: selected.getFullYear() });
  }
  if (!open && wasOpen) setWasOpen(false);

  const monthName = isFa ? MONTH_NAMES_FA[view.month] : MONTH_NAMES_EN[view.month];
  const dowNames = isFa ? DOW_FA : DOW_EN;

  /** The month's days, padded to whole weeks so the grid never shifts. */
  const cells = useMemo(() => {
    const first = new Date(view.year, view.month, 1);
    const last = new Date(view.year, view.month + 1, 0);
    const out: Array<Date | null> = [];
    // Leading blanks: the first day of the month sits in its own weekday
    // column.
    // In FA mode, the week starts on Saturday (day 6 in JS getDay()),
    // so we shift by 1: Saturday (6) becomes 0, Sunday (0) becomes 1, etc.
    // In EN mode, the week starts on Sunday, so getDay() is used as-is.
    const startDow = lang === "fa"
      ? (first.getDay() + 1) % 7   // Sat=0, Sun=1, Mon=2, Tue=3, Wed=4, Thu=5, Fri=6
      : first.getDay();            // Sun=0, Mon=1, ... (unchanged)
    for (let i = 0; i < startDow; i++) out.push(null);
    for (let d = 1; d <= last.getDate(); d++) out.push(new Date(view.year, view.month, d));
    // Trailing blanks fill the last row.
    while (out.length % 7 !== 0) out.push(null);
    return out;
  }, [view.year, view.month, lang]);

  const todayKey = dayKey(new Date());
  const selectedKey = dayKey(selected);

  const prevMonth = () =>
    setView((v) =>
      v.month === 0 ? { month: 11, year: v.year - 1 } : { month: v.month - 1, year: v.year },
    );
  const nextMonth = () =>
    setView((v) =>
      v.month === 11 ? { month: 0, year: v.year + 1 } : { month: v.month + 1, year: v.year },
    );

  return (
    <BottomSheet open={open} onClose={onClose} title={t("calendar.title")}>
      {/* Month navigation. The chevrons point at the side they move to, and
          mirror themselves in Persian — the document direction flips the row,
          so a fixed left arrow would point away from the month it opens. */}
      <div className="mb-4 flex items-center justify-between">
        <button
          type="button"
          onClick={prevMonth}
          aria-label={t("calendar.prevMonth")}
          className="grid h-11 w-11 flex-none place-items-center rounded-lg border border-line text-ink-2 transition-colors duration-[var(--t-fast)] hover:bg-elevated active:scale-[0.96]"
        >
          <ChevronLeftIcon className="rtl:-scale-x-100" />
        </button>
        <span className="min-w-0 flex-1 truncate text-center text-md font-bold text-ink">
          {monthName} {digits.format(view.year)}
        </span>
        <button
          type="button"
          onClick={nextMonth}
          aria-label={t("calendar.nextMonth")}
          className="grid h-11 w-11 flex-none place-items-center rounded-lg border border-line text-ink-2 transition-colors duration-[var(--t-fast)] hover:bg-elevated active:scale-[0.96]"
        >
          <ChevronRightIcon />
        </button>
      </div>

      {/* Weekday header. */}
      <div className="mb-1 grid grid-cols-7 gap-1">
        {dowNames.map((dow) => (
          <div key={dow} className="text-center text-xs font-bold text-ink-3">
            {dow}
          </div>
        ))}
      </div>

      {/* The month. */}
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
              <span className="num-display tabular-nums">{digits.format(day.getDate())}</span>
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
