import { NavLink } from "react-router-dom";
import { useI18n } from "../i18n/I18nProvider";
import { haptic } from "../lib/telegram";
import { BallIcon, ChartIcon, TableIcon, UserIcon, ShirtIcon } from "./icons";
import { cx } from "./ui";
import type { StringKey } from "../i18n/strings";

/**
 * Matchday leads; My Teams is gone (favorites are picked in onboarding and
 * edited from Profile), so Browse takes its tab slot. Player Stats doesn't
 * consume a tab slot either — it's linked from the Ranks top bar and from a
 * match's Stats tab, both places ranking-curious readers already are.
 */
const tabs: Array<{ to: string; key: StringKey; Icon: typeof BallIcon }> = [
  { to: "/matches", key: "nav.matches", Icon: BallIcon },
  { to: "/leaderboards", key: "nav.board", Icon: ChartIcon },
  { to: "/browse", key: "nav.browse", Icon: ShirtIcon },
  { to: "/table", key: "nav.table", Icon: TableIcon },
  { to: "/profile", key: "nav.profile", Icon: UserIcon },
];

export function TabBar() {
  const { t } = useI18n();

  return (
    // 95% opaque, so no backdrop blur — same reasoning as TopBar: the blur was
    // imperceptible but ran on every scroll frame.
    <nav className="pad-safe-bottom sticky bottom-0 z-20 border-t border-line bg-base/95">
      <ul className="mx-auto flex w-full max-w-[560px] items-stretch justify-between px-1">
        {tabs.map(({ to, key, Icon }) => (
          <li key={to} className="flex-1">
            <NavLink
              to={to}
              onClick={() => haptic("light")}
              className={({ isActive }) =>
                cx(
                  "relative flex min-h-14 flex-col items-center justify-center gap-1 rounded-xl px-1 text-[11px] font-bold transition-colors duration-[var(--t-fast)]",
                  isActive ? "text-volt" : "text-ink-3 hover:text-ink-2",
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
