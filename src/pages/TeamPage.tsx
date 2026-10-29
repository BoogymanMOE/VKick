import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { TopBar } from "../components/TopBar";
import { PanelSkeleton } from "../components/Skeletons";
import { NewsCard } from "../components/panels/NewsCard";
import { LineupPitch } from "../components/panels/LineupsPanel";
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
import {
  matchFromApi,
  useLeagueNews,
  useSquad,
  useTeamDetail,
  useRecentLineup,
  type SquadRow,
} from "../hooks/useApi";
import { usePrefetchMatch } from "../hooks/usePrefetch";
import { TEAM_FALLBACK } from "../lib/colors";
import { useLocalState } from "../lib/useLocalState";
import { ChevronDownIcon, ChevronRightIcon } from "../components/icons";
import { useI18n } from "../i18n/context";
import { formatKickoff, formatKickoffDate, toFaDigits } from "../lib/format";
import type { ApiMatch } from "../lib/api";
import type { LineupPlayer } from "../types";
import type { Position } from "../types";
import { competitionName } from "../lib/leagues";

type Tab = "squad" | "fixtures" | "season" | "lineup" | "news";

const AVAILABILITY_TONE = { injured: "danger", suspended: "gold", doubtful: "muted" } as const;

function AvailabilityBadge({ status, reason }: { status: "injured" | "suspended" | "doubtful"; reason?: string | null }) {
  const { t, localize } = useI18n();
  const label = t(`team.availability.${status}`);
  const title = reason ? `${label}: ${localize(reason)}` : label;
  return (
    <Chip tone={AVAILABILITY_TONE[status]} className="max-w-full" normalCase>
      <span className="truncate" title={title}>{label}{reason ? ` · ${localize(reason)}` : ""}</span>
    </Chip>
  );
}

const POS_ORDER: Position[] = ["GK", "DEF", "MID", "FWD", "OTHER"];

/** English ordinal suffix: 1st, 2nd, 3rd, 4th … 11th/12th/13th … 21st. */
function ordinal(rank: number): string {
  const mod100 = rank % 100;
  const suffix = mod100 >= 11 && mod100 <= 13 ? "th" : (["th", "st", "nd", "rd"][rank % 10] ?? "th");
  return `${rank}${suffix}`;
}

/**
 * A club's page: full squad (from the weekly roster sync), season stat line and
 * recent fixtures. Reached by tapping any team in the table or a match card.
 */
export default function TeamPage() {
  const { id = "" } = useParams();
  const { t, lang, localize } = useI18n();
  const detailQuery = useTeamDetail(id);
  const squadQuery = useSquad(id);

  const [tab, setTab] = useState<Tab>("squad");
  // Which form badge the reader last tapped: its opponent + score is spelled
  // out under the strip (mobile taps have no hover tooltip).
  const [formDetail, setFormDetail] = useState<string | null>(null);

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
        <div className="mt-md">
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

  const { team, seasonStats, standing, fixtures } = detailQuery.data;
  // Persian reads every number in the Persian script; English keeps the ordinal.
  const num = (value: number | string) => (lang === "fa" ? toFaDigits(value) : String(value));
  const positionLabel = (rank: number) => (lang === "fa" ? `${toFaDigits(rank)}م` : ordinal(rank));
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

  // The club's last five finished results, newest first (the server serves the
  // finished segment newest-first too). Kept as full match records — not a
  // letters string — so each badge can name its opponent and score. Fewer than
  // five finished matches simply means a shorter strip: nothing is padded.
  const formMatches = fixtures
    .filter((match) => match.status === "finished" && match.home_score != null && match.away_score != null)
    .slice(0, 5);
  const formResult = (match: ApiMatch) => {
    const forHome = match.home_team_id === team.id;
    const goalsFor = (forHome ? match.home_score : match.away_score) ?? 0;
    const goalsAgainst = (forHome ? match.away_score : match.home_score) ?? 0;
    return goalsFor > goalsAgainst ? "W" : goalsFor < goalsAgainst ? "L" : "D";
  };
  const formTooltip = (match: ApiMatch) => {
    const forHome = match.home_team_id === team.id;
    const opponent = forHome ? match.away_short ?? match.away_name : match.home_short ?? match.home_name;
    const score = forHome
      ? `${match.home_score}–${match.away_score}`
      : `${match.away_score}–${match.home_score}`;
    return `${localize(opponent)} · ${lang === "fa" ? toFaDigits(score) : score}`;
  };

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
        className="relative mt-md overflow-hidden rounded-card border border-line p-4"
        style={{
          background: `linear-gradient(135deg, color-mix(in srgb, ${teamView.color} 30%, transparent) 0%, color-mix(in srgb, ${teamView.color} 10%, transparent) 45%, var(--bg-surface) 100%)`,
        }}
      >
        <div className="flex items-center gap-3.5">
          <TeamBadge team={teamView} size="xl" />
          {/* The club's name stays in the top bar; this card is the league line —
              competition, matches played, position and points. */}
          <div className="min-w-0">
            <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-ink-3">
              <span className="font-bold text-ink">{teamLeagueLabel}</span>
              {standing?.played != null ? (
                <span>{t(standing.played === 1 ? "team.matchesPlayedOne" : "team.matchesPlayedMany", { played: num(standing.played) })}</span>
              ) : null}
              {standing?.rank ? <span>{positionLabel(standing.rank)}</span> : null}
              {standing?.points != null ? <span>{t("team.points", { points: num(standing.points) })}</span> : null}
            </p>
          </div>
        </div>

        {/* Form: the club's last five results, newest first, each badge naming
            its opponent and score on tap (title covers desktop hover). The
            detail line has a reserved height, so tapping never shifts the
            layout below. */}
        {formMatches.length > 0 ? (
          <div className="mt-3 border-t border-line pt-3">
            <div className="flex items-center justify-between gap-3">
              <span aria-hidden="true" className="text-xs font-bold text-ink-3">{t("table.form")}</span>
              <div className="flex items-center gap-2">
                {formMatches.map((match) => {
                  const result = formResult(match);
                  const title = formTooltip(match);
                  const selected = formDetail === match.id;
                  return (
                    <button
                      key={match.id}
                      type="button"
                      title={title}
                      aria-pressed={selected}
                      aria-label={`${result === "W" ? t("table.formW") : result === "L" ? t("table.formL") : t("table.formD")}: ${title}`}
                      onClick={() => setFormDetail(selected ? null : match.id)}
                      className={cx(
                        "grid h-6 w-6 place-items-center rounded text-[10px] font-bold transition-colors duration-[var(--t-fast)]",
                        selected ? "ring-1 ring-current" : "",
                        result === "W" ? "bg-pitch/20 text-pitch" : result === "L" ? "bg-danger/20 text-danger" : "bg-ink-3/15 text-ink-3",
                      )}
                    >
                      {result === "W" ? t("table.formWShort") : result === "L" ? t("table.formLShort") : t("table.formDShort")}
                    </button>
                  );
                })}
              </div>
            </div>
            <p className="mt-1 min-h-4 text-end text-[10px] text-ink-3">
              {formTooltip((fixtures.find((match) => match.id === formDetail) ?? formMatches[0]) as ApiMatch)}
            </p>
          </div>
        ) : null}
      </div>

      <div className="mt-lg">
        <Segmented
          id="team-tabs"
          value={tab}
          onChange={setTab}
          options={[
            { value: "squad", label: t("team.tab.squad") },
            { value: "fixtures", label: t("team.tab.fixtures") },
            { value: "season", label: t("team.tab.season") },
            { value: "lineup", label: t("team.tab.lineup") },
            { value: "news", label: t("team.tab.news") },
          ]}
        />
      </div>

      {/* The panel the team-tabs tablist above points at (see MatchDetail). */}
      <section
        id="team-tabs-panel"
        role="tabpanel"
        aria-labelledby={`team-tabs-${tab}`}
        className="panel-in mt-lg"
        key={tab}
      >
        {tab === "squad" ? <SquadTab squadQuery={squadQuery} /> : null}
        {tab === "fixtures" ? <FixturesTab fixtures={fixtures} teamId={team.id} /> : null}
        {tab === "season" ? <StatsTab stats={seasonStats} fixtures={fixtures} teamId={team.id} /> : null}
        {tab === "lineup" ? <RecentLineupTab teamId={team.id} /> : null}
        {tab === "news" ? <NewsTab teamId={team.id} league={team.league ?? ""} /> : null}
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
    return <EmptyState icon="👥" title={t("team.squadEmpty")} hint={t("team.squadEmptyHint")} />;
  }

  // Persian reads every number in the Persian script — jersey, counts and stats
  // alike. Mixing ۱۳ with 00/01 in one row was the bug this fixes.
  const num = (value: number | string) => (lang === "fa" ? toFaDigits(value) : String(value));

  return (
    <div className="space-y-lg">
      {/* The squad rows carry colour-coded numbers with no key; a colour-blind
          reader cannot tell goals from assists. The legend names both. */}
      <div
        className="flex items-center gap-3 text-xs font-bold"
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
          <ul className="space-y-2">
            {players.map((player) => (
              // One grid, flipped by `dir`: the jersey lands on the leading
              // edge (right in Persian, left in English) and the goals/assists
              // on the trailing edge, so there is no dead strip on either side.
              <li
                key={player.id}
                dir={dir}
                className="player-row rounded-card border border-line bg-surface p-2.5"
              >
                <Num className="player-number text-xs font-bold text-ink-3">
                  {num(player.jersey ?? "–")}
                </Num>
                {/* A face for every squad member: the ESPN headshot where the
                    feed has one, the player's initials where it doesn't, on
                    the same footprint either way. */}
                <PlayerAvatar name={localize(player.name)} src={player.avatarUrl} size="sm" />
                <span className="player-name min-w-0">
                  <span className="block truncate text-sm font-bold text-ink">
                    {/* <bdi> isolates a Latin name so it cannot drift the row's
                        bidi run in Persian. */}
                    <bdi>{localize(player.name)}</bdi>
                  </span>
                  <span className="block truncate text-xs text-ink-3">
                    {player.espnPosition ?? t(`pos.${player.position}`)}
                    {player.appearances
                      ? ` · ${t("team.appearances", { count: num(player.appearances) })}`
                      : ""}
                  </span>
                  {player.availability ? (
                    <span className="mt-1 block"><AvailabilityBadge status={player.availability.status} reason={player.availability.reason ?? player.availability.expected_return} /></span>
                  ) : null}
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

  const played = fixtures.filter((match) => match.status === "finished");
  const upcoming = fixtures.filter((match) => match.status !== "finished");
  const renderMatch = (match: ApiMatch) => {
    // One scoreline per fixture: crest, club, the result or the kickoff, club, crest.
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
  };

  return (
    <div className="space-y-lg">
      {played.length > 0 ? (
        <div>
          <SectionHeading title={t("team.recentResults")} />
          <ul className="space-y-2">{played.map((match) => renderMatch(match))}</ul>
        </div>
      ) : null}
      {upcoming.length > 0 ? (
        <div>
          <SectionHeading title={t("team.upcomingFixtures")} />
          <ul className="space-y-2">{upcoming.map((match) => renderMatch(match))}</ul>
        </div>
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------ season stats */

type SeasonStats = NonNullable<ReturnType<typeof useTeamDetail>["data"]>["seasonStats"];

function StatsTab({
  stats,
  fixtures,
  teamId,
}: {
  stats: SeasonStats;
  fixtures: ApiMatch[];
  teamId: string;
}) {
  const { t, lang, localize } = useI18n();
  const locale = lang === "fa" ? "fa-IR" : undefined;
  const dateFmt = new Intl.DateTimeFormat(locale, { month: "short", day: "numeric" });
  const recentResults = fixtures.filter((match) => match.status === "finished").slice(0, 5);
  if (!stats && recentResults.length === 0) {
    return <EmptyState title={t("team.statsEmpty")} hint={t("team.statsEmptyHint")} />;
  }

  // Two reads instead of one dump: what the side creates, and what it concedes
  // or controls. The flat list said everything at once and ranked nothing.
  const attackRows: Array<{ label: string; value: string }> = stats
    ? [
        { label: t("stats.goals"), value: `${stats.goals_for}` },
        { label: t("stats.shots"), value: `${stats.total_shots}` },
        { label: t("stats.onTarget"), value: `${stats.total_shots_on_target}` },
        { label: t("stats.corners"), value: `${stats.total_corners}` },
      ]
    : [];
  const controlRows: Array<{ label: string; value: string }> = stats
    ? [
        { label: t("stats.conceded"), value: `${stats.goals_against}` },
        { label: t("stats.possession"), value: `${Math.round(stats.avg_possession)}%` },
        { label: t("stats.passAccuracy"), value: `${Math.round(stats.avg_pass_accuracy)}%` },
        { label: t("stats.fouls"), value: `${stats.total_fouls}` },
      ]
    : [];

  // The season in one line. The grouped cards below say what the side does;
  // only the record says how it went, so it leads the tab rather than hiding
  // as row one of a list nobody scanned to the bottom of.
  const record: Array<{ letter: string; value: number }> = stats
    ? [
        { letter: "W", value: stats.wins },
        { letter: "D", value: stats.draws },
        { letter: "L", value: stats.losses },
      ]
    : [];

  return (
    <div className="space-y-lg">
      {recentResults.length > 0 ? (
        <Card className="p-3">
          <SectionHeading title={t("team.recentResults")} />
          <ul className="divide-y divide-line">
            {recentResults.map((match) => {
              const { home, away } = matchFromApi(match);
              const isHome = home.id === teamId;
              const gf = isHome ? match.home_score ?? 0 : match.away_score ?? 0;
              const ga = isHome ? match.away_score ?? 0 : match.home_score ?? 0;
              const result = gf > ga ? "W" : gf < ga ? "L" : "D";
              const opponent = isHome ? away : home;
              const resultLabel =
                result === "W"
                  ? t("table.formWShort")
                  : result === "L"
                    ? t("table.formLShort")
                    : t("table.formDShort");
              return (
                <li key={match.id} className="flex items-center gap-2 py-2">
                  <span
                    className={cx(
                      "grid h-6 w-6 flex-none place-items-center rounded text-[10px] font-bold",
                      result === "W"
                        ? "bg-pitch/20 text-pitch"
                        : result === "L"
                          ? "bg-danger/20 text-danger"
                          : "bg-ink-3/15 text-ink-3",
                    )}
                  >
                    {resultLabel}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-xs text-ink-2">
                    {isHome ? `${t("team.vs")} ` : ""}
                    {localize(opponent.shortName)}
                    {!isHome ? ` ${t("team.vs")}` : ""}
                  </span>
                  <span dir="ltr" className="flex-none text-xs font-bold text-ink">
                    {lang === "fa" ? toFaDigits(`${gf}–${ga}`) : `${gf}–${ga}`}
                  </span>
                  <span className="flex-none text-[10px] text-ink-3">
                    {dateFmt.format(new Date(match.kickoff_at))}
                  </span>
                </li>
              );
            })}
          </ul>
        </Card>
      ) : null}
      {stats ? (
        <>
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
        </>
      ) : (
        <EmptyState title={t("team.statsEmpty")} hint={t("team.statsEmptyHint")} />
      )}
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
              <Num className="text-md font-bold text-ink">{row.value}</Num>
            </dd>
          </div>
        ))}
      </dl>
    </Card>
  );
}

/* ------------------------------------------------------------ recent lineup */

function RecentLineupTab({ teamId }: { teamId: string }) {
  const { t, lang, localize } = useI18n();
  const query = useRecentLineup(teamId);
  if (query.isLoading) return <PanelSkeleton height={192} />;
  if (query.isError) return <ErrorState onRetry={() => query.refetch()} />;
  const data = query.data;
  if (!data?.match) return <EmptyState title={t("team.lineupEmpty")} hint={t("team.lineupEmptyHint")} />;
  const locale = lang === "fa" ? "fa-IR" : undefined;
  const dateFmt = new Intl.DateTimeFormat(locale, { weekday: "short", month: "short", day: "numeric" });
  const number = (value: number) => (lang === "fa" ? toFaDigits(value) : value);
  const playerRows = (players: LineupPlayer[]) =>
    players.map((player) => (
      <li key={player.id} className="flex flex-wrap items-center gap-2 py-2">
        <span className="grid h-7 w-7 flex-none place-items-center rounded-full bg-elevated text-xs font-bold text-ink-2">
          {player.number > 0 ? number(player.number) : "–"}
        </span>
        <PlayerAvatar
          name={localize(player.name)}
          src={player.avatarUrl}
          fallbackSrc={player.headshot ?? player.headshotUrl}
          size="sm"
        />
        <span className="min-w-0 flex-1 truncate text-sm font-bold text-ink">{localize(player.name)}</span>
        <span className="text-xs text-ink-3">{t(`pos.${player.position}`)}</span>
        {player.availability ? <AvailabilityBadge status={player.availability.status} reason={player.availability.reason ?? player.availability.expected_return} /> : null}
      </li>
    ));

  return (
    <div className="space-y-3">
      <Card className="p-3">
        <div className="flex items-center justify-between">
          <span className="text-xs font-bold text-ink-3">{dateFmt.format(new Date(data.match.kickoffAt))}</span>
          {data.match.formation ? <Chip tone="pitch">{data.match.formation}</Chip> : null}
        </div>
      </Card>
      <Card className="p-3">
        <SectionHeading title={t("team.lineupStarters")} />
        {data.starters.length > 0 ? (
          <>
            <LineupPitch
              lineup={{
                formation: data.match.formation ?? "",
                coach: "",
                starters: data.starters,
                subs: [],
              }}
            />
            <ul className="divide-y divide-line">{playerRows(data.starters)}</ul>
          </>
        ) : <EmptyState title={t("team.lineupUnavailable")} />}
      </Card>
      {data.bench.length + data.subs.length > 0 ? (
        <Card className="p-3">
          <SectionHeading title={t("team.lineupSubs")} />
          <ul className="divide-y divide-line">
            {[...data.subs, ...data.bench].map((player) => (
              <li key={player.id} className="flex flex-wrap items-center gap-2 py-2">
                <span className="grid h-7 w-7 flex-none place-items-center rounded-full bg-elevated text-xs font-bold text-ink-2">
                  {player.number > 0 ? number(player.number) : "–"}
                </span>
                <PlayerAvatar
                  name={localize(player.name)}
                  src={player.avatarUrl}
                  fallbackSrc={player.headshot ?? player.headshotUrl}
                  size="sm"
                />
                <span className="min-w-0 flex-1 truncate text-sm font-bold text-ink">{localize(player.name)}</span>
                {player.availability ? <AvailabilityBadge status={player.availability.status} reason={player.availability.reason ?? player.availability.expected_return} /> : null}
                {player.minutesPlayed ? <span className="flex-none text-xs font-bold text-pitch">↑</span> : null}
              </li>
            ))}
          </ul>
        </Card>
      ) : null}
      <Link
        to={`/match/${data.match.id}`}
        className="block rounded-card border border-line bg-surface p-3 text-center text-xs font-bold text-volt transition-colors hover:bg-elevated"
      >
        {t("team.lineupViewMatch")} →
      </Link>
    </div>
  );
}

/**
 * Recent ESPN coverage for this club. ESPN publishes no per-team soccer news
 * feed, so the server takes the league's feed and narrows it by this club's
 * id — the result is real coverage rather than a stub list, and every card
 * links out to the article on ESPN.
 */
function NewsTab({ teamId, league }: { teamId: string; league: string }) {
  const { t, lang } = useI18n();
  const query = useLeagueNews(league, teamId);

  if (query.isLoading) return <PanelSkeleton height={192} />;
  if (query.isError) return <ErrorState onRetry={() => query.refetch()} />;

  const articles = query.data?.articles ?? [];
  if (articles.length === 0) {
    return <EmptyState title={t("team.news.empty")} hint={t("team.news.emptyHint")} />;
  }

  const locale = lang === "fa" ? "fa-IR" : undefined;
  return (
    <ul className="space-y-2">
      {articles.map((article) => (
        <li key={article.id}>
          <NewsCard article={article} locale={locale} />
        </li>
      ))}
    </ul>
  );
}
