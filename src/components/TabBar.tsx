import { NavLink } from "react-router-dom";
import { useI18n } from "../i18n/context";
import { haptic } from "../lib/telegram";
import { BallIcon, ListIcon, UserIcon } from "./icons";
import { cx } from "../lib/cx";
import type { StringKey } from "../i18n/strings";

/**
 * Three tabs: Matches, Tables, Profile. Browse is now inside Tables.
 */
const tabs: Array<{ to: string; key: StringKey; Icon: typeof BallIcon }> = [
  { to: "/matches", key: "nav.matches", Icon: BallIcon },
  { to: "/table", key: "nav.table", Icon: ListIcon },
  { to: "/profile", key: "nav.profile", Icon: UserIcon },
];

export function TabBar() {
  const { t } = useI18n();

  return (      // 95% opaque, so no backdrop blur — same reasoning as TopBar: the blur was
    // imperceptible but ran on every scroll frame.
    // Ad is now inline and scrolls with content, so TabBar sits at the very bottom.
    <nav
      className="pad-safe-bottom sticky z-20 border-t border-line bg-base/95"
    >
      <ul className="mx-auto flex w-full max-w-[560px] items-stretch justify-between px-2 pt-1">
        {tabs.map(({ to, key, Icon }) => (
          <li key={to} className="flex-1">
            <NavLink
              to={to}
              onClick={() => haptic("light")}
              className={({ isActive }) =>
                cx(
                  "relative flex min-h-14 flex-col items-center justify-center gap-1 rounded-xl px-1 text-[11px] font-bold transition-[color,background-color] duration-[var(--t-fast)]",
                  isActive ? "bg-elevated/70 text-volt" : "text-ink-3 hover:text-ink-2",
                )
              }
            >
              {({ isActive }) => (
                <>
                  {/* Shape cue, not just colour: a colour-blind user (or one
                      in grayscale) reads "you are here" from this bar even
                      when the volt text is indistinguishable. aria-current on
                      the link already carries it for screen readers. */}
                  <span
                    aria-hidden="true"
                    className={cx(
                      "absolute top-0.5 h-[3px] w-6 rounded-full bg-volt transition-opacity duration-[var(--t-fast)]",
                      isActive ? "opacity-100" : "opacity-0",
                    )}
                  />
                  <Icon
                    strokeWidth={isActive ? 2.2 : 1.8}
                    className={cx(
                      "transition-transform duration-[var(--t-fast)]",
                      isActive && "tab-pop scale-105",
                    )}
                  />
                  <span className="truncate">{t(key)}</span>
                </>
              )}
            </NavLink>
          </li>
        ))}
      </ul>
    </nav>
  );
}
