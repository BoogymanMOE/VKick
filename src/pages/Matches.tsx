import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { ConfettiBurst } from "../components/Confetti";
import { clubContext, opponentOf } from "../components/ClubCard";
import { MatchCard } from "../components/MatchCard";
import { MatchCardSkeleton } from "../components/Skeletons";
import { TopBar } from "../components/TopBar";
import { useToast } from "../components/Toast";
import {
  Button,
  Card,
  Chip,
  CollapsibleSection,
  EmptyState,
  ErrorState,
  LiveDot,
  Num,
  SectionHeading,
  TeamBadge,
  cx,
} from "../components/ui";
import { useMatches, useFollowedLeagues } from "../hooks/useApi";
import { useFavorites } from "../hooks/useFavorites";
import { useI18n } from "../i18n/I18nProvider";
import { formatClock, formatKickoff } from "../lib/format";
import { LEAGUE_BY_SLUG } from "../lib/leagues";
import { haptic, notifyHaptic } from "../lib/telegram";
import { BallIcon, RefreshIcon, StarFilledIcon } from "../components/icons";
import { TaskAdCard } from "../components/TaskAdCard";
import type { Match, Team } from "../types";

export default function Matches() {
  const { t, lang, localize } = useI18n();
  const { push } = useToast();
  const navigate = useNavigate();
  const locale = lang === "fa" ? "fa-IR" : undefined;
  const queryClient = useQueryClient();

  // Deep link from Browse: /matches?league=eng.1 narrows the feed to one
  // competition. Absent param = the followed-leagues feed (or everything).
  const [searchParams] = useSearchParams();
  const league = searchParams.get("league") ?? undefined;
  const { teams: favTeams, anchorId, count: favCount, isFavorite } = useFavorites();
  const followed = useFollowedLeagues();

  // Followed leagues narrow the default feed when set; the deep-link param
  // (from Browse) takes precedence over both.
  const [leagueFilter, setLeagueFilter] = useState<string | null>(null);
  const activeLeague = league ?? leagueFilter ?? undefined;

  const matchesQuery = useMatches({ league: activeLeague });
  const matches = matchesQuery.data ?? [];

  // The team rows read the unfiltered feed so a favorite club's fixture shows
  // even when the league chips narrow the page (same query key when both are
  // unfiltered, so react-query fetches once).
  const allMatchesQuery = useMatches();
  const allMatches = useMemo(() => allMatchesQuery.data ?? [], [allMatchesQuery.data]);

  const [refreshing, setRefreshing] = useState(false);
  const [lastSync, setLastSync] = useState<Date | null>(null);
  const [flashId, setFlashId] = useState<string | null>(null);
  const [burst, setBurst] = useState(0);

  const live0 = matches.filter((m) => m.status === "live");
  const upcoming0 = matches.filter((m) => m.status === "scheduled");
  const finished0 = matches.filter((m) => m.status === "finished");
  const inMyTeams = (match: Match) => isFavorite(match.home.id) || isFavorite(match.away.id);
  // Favorite clubs sort to the top of each section.
  const organize = (list: Match[]) => [...list].sort((a, b) => Number(inMyTeams(b)) - Number(inMyTeams(a)));
  const live = organize(live0);
  // With picks saved, discovery shrinks to a window (the heading count shows
  // the real total); without picks, it stays full so the app is usable
  // pre-onboarding. Results live in the team rows — no separate FT section.
  const capGeneral = favCount > 0 && !league && leagueFilter === null;
  const upcomingShown = capGeneral ? organize(upcoming0).slice(0, 6) : organize(upcoming0);
  // Recent results, newest kickoff first — the sections above sort favorites up.
  const finished = [...finished0]
    .sort((a, b) => +new Date(b.kickoffAt) - +new Date(a.kickoffAt))
    .slice(0, 12);

  // One context per favorite club: live now, else next kickoff, else last
  // result. The anchor club leads the rows.
  const teamRows = useMemo(
    () =>
      [...favTeams]
        .sort((a, b) => Number(b.id === anchorId) - Number(a.id === anchorId))
        .map((team) => ({ team, context: clubContext(team.id, allMatches) })),
    [favTeams, anchorId, allMatches],
  );

  // Goal detection: when a refetch brings a new score for a match, fire the
  // volt sweep + toast. The server polls ESPN every minute; this picks that up.
  const scoreRef = useRef<Map<string, string>>(new Map());
  const seeded = useRef(false);

  useEffect(() => {
    if (!matchesQuery.data) return;
    const incoming = new Map(
      matchesQuery.data.map((m) => [m.id, `${m.homeScore ?? "–"}-${m.awayScore ?? "–"}`]),
    );
    if (!seeded.current) {
      scoreRef.current = incoming;
      seeded.current = true;
      return;
    }
    for (const [id, score] of incoming) {
      const prev = scoreRef.current.get(id);
      if (prev && prev !== score && score !== "–-–") {
        const match = matchesQuery.data.find((m) => m.id === id);
        if (match) {
          setFlashId(id);
          setBurst((value) => value + 1);
          notifyHaptic("success");
          push({
            text: `${localize(match.home.shortName)} ${match.homeScore ?? 0}-${match.awayScore ?? 0} ${localize(match.away.shortName)}`,
            tone: "volt",
            icon: <BallIcon className="h-4 w-4" />,
          });
          window.setTimeout(() => setFlashId(null), 1400);
        }
      }
    }
    scoreRef.current = incoming;
    setLastSync(new Date());
  }, [matchesQuery.data, push, localize]);

  function refresh() {
    haptic("light");
    setRefreshing(true);
    void queryClient.invalidateQueries({ queryKey: ["matches"] }).then(() => {
      setRefreshing(false);
      const now = new Date();
      setLastSync(now);
      push({
        text: t("matches.lastSync", { time: formatClock(now, locale) }),
        tone: "muted",
        icon: <RefreshIcon className="h-4 w-4" />,
      });
    });
  }

  // PRODUCT.md rule 1: the live moment leads the screen. Collapsible so a
  // quiet matchday can be folded away to leave more room for the feed below;
  // the pulsing dot keeps the folded header honest while games are running.
  const liveSection = (
    <CollapsibleSection
      id="matches-live"
      title={t("matches.live")}
      count={live.length}
      collapsedBadge={
        live.length > 0 ? (
          <Chip tone="live">
            <LiveDot />
            <Num>{live.length}</Num>
          </Chip>
        ) : null
      }
    >
      {matchesQuery.isLoading ? (
        <ul className="space-y-2">
          <MatchCardSkeleton />
          <MatchCardSkeleton />
        </ul>
      ) : matchesQuery.isError ? (
        <ErrorState title={t("error.title")} hint={t("error.hint")} onRetry={() => matchesQuery.refetch()} />
      ) : live.length > 0 ? (
        <ul className="space-y-2">
          {live.map((match) => (
            <MatchCard key={match.id} match={match} flash={flashId === match.id} />
          ))}
        </ul>
      ) : (
        <EmptyState title={t("matches.empty")} hint={t("matches.emptyHint")} />
      )}
    </CollapsibleSection>
  );

  return (
    <>
      <ConfettiBurst trigger={burst} />

      <TopBar
        title={t("matches.title")}
        subtitle={t("matches.subtitle")}
        right={
          <button
            type="button"
            onClick={refresh}
            aria-label={t("matches.refresh")}
            className={cx(
              "grid h-11 w-11 flex-none place-items-center rounded-full border border-line text-ink-2 transition-colors duration-[var(--t-fast)] hover:bg-elevated hover:text-ink",
              refreshing && "animate-spin",
            )}
          >
            <RefreshIcon />
          </button>
        }
      />

      {/* Followed leagues: one tap re-scopes the whole feed (concept pillar 1). */}
      {!league && followed.count > 0 ? (
        <div className="-mx-3 mt-3 flex gap-1.5 overflow-x-auto px-3 pb-1">
          <button
            type="button"
            onClick={() => {
              haptic("light");
              setLeagueFilter(null);
            }}
            aria-pressed={leagueFilter === null}
            className={cx(
              "min-h-11 flex-none rounded-full border px-3.5 text-[11px] font-bold transition-colors duration-[var(--t-fast)]",
              leagueFilter === null ? "border-volt text-volt" : "border-line text-ink-3",
            )}
          >
            {t("browse.all")}
          </button>
          {followed.leagues.map((l) => (
            <button
              key={l.league}
              type="button"
              onClick={() => {
                haptic("light");
                setLeagueFilter(l.league);
              }}
              aria-pressed={leagueFilter === l.league}
              className={cx(
                "min-h-11 flex-none rounded-full border px-3.5 text-[11px] font-bold transition-colors duration-[var(--t-fast)]",
                leagueFilter === l.league ? "border-volt text-volt" : "border-line text-ink-3",
              )}
            >
              {l.name ?? l.league}
            </button>
          ))}
        </div>
      ) : null}

      {/* Single-league deep link: name the scope, let the user leave. Without
          this the screen looks like a broken feed when the window is quiet. */}
      {league ? (
        <div className="mt-3 flex items-center justify-between gap-2 rounded-card border border-line bg-surface px-3 py-2">
          <p className="min-w-0 truncate text-xs text-ink-2">
            {t("matches.leagueScope", {
              league: LEAGUE_BY_SLUG[league] ? t(`league.${LEAGUE_BY_SLUG[league]}`) : league,
            })}
          </p>
          <button
            type="button"
            onClick={() => {
              haptic("light");
              navigate("/matches");
            }}
            className="inline-flex min-h-11 flex-none items-center rounded-full border border-volt px-3 text-[11px] font-bold text-volt transition-colors duration-[var(--t-fast)] hover:bg-elevated"
          >
            {t("matches.showAll")}
          </button>
        </div>
      ) : null}

      {/* The picks feed, one row per favorite club: live game, else next
          fixture, else last result. Five rows max, anchor first — the whole
          answer to "what are my teams doing" without a card flood. */}
      {!league && favCount > 0 ? (
        <section className="mt-3">
          <SectionHeading
            title={t("matches.myTeams")}
            action={
              <Chip tone="volt">
                <StarFilledIcon className="me-1 inline-block h-3 w-3 align-[-1px]" />
                <Num>{favCount}</Num>
              </Chip>
            }
          />
          {matchesQuery.isLoading ? (
            <ul className="space-y-2">
              <MatchCardSkeleton />
              <MatchCardSkeleton />
            </ul>
          ) : matchesQuery.isError ? (
            <ErrorState
              title={t("error.title")}
              hint={t("error.hint")}
              onRetry={() => matchesQuery.refetch()}
            />
          ) : (
            <ul className="space-y-2">
              {teamRows.map(({ team, context }) => (
                <TeamRow key={team.id} team={team} context={context} anchored={team.id === anchorId} />
              ))}
            </ul>
          )}
        </section>
      ) : null}

      {/* No favorites yet: one clear call to pick them. The picks feed above
          takes over once a team is saved. */}
      {favCount === 0 ? (
        <Card className="pitch-watermark mt-3 flex items-center justify-between gap-3 p-3">
          <div className="min-w-0">
            <p className="text-sm font-bold text-ink">{t("myTeams.empty")}</p>
            <p className="mt-0.5 text-xs text-ink-3">{t("myTeams.hint")}</p>
          </div>
          <Link
            to="/onboarding"
            className="inline-flex min-h-11 flex-none items-center rounded-full bg-volt px-4 text-sm font-bold text-black transition-[filter] duration-[var(--t-fast)] hover:brightness-95"
          >
            {t("matches.pickTeams")}
          </Link>
        </Card>
      ) : null}

      {/* The live moment leads the general feed (product principle 1); the
          picks feed above already carries the favorite clubs' live games. */}
      {live.length > 0 ? liveSection : null}

      {/* General upcoming feed, capped with picks saved so the page stays a
          glance, not a scroll. Results live in the team rows above. */}
      <CollapsibleSection
        id="matches-upcoming"
        title={t("matches.upcoming")}
        count={upcoming0.length}
        defaultOpen
      >
        {matchesQuery.isLoading ? (
          <ul className="space-y-2">
            <MatchCardSkeleton />
          </ul>
        ) : matchesQuery.isError ? (
          <ErrorState
            title={t("error.title")}
            hint={t("error.hint")}
            onRetry={() => matchesQuery.refetch()}
          />
        ) : upcomingShown.length > 0 ? (
          <ul className="space-y-2">
            {upcomingShown.map((match) => (
              <MatchCard key={match.id} match={match} />
            ))}
          </ul>
        ) : (
          <EmptyState title={t("matches.empty")} hint={t("matches.emptyHint")} />
        )}
      </CollapsibleSection>

      {/* Previous results beneath the feed: folded away by default so the
          matchday page leads with what's next; open when the score is wanted.
          Hidden entirely until there is a result — an always-empty disclosure
          is noise, not navigation. */}
      {finished.length > 0 || matchesQuery.isLoading || matchesQuery.isError ? (
        <CollapsibleSection
          id="matches-previous"
          title={t("matches.previous")}
          count={finished0.length}
          defaultOpen={false}
        >
          {matchesQuery.isLoading ? (
            <ul className="space-y-2">
              <MatchCardSkeleton />
            </ul>
          ) : matchesQuery.isError ? (
            <ErrorState
              title={t("error.title")}
              hint={t("error.hint")}
              onRetry={() => matchesQuery.refetch()}
            />
          ) : (
            <ul className="space-y-2">
              {finished.map((match) => (
                <MatchCard key={match.id} match={match} />
              ))}
            </ul>
          )}
        </CollapsibleSection>
      ) : null}

      <div className="mt-6 grid place-items-center">
        <Button variant="ghost" className="text-xs" onClick={refresh} disabled={refreshing}>
          {t("matches.refresh")}
          {lastSync ? ` Â· ${formatClock(lastSync, locale)}` : ""}
        </Button>
      </div>

      {/* Inline sponsored card (Adsgram Task) — Telegram only, hidden when
          nothing fills; see src/lib/ads.ts for the whole story. */}
      <TaskAdCard />
    </>
  );
}

/* ------------------------------------------------------------ team rows */

/**
 * One row per favorite club — the entire "what are my teams doing" answer in
 * a single glance: live score with minute, else next kickoff, else the last
 * result. Full-width row (the compact tile strip wasted a whole band and
 * still needed a second tap to see anything), anchor club marked with gold.
 */
function TeamRow({
  team,
  context,
  anchored,
}: {
  team: Team;
  context: ReturnType<typeof clubContext>;
  anchored: boolean;
}) {
  const { t, lang, localize } = useI18n();
  const locale = lang === "fa" ? "fa-IR" : undefined;
  const { live, next, last } = context;

  let state: ReactNode;
  let meta: ReactNode;
  if (live) {
    const goalsFor = live.home.id === team.id ? live.homeScore : live.awayScore;
    const goalsAgainst = live.home.id === team.id ? live.awayScore : live.homeScore;
    state = (
      <span className="inline-flex items-center gap-1.5 text-live">
        <LiveDot />
        <Num className="text-lg">
          {goalsFor}–{goalsAgainst}
        </Num>
        <span className="text-[10px] font-normal text-ink-3">{live.minute}</span>
      </span>
    );
    meta = <span className="text-[11px] text-ink-3">{t("matches.live")}</span>;
  } else if (next) {
    state = (
      <span className="flex items-center gap-2">
        <TeamBadge team={next.home.id === team.id ? next.away : next.home} size="sm" />
        <span className="text-xs font-bold text-ink-2">
          {t("myTeams.vsOpp", { opp: localize(opponentOf(team.id, next).shortName) })}
        </span>
      </span>
    );
    meta = <span className="text-[11px] text-ink-3">{formatKickoff(new Date(next.kickoffAt), locale)}</span>;
  } else if (last) {
    const forTeam = (m: Match) => (m.home.id === team.id ? m.homeScore : m.awayScore) ?? 0;
    const againstTeam = (m: Match) => (m.home.id === team.id ? m.awayScore : m.homeScore) ?? 0;
    const won = forTeam(last) > againstTeam(last);
    state = (
      <Num className={cx("text-lg", won ? "text-pitch" : "text-ink-2")}>
        {forTeam(last)}–{againstTeam(last)}
      </Num>
    );
    meta = <span className="text-[11px] text-ink-3">{t("status.finished")}</span>;
  } else {
    state = <span className="text-xs text-ink-3">{t("matches.noMatch")}</span>;
    meta = null;
  }

  const target = live ?? next ?? last;
  return (
    <li>
      {target ? (
        <Link
          to={`/match/${target.id}`}
          className={cx(
            "flex min-h-14 items-center gap-3 rounded-card border bg-surface p-2.5 transition-colors duration-[var(--t-fast)] hover:bg-elevated",
            anchored ? "border-gold/60" : "border-line",
          )}
        >
          <TeamBadge team={team} size="md" />
          <span className="min-w-0 flex-1">
            <span className="flex items-center gap-1.5">
              <span className="truncate text-sm font-bold text-ink">{localize(team.shortName)}</span>
              {anchored ? <StarFilledIcon className="h-3 w-3 flex-none text-gold" /> : null}
            </span>
            {meta}
          </span>
          {state}
        </Link>
      ) : (
        <div className="flex min-h-14 items-center gap-3 rounded-card border border-line bg-surface p-2.5">
          <TeamBadge team={team} size="md" />
          <span className="min-w-0 flex-1 truncate text-sm font-bold text-ink">
            {localize(team.shortName)}
          </span>
          {state}
        </div>
      )}
    </li>
  );
}
