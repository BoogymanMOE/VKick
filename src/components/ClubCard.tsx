import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { useMemo } from "react";
import { useMatches } from "../hooks/useApi";
import { useI18n } from "../i18n/context";
import { formatKickoff } from "../lib/format";
import type { Team } from "../types";
import { cx } from "../lib/cx";
import { LiveDot, Num, TeamBadge } from "./ui";
import { CloseIcon, StarFilledIcon } from "./icons";
import { clubContext, opponentOf } from "../lib/clubContext";

/**
 * Compact club tile with its fixture state — the shared atom behind the home
 * page "My teams" strip and the picked-clubs row on the My Teams screen.
 * Tapping it opens the club's live/next match; `onRemove` renders the × affordance;
 * `onMakeAnchor` renders the ★ affordance that sets the club as the favorite.
 */
export function ClubFixtureCard({
  team,
  anchored = false,
  onMakeAnchor,
  onRemove,
}: {
  team: Team;
  anchored?: boolean;
  onMakeAnchor?: () => void;
  onRemove?: () => void;
}) {
  const { t, lang, localize } = useI18n();
  const locale = lang === "fa" ? "fa-IR" : undefined;
  const matchesQuery = useMatches();
  const all = useMemo(() => matchesQuery.data ?? [], [matchesQuery.data]);
  const { match, live, next, last } = clubContext(team.id, all);
  const name = localize(team.shortName);

  let status: ReactNode;
  if (live) {
    const goalsFor = live.home.id === team.id ? live.homeScore : live.awayScore;
    const goalsAgainst = live.home.id === team.id ? live.awayScore : live.homeScore;
    status = (
      <span className="inline-flex items-center gap-1 text-xs font-bold text-live">
        <LiveDot />
        <Num>
          {goalsFor}-{goalsAgainst}
        </Num>
        <span className="text-xs font-normal text-ink-3">{live.minute}</span>
      </span>
    );
  } else if (next) {
    status = (
      <span className="flex w-full flex-col items-center gap-0.5 text-xs leading-tight text-ink-3">
        <span className="w-full truncate">
          {t("myTeams.vsOpp", { opp: localize(opponentOf(team.id, next).shortName) })}
        </span>
        <span>{formatKickoff(new Date(next.kickoffAt), locale)}</span>
      </span>
    );
  } else if (last) {
    status = (
      <span className="w-full truncate text-xs text-ink-3">
        <Num>{last.homeScore}</Num>-<Num>{last.awayScore}</Num>
      </span>
    );
  } else {
    status = <span className="text-xs text-ink-3">{t("matches.noMatch")}</span>;
  }

  const body = (
    <div
      className={cx(
        "flex w-[92px] flex-col items-center gap-1 rounded-card border bg-surface p-2.5 text-center",
        anchored ? "border-gold" : "border-line",
      )}
    >
      <TeamBadge team={team} size="md" />
      <span className="w-full truncate text-xs font-bold text-ink">{name}</span>
      {status}
      {anchored ? (
        <span className="text-gold">
          <StarFilledIcon className="h-2.5 w-2.5" />
        </span>
      ) : null}
    </div>
  );

  return (
    <li className="relative flex-none">
      {match ? (
        <Link
          to={`/match/${match.id}`}
          className="block rounded-card transition-[background-color,transform] duration-[var(--t-fast)] hover:bg-elevated active:scale-[0.98]"
        >
          {body}
        </Link>
      ) : (
        body
      )}
      {onMakeAnchor ? (
        <button
          type="button"
          onClick={onMakeAnchor}
          aria-label={t("onboarding.makeFavorite")}
          aria-pressed={anchored}
          className="absolute -top-1 -start-1 grid h-11 w-11 place-items-center rounded-full"
        >
          <span
            className={cx(
              "grid h-5 w-5 place-items-center rounded-full border bg-elevated transition-colors duration-[var(--t-fast)]",
              // Keyed on `anchored`: promotion remounts the dot so the star
              // replays star-pop instead of the fill just blinking on.
              anchored ? "star-pop border-gold text-gold" : "border-line text-ink-3",
            )}
            key={anchored ? "on" : "off"}
            aria-hidden="true"
          >
            <StarFilledIcon className="h-2.5 w-2.5" />
          </span>
        </button>
      ) : null}
      {onRemove ? (
        <button
          type="button"
          onClick={onRemove}
          aria-label={t("myTeams.removed", { team: name })}
          className="absolute -top-1 -end-1 grid h-11 w-11 place-items-center rounded-full"
        >
          <span
            className="grid h-5 w-5 place-items-center rounded-full border border-line bg-elevated text-ink-2 transition-colors duration-[var(--t-fast)] hover:border-danger hover:text-danger"
            aria-hidden="true"
          >
            <CloseIcon className="h-2.5 w-2.5" />
          </span>
        </button>
      ) : null}
    </li>
  );
}
