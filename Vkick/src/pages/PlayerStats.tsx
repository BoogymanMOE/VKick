import { useState } from "react";
import { TopBar } from "../components/TopBar";
import { RowSkeleton } from "../components/Skeletons";
import { EmptyState, ErrorState } from "../components/ui";
import { Card, Chip, Num, SectionHeading, Segmented, TeamBadge, cx } from "../components/ui";
import {
  SLUG_BY_LEAGUE,
  useLeaguePlayers,
  useLeagueTeamStats,
  type LeaderPlayerRow,
  type LeaderSort,
} from "../hooks/useApi";
import { TEAM_FALLBACK, readableInk } from "../lib/colors";
import { useI18n } from "../i18n/I18nProvider";
import { Link } from "react-router-dom";
import { haptic } from "../lib/telegram";
import type { StringKey } from "../i18n/strings";
import type { LeagueId } from "../types";

/**
 * Leagues with synced season standings/stats. Hardcoded to the big five for
 * now (the standings sync covers exactly these), but typed and consumed
 * through SLUG_BY_LEAGUE so adding a league to the sync is a one-line change
 * here, not a refactor.
 */
const STAT_LEAGUES: LeagueId[] = ["PL", "LL", "SA", "BL", "L1"];

/** Leaderboard columns: i18n key + the server sort field. */
const SORTS: Array<{ key: LeaderSort; labelKey: StringKey }> = [
  { key: "goals", labelKey: "stats.goals" },
  { key: "assists", labelKey: "stats.assists" },
  { key: "stat_score_total", labelKey: "ratings.points" },
  { key: "appearances", labelKey: "table.played" },
  { key: "minutes", labelKey: "stats.minutes" },
  { key: "shots", labelKey: "stats.shots" },
  { key: "shots_on_target", labelKey: "stats.onTarget" },
  { key: "yellow_cards", labelKey: "stats.yellow" },
  { key: "red_cards", labelKey: "stats.red" },
  { key: "saves", labelKey: "stats.saves" },
  { key: "goals_conceded", labelKey: "stats.conceded" },
  { key: "fouls_committed", labelKey: "stats.fouls" },
  { key: "own_goals", labelKey: "stats.ownGoals" },
];

/**
 * Player stats tables — season leaderboards per league (most goals, assists,
 * minutes, cards, saves, everything) plus a team-stats tab. All real, all
 * recomputed server-side after every sync.
 */
export default function PlayerStats() {
  const { t } = useI18n();
  const [league, setLeague] = useState<LeagueId>("PL");
  const [view, setView] = useState<"players" | "teams">("players");
  const [sort, setSort] = useState<LeaderSort>("goals");

  const slug = SLUG_BY_LEAGUE[league];

  return (
    <>
      <TopBar title={t("statsPage.title")} subtitle={t("statsPage.subtitle")} />

      <div className="mt-3">
        <Segmented
          value={view}
          onChange={setView}
          options={[
            { value: "players", label: t("statsPage.players") },
            { value: "teams", label: t("statsPage.teams") },
          ]}
        />
      </div>

      <div className="mt-3">
        <Segmented
          value={league}
          onChange={setLeague}
          options={STAT_LEAGUES.map((id) => ({ value: id, label: t(`league.${id}`) }))}
        />
      </div>

      {view === "players" ? (
        <PlayerBoard league={slug} sort={sort} onSort={setSort} />
      ) : (
        <TeamBoard league={slug} />
      )}
    </>
  );
}

function PlayerBoard({
  league,
  sort,
  onSort,
}: {
  league: string;
  sort: LeaderSort;
  onSort: (s: LeaderSort) => void;
}) {
  const { t, localize } = useI18n();
  const query = useLeaguePlayers(league, sort, 50);
  const rows = query.data ?? [];
  const activeSort = SORTS.find((s) => s.key === sort) ?? SORTS[0];

  return (
    <>
      <div className="mt-4">
        <SectionHeading
          title={t(activeSort.labelKey)}
          action={
            <select
              value={sort}
              onChange={(e) => {
                haptic("light");
                onSort(e.target.value as LeaderSort);
              }}
              className="min-h-11 rounded-card border border-line bg-surface px-3 text-xs font-bold text-ink focus:border-volt focus:outline-none"
              aria-label={t("statsPage.sortBy")}
            >
              {SORTS.map((s) => (
                <option key={s.key} value={s.key}>
                  {t(s.labelKey)}
                </option>
              ))}
            </select>
          }
        />
      </div>

      {query.isLoading ? (
        <div className="mt-3">
          <RowSkeleton rows={8} />
        </div>
      ) : query.isError ? (
        <ErrorState onRetry={() => query.refetch()} />
      ) : rows.length === 0 ? (
        <EmptyState
          title={t("stats.emptyTitle")}
          hint={t("stats.noneHint")}
          action={
            <Link
              to="/matches"
              className="min-h-11 rounded-full border border-volt px-5 text-xs font-bold leading-[2.75rem] text-volt transition-colors duration-[var(--t-fast)] hover:bg-elevated"
            >
              {t("stats.emptyAction")}
            </Link>
          }
        />
      ) : (
        <ul className="mt-3 space-y-2">
          {rows.map((row, index) => (
            <li
              key={row.playerId}
              className={cx(
                "flex items-center gap-3 rounded-card border p-2.5",
                index === 0 ? "border-gold/50 bg-elevated" : "border-line bg-surface",
              )}
            >
              <Num
                className={cx(
                  "w-6 flex-none text-center text-sm",
                  index === 0 ? "text-gold" : index < 3 ? "text-gold/80" : "text-ink-3",
                )}
              >
                {index + 1}
              </Num>
              <div
                className="grid h-9 w-9 flex-none place-items-center rounded-full text-[10px] font-bold"
                style={{ backgroundColor: row.teamColor ?? TEAM_FALLBACK, color: readableInk(row.teamColor) }}
                aria-hidden="true"
              >
                {row.jersey ?? row.position[0]}
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-bold text-ink">{localize(row.name)}</p>
                <p className="truncate text-[11px] text-ink-3">
                  {localize(row.teamShort ?? row.teamName)} · {t(`pos.${row.position}` as StringKey)} ·{" "}
                  <Num>{row.appearances}</Num>
                  {t("table.played" as StringKey)}
                </p>
              </div>
              <div className="flex-none text-end">
                <Num className={cx("block text-xl leading-none", index === 0 ? "text-gold" : "text-ink")}>
                  {formatValue(row, sort)}
                </Num>
                <span className="label text-ink-3">{t(activeSort.labelKey)}</span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

function formatValue(row: LeaderPlayerRow, sort: LeaderSort): string {
  const value =
    sort === "stat_score_total" ? row.statScoreTotal : (row[sort as keyof LeaderPlayerRow] as number);
  if (sort === "minutes" && typeof value === "number" && value >= 1000) {
    return `${Math.round(value / 100) / 10}k`;
  }
  return String(value ?? 0);
}

function TeamBoard({ league }: { league: string }) {
  const { t, localize } = useI18n();
  const query = useLeagueTeamStats(league);
  const rows = query.data ?? [];

  if (query.isLoading) {
    return (
      <div className="mt-4">
        <RowSkeleton rows={8} />
      </div>
    );
  }
  if (query.isError) {
    return <ErrorState onRetry={() => query.refetch()} />;
  }
  if (rows.length === 0) {
    return (
      <EmptyState
        title={t("stats.emptyTitle")}
        hint={t("stats.noneHint")}
        action={
          <Link
            to="/matches"
            className="min-h-11 rounded-full border border-volt px-5 text-xs font-bold leading-[2.75rem] text-volt transition-colors duration-[var(--t-fast)] hover:bg-elevated"
          >
            {t("stats.emptyAction")}
          </Link>
        }
      />
    );
  }

  return (
    <section className="mt-4">
      <SectionHeading title={t("statsPage.teamTable")} />
      <div className="space-y-2">
        {rows.map((row) => (
          <Card key={row.teamId} className="p-3">
            <div className="flex items-center gap-2">
              <TeamBadge
                team={{
                  id: row.teamId,
                  name: row.name,
                  shortName: row.shortName ?? row.name,
                  abbreviation: row.shortName?.slice(0, 3) ?? "—",
                  color: row.color ?? TEAM_FALLBACK,
                  league: "PL",
                }}
                size="sm"
              />
              <span className="min-w-0 flex-1 truncate text-sm font-bold text-ink">
                {localize(row.shortName ?? row.name)}
              </span>
              <Chip tone="muted">
                <Num>{row.played}</Num>
                {t("table.played")}
              </Chip>
            </div>
            <div className="mt-2 grid grid-cols-4 gap-2 border-t border-line pt-2 text-center">
              <Metric label={t("table.pts")} value={`${row.wins * 3 + row.draws}`} />
              <Metric label={t("stats.goals")} value={`${row.goalsFor}:${row.goalsAgainst}`} />
              <Metric label={t("stats.possession")} value={`${Math.round(row.avgPossession)}%`} />
              <Metric label={t("stats.passAccuracy")} value={`${Math.round(row.avgPassAccuracy)}%`} />
            </div>
          </Card>
        ))}
      </div>
    </section>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[10px] text-ink-3">{label}</p>
      <Num className="text-sm text-ink">{value}</Num>
    </div>
  );
}
