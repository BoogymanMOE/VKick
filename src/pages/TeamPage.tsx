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
  PlayerAvatar,
  SectionHeading,
  Segmented,
  TeamBadge,
} from "../components/ui";
import { cx } from "../lib/cx";
import { matchFromApi, useSquad, useTeamDetail, useTeamUnderstat, type SquadRow } from "../hooks/useApi";
import type { StringKey } from "../i18n/strings";
import { usePrefetchMatch } from "../hooks/usePrefetch";
import { TEAM_FALLBACK } from "../lib/colors";
import { useLocalState } from "../lib/useLocalState";
import { ChevronDownIcon, ChevronRightIcon } from "../components/icons";
import { useI18n } from "../i18n/context";
import { formatKickoff, formatKickoffDate, toFaDigits } from "../lib/format";
import type { ApiMatch } from "../lib/api";
import type { Position } from "../types";
import { competitionName } from "../lib/leagues";

type Tab = "squad" | "fixtures" | "season" | "xg";

const POS_ORDER: Position[] = ["GK", "DEF", "MID", "FWD"];

/**
 * A club's page: full squad (from the weekly roster sync), season stat line and
 * recent fixtures. Reached by tapping any team in the table or a match card.
 */
export default function TeamPage() {
  const { id = "" } = useParams();  const { t, lang, localize } = useI18n();
  const detailQuery = useTeamDetail(id);
  const squadQuery = useSquad(id);

  const [tab, setTab] = useState<Tab>("squad");

  // Error BEFORE the loading check: `data` is undefined when the request
  // fails, so a `isLoading || !data` branch placed first would swallow the error
  // and leave the skeleton on screen forever. `!detailQuery.data` on the error
  // branch is deliberate — a failed background refetch keeps the data already
  // on screen instead of replacing a good page with an error card.
  if (detailQuery.isError && !detailQuery.data) {
    // A banned-league club 404s LEAGUE_NOT_SUPPORTED: that is a permanent
    // state, not a retryable failure, so it gets the empty state rather than
    // the error/retry card.
    const code = (detailQuery.error as { code?: string } | null)?.code;
    return (
      <>
        <TopBar title={t("team.title")} back />
        <div className="mt-3">
          {code === "LEAGUE_NOT_SUPPORTED" ? (
            <EmptyState title={t("team.leagueUnsupported")} />
          ) : (
            <ErrorState onRetry={() => detailQuery.refetch()} />
          )}
        </div>
      </>
    );
  }

  if (detailQuery.isLoading || !detailQuery.data) {
    return (
      <>
        <TopBar title={t("team.title")} back />
        <PanelSkeleton height={160} />
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

  const teamLeagueLabel = leagueId ? t(`league.${leagueId}`) : competitionName(team.league, lang);

  return (
    <>
      <TopBar
        title={localize(teamView.shortName)}
        subtitle={teamLeagueLabel}
        back
      />

      {/* Club header: the club's own colour washed across the card from the top
          corner, so a page opens on the side's identity rather than on generic
          dark chrome. It is a gradient, never a decorative side stripe, and the
          crest sits at the hero size — this is the one place the badge leads. */}
      <div
        className="relative mt-3 overflow-hidden rounded-card border border-line p-4"
        style={{
          background: `linear-gradient(135deg, color-mix(in srgb, ${teamView.color} 30%, transparent) 0%, color-mix(in srgb, ${teamView.color} 10%, transparent) 45%, var(--bg-surface) 100%)`,
        }}
      >
        <div className="flex items-center gap-3.5">
          <TeamBadge team={teamView} size="xl" />
          <div className="min-w-0">
            <p className="truncate text-lg font-bold text-ink">{localize(team.name)}</p>
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
            { value: "squad", label: t("team.tab.squad") },
            { value: "fixtures", label: t("team.tab.fixtures") },
            { value: "season", label: t("team.tab.season") },
            { value: "xg", label: t("team.tab.xg") },
          ]}
        />
      </div>

      <section className="panel-in mt-4" key={tab}>
        {tab === "squad" ? <SquadTab squadQuery={squadQuery} /> : null}
        {tab === "fixtures" ? <FixturesTab fixtures={fixtures} teamId={team.id} /> : null}
        {tab === "season" ? <StatsTab stats={seasonStats} /> : null}
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
  const { t, lang } = useI18n();
  if (squadQuery.isLoading) return <PanelSkeleton height={192} />;
  if (squadQuery.isError) return <ErrorState onRetry={() => squadQuery.refetch()} />;

  const squad = squadQuery.data;
  if (!squad || squad.players.length === 0) {
    return <EmptyState title={t("team.squadEmpty")} hint={t("team.squadEmptyHint")} />;
  }

  // Persian reads every number in the Persian script — jersey, counts and stats
  // alike. Mixing ۱۳ with 00/01 in one row was the bug this fixes.
  const num = (value: number | string) => (lang === "fa" ? toFaDigits(value) : String(value));

  return (
    <div className="space-y-4">
      {/* The squad rows carry colour-coded numbers with no key; a colour-blind
          reader cannot tell goals from assists. The legend names both. */}
      <div
        className="flex items-center gap-3 text-[11px] font-bold"
        style={{ padding: "8px 0", borderBottom: "1px solid var(--border-subtle)" }}
      >
        <span className="flex items-center gap-1" style={{ color: "var(--volt)" }}>
          <span aria-hidden="true">⚽</span>
          {t("team.stats.goals")}
        </span>
        <span className="flex items-center gap-1" style={{ color: "var(--gold)" }}>
          <span aria-hidden="true">🅰️</span>
          {t("team.stats.assists")}
        </span>
      </div>
      {POS_ORDER.map((pos) => {
        const group = squad.players.filter((p) => p.position === pos);
        if (group.length === 0) return null;
        return <SquadSection key={pos} pos={pos} players={group} num={num} />;
      })}
    </div>
  );
}

/**
 * One position group (GK / DEF / MID / FWD) with a collapsible header. The MID
 * group is 17 rows on its own — a scroll wall — so each group folds under its
 * heading; the choice persists per position so a collapsed group stays folded
 * across reloads. GK and DEF start open, MID and FWD closed.
 */
function SquadSection({
  pos,
  players,
  num,
}: {
  pos: Position;
  players: SquadRow[];
  num: (value: number | string) => string;
}) {
  const { t, dir, localize } = useI18n();
  const [collapsed, setCollapsed] = useLocalState<boolean>(
    `team.squad.collapsed.${pos}`,
    pos === "MID" || pos === "FWD",
  );

  return (
    <div>
      {/* The count rides NEXT to the heading, not on the far side of the row: a
          badge detached from its label reads as stray chrome. */}
      <button
        type="button"
        onClick={() => setCollapsed((value) => !value)}
        aria-expanded={!collapsed}
        className="mb-2 flex min-h-11 w-full items-center gap-2 rounded-xl px-1 text-start transition-colors duration-[var(--t-fast)] hover:bg-elevated"
      >
        <h2 className="label label-lg text-ink-2">{t(`pos.${pos}`)}</h2>
        <Chip tone="muted">
          <Num>{num(players.length)}</Num>
        </Chip>
        {/* ChevronDown (▾) open / ChevronRight (▸) closed. ChevronRightIcon
            already mirrors itself in RTL, so it points left in Persian. */}
        <span className="ms-auto flex flex-none items-center text-ink-3" aria-hidden="true">
          {collapsed ? <ChevronRightIcon /> : <ChevronDownIcon />}
        </span>
      </button>

      {/* Smooth fold: the grid-rows trick animates the height without measuring
          the list, and the inner clip keeps the rows out of the layout while
          collapsed. */}
      <div className="squad-collapse" data-collapsed={collapsed}>
        <div className="squad-collapse-inner">
          <ul className="space-y-1.5">
            {players.map((player) => (
              // One grid, flipped by `dir`: the jersey lands on the leading
              // edge (right in Persian, left in English) and the goals/assists
              // on the trailing edge, so there is no dead strip on either side.
              <li
                key={player.id}
                dir={dir}
                className="player-row rounded-card border border-line bg-surface p-2.5"
              >
                <Num className="player-number text-[11px] font-bold text-ink-3">
                  {num(player.jersey ?? "–")}
                </Num>
                {/* A face for every squad member: the ESPN headshot where the
                    feed has one, the player's initials where it doesn't, on
                    the same footprint either way. */}
                <PlayerAvatar name={localize(player.name)} src={player.headshot} size="sm" />
                <span className="player-name min-w-0">
                  <span className="block truncate text-sm font-bold text-ink">
                    {/* <bdi> isolates a Latin name so it cannot drift the row's
                        bidi run in Persian. */}
                    <bdi>{localize(player.name)}</bdi>
                  </span>
                  <span className="block truncate text-[11px] text-ink-3">
                    {player.espnPosition ?? t(`pos.${player.position}`)}
                    {player.appearances
                      ? ` · ${t("team.appearances", { count: num(player.appearances) })}`
                      : ""}
                  </span>
                </span>
                <span className="player-stats flex-none">
                  <Num className={cx("text-sm", (player.goals ?? 0) > 0 ? "text-volt" : "text-ink-3")}>
                    {num(player.goals ?? 0)}
                  </Num>
                  <Num className={cx("text-sm", (player.assists ?? 0) > 0 ? "text-gold" : "text-ink-3")}>
                    {" "}
                    {num(player.assists ?? 0)}
                  </Num>
                </span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------ fixtures */

function FixturesTab({ fixtures, teamId }: { fixtures: ApiMatch[]; teamId: string }) {
  const { t, lang, localize } = useI18n();
  const prefetchMatch = usePrefetchMatch();
  const locale = lang === "fa" ? "fa-IR" : undefined;
  if (fixtures.length === 0) return <EmptyState title={t("team.noFixtures")} />;

  return (
    <ul className="space-y-2">
      {fixtures.map((match) => {
        // One scoreline per fixture: crest, club, the result or the kickoff,
        // club, crest. The club whose page this is wears volt, so picking your
        // side out of a neutral fixture list needs no reading.
        const { home, away } = matchFromApi(match);
        return (
          <li key={match.id}>
            <Link
              to={`/match/${match.id}`}
              onPointerDown={() => prefetchMatch(match.id)}
              aria-label={`${localize(home.shortName)} ${t("common.versus")} ${localize(away.shortName)}`}
              className="flex items-center justify-between gap-2 rounded-card border border-line bg-surface p-2.5 transition-colors duration-[var(--t-fast)] hover:bg-elevated"
            >
              <span className="flex min-w-0 flex-1 items-center gap-2">
                <TeamBadge team={home} size="sm" />
                <span
                  className={cx(
                    "min-w-0 truncate text-xs font-bold",
                    home.id === teamId ? "text-volt" : "text-ink",
                  )}
                >
                  {localize(home.shortName)}
                </span>
              </span>
              <span className="flex-none">
                {match.status === "finished" ? (
                  <Chip tone="muted">
                    <Num>
                      {match.home_score ?? 0}–{match.away_score ?? 0}
                    </Num>
                  </Chip>
                ) : match.status === "live" ? (
                  <Chip tone="live">
                    <Num>{match.minute_display ?? ""}</Num>
                  </Chip>
                ) : (
                  /* Kickoff carries the date AND the time, so a fixture weeks
                     out is unambiguous at a glance. */
                  <Chip tone="volt">
                    <Num>{formatKickoffDate(new Date(match.kickoff_at), locale)}</Num>
                    {" · "}
                    <Num>{formatKickoff(new Date(match.kickoff_at), locale)}</Num>
                  </Chip>
                )}
              </span>
              <span className="flex min-w-0 flex-1 items-center justify-end gap-2">
                <span
                  className={cx(
                    "min-w-0 truncate text-end text-xs font-bold",
                    away.id === teamId ? "text-volt" : "text-ink",
                  )}
                >
                  {localize(away.shortName)}
                </span>
                <TeamBadge team={away} size="sm" />
              </span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

/* ------------------------------------------------------------ season stats */

type SeasonStats = NonNullable<ReturnType<typeof useTeamDetail>["data"]>["seasonStats"];

function StatsTab({ stats }: { stats: SeasonStats }) {
  const { t } = useI18n();
  if (!stats) return <EmptyState title={t("team.statsEmpty")} hint={t("team.statsEmptyHint")} />;

  // Two reads instead of one dump: what the side creates, and what it concedes
  // or controls. The flat list said everything at once and ranked nothing.
  const attackRows: Array<{ label: string; value: string }> = [
    { label: t("stats.goals"), value: `${stats.goals_for}` },
    { label: t("stats.shots"), value: `${stats.total_shots}` },
    { label: t("stats.onTarget"), value: `${stats.total_shots_on_target}` },
    { label: t("stats.corners"), value: `${stats.total_corners}` },
  ];
  const controlRows: Array<{ label: string; value: string }> = [
    { label: t("stats.conceded"), value: `${stats.goals_against}` },
    { label: t("stats.possession"), value: `${Math.round(stats.avg_possession)}%` },
    { label: t("stats.passAccuracy"), value: `${Math.round(stats.avg_pass_accuracy)}%` },
    { label: t("stats.fouls"), value: `${stats.total_fouls}` },
  ];

  // The season in one line. The grouped cards below say what the side does;
  // only the record says how it went, so it leads the tab rather than hiding
  // as row one of a list nobody scanned to the bottom of.
  const record: Array<{ letter: string; value: number }> = [
    { letter: "W", value: stats.wins },
    { letter: "D", value: stats.draws },
    { letter: "L", value: stats.losses },
  ];

  return (
    <div className="space-y-4">
      <Card className="flex items-center justify-between gap-3 p-4">
        <span className="label text-ink-3">{t("statsPage.teams")}</span>
        <span className="flex items-baseline gap-2">
          {record.map(({ letter, value }) => (
            <span key={letter} className="flex items-baseline gap-0.5">
              <Num className="text-lg font-black text-ink">{value}</Num>
              <span className="label text-ink-3">{letter}</span>
            </span>
          ))}
        </span>
      </Card>
      <StatCard title={t("team.statsAttack")} rows={attackRows} />
      <StatCard title={t("team.statsDefense")} rows={controlRows} />
    </div>
  );
}

/** One grouped stat sheet: a heading, then label/value rows on a hairline. */
function StatCard({ title, rows }: { title: string; rows: Array<{ label: string; value: string }> }) {
  return (
    <Card className="p-4">
      <SectionHeading title={title} />
      <dl className="divide-y divide-line">
        {rows.map((row) => (
          <div key={row.label} className="flex items-center justify-between gap-3 py-2.5">
            <dt className="text-xs text-ink-3">{row.label}</dt>
            <dd>
              <Num className="text-base font-bold text-ink">{row.value}</Num>
            </dd>
          </div>
        ))}
      </dl>
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
