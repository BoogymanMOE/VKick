import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { useMemo } from "react";
import { useMatches } from "../hooks/useApi";
import { useI18n } from "../i18n/I18nProvider";
import { formatKickoff } from "../lib/format";
import type { Match, Team } from "../types";
import { LiveDot, Num, TeamBadge, cx } from "./ui";
import { CloseIcon, StarFilledIcon } from "./icons";

/** A club's context in the fixture list: live now, else next kickoff, else last result. */
export function clubContext(teamId: string, matches: Match[]) {
  const mine = matches.filter((m) => m.home.id === teamId || m.away.id === teamId);
  const newestFirst = (a: Match, b: Match) => +new Date(b.kickoffAt) - +new Date(a.kickoffAt);
  const soonestFirst = (a: Match, b: Match) => +new Date(a.kickoffAt) - +new Date(b.kickoffAt);
  const live = mine.find((m) => m.status === "live");
  const next = mine.filter((m) => m.status === "scheduled").sort(soonestFirst)[0];
  const last = mine.filter((m) => m.status === "finished").sort(newestFirst)[0];
  return { match: live ?? next ?? last, live, next, last };
}

export function opponentOf(teamId: string, match: Match) {
  return match.home.id === teamId ? match.away : match.home;
}

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
      <span className="inline-flex items-center gap-1 text-[11px] font-bold text-live">
        <LiveDot />
        <Num>
          {goalsFor}-{goalsAgainst}
        </Num>
        <span className="text-[10px] font-normal text-ink-3">{live.minute}</span>
      </span>
    );
  } else if (next) {
    status = (
      <span className="flex w-full flex-col items-center gap-0.5 text-[10px] leading-tight text-ink-3">
        <span className="w-full truncate">
          {t("myTeams.vsOpp", { opp: localize(opponentOf(team.id, next).shortName) })}
        </span>
        <span>{formatKickoff(new Date(next.kickoffAt), locale)}</span>
      </span>
    );
  } else if (last) {
    status = (
      <span className="w-full truncate text-[11px] text-ink-3">
        <Num>{last.homeScore}</Num>-<Num>{last.awayScore}</Num>
      </span>
    );
  } else {
    status = <span className="text-[10px] text-ink-3">{t("matches.noMatch")}</span>;
  }

  const body = (
    <div
      className={cx(
        "flex w-[92px] flex-col items-center gap-1 rounded-card border bg-surface p-2.5 text-center",
        anchored ? "border-gold" : "border-line",
      )}
    >
      <TeamBadge team={team} size="md" />
      <span className="w-full truncate text-[11px] font-bold text-ink">{name}</span>
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
          className="block rounded-card transition-colors duration-[var(--t-fast)] hover:bg-elevated"
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
              anchored ? "border-gold text-gold" : "border-line text-ink-3",
            )}
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
