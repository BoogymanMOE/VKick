/**
 * Club-picker tab strip: a light scrollable chip row (the same pattern as the
 * followed-league filter on Matches) instead of the boxed Segmented pill —
 * with one tab per catalog league plus the catch-alls, a boxed tablist reads
 * as a heavy gray slab that is always half-scrolled. Scrollable chips keep
 * every tab reachable and make the active one obvious.
 */
import { haptic } from "../lib/telegram";
import { cx } from "./ui";
import type { PickerGroup } from "../lib/pickerGroups";

export function PickerTabs({
  groups,
  value,
  onChange,
}: {
  groups: PickerGroup[];
  value: string;
  onChange: (key: string) => void;
}) {
  return (
    <div
      role="tablist"
      aria-label="Club groups"
      className="-mx-3 mt-3 flex gap-1.5 overflow-x-auto px-3 pb-1"
    >
      {groups.map((group) => (
        <button
          key={group.value}
          role="tab"
          type="button"
          aria-selected={value === group.value}
          onClick={() => {
            if (value !== group.value) haptic("light");
            onChange(group.value);
          }}
          className={cx(
            "min-h-11 flex-none rounded-full border px-3.5 text-[11px] font-bold transition-colors duration-[var(--t-fast)]",
            value === group.value ? "border-volt text-volt" : "border-line text-ink-3 hover:text-ink-2",
          )}
        >
          {group.label}
        </button>
      ))}
    </div>
  );
}
