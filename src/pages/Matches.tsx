import { Fragment, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { ConfettiBurst } from "../components/Confetti";
import { TopBar } from "../components/TopBar";
import { useToast } from "../components/toastContext";
import { EmptyState, ErrorState } from "../components/ui";
import { useLocalState } from "../lib/useLocalState";
import {
  BallIcon,
  CalendarIcon,
  CloseIcon,
  PlusIcon,
  StarFilledIcon,
} from "../components/icons";
import { LeagueGroupSkeleton } from "../components/Skeletons";
import { useNow } from "../hooks/useNow";
import { cx } from "../lib/cx";
import { useMatches, useFollowedLeagues, useSyncHealth } from "../hooks/useApi";
import { useFavorites } from "../hooks/useFavorites";
import { useI18n } from "../i18n/context";
import { formatClock } from "../lib/format";
import { competitionName } from "../lib/leagues";
import { haptic, notifyHaptic } from "../lib/telegram";
import { DateStrip, dayKey as chipDayKey } from "../components/DateStrip";
import { InlineAd } from "../components/InlineAd";
import { LeaguePickerSheet } from "../components/panels/LeaguePickerSheet";
import { CalendarSheet } from "../components/panels/CalendarSheet";
import { usePullToRefresh } from "../hooks/usePullToRefresh";
import { useLiveUpdates } from "../hooks/useLiveUpdates";
import { PullIndicator } from "../components/PullToRefresh";
import { LeagueGroup } from "../components/LeagueGroup";
import {
  addJalaliMonths,
  jalaliMonthLength,
  jalaliToGregorian,
  toJalali,
} from "../lib/jalali";
import type { Match } from "../types";

/**
 * One chip in the league scope row: smaller than a 44px target on purpose, with
 * an invisible `after:` band that keeps the real hit area at 44px — the visual
 * language wanted a tighter pill without shrinking what a thumb can hit.
 */
const LEAGUE_CHIP ="relative h-9 flex-none rounded-lg border px-3.5 text-sm font-bold transition-[color,background-color,transform] duration-[var(--t-fast)] active:scale-[0.97] after:absolute after:-inset-x-0.5 after:-inset-y-1 after:content-['']"
;

/** Selected league chip: filled volt pill — the row's one "picked" affordance. */
const LEAGUE_CHIP_ON = "border-volt bg-volt/15 text-volt";
const LEAGUE_CHIP_OFF = "border-line text-ink-3";

const pad = (n: number) => String(n).padStart(2, "0");
const localDayKey = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

/**
 * The calendar sheet spans today ± this many months (see CalendarSheet), so
 * the feed query must cover every day in that band: a picked day three months
 * out HAS fixtures to show, not the old “no matches” lie. With `from`/`to`
 * set the server runs its range mode, unbounded by the 3-week relevance
 * window — hence the explicit limit matching the server's range ceiling.
 */
const CALENDAR_HORIZON_MONTHS = 3;
const FEED_RANGE_LIMIT = 2000;

/**
 * The band's first/last day, anchored at month bounds of the ACTIVE calendar
 * (Solar Hijri under Persian, Gregorian under English) so every tile the
 * sheet can clip into — its grid steps whole months of that calendar — is
 * inside the fetched range. Computed once per language: an app left open
 * across a month boundary would rebolt the range on reload, and the mid-band
 * days it misses next session are caught by the cache-busting refetch.
 */
function feedRange(lang: "en" | "fa"): { from: string; to: string } {
  const now = new Date();
  if (lang === "fa") {
    const t = toJalali(now);
    const min = addJalaliMonths(t.jy, t.jm, -CALENDAR_HORIZON_MONTHS);
    const max = addJalaliMonths(t.jy, t.jm, CALENDAR_HORIZON_MONTHS);
    return {
      from: localDayKey(jalaliToGregorian(min.jy, min.jm, 1)),
      to: localDayKey(jalaliToGregorian(max.jy, max.jm, jalaliMonthLength(max.jy, max.jm))),
    };
  }
  return {
    from: localDayKey(new Date(now.getFullYear(), now.getMonth() - CALENDAR_HORIZON_MONTHS, 1)),
    to: localDayKey(new Date(now.getFullYear(), now.getMonth() + CALENDAR_HORIZON_MONTHS + 1, 0)),
  };
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

/**
 * Pick-banner dismiss is persisted so a user who already said “don’t show me
 * this again” keeps that choice after reload — the stored id beats the
 * computed “we don’t have any favorites” default.
 */
const PICK_BANNER_KEY = "verdikick.pickBannerDismissed";

/** One competition's slice of the selected day; kickoff-sorted rows. */
interface DayLeagueGroup {
  league: string;
  matches: Match[];
  /** Earliest kickoff, numeric — group ordering's second key. */
  firstKickoff: number;
}

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

  // The calendar's full reach, not just the relevance window: the day feed and
  // the sheet's fixture dots both read this one list.
  const range = useMemo(() => feedRange(lang), [lang]);
  const matchesQuery = useMatches({
    league: activeLeague,
    from: range.from,
    to: range.to,
    limit: FEED_RANGE_LIMIT,
  });
  // Stable identity: every memo below keys on it, and `data ?? []` would hand
  // them a fresh array on each render (query data is stable between refetches).
  const matches = useMemo(() => matchesQuery.data ?? [], [matchesQuery.data]);

  // The Favorite Leagues sheet. Local to the feed (not a route) so opening and
  // closing it never loses the scroll position or the selected league chip.
  const [leaguesOpen, setLeaguesOpen] = useState(false);
  // The month picker, for the days the seven-chip week cannot reach.
  const [calendarOpen, setCalendarOpen] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [lastSync, setLastSync] = useState<Date | null>(null);
  const [burst, setBurst] = useState(0);

  // Date strip: 21 day chips. `picked` is null while "today" is selected — the
  // day is then recomputed from the clock every minute, so an app left open
  // past local midnight rolls over to the new day instead of sticking on the
  // one it booted with.
  const now = useNow(60_000);
  const [picked, setPicked] = useState<Date | null>(null);
  const selectedDay = picked ?? startOfDay(new Date(now));
  const selectedKey = dayKey(selectedDay);

  // Filter by LOCAL calendar day. The day's matches no longer group by state;
  // grouping is by competition (see `leagueGroups`).
  const dayMatches = useMemo(
    () => matches.filter((m) => dayKey(new Date(m.kickoffAt)) === selectedKey),
    [matches, selectedKey],
  );

  // Strip/calendar markers, one pass over the feed. The strip's dot marks ONLY
  // the days a followed club plays — a day full of fixtures the user doesn't
  // follow stays quiet — while the calendar sheet keeps its "has fixtures" dots,
  // because there the user is hunting open dates, not their own matchdays.
  const { daysWithMatches, daysWithFavorites } = useMemo(() => {
    const all = new Set<string>();
    const favorites = new Set<string>();
    for (const match of matches) {
      const key = chipDayKey(new Date(match.kickoffAt));
      all.add(key);
      if (isFavorite(match.home.id) || isFavorite(match.away.id)) favorites.add(key);
    }
    return { daysWithMatches: all, daysWithFavorites: favorites };
  }, [matches, isFavorite]);

  // THE GROUPING: the day's matches come together in one rounded container per
  // competition. Followed leagues lead (in the user's own follow order — that
  // IS their interest ranking, so it beats every computed heuristic); among the
  // rest, earliest kickoff first. Within a group, kickoff order top-to-bottom.
  const leagueGroups = useMemo<DayLeagueGroup[]>(() => {
    const byLeague = new Map<string, Match[]>();
    for (const match of dayMatches) {
      const list = byLeague.get(match.league);
      if (list) list.push(match);
      else byLeague.set(match.league, [match]);
    }
    // The followed list is at most 5 slugs, so building an index map per render
    // is cheaper than a `.find` inside the sort's comparator.
    const followOrder = new Map(followed.leagues.map((l, i) => [l.league, i]));
    return [...byLeague]
      .map(([leagueSlug, list]) => {
        const sorted = [...list].sort(
          (a, b) => new Date(a.kickoffAt).getTime() - new Date(b.kickoffAt).getTime(),
        );
        return {
          league: leagueSlug,
          matches: sorted,
          firstKickoff: new Date(sorted[0].kickoffAt).getTime(),
        };
      })
      .sort((a, b) => {
        const rankA = followOrder.get(a.league) ?? followOrder.size;
        const rankB = followOrder.get(b.league) ?? followOrder.size;
        return rankA - rankB || a.firstKickoff - b.firstKickoff;
      });
  }, [dayMatches, followed.leagues]);

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

  // Localization: localized short-month header date and localized digits.
  // calendar: "gregory" keeps fa-IR on the same month/day number the strip's
  // chips print (fa-IR's default Persian calendar renames them).
  const headerDayFormatter = useMemo(
    () =>
      new Intl.DateTimeFormat(locale, {
        weekday: "long",
        day: "numeric",
        month: "short",
        calendar: "gregory",
      }),
    [locale],
  );
  const digitsFormatter = useMemo(
    () => new Intl.NumberFormat(lang === "fa" ? "fa-IR" : "en", { useGrouping: false }),
    [lang],
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
  // users expect on a live-score view. The hook grabs the downward drag only
  // while the feed is at the very top and preventDefaults it, which is exactly
  // the shape Telegram's swipe-to-claim needs to lose: the app also calls
  // `disableVerticalSwipes()` once on boot (lib/telegram.ts), so the native
  // collapse gesture never forms to begin with, and this manual refresh is the
  // gesture that stays. Distance is capped and rubber-banded so the drag never
  // reaches the header collapse threshold.
  const pull = usePullToRefresh(refresh, !refreshing);

  return (
    // ≥600px: the whole screen (header row, strip, feed) re-centres into a
    // 480px column instead of stretching edge to edge — the companion web
    // layout. The inline `--app-max-width` feeds TopBar's own max-w (its
    // default is 768px), so the header's gutters land on the same column as
    // everything below it; below 600px the cap is inert and nothing changes.
    <div
      className="mx-auto w-full max-w-[480px]"
      style={{ "--app-max-width": "480px" } as CSSProperties}
    >
      <ConfettiBurst trigger={burst} />
      <TopBar
        title={t("matches.title")}
        // The subtitle is the SELECTED day plus its count: "یکشنبه ۲۵ اکتبر ·
        // ۲۲ مسابقه" — the DateStrip below can move the feed a week, so both
        // the weekday and the number must track the picked day, not the boot
        // clock. Digits localize (Persian digits under fa), the word is an
        // i18n key, and the old standalone count chip is gone.
        subtitle={t(
          dayMatches.length === 1 ? "matches.headerCountOne" : "matches.headerCount",
          {
            date: headerDayFormatter.format(selectedDay),
            count: digitsFormatter.format(dayMatches.length),
          },
        )}
        right={
          // One header action: the calendar. Refresh's button went away — the
          // gesture above owns the resync, and the toast after every sync is
          // still the visible confirmation. The calendar keeps its 40px visual
          // circle with an invisible 44px hit band (after:-inset-1) so the
          // thumb target never drops under the 44px floor.
          <button
            type="button"
            onClick={() => {
              haptic("light");
              setCalendarOpen(true);
            }}
            aria-haspopup="dialog"
            aria-label={t("matches.pickDate")}
            title={t("matches.pickDate")}
            className="relative grid h-10 w-10 flex-none place-items-center rounded-full border border-line text-ink transition-colors duration-[var(--t-fast)] hover:bg-elevated after:absolute after:-inset-1 after:content-['']"
          >
            <CalendarIcon className="h-[18px] w-[18px]" />
          </button>
        }
      />

      {/* Everything below sits under the sticky header. The wrapper gives the
          pull-to-refresh marker an anchor so it slides in between header and
          feed instead of fighting the header for the same band. */}
      <div className="relative" >
        <PullIndicator pull={pull} />
        {/* A full refresh in flight: the subtle carousel is the only visible
            state, since the header no longer carries a refresh button. */}
        {refreshing ? (
          <span
            role="status"
            aria-label={t("common.loading")}
            className="absolute end-0 top-0 z-10 grid h-7 w-7 place-items-center"
          >
            <span
              aria-hidden="true"
              className="h-4 w-4 animate-spin rounded-full border-2 border-line border-t-volt"
            />
          </span>
        ) : null}

        {/* Date strip: seven day chips across the full content width, today
            selected by default. mt-3 is the 12px gap under the header's bottom
            border; the calendar moved up into the header, and the sheet below
            is rendered from here so the header button has one owner. The dots
            under the chips mark the days a FOLLOWED club plays (teal), not
            every fixture-bearing day. */}
        <div className="mt-3">
          <DateStrip selected={selectedDay} onSelect={setPicked} daysWithFavorites={daysWithFavorites} />
        </div>
        <CalendarSheet
          open={calendarOpen}
          onClose={() => setCalendarOpen(false)}
          selected={selectedDay}
          onSelect={setPicked}
          daysWithMatches={daysWithMatches}
        />

        {/* Favorite leagues — the start page's own way in. One tap re-scopes
            the whole feed (concept pillar 1); the last chip opens the picker,
            and the row is here even with nothing followed so leagues are
            pickable from the feed rather than only during onboarding.

            py-1 keeps the chips' 4px invisible hit band INSIDE this scroll
            container: overflow-x-auto clips vertically too, so without the
            padding the extra target area above and below is unreachable. It is
            a plain 12px margin above now, not the old -my-1 compensation: the
            row is part of the 8px rhythm (12px under the strip, and the first
            group 16px under the row), and a -4px bottom margin was
            eating 4px of that gap. */}
        {!league && (followed.count > 0 || favCount > 0) ? (
          <div className="-mx-[var(--space-page-x,16px)] mt-md flex items-center gap-1.5 overflow-x-auto px-[var(--space-page-x,16px)] py-1">
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
              className="inline-flex min-h-11 flex-none items-center rounded-lg border border-volt px-3 text-xs font-bold text-volt transition-colors duration-[var(--t-fast)] hover:bg-elevated"
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
            className="mt-md flex min-h-12 items-center gap-2 rounded-card border border-line bg-elevated ps-3 pe-0.5"
          >
            <StarFilledIcon className="h-4 w-4 flex-none text-gold" aria-hidden="true" />
            <p className="min-w-0 flex-1 text-xs font-bold text-ink">{t("matches.pickBanner")}</p>
            <Link
              to="/onboarding"
              onClick={() => haptic("light")}
              // A pill, not a block glued to the banner's edge: 36px tall
              // inside the 48px banner, with an invisible band to 44px.
              className="relative inline-flex h-9 flex-none items-center rounded-full bg-volt px-4 text-[13px] font-bold text-black after:absolute after:-inset-1 after:content-['']"
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
          <ul className="mt-md space-y-3" aria-busy="true">
            <LeagueGroupSkeleton />
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
                    className="min-h-11 rounded-lg border border-volt px-5 text-sm font-bold text-volt transition-colors duration-[var(--t-fast)] hover:bg-elevated"
                  >
                    {t("matches.goToDay", { day: dayLabel(nextMatchDay) })}
                  </button>
                ) : null
              }
            />
          </div>
        ) : null}

        {/* The day's matches, grouped by competition — followed leagues first
            (the user's own follow order), then by earliest kickoff. Each group
            is one rounded container: header row (teal square dot, league name,
            count on the far end) over kick-off-sorted rows with hairline
            dividers. The sponsored card keeps its between-groups slot, after
            the leading group when there are several. */}
        {!matchesQuery.isLoading && !hasFeedError && leagueGroups.length > 0 ? (
          <div key={selectedKey} className="day-swap mt-4 space-y-3">
            {leagueGroups.map((group, index) => (
              <Fragment key={group.league}>
                <LeagueGroup
                  league={group.league}
                  matches={group.matches}
                  isFavoriteTeam={isFavorite}
                  index={index}
                />
                {index === 0 && leagueGroups.length > 1 ? <InlineAd /> : null}
              </Fragment>
            ))}
          </div>
        ) : null}

        {/* Sync note: the feed resyncs through pull-to-refresh, so this line
            only reports when the data last moved. */}
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
    </div>
  );
}
