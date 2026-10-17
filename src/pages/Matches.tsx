import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Link } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { ConfettiBurst } from "../components/Confetti";
import { MatchCard } from "../components/MatchCard";
import { TopBar } from "../components/TopBar";
import { useToast } from "../components/toastContext";
import { Card } from "../components/ui";
import { cx } from "../lib/cx";
import { useMatches, useFollowedLeagues } from "../hooks/useApi";
import { useFavorites } from "../hooks/useFavorites";
import { useI18n } from "../i18n/context";
import { formatClock } from "../lib/format";
import { LEAGUE_BY_SLUG } from "../lib/leagues";
import { haptic, notifyHaptic } from "../lib/telegram";
import {
  BallIcon,
  PlusIcon,
  RefreshIcon,
  ShareIcon,
} from "../components/icons";
import { DateStrip } from "../components/DateStrip";
import { InlineAd } from "../components/InlineAd";
import { LeaguePickerSheet } from "../components/panels/LeaguePickerSheet";
import { usePullToRefresh } from "../hooks/usePullToRefresh";
import { useLiveUpdates } from "../hooks/useLiveUpdates";
import { PullIndicator } from "../components/PullToRefresh";
import type { Match } from "../types";

/** One chip in the league scope row: same shape, tone flips with the state. */
const LEAGUE_CHIP =
  "min-h-11 flex-none rounded-full border px-3.5 text-[11px] font-bold transition-[color,background-color,transform] duration-[var(--t-fast)] active:scale-[0.97]";

/** Selected league chip: filled volt pill — the row's one "picked" affordance. */
const LEAGUE_CHIP_ON = "border-volt bg-volt/15 text-volt";
const LEAGUE_CHIP_OFF = "border-line text-ink-3";

export default function Matches() {
  const { t, lang, localize } = useI18n();
  const { push } = useToast();
  const navigate = useNavigate();
  const locale = lang === "fa" ? "fa-IR" : undefined;
  const queryClient = useQueryClient();
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

  const matchesQuery = useMatches({ league: activeLeague });
  const matches = matchesQuery.data ?? [];

  // The Favorite Leagues sheet. Local to the feed (not a route) so opening and
  // closing it never loses the scroll position or the selected league chip.
  const [leaguesOpen, setLeaguesOpen] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [lastSync, setLastSync] = useState<Date | null>(null);
  const [burst, setBurst] = useState(0);

  // Date strip: 5 day chips, today selected by default.
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const [selectedDay, setSelectedDay] = useState<Date>(today);
  
  // Filter matches by selected day (compare kickoff date).
  const selectedDateStr = selectedDay.toISOString().slice(0, 10);
  const dayMatches = useMemo(() => {
    return matches.filter((m) => {
      const kickoff = new Date(m.kickoffAt);
      const kickoffStr = kickoff.toISOString().slice(0, 10);
      return kickoffStr === selectedDateStr;
    });
  }, [matches, selectedDateStr]);
  
  const inMyTeams = (match: Match) => isFavorite(match.home.id) || isFavorite(match.away.id);
  const myTeamsMatches = useMemo(() => dayMatches.filter(inMyTeams), [dayMatches]);
  const otherMatches = useMemo(() => dayMatches.filter((m) => !inMyTeams(m)), [dayMatches]);

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
        icon: <RefreshIcon className="h-4 w-4" />,
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
      <ConfettiBurst trigger={burst} />          <TopBar
        title={t("matches.title")}
        subtitle={new Date().toLocaleDateString(lang === "fa" ? "fa-IR" : undefined, { weekday: "short", day: "numeric", month: "short" })}
      />

      {/* Everything below sits under the sticky header. The wrapper gives the
          pull-to-refresh marker an anchor so it slides in between header and
          feed instead of fighting the header for the same band. */}
      <div className="relative">
        <PullIndicator pull={pull} />

        {/* Date strip: 5 day chips. Today is teal-filled and selected by default. */}
        <DateStrip selected={selectedDay} onSelect={setSelectedDay} />

        {/* Favorite leagues — the start page's own way in. One tap re-scopes
            the whole feed (concept pillar 1); the last chip opens the picker,
            and the row is here even with nothing followed so leagues are
            pickable from the feed rather than only during onboarding. */}
        {!league ? (
          <div className="-mx-[var(--space-page-x,16px)] mt-4 flex items-center gap-1.5 overflow-x-auto px-[var(--space-page-x,16px)] pb-1">
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
                    className={cx(LEAGUE_CHIP, leagueFilter === l.league ? LEAGUE_CHIP_ON : LEAGUE_CHIP_OFF)}
                  >
                    {l.name ?? l.league}
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
          <div className="mt-4 flex items-center justify-between gap-2 rounded-card border border-line bg-surface px-4 py-3">
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
        {/* Live leads (product principle 1): whenever a game is running it is the
          first thing on screen, above every other block. Collapsible so a quiet
          matchday can fold it away; the pulsing badge keeps the folded header
          honest while games are running. */}
        {/* My teams group: matches where a favorite team is playing */}
        {favCount > 0 && myTeamsMatches.length > 0 && (
          <section className="mt-4">
            <div className="flex items-center gap-2 mb-2">
              <span className="text-[12px]" aria-hidden="true">★</span>
              <h2 className="text-[13px] font-bold text-ink-2">{t("matches.myTeams")}</h2>
            </div>
            <ul className="space-y-2">
              {myTeamsMatches.map((match, index) => (
                <MatchCard key={match.id} match={match} index={index} />
              ))}
            </ul>
          </section>
        )}

        {/* Inline ad between groups */}
        {favCount > 0 && myTeamsMatches.length > 0 && otherMatches.length > 0 && (
          <InlineAd />
        )}

        {/* Other matches group */}
        {otherMatches.length > 0 && (
          <section className="mt-4">
            <h2 className="text-[13px] font-bold text-ink-2 mb-2">{t("matches.otherMatches")}</h2>
            <ul className="space-y-2">
              {otherMatches.map((match, index) => (
                <MatchCard key={match.id} match={match} index={index} />
              ))}
            </ul>
          </section>
        )}

        {/* No favorites yet */}
        {favCount === 0 ? (
          <Card className="pitch-watermark mt-4 flex items-center justify-between gap-3 p-4">
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
        {/* Referral banner — the invite system's only entry on the feed, parked
          at the foot of the page so it never pushes the live scores down. */}
        <Link
          to="/profile"
          onClick={() => haptic("light")}
          className="mt-6 flex items-center gap-3 rounded-card border border-volt/40 bg-surface p-3 transition-colors duration-[var(--t-fast)] hover:bg-elevated"
        >
          <span className="grid h-10 w-10 flex-none place-items-center rounded-full bg-volt/15 text-volt">
            <ShareIcon className="h-5 w-5" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-bold text-ink">{t("referral.bannerTitle")}</span>
            <span className="block text-xs text-ink-3">{t("referral.hint")}</span>
          </span>
          <span className="inline-flex min-h-11 flex-none items-center rounded-full bg-volt px-4 text-xs font-bold text-black transition-[filter] duration-[var(--t-fast)] hover:brightness-95">
            {t("referral.bannerCta")}
          </span>
        </Link>

        {/* Sync note, not a second refresh button: pull-to-refresh and the
          TopBar icon already carry the action, so this line only reports it. */}
        <p className="mt-6 text-center text-[11px] text-ink-3">
          {t("matches.hint")}
          {lastSync ? ` · ${t("matches.lastSync", { time: formatClock(lastSync, locale) })}` : ""}
        </p>
      </div>
    </>
  );
}

