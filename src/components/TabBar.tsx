import { NavLink } from "react-router-dom";
import { useI18n } from "../i18n/I18nProvider";
import { haptic } from "../lib/telegram";
import { BallIcon, ChartIcon, ShirtIcon, TableIcon, UserIcon } from "./icons";
import { cx } from "./ui";
import type { StringKey } from "../i18n/strings";

/**
 * The concept's four pillars + account, as tabs: Matchday (pillars 1),
 * Leaderboards (2/3), My Teams (1), Table (1), Profile. Browse and Player
 * Stats stay reachable from within screens (TopBar links, Cups) rather than
 * consuming tab slots.
 */
const tabs: Array<{ to: string; key: StringKey; Icon: typeof BallIcon }> = [
  { to: "/matches", key: "nav.matches", Icon: BallIcon },
  { to: "/leaderboards", key: "nav.board", Icon: ChartIcon },
  { to: "/my-teams", key: "nav.myTeams", Icon: ShirtIcon },
  { to: "/table", key: "nav.table", Icon: TableIcon },
  { to: "/profile", key: "nav.profile", Icon: UserIcon },
];

export function TabBar() {
  const { t } = useI18n();

  return (
    <nav className="pad-safe-bottom sticky bottom-0 z-20 border-t border-line bg-base/95 backdrop-blur-md">
      <ul className="mx-auto flex w-full max-w-[560px] items-stretch justify-between px-1">
        {tabs.map(({ to, key, Icon }) => (
          <li key={to} className="flex-1">
            <NavLink
              to={to}
              onClick={() => haptic("light")}
              className={({ isActive }) =>
                cx(
                  "flex min-h-14 flex-col items-center justify-center gap-1 rounded-xl px-1 text-[11px] font-bold transition-colors duration-[var(--t-fast)]",
                  isActive ? "text-volt" : "text-ink-3 hover:text-ink-2",
                )
              }
            >
              {({ isActive }) => (
                <>
                  <Icon
                    strokeWidth={isActive ? 2.2 : 1.8}
                    className={cx("transition-transform duration-[var(--t-fast)]", isActive && "scale-105")}
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
