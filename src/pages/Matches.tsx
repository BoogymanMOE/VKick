import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { ConfettiBurst } from "../components/Confetti";
import { MatchCard } from "../components/MatchCard";
import { TopBar } from "../components/TopBar";
import { useToast } from "../components/toastContext";
import { Chip, CollapsibleSection, EmptyState, ErrorState, Num } from "../components/ui";
import { useLocalState } from "../lib/useLocalState";
import {
  BallIcon,
  CloseIcon,
  PlusIcon,
  RefreshIcon,
  StarFilledIcon,
} from "../components/icons";
import { MatchCardSkeleton } from "../components/Skeletons";
import { useNow } from "../hooks/useNow";
import { cx } from "../lib/cx";
import { useMatches, useFollowedLeagues, useSyncHealth } from "../hooks/useApi";
import { useFavorites } from "../hooks/useFavorites";
import { useI18n } from "../i18n/context";
import { formatClock } from "../lib/format";
import { competitionName } from "../lib/leagues";
import { haptic, notifyHaptic } from "../lib/telegram";
import { DateStrip } from "../components/DateStrip";
import { InlineAd } from "../components/InlineAd";
import { LeaguePickerSheet } from "../components/panels/LeaguePickerSheet";
import { usePullToRefresh } from "../hooks/usePullToRefresh";
import { useLiveUpdates } from "../hooks/useLiveUpdates";
import { PullIndicator } from "../components/PullToRefresh";
import type { Match } from "../types";

/**
 * One chip in the league scope row: smaller than a 44px target on purpose, with
 * an invisible `after:` band that keeps the real hit area at 44px — the visual
 * language wanted a tighter pill without shrinking what a thumb can hit.
 */
const LEAGUE_CHIP =
  "relative h-9 flex-none rounded-full border px-3.5 text-sm font-bold transition-[color,background-color,transform] duration-[var(--t-fast)] active:scale-[0.97] after:absolute after:-inset-x-0.5 after:-inset-y-1 after:content-['']";

/** Selected league chip: filled volt pill — the row's one "picked" affordance. */
const LEAGUE_CHIP_ON = "border-volt bg-volt/15 text-volt";
const LEAGUE_CHIP_OFF = "border-line text-ink-3";

const pad = (n: number) => String(n).padStart(2, "0");

function GroupHeader({ id, label, count, tone }: { id: string; label: string; count: number; tone: "live" | "gold" | "muted" }) {
  return (
    <div className="mb-2 mt-lg flex items-center gap-2 first:mt-0">
      <h2
        id={id}
        className={cx(
          "text-sm font-extrabold",
          tone === "live" ? "text-live" : tone === "gold" ? "text-gold" : "text-ink-2",
        )}
      >
        {label}
      </h2>
      <Chip tone={tone}>
        <Num>{count}</Num>
      </Chip>
    </div>
  );
}

/**
 * Local calendar-day key. NEVER use toISOString() for this: it is UTC, so east
 * of UTC (this app's users are UTC+3:30/+4) local midnight is still the previous
 * UTC day and every match would be filed under the wrong date.
 */
const dayKey = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const startOfDay = (d: Date) => {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
};
const STATUS_RANK: Record<string, number> = { live: 0, halftime: 0, scheduled: 1, finished: 2 };
/** Live first, then upcoming by kickoff, then finished. */
const byPlay = (a: Match, b: Match) =>
  (STATUS_RANK[a.status] ?? 1) - (STATUS_RANK[b.status] ?? 1) ||
  new Date(a.kickoffAt).getTime() - new Date(b.kickoffAt).getTime();

/**
 * Pick-banner dismiss is persisted so a user who already said “don’t show me
 * this again” keeps that choice after reload — the stored id beats the
 * computed “we don’t have any favorites” default.
 */
const PICK_BANNER_KEY = "verdikick.pickBannerDismissed";

export default function Matches() {
  const { t, lang, localize } = useI18n();
  const { push } = useToast();
  const navigate = useNavigate();
  const locale = lang === "fa" ? "fa-IR" : undefined;
  /** Localized short day label ("Wed 21" / "پ، ۲۱") for the empty-day copy. */
  const dayLabel = (d: Date) =>
    new Intl.DateTimeFormat(locale, { weekday: "short", day: "numeric" }).format(d);  const queryClient = useQueryClient();
  useLiveUpdates();

  // Deep link from Browse: /matches?league=eng.1 narrows the feed to one
  // competition. Absent param = the followed-leagues feed (or everything).
  const [searchParams] = useSearchParams();
  const league = searchParams.get("league") ?? undefined;
  const { count: favCount, isFavorite } = useFavorites();
  const followed = useFollowedLeagues();

  // Followed leagues narrow the default feed when set; the deep-link param
  // (from Browse) takes precedence over both.
  const [leagueFilter, setLeagueFilter] = useState<string | null>(null);
  const activeLeague = league ?? leagueFilter ?? undefined;

  const [bannerDismissed, setBannerDismissed] = useLocalState<boolean>(PICK_BANNER_KEY, false);
  const showPickBanner = favCount === 0 && !bannerDismissed;

  const matchesQuery = useMatches({ league: activeLeague });
  // Stable identity: every memo below keys on it, and `data ?? []` would hand
  // them a fresh array on each render (query data is stable between refetches).
  const matches = useMemo(() => matchesQuery.data ?? [], [matchesQuery.data]);

  // The Favorite Leagues sheet. Local to the feed (not a route) so opening and
  // closing it never loses the scroll position or the selected league chip.
  const [leaguesOpen, setLeaguesOpen] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [lastSync, setLastSync] = useState<Date | null>(null);
  const [burst, setBurst] = useState(0);

  // Date strip: 5 day chips. `picked` is null while "today" is selected — the
  // day is then recomputed from the clock every minute, so an app left open
  // past local midnight rolls over to the new day instead of sticking on the
  // one it booted with.
  const now = useNow(60_000);
  const [picked, setPicked] = useState<Date | null>(null);
  const selectedDay = picked ?? startOfDay(new Date(now));
  const selectedKey = dayKey(selectedDay);

  // Filter by LOCAL calendar day, and order each day the way people read a
  // matchday: what is on now, then what is next, then what already happened.
  const dayMatches = useMemo(
    () => matches.filter((m) => dayKey(new Date(m.kickoffAt)) === selectedKey).sort(byPlay),
    [matches, selectedKey],
  );

  const myTeamsMatches = useMemo(
    () => dayMatches.filter((m) => isFavorite(m.home.id) || isFavorite(m.away.id)),
    [dayMatches, isFavorite],
  );
  const otherMatches = useMemo(
    () => dayMatches.filter((m) => !myTeamsMatches.includes(m)),
    [dayMatches, myTeamsMatches],
  );

  // The rest of the day, grouped by state: a busy matchday is otherwise one
  // column of twelve half-time borders. Live first, then the break, then what
  // is still ahead, then the record. Parts of the day before group boundaries
  // never repeat: `Match` folds a real `halftime` server status into `live`, so
  // the break flag carves the half-time group out of the live column.
  const groups = useMemo(() => {
    const g = { live: [] as Match[], halftime: [] as Match[], scheduled: [] as Match[], finished: [] as Match[] };
    for (const m of otherMatches) {
      if (m.status === "finished") g.finished.push(m);
      else if (m.isHalftime) g.halftime.push(m);
      else if (m.status === "live") g.live.push(m);
      else g.scheduled.push(m);
    }
    return g;
  }, [otherMatches]);
  const isToday = selectedKey === dayKey(startOfDay(new Date(now)));
  // Finished collapsed by default whenever anything sits above it (my teams
  // included); expanded by default when it is the day's only content. A saved
  // per-user choice always beats this computed default — useLocalState reads
  // the stored value before it ever looks at `defaultOpen`.
  const onlyFinishedHasContent =
    myTeamsMatches.length === 0 &&
    groups.live.length === 0 &&
    groups.halftime.length === 0 &&
    groups.scheduled.length === 0;

  // First later day that has matches, for the empty state's shortcut.
  const nextMatchDay = useMemo(() => {
    const later = matches
      .map((m) => new Date(m.kickoffAt))
      .filter((d) => dayKey(d) > selectedKey)
      .sort((a, b) => a.getTime() - b.getTime());
    return later[0] ? startOfDay(later[0]) : null;
  }, [matches, selectedKey]);

  // The server's sync ledger (the sentinel's snapshot), polled on a slow loop:
  // the footer's data-age line tells the truth about the DATA, not just about
  // the last browser fetch — sync can lag behind a 200-OK, and "silently
  // quiet" is the one failure a live-score feed must never have.
  const syncHealth = useSyncHealth();
  const serverSyncedAt = syncHealth.data?.latestLastSyncedAt
    ? new Date(syncHealth.data.latestLastSyncedAt)
    : null;
  const syncAt = serverSyncedAt ?? (lastSync as Date | null);
  const syncStale = syncAt ? Date.now() - syncAt.getTime() > 30 * 60_000 : false;

  // No data AND an error: an error over cached matches would replace a usable
  // feed, so the error card is reserved for the cold-failure case.
  const hasFeedError = matchesQuery.isError && !matchesQuery.data;

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
      // The first successful fetch counts as a sync, so the feed can say when
      // it was last updated before any score has changed.
      setLastSync(new Date());
      return;
    }
    for (const [id, score] of incoming) {
      const prev = scoreRef.current.get(id);
      if (prev && prev !== score && score !== "–-–") {
        const match = matchesQuery.data.find((m) => m.id === id);
        if (match) {
          setBurst((value) => value + 1);
          notifyHaptic("success");
          push({
            text: `${localize(match.home.shortName)} ${match.homeScore ?? 0}-${match.awayScore ?? 0} ${localize(match.away.shortName)}`,
            tone: "volt",
            icon: <BallIcon className="h-4 w-4" />,
          });
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
        // A successful sync, not a spinner: the checkmark says "done".
        icon: "✓",
      });
    });
  }

  // Pull down from the top of the feed to resync: the gesture this screen's
  // users expect on a live-score view. The TopBar icon stays as the equivalent
  // for keyboard and screen-reader users, so this is an addition, never the
  // only path.
  const pull = usePullToRefresh(refresh, !refreshing);

  return (
    <>
      <ConfettiBurst trigger={burst} />
      <TopBar
        title={t("matches.title")}
        subtitle={new Date().toLocaleDateString(lang === "fa" ? "fa-IR" : undefined, {
          weekday: "short",
          day: "numeric",
          month: "short",
        })}
        right={
          // The non-gesture refresh path the pull-to-refresh comment promises:
          // a real 44px button, reachable by keyboard and announced by name.
          <button
            type="button"
            onClick={refresh}
            disabled={refreshing}
            aria-label={t("common.refresh")}
            title={t("common.refresh")}
            className="grid h-11 w-11 flex-none place-items-center rounded-full border border-line text-ink transition-colors duration-[var(--t-fast)] hover:bg-elevated disabled:opacity-60"
          >
            <span className={cx(refreshing && "animate-spin")}>
              <RefreshIcon />
            </span>
          </button>
        }
      />

      {/* Everything below sits under the sticky header. The wrapper gives the
          pull-to-refresh marker an anchor so it slides in between header and
          feed instead of fighting the header for the same band. */}
      <div className="relative">
        <PullIndicator pull={pull} />

        {/* Date strip: 5 day chips, today selected by default. */}
        <DateStrip selected={selectedDay} onSelect={setPicked} />

        {/* Favorite leagues — the start page's own way in. One tap re-scopes
            the whole feed (concept pillar 1); the last chip opens the picker,
            and the row is here even with nothing followed so leagues are
            pickable from the feed rather than only during onboarding.

            py-1 with -my-1 keeps the chips' 4px invisible hit band INSIDE this
            scroll container: overflow-x-auto clips vertically too, so without
            the padding the extra target area above and below is unreachable. */}
        {!league && (followed.count > 0 || favCount > 0) ? (
          <div className="-mx-[var(--space-page-x,16px)] -my-1 mt-md flex items-center gap-1.5 overflow-x-auto px-[var(--space-page-x,16px)] py-1">
            {followed.count > 0 ? (
              <>
                <button
                  type="button"
                  onClick={() => {
                    haptic("light");
                    setLeagueFilter(null);
                  }}
                  aria-pressed={leagueFilter === null}
                  className={cx(LEAGUE_CHIP, leagueFilter === null ? LEAGUE_CHIP_ON : LEAGUE_CHIP_OFF)}
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
                    className={cx(LEAGUE_CHIP, leagueFilter === l.league ? LEAGUE_CHIP_ON : LEAGUE_CHIP_OFF)}                    >
                    {l.name ? localize(l.name) : competitionName(l.league, lang)}
                  </button>
                ))}
              </>
            ) : null}
            <button
              type="button"
              onClick={() => {
                haptic("light");
                setLeaguesOpen(true);
              }}
              aria-haspopup="dialog"
              className={cx(LEAGUE_CHIP, "inline-flex items-center gap-1.5 border-volt text-volt")}
              style={{ backgroundColor: "color-mix(in srgb, var(--volt) 12%, transparent)" }}
            >
              <PlusIcon className="h-3.5 w-3.5" aria-hidden="true" />
              {t(followed.count > 0 ? "leagues.edit" : "matches.pickLeagues")}
            </button>
          </div>
        ) : null}

        <LeaguePickerSheet open={leaguesOpen} onClose={() => setLeaguesOpen(false)} />

        {/* Single-league deep link: name the scope, let the user leave. Without
          this the screen looks like a broken feed when the window is quiet. */}
        {league ? (
          <div className="mt-md flex items-center justify-between gap-2 rounded-card border border-line bg-surface px-4 py-3">
            <p className="min-w-0 truncate text-xs text-ink-2">
              {t("matches.leagueScope", {
                league: competitionName(league, lang),
              })}
            </p>
            <button
              type="button"
              onClick={() => {
                haptic("light");
                navigate("/matches");
              }}
              className="inline-flex min-h-11 flex-none items-center rounded-full border border-volt px-3 text-xs font-bold text-volt transition-colors duration-[var(--t-fast)] hover:bg-elevated"
            >
              {t("matches.showAll")}
            </button>
          </div>
        ) : null}

        {/* No favorites yet: above the groups, because it is the answer to an
            empty feed rather than a footnote under one. Hidden while the first
            payload loads — the skeleton list stands in for the whole feed. */}
        {showPickBanner && !matchesQuery.isLoading ? (
          <div
            role="region"
            aria-label={t("matches.pickBanner")}
            className="mt-2 flex min-h-11 items-center gap-2 rounded-card border border-line bg-elevated ps-3 pe-1"
          >
            <StarFilledIcon className="h-4 w-4 flex-none text-gold" aria-hidden="true" />
            <p className="min-w-0 flex-1 text-xs font-bold text-ink">{t("matches.pickBanner")}</p>
            <Link
              to="/onboarding"
              onClick={() => haptic("light")}
              className="inline-flex min-h-11 flex-none items-center rounded-full bg-volt px-4 text-xs font-bold text-black"
            >
              {t("matches.pickBannerCta")}
            </Link>
            <button
              type="button"
              aria-label={t("matches.pickBannerDismiss")}
              onClick={() => {
                haptic("light");
                setBannerDismissed(true);
              }}
              className="grid h-11 w-11 flex-none place-items-center rounded-full text-ink-3"
            >
              <CloseIcon className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>
        ) : null}

        {/* Feed states: three skeletons while the first payload lands, an error
            card only when there is nothing cached, and an empty day that offers
            the next day with football instead of a dead end. */}
        {matchesQuery.isLoading ? (
          <ul className="mt-md space-y-2" aria-busy="true">
            <MatchCardSkeleton />
            <MatchCardSkeleton />
            <MatchCardSkeleton />
            <MatchCardSkeleton />
          </ul>
        ) : hasFeedError ? (
          <div className="mt-md">
            <ErrorState onRetry={() => matchesQuery.refetch()} />
          </div>
        ) : dayMatches.length === 0 ? (
          <div className="mt-md">
            <EmptyState
              icon="⚽"
              title={t("matches.emptyDay", { day: dayLabel(selectedDay) })}
              hint={
                nextMatchDay
                  ? t("matches.emptyNext", { day: dayLabel(nextMatchDay) })
                  : t("matches.emptyHint")
              }
              action={
                nextMatchDay ? (
                  <button
                    type="button"
                    onClick={() => {
                      haptic("light");
                      setPicked(nextMatchDay);
                    }}
                    className="min-h-11 rounded-full border border-volt px-5 text-sm font-bold text-volt transition-colors duration-[var(--t-fast)] hover:bg-elevated"
                  >
                    {t("matches.goToDay", { day: dayLabel(nextMatchDay) })}
                  </button>
                ) : null
              }
            />
          </div>
        ) : null}

        {!matchesQuery.isLoading && !hasFeedError ? (
          <div key={selectedKey} className="day-swap">
            {/* My teams group: matches where a favorite team is playing. */}
            {favCount > 0 && myTeamsMatches.length > 0 && (
              <section className="mt-md">
                <div className="mb-2 flex items-center gap-2">
                  <StarFilledIcon className="h-3.5 w-3.5 text-gold" aria-hidden="true" />
                  <h2 className="text-sm font-bold text-ink-2">{t("matches.myTeams")}</h2>
                </div>
                <ul className="space-y-2">
                  {myTeamsMatches.map((match, index) => (
                    <MatchCard key={match.id} match={match} index={index} />
                  ))}
                </ul>
              </section>
            )}

            {/* Inline ad between the two groups. */}
            {favCount > 0 && myTeamsMatches.length > 0 && otherMatches.length > 0 && (
              <InlineAd />
            )}

            {/* Everything else on the day, grouped by state. */}
            {groups.live.length > 0 && (
              <section aria-labelledby="feed-group-live">
                <GroupHeader id="feed-group-live" label={t("matches.groupLive")} count={groups.live.length} tone="live" />
                <ul className="space-y-2">
                  {groups.live.map((match, index) => (
                    <MatchCard key={match.id} match={match} index={index} />
                  ))}
                </ul>
              </section>
            )}

            {groups.halftime.length > 0 && (
              <section aria-labelledby="feed-group-halftime">
                <GroupHeader
                  id="feed-group-halftime"
                  label={t("matches.groupHalftime")}
                  count={groups.halftime.length}
                  tone="gold"
                />
                <ul className="space-y-2">
                  {groups.halftime.map((match, index) => (
                    <MatchCard key={match.id} match={match} index={index} />
                  ))}
                </ul>
              </section>
            )}

            {groups.scheduled.length > 0 && (
              <section aria-labelledby="feed-group-scheduled">
                <GroupHeader
                  id="feed-group-scheduled"
                  label={t(isToday ? "matches.groupLater" : "matches.groupUpcoming")}
                  count={groups.scheduled.length}
                  tone="muted"
                />
                <ul className="space-y-2">
                  {groups.scheduled.map((match, index) => (
                    <MatchCard key={match.id} match={match} index={index} />
                  ))}
                </ul>
              </section>
            )}

            {groups.finished.length > 0 && (
              <CollapsibleSection
                id="feed-finished"
                level={2}
                title={t("matches.groupFinished")}
                count={groups.finished.length}
                defaultOpen={onlyFinishedHasContent}
              >
                <ul className="space-y-2">
                  {groups.finished.map((match, index) => (
                    <MatchCard key={match.id} match={match} index={index} />
                  ))}
                </ul>
              </CollapsibleSection>
            )}
          </div>
        ) : null}

        {/* Sync note, not a second refresh button: pull-to-refresh and the
          TopBar icon already carry the action, so this line only reports it. */}
        <p className="mt-xl text-center text-xs text-ink-3">
          {t("matches.hint")}
          {syncStale
            ? ` · ${t("matches.syncDelayed")}`
            : syncAt
              ? ` · ${t("matches.dataAsOf", { time: formatClock(syncAt, locale) })}`
              : lastSync
                ? ` · ${t("matches.lastSync", { time: formatClock(lastSync, locale) })}`
                : ""}
        </p>
      </div>
    </>
  );
}

