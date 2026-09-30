import { useEffect, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { ConfettiBurst } from "../components/Confetti";
import { ClubFixtureCard } from "../components/ClubCard";
import { MatchCard } from "../components/MatchCard";
import { MatchCardSkeleton } from "../components/Skeletons";
import { TopBar } from "../components/TopBar";
import { useToast } from "../components/Toast";
import { Button, Card, Chip, EmptyState, ErrorState, Num, SectionHeading, cx } from "../components/ui";
import { useMatches, useFollowedLeagues } from "../hooks/useApi";
import { MAX_FAVORITES, useFavorites } from "../hooks/useFavorites";
import { useI18n } from "../i18n/I18nProvider";
import { formatClock } from "../lib/format";
import { haptic, notifyHaptic } from "../lib/telegram";
import { BallIcon, PlusIcon, RefreshIcon, StarFilledIcon } from "../components/icons";
import type { Match } from "../types";

export default function Matches() {
  const { t, lang, localize } = useI18n();
  const { push } = useToast();
  const locale = lang === "fa" ? "fa-IR" : undefined;
  const queryClient = useQueryClient();

  // Deep link from Browse: /matches?league=eng.1 narrows the feed to one
  // competition. Absent param = the followed-leagues feed (or everything).
  const [searchParams] = useSearchParams();
  const league = searchParams.get("league") ?? undefined;

  const { teams: favTeams, anchorId, count: favCount, isFavorite } = useFavorites();
  const followed = useFollowedLeagues();
  const [onlyMine, setOnlyMine] = useState(false);

  // Followed leagues narrow the default feed when set; the deep-link param
  // (from Browse) takes precedence over both.
  const [leagueFilter, setLeagueFilter] = useState<string | null>(null);
  const activeLeague = league ?? leagueFilter ?? undefined;

  const matchesQuery = useMatches({ league: activeLeague });
  const matches = matchesQuery.data ?? [];

  const [refreshing, setRefreshing] = useState(false);
  const [lastSync, setLastSync] = useState<Date | null>(null);
  const [flashId, setFlashId] = useState<string | null>(null);
  const [burst, setBurst] = useState(0);

  const live0 = matches.filter((m) => m.status === "live");
  const upcoming0 = matches.filter((m) => m.status === "scheduled");
  const finished0 = matches.filter((m) => m.status === "finished");

  const inMyTeams = (match: Match) => isFavorite(match.home.id) || isFavorite(match.away.id);
  // Your clubs sort to the top of each section; the filter narrows to them only.
  const organize = (list: Match[]) => {
    const filtered = onlyMine ? list.filter(inMyTeams) : list;
    return [...filtered].sort((a, b) => Number(inMyTeams(b)) - Number(inMyTeams(a)));
  };
  const live = organize(live0);
  const upcoming = organize(upcoming0);
  const finished = organize(finished0);

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

  // PRODUCT.md rule 1: the live moment leads the screen.
  const liveSection = (
    <section className="mt-3">
      <SectionHeading
        title={t("matches.live")}
        action={
          live.length > 0 ? (
            <Chip tone="live">
              <Num>{live.length}</Num>
            </Chip>
          ) : null
        }
      />
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
        <EmptyState
          title={t(onlyMine ? "matches.emptyFilter" : "matches.empty")}
          hint={t("matches.emptyHint")}
        />
      )}
    </section>
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

      {/* The live moment leads; cards and countdown follow it. */}
      {live.length > 0 ? liveSection : null}

      {/* Your clubs: live/next fixture first, plus the only-mine filter below. */}
      {favCount > 0 ? (
        <section className="mt-3">
          <SectionHeading
            title={t("matches.myTeams")}
            action={
              <button
                type="button"
                onClick={() => {
                  haptic("light");
                  setOnlyMine((value) => !value);
                }}
                aria-pressed={onlyMine}
                className={cx(
                  "min-h-11 rounded-full border px-3 text-[11px] font-bold transition-colors duration-[var(--t-fast)]",
                  onlyMine ? "border-volt text-volt" : "border-line text-ink-3 hover:text-ink-2",
                )}
                style={
                  onlyMine
                    ? { backgroundColor: "color-mix(in srgb, var(--volt) 12%, transparent)" }
                    : undefined
                }
              >
                <StarFilledIcon className="me-1 inline-block align-[-1px]" />
                {t("matches.showMyOnly")}
              </button>
            }
          />
          <ul className="-mx-3 flex gap-2 overflow-x-auto px-3 pb-1">
            {/* Anchor club leads the strip (concept pillar 1). */}
            {[...favTeams]
              .sort((a, b) => Number(b.id === anchorId) - Number(a.id === anchorId))
              .map((team) => (
                <ClubFixtureCard key={team.id} team={team} anchored={team.id === anchorId} />
              ))}
            {favCount < MAX_FAVORITES ? (
              <li className="flex-none">
                <Link
                  to="/my-teams"
                  className="grid min-h-[96px] w-[92px] place-items-center rounded-card border border-dashed border-line text-ink-3 transition-colors duration-[var(--t-fast)] hover:bg-elevated hover:text-ink"
                >
                  <PlusIcon />
                </Link>
              </li>
            ) : null}
          </ul>
        </section>
      ) : (
        <Card className="pitch-watermark mt-3 flex items-center justify-between gap-3 p-3">
          <div className="min-w-0">
            <p className="text-sm font-bold text-ink">{t("myTeams.empty")}</p>
            <p className="mt-0.5 text-xs text-ink-3">{t("myTeams.hint")}</p>
          </div>
          <Link
            to="/my-teams"
            className="inline-flex min-h-11 flex-none items-center rounded-full bg-volt px-4 text-sm font-bold text-black transition-[filter] duration-[var(--t-fast)] hover:brightness-95"
          >
            {t("matches.pickTeams")}
          </Link>
        </Card>
      )}

      {/* Nothing live: the section takes its slot below the summary instead. */}
      {live.length === 0 ? liveSection : null}

      <section className="mt-6">
        <SectionHeading title={t("matches.upcoming")} />
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
        ) : upcoming.length > 0 ? (
          <ul className="space-y-2">
            {upcoming.map((match) => (
              <MatchCard key={match.id} match={match} />
            ))}
          </ul>
        ) : onlyMine ? (
          <EmptyState
            title={t("matches.emptyFilter")}
            action={
              <Button variant="ghost" className="min-h-11 px-4 text-xs" onClick={() => setOnlyMine(false)}>
                {t("matches.emptyFilterAction")}
              </Button>
            }
          />
        ) : (
          <EmptyState title={t("matches.empty")} hint={t("matches.emptyHint")} />
        )}
      </section>

      <section className="mt-6">
        <SectionHeading title={t("matches.finished")} />
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
        ) : finished.length > 0 ? (
          <ul className="space-y-2">
            {finished.map((match) => (
              <MatchCard key={match.id} match={match} />
            ))}
          </ul>
        ) : onlyMine ? (
          <EmptyState
            title={t("matches.emptyFilter")}
            action={
              <Button variant="ghost" className="min-h-11 px-4 text-xs" onClick={() => setOnlyMine(false)}>
                {t("matches.emptyFilterAction")}
              </Button>
            }
          />
        ) : (
          <EmptyState title={t("matches.empty")} hint={t("matches.emptyHint")} />
        )}
      </section>

      <div className="mt-6 grid place-items-center">
        <Button variant="ghost" className="text-xs" onClick={refresh} disabled={refreshing}>
          {t("matches.refresh")}
          {lastSync ? ` Â· ${formatClock(lastSync, locale)}` : ""}
        </Button>
      </div>
    </>
  );
}
