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
}

export function DateStrip({ selected, onSelect }: DateStripProps) {
  const { t } = useI18n();
  const days = useMemo(() => {
    const now = new Date();
    now.setHours(0, 0, 0, 0);
    return [
      new Date(now.getTime() - 86400000), // yesterday
      now, // today
      new Date(now.getTime() + 86400000), // tomorrow
      new Date(now.getTime() + 2 * 86400000),
      new Date(now.getTime() + 3 * 86400000),
    ];
  }, []);

  const isToday = (d: Date) => {
    const today = new Date();
    return d.getFullYear() === today.getFullYear() &&
      d.getMonth() === today.getMonth() &&
      d.getDate() === today.getDate();
  };

  return (
    <div
      className="mt-4 flex items-center gap-1.5 overflow-x-auto px-[var(--space-page-x,16px)]"
      role="tablist"
      aria-label={t("dateStrip.label")}
    >
      {days.map((day) => {
        const today = isToday(day);
        return (
          <button
            key={day.toISOString()}
            type="button"
            role="tab"
            aria-selected={selected.getTime() === day.getTime()}
            onClick={() => {
              onSelect(day);
            }}
            className="min-h-[48px] flex-1 flex flex-col items-center justify-center rounded-[12px] border px-1 text-center transition-colors duration-[var(--t-fast)] active:scale-[0.97]"
            style={{
              borderColor: today ? "var(--volt)" : "var(--line)",
              backgroundColor: today
                ? "var(--volt)"
                : "transparent",
              color: today
                ? "#04221a"
                : "var(--ink-3)",
            }}
          >
            <span className="text-[12px] font-bold">
              {t(`dates.day.${DAY_NAMES[day.getDay()]}` as never)}
            </span>
            <span className="text-[15px] font-bold leading-none">
              {day.getDate()}
            </span>
          </button>
        );
      })}
    </div>
  );
}
