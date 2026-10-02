import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { TopBar } from "../components/TopBar";
import { PanelSkeleton } from "../components/Skeletons";
import {
  Card,
  Chip,
  EmptyState,
  ErrorState,
  Num,
  SectionHeading,
  Segmented,
  TeamBadge,
  cx,
} from "../components/ui";
import { useSquad, useTeamDetail, useTeamUnderstat } from "../hooks/useApi";
import type { StringKey } from "../i18n/strings";
import { usePrefetchMatch } from "../hooks/usePrefetch";
import { TEAM_FALLBACK } from "../lib/colors";
import { useI18n } from "../i18n/I18nProvider";
import { formatKickoff, formatKickoffDate } from "../lib/format";
import type { ApiMatch } from "../lib/api";
import type { Position } from "../types";

type Tab = "squad" | "form" | "stats" | "xg";

const POS_ORDER: Position[] = ["GK", "DEF", "MID", "FWD"];

/**
 * A club's page: full squad (from the weekly roster sync), season stat line and
 * recent fixtures. Reached by tapping any team in the table or a match card.
 */
export default function TeamPage() {
  const { id = "" } = useParams();
  const { t, localize } = useI18n();

  const detailQuery = useTeamDetail(id);
  const squadQuery = useSquad(id);

  const [tab, setTab] = useState<Tab>("squad");

  if (detailQuery.isLoading || !detailQuery.data) {
    return (
      <>
        <TopBar title={t("team.title")} back />
        <PanelSkeleton height={160} />
      </>
    );
  }

  if (detailQuery.isError) {
    return (
      <>
        <TopBar title={t("team.title")} back />
        <div className="mt-3">
          <ErrorState onRetry={() => detailQuery.refetch()} />
        </div>
      </>
    );
  }

  const { team, seasonStats, fixtures } = detailQuery.data;
  const leagueId =
    team.league && ["eng.1", "esp.1", "ita.1", "ger.1", "fra.1"].includes(team.league)
      ? (
          { "eng.1": "PL", "esp.1": "LL", "ita.1": "SA", "ger.1": "BL", "fra.1": "L1" } as Record<
            string,
            "PL" | "LL" | "SA" | "BL" | "L1"
          >
        )[team.league]
      : null;

  const teamView = {
    id: team.id,
    name: team.name,
    shortName: team.short_name ?? team.name,
    abbreviation: team.abbreviation ?? (team.short_name ?? team.name).slice(0, 3).toUpperCase(),
    color: team.color ?? TEAM_FALLBACK,
    league: leagueId ?? "PL",
  };

  return (
    <>
      <TopBar
        title={localize(teamView.shortName)}
        subtitle={leagueId ? t(`league.${leagueId}`) : team.league}
        back
      />

      {/* Club header */}
      <div className="relative mt-3 overflow-hidden rounded-card border border-line bg-surface p-4">
        <div className="flex items-center gap-3">
          <TeamBadge team={teamView} size="lg" />
          <div className="min-w-0">
            <p className="truncate text-base font-bold text-ink">{localize(team.name)}</p>
            <p className="text-xs text-ink-3">
              {squadQuery.data?.coach ? `${t("lineups.coach")}: ${localize(squadQuery.data.coach)} · ` : ""}
              {seasonStats ? t("team.played", { played: seasonStats.played }) : null}
            </p>
          </div>
        </div>
      </div>

      <div className="mt-4">
        <Segmented
          value={tab}
          onChange={setTab}
          options={[
            { value: "squad", label: t("team.tabSquad") },
            { value: "form", label: t("team.tabFixtures") },
            { value: "stats", label: t("team.tabStats") },
            { value: "xg", label: t("team.tabXg") },
          ]}
        />
      </div>

      <section className="panel-in mt-4" key={tab}>
        {tab === "squad" ? <SquadTab squadQuery={squadQuery} /> : null}
        {tab === "form" ? <FixturesTab fixtures={fixtures} /> : null}
        {tab === "stats" ? <StatsTab stats={seasonStats} /> : null}
        {tab === "xg" ? (
          <XgTab
            teamId={team.id}
            played={seasonStats?.played ?? 0}
            points={seasonStats ? seasonStats.wins * 3 + seasonStats.draws : null}
          />
        ) : null}
      </section>
    </>
  );
}

/* ------------------------------------------------------------ squad */

function SquadTab({ squadQuery }: { squadQuery: ReturnType<typeof useSquad> }) {
  const { t, localize } = useI18n();
  if (squadQuery.isLoading) return <PanelSkeleton height={192} />;
  if (squadQuery.isError) return <ErrorState onRetry={() => squadQuery.refetch()} />;

  const squad = squadQuery.data;
  if (!squad || squad.players.length === 0) {
    return <EmptyState title={t("team.squadEmpty")} hint={t("team.squadEmptyHint")} />;
  }

  return (
    <div className="space-y-4">
      {POS_ORDER.map((pos) => {
        const group = squad.players.filter((p) => p.position === pos);
        if (group.length === 0) return null;
        return (
          <div key={pos}>
            <SectionHeading
              title={t(`pos.${pos}`)}
              action={
                <Chip tone="muted">
                  <Num>{group.length}</Num>
                </Chip>
              }
            />
            <ul className="space-y-1.5">
              {group.map((player) => (
                <li
                  key={player.id}
                  className="flex items-center gap-3 rounded-card border border-line bg-surface p-2.5"
                >
                  <Num className="grid h-7 w-7 flex-none place-items-center rounded-full bg-elevated text-[11px] text-ink-2">
                    {player.jersey ?? "–"}
                  </Num>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-bold text-ink">{localize(player.name)}</span>
                    <span className="text-[11px] text-ink-3">
                      {player.espnPosition ?? t(`pos.${player.position}`)}
                      {player.appearances ? ` · ${t("team.appearances", { count: player.appearances })}` : ""}
                    </span>
                  </span>
                  <span className="flex-none text-end">
                    <Num className={cx("text-sm", (player.goals ?? 0) > 0 ? "text-volt" : "text-ink-3")}>
                      {player.goals ?? 0}
                    </Num>
                    <Num className={cx("text-sm", (player.assists ?? 0) > 0 ? "text-gold" : "text-ink-3")}>
                      {" "}
                      {player.assists ?? 0}
                    </Num>
                  </span>
                </li>
              ))}
            </ul>
          </div>
        );
      })}
    </div>
  );
}

/* ------------------------------------------------------------ fixtures */

function FixturesTab({ fixtures }: { fixtures: ApiMatch[] }) {
  const { t, lang, localize } = useI18n();
  const prefetchMatch = usePrefetchMatch();
  const locale = lang === "fa" ? "fa-IR" : undefined;
  if (fixtures.length === 0) return <EmptyState title={t("team.noFixtures")} />;

  return (
    <ul className="space-y-2">
      {fixtures.map((match) => (
        <li key={match.id} className="flex items-center gap-2 rounded-card border border-line bg-surface p-3">
          <Num className="w-14 flex-none text-[11px] text-ink-3">
            {formatKickoff(new Date(match.kickoff_at), locale)}
          </Num>
          <Link
            to={`/match/${match.id}`}
            onPointerDown={() => prefetchMatch(match.id)}
            className="min-w-0 flex-1 truncate text-xs font-bold text-ink transition-colors duration-[var(--t-fast)] hover:text-volt"
          >
            {localize(match.home_short ?? "")} {t("common.versus")} {localize(match.away_short ?? "")}
          </Link>
          {match.status === "finished" ? (
            <Chip tone="muted" className="flex-none">
              <Num>
                {match.home_score ?? 0}–{match.away_score ?? 0}
              </Num>
            </Chip>
          ) : match.status === "live" ? (
            <Chip tone="live" className="flex-none">
              <Num>{match.minute_display ?? ""}</Num>
            </Chip>
          ) : (
            <Chip tone="volt" className="flex-none">
              <Num>{formatKickoffDate(new Date(match.kickoff_at), locale)}</Num>
            </Chip>
          )}
          {match.status === "finished" ? (
            <Link
              to={`/match/${match.id}/replay`}
              className="flex-none text-[11px] font-bold text-volt underline underline-offset-2"
            >
              {t("replay.title")}
            </Link>
          ) : null}
        </li>
      ))}
    </ul>
  );
}

/* ------------------------------------------------------------ season stats */

type SeasonStats = NonNullable<ReturnType<typeof useTeamDetail>["data"]>["seasonStats"];

function StatsTab({ stats }: { stats: SeasonStats }) {
  const { t } = useI18n();
  if (!stats) return <EmptyState title={t("team.statsEmpty")} hint={t("team.statsEmptyHint")} />;

  const rows: Array<{ label: string; value: string }> = [
    { label: t("statsPage.teams"), value: `${stats.wins}W ${stats.draws}D ${stats.losses}L` },
    { label: t("stats.goals"), value: `${stats.goals_for}` },
    { label: t("stats.conceded"), value: `${stats.goals_against}` },
    { label: t("stats.possession"), value: `${Math.round(stats.avg_possession)}%` },
    { label: t("stats.passAccuracy"), value: `${Math.round(stats.avg_pass_accuracy)}%` },
    { label: t("stats.shots"), value: `${stats.total_shots}` },
    { label: t("stats.onTarget"), value: `${stats.total_shots_on_target}` },
    { label: t("stats.corners"), value: `${stats.total_corners}` },
    { label: t("stats.fouls"), value: `${stats.total_fouls}` },
  ];

  return (
    <Card className="divide-y divide-line p-0">
      {rows.map((row) => (
        <div key={row.label} className="flex items-center justify-between px-3 py-2.5">
          <span className="text-xs text-ink-2">{row.label}</span>
          <Num className="text-sm font-bold text-ink">{row.value}</Num>
        </div>
      ))}
    </Card>
  );
}

/* ------------------------------------------------------------ expected goals */

/** Understat stores these display labels; map them to our own copy. */
const SITUATION_KEY: Record<string, StringKey> = {
  "Open play": "xg.sitOpenPlay",
  "From corner": "xg.sitCorner",
  "Set piece": "xg.sitSetPiece",
  "Direct Freekick": "xg.sitFreekick",
  Penalty: "xg.sitPenalty",
};

/**
 * Expected goals, from Understat (a different source to the ESPN stat sheet).
 * A club's xG against its actual goals is the read that separates a good
 * attacking side from a lucky one, and the per-type split is the part the
 * broadcaster graphics never show.
 *
 * Empty is a normal outcome, not a failure: the scraper only runs for followed
 * big-five clubs, so cups and the long tail have nothing here.
 */
function XgTab({ teamId, played, points }: { teamId: string; played: number; points: number | null }) {
  const { t, localize } = useI18n();
  const query = useTeamUnderstat(teamId);

  if (query.isLoading) return <PanelSkeleton height={192} />;
  if (query.isError) return <ErrorState onRetry={() => query.refetch()} />;

  const teamXg = query.data?.teamStats?.xg ?? null;
  const teamXga = query.data?.teamStats?.xga ?? null;
  const expected = query.data?.teamStats?.xpts ?? null;
  const ppda = query.data?.teamStats?.ppda ?? null;
  const deep = query.data?.teamStats?.deep ?? null;
  const situations = query.data?.situations ?? [];
  const players = [...(query.data?.players ?? [])].sort((a, b) => (b.xg ?? 0) - (a.xg ?? 0));

  if (teamXg == null && situations.length === 0 && players.length === 0) {
    return <EmptyState title={t("xg.emptyTitle")} hint={t("xg.emptyHint")} />;
  }

  const fixed = (value: number | null) => (value == null ? "–" : value.toFixed(2));
  const perMatch = (value: number | null) =>
    value != null && played > 0 ? (value / played).toFixed(2) : null;
  // Actual minus expected: the over/under-performance read.
  const delta = points != null && expected != null ? points - expected : null;
  const extra = [
    ppda != null ? { label: t("xg.ppda"), value: ppda.toFixed(2), hint: t("xg.ppdaHint") } : null,
    deep != null ? { label: t("xg.deep"), value: String(deep), hint: t("xg.deepHint") } : null,
  ].filter((row): row is { label: string; value: string; hint: string } => row != null);
  // Scale the bars against the biggest type so they read as shares of the total.
  const widest = Math.max(0.01, ...situations.map((s) => Math.max(s.xg ?? 0, s.xga ?? 0)));

  return (
    <div className="space-y-4">
      <Card className="p-4">
        <SectionHeading title={t("xg.title")} />
        <div className="mt-3 grid grid-cols-2 gap-4">
          <div>
            <p className="text-[11px] font-semibold text-ink-3">{t("xg.for")}</p>
            <Num className="text-2xl font-black text-volt">{fixed(teamXg)}</Num>
            {perMatch(teamXg) ? (
              <p className="text-[11px] text-ink-3">
                <Num>{perMatch(teamXg)}</Num> {t("xg.perMatch")}
              </p>
            ) : null}
          </div>
          <div className="text-end">
            <p className="text-[11px] font-semibold text-ink-3">{t("xg.against")}</p>
            <Num className="text-2xl font-black text-ink-2">{fixed(teamXga)}</Num>
            {perMatch(teamXga) ? (
              <p className="text-[11px] text-ink-3">
                <Num>{perMatch(teamXga)}</Num> {t("xg.perMatch")}
              </p>
            ) : null}
          </div>
        </div>

        {delta != null ? (
          <div className="mt-3 flex items-baseline justify-between gap-2 border-t border-line pt-3">
            <span className="text-xs text-ink-2">{t("xg.points")}</span>
            <span className="text-[11px] text-ink-3">
              <Num className="text-sm font-bold text-ink">{points}</Num>
              {" · "}
              {t("xg.expected")} <Num className="text-sm font-bold text-gold">{expected?.toFixed(1)}</Num>{" "}
              <Num className={cx("font-bold", delta >= 0 ? "text-volt" : "text-danger")}>
                {delta >= 0 ? "+" : ""}
                {delta.toFixed(1)}
              </Num>
            </span>
          </div>
        ) : null}

        {extra.length > 0 ? (
          <dl className="mt-3 grid grid-cols-2 gap-3 border-t border-line pt-3">
            {extra.map((row) => (
              <div key={row.label}>
                <dt className="text-[11px] font-semibold text-ink-3">{row.label}</dt>
                <dd>
                  <Num className="text-sm font-bold text-ink">{row.value}</Num>
                </dd>
              </div>
            ))}
          </dl>
        ) : null}
      </Card>

      {situations.length > 0 ? (
        <Card className="p-4">
          <SectionHeading title={t("xg.situations")} />
          <p className="mt-1 text-[11px] text-ink-3">{t("xg.situationsHint")}</p>
          <ul className="mt-3 space-y-3">
            {situations.map((situation) => {
              const key = SITUATION_KEY[situation.situation];
              return (
                <li key={situation.situation}>
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="text-xs text-ink-2">{key ? t(key) : situation.situation}</span>
                    <span className="text-[11px] text-ink-3">
                      <Num>{situation.shots ?? 0}</Num> {t("stats.shots")} · <Num>{situation.goals ?? 0}</Num>{" "}
                      {t("stats.goals")}
                    </span>
                  </div>
                  <div className="mt-1 flex items-center gap-2">
                    <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-elevated">
                      <span
                        className="block h-full rounded-full bg-volt"
                        style={{ width: `${(((situation.xg ?? 0) / widest) * 100).toFixed(1)}%` }}
                      />
                    </span>
                    <Num className="w-9 flex-none text-end text-[11px] font-bold text-ink">
                      {fixed(situation.xg ?? 0)}
                    </Num>
                  </div>
                </li>
              );
            })}
          </ul>
        </Card>
      ) : null}

      {players.length > 0 ? (
        <Card className="p-0">
          <div className="px-3 pt-3">
            <SectionHeading title={t("xg.players")} />
          </div>
          <ul className="mt-2 divide-y divide-line">
            {players.slice(0, 10).map((player) => (
              <li key={player.id} className="flex items-center gap-3 px-3 py-2">
                <Num className="grid h-6 w-6 flex-none place-items-center rounded-full bg-elevated text-[10px] text-ink-2">
                  {player.jersey ?? "–"}
                </Num>
                <span className="min-w-0 flex-1 truncate text-xs font-bold text-ink">
                  {localize(player.name)}
                </span>
                <span className="flex-none text-[11px] text-ink-3">
                  <Num className="me-2 text-ink-2">
                    {t("xg.xa")} {fixed(player.xa ?? 0)}
                  </Num>
                  <Num className="font-bold text-volt">{fixed(player.xg ?? 0)}</Num>
                </span>
              </li>
            ))}
          </ul>
          <p className="px-3 pb-3 pt-2 text-[11px] text-ink-3">{t("xg.source")}</p>
        </Card>
      ) : null}
    </div>
  );
}
