import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ReplayPitch, ReplayMomentum } from "../components/ReplayPitch";
import { TopBar } from "../components/TopBar";
import { ReplaySkeleton } from "../components/Skeletons";
import { ConfettiBurst } from "../components/Confetti";
import { BallIcon, PauseIcon, PlayIcon } from "../components/icons";
import { Card, Chip, EmptyState, ErrorState, Num, Segmented, cx } from "../components/ui";
import { api } from "../lib/api";
import { TEAM_FALLBACK } from "../lib/colors";
import { useCompetitionLabel, useReplay } from "../hooks/useApi";
import { useI18n } from "../i18n/I18nProvider";
import { haptic, notifyHaptic } from "../lib/telegram";
import { buildReplayModel, type ReplayEvent } from "../lib/replay";

type Track = "pitch" | "commentary";

/**
 * Replay of a finished match: a scrubbable 2D pitch driven by the stored
 * timeline (goals with real shot coordinates when ESPN published them) plus a
 * synced commentary track. Playback advances ~1 match-minute per second.
 */
export default function MatchReplayPage() {
  const { id = "" } = useParams();
  const { t, localize } = useI18n();

  const replayQuery = useReplay(id);
  const data = replayQuery.data;
  // Competition name (big-five alias, else the catalog name) — hooks must run
  // before the loading/empty returns below, hence it lives up here.
  const leagueLabel = useCompetitionLabel(data?.match.league ?? "");

  const model = useMemo(() => {
    if (!data) return null;
    const m = data.match;
    return buildReplayModel(data, {
      home: {
        id: m.home_team_id,
        name: m.home_name,
        shortName: m.home_short ?? m.home_name,
        color: m.home_color ?? TEAM_FALLBACK,
      },
      away: {
        id: m.away_team_id,
        name: m.away_name,
        shortName: m.away_short ?? m.away_name,
        color: m.away_color ?? TEAM_FALLBACK,
      },
    });
  }, [data]);

  // Lineups feed the formation chips on the pitch.
  const lineupsQuery = useQuery({
    queryKey: ["lineups", id],
    queryFn: () => api.getLineups(id),
    enabled: Boolean(id),
    staleTime: 10 * 60_000,
  });

  const [minute, setMinute] = useState(0);
  const [playing, setPlaying] = useState(true);
  const [track, setTrack] = useState<Track>("pitch");
  const [burst, setBurst] = useState(0);
  const seenGoals = useRef<Set<string>>(new Set());

  const total = model?.totalMinutes ?? 0;

  // Reset when another match is opened.
  useEffect(() => {
    setMinute(0);
    setPlaying(true);
    seenGoals.current = new Set();
  }, [id]);

  // Playback loop: one match-minute per second.
  useEffect(() => {
    if (!playing || total === 0) return;
    const timer = window.setInterval(() => {
      setMinute((m) => {
        if (m >= total) {
          setPlaying(false);
          return m;
        }
        return m + 1;
      });
    }, 1000);
    return () => window.clearInterval(timer);
  }, [playing, total]);

  const tick = model?.ticks[Math.min(minute, model.ticks.length - 1)] ?? null;

  // Goal moment: haptic + confetti, once per goal.
  const goalsUpTo = tick ? tick.goals.map((g) => g.id).join(",") : "";
  useEffect(() => {
    if (!tick) return;
    for (const goal of tick.goals) {
      if (!seenGoals.current.has(goal.id)) {
        seenGoals.current.add(goal.id);
        if (goal.minute > 0) {
          notifyHaptic("success");
          setBurst((v) => v + 1);
        }
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [goalsUpTo]);

  if (replayQuery.isLoading) {
    return (
      <>
        <TopBar title={t("replay.title")} back />
        <div className="mt-3">
          <ReplaySkeleton />
        </div>
      </>
    );
  }

  if (replayQuery.isError) {
    return (
      <>
        <TopBar title={t("replay.title")} back />
        <div className="mt-4">
          <ErrorState onRetry={() => replayQuery.refetch()} />
        </div>
      </>
    );
  }

  if (!data || !model || !tick) {
    return (
      <>
        <TopBar title={t("replay.title")} back />
        <div className="mt-4">
          <EmptyState
            title={t("replay.emptyTitle")}
            hint={t("replay.emptyHint")}
            action={
              <Link
                to="/matches"
                className="min-h-11 rounded-full border border-volt px-5 text-xs font-bold leading-[2.75rem] text-volt transition-colors duration-[var(--t-fast)] hover:bg-elevated"
              >
                {t("replay.emptyAction")}
              </Link>
            }
          />
        </div>
      </>
    );
  }

  const match = data.match;
  const finished = match.status === "finished";

  const recentEvents = model.events
    .filter((e) => e.minute <= minute && e.minute > 0)
    .slice(-3)
    .reverse();
  const commentaryUpTo = data.commentary.filter((line) => (line.minute_seconds ?? 0) <= minute * 60 + 59);
  const commentaryTail = commentaryUpTo.slice(-6).reverse();

  const homeStarters = (lineupsQuery.data?.players ?? [])
    .filter((p) => p.team_id === match.home_team_id && p.started === 1)
    .slice(0, 11)
    .map((p) => ({
      id: p.player_id,
      side: "home" as const,
      name: p.full_name,
      number: p.jersey_number ?? 0,
      position: (p.position ?? "MID") as "GK" | "DEF" | "MID" | "FWD",
      espnPosition: p.espn_position,
    }));
  const awayStarters = (lineupsQuery.data?.players ?? [])
    .filter((p) => p.team_id === match.away_team_id && p.started === 1)
    .slice(0, 11)
    .map((p) => ({
      id: p.player_id,
      side: "away" as const,
      name: p.full_name,
      number: p.jersey_number ?? 0,
      position: (p.position ?? "MID") as "GK" | "DEF" | "MID" | "FWD",
      espnPosition: p.espn_position,
    }));

  const minuteLabel = (m: number) => (m > 90 ? `90+${m - 90}'` : `${m}'`);

  // Expected goals, when Understat matched this fixture. The bar is the share
  // of the match's total xG, drawn in club colours (the numbers stay gold).
  const xgTotal = (model.xgHome ?? 0) + (model.xgAway ?? 0);
  const xgShare = xgTotal > 0 ? (model.xgHome ?? 0) / xgTotal : null;

  return (
    <>
      <ConfettiBurst trigger={burst} />
      <TopBar
        title={t("replay.title")}
        subtitle={`${localize(match.home_short ?? match.home_name)} ${match.home_score ?? 0}–${match.away_score ?? 0} ${localize(match.away_short ?? match.away_name)}`}
        back
      />

      {!finished ? (
        <Chip tone="muted" className="mt-3">
          {t("replay.notFinished")}
        </Chip>
      ) : null}

      <div className="mt-3">
        <ReplayPitch
          model={model}
          tick={tick}
          homeStarters={homeStarters}
          awayStarters={awayStarters}
          homeFormation={lineupsQuery.data?.home.formation ?? ""}
          awayFormation={lineupsQuery.data?.away.formation ?? ""}
          playing={playing}
        />
      </div>

      {/* Transport: play/pause, minute readout, scrubber */}
      <Card className="mt-3 p-3">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => {
              haptic("light");
              if (minute >= total) setMinute(0);
              setPlaying((p) => !p);
            }}
            aria-label={playing ? t("shot.pause") : t("shot.play")}
            className="grid h-11 w-11 flex-none place-items-center rounded-full bg-volt text-black transition-[filter] duration-[var(--t-fast)] hover:brightness-95"
          >
            {playing ? <PauseIcon className="h-4 w-4" /> : <PlayIcon className="h-4 w-4" />}
          </button>
          <div className="min-w-0 flex-1">
            <input
              type="range"
              min={0}
              max={total}
              value={Math.min(minute, total)}
              onChange={(e) => {
                setPlaying(false);
                setMinute(Number(e.target.value));
              }}
              className="range-scrub w-full"
              aria-label={t("replay.scrub")}
            />
            <div className="flex justify-between text-[10px] text-ink-3">
              <Num>{minuteLabel(minute)}</Num>
              <span>{t("replay.minutePerSecond")}</span>
              <Num>{minuteLabel(total)}</Num>
            </div>
          </div>
        </div>

        <ReplayMomentum model={model} minute={minute} />
      </Card>

      {/* Expected goals: the post-match read, drawn in the evaluation colour so
          it never competes with the volt scoreline. Missing means the fixture
          wasn't matched (or the club is outside Understat's big five) — the
          card says so instead of printing a zero. */}
      <Card className="mt-3 p-4">
        <div className="flex items-baseline justify-between gap-2">
          <span className="label text-ink-3">{t("xg.title")}</span>
          <span className="text-[10px] font-semibold text-ink-3">{t("replay.xgSource")}</span>
        </div>
        {model.xgHome != null || model.xgAway != null ? (
          <>
            <div className="mt-2 grid grid-cols-2 gap-3">
              <div className="text-center">
                <p className="truncate text-[11px] font-semibold text-ink-3">
                  {localize(model.home.shortName)}
                </p>
                <Num className="text-xl font-black text-gold">
                  {model.xgHome != null ? model.xgHome.toFixed(2) : "–"}
                </Num>
              </div>
              <div className="text-center">
                <p className="truncate text-[11px] font-semibold text-ink-3">
                  {localize(model.away.shortName)}
                </p>
                <Num className="text-xl font-black text-gold">
                  {model.xgAway != null ? model.xgAway.toFixed(2) : "–"}
                </Num>
              </div>
            </div>
            {xgShare != null ? (
              <div className="mt-2 flex h-1.5 overflow-hidden rounded-full bg-elevated" aria-hidden="true">
                <span
                  className="h-full"
                  style={{ width: `${xgShare * 100}%`, backgroundColor: model.home.color }}
                />
                <span className="h-full flex-1" style={{ backgroundColor: model.away.color }} />
              </div>
            ) : null}
          </>
        ) : (
          <p className="mt-2 text-[11px] text-ink-3">{t("xg.emptyHint")}</p>
        )}
      </Card>

      {/* Goal feed: the moments that decide the match, newest first */}
      <section className="mt-4">
        <Segmented
          value={track}
          onChange={setTrack}
          options={[
            { value: "pitch", label: t("replay.tabEvents") },
            { value: "commentary", label: t("replay.tabCommentary") },
          ]}
        />

        {track === "pitch" ? (
          <ul className="mt-3 space-y-2">
            {recentEvents.length === 0 ? (
              <li className="rounded-card border border-dashed border-line px-3 py-4 text-center text-xs text-ink-3">
                {t("replay.kickoffSoon")}
              </li>
            ) : null}
            {recentEvents.map((event) => (
              <EventRow key={event.id} event={event} />
            ))}
          </ul>
        ) : (
          <Card className="mt-3 max-h-72 overflow-y-auto p-3">
            {commentaryTail.length === 0 ? (
              <p className="text-xs text-ink-3">{t("commentary.empty")}</p>
            ) : (
              <ul className="space-y-2">
                {commentaryTail.map((line) => (
                  <li key={line.sequence} className="flex gap-2 text-xs">
                    <Num className="w-8 flex-none text-ink-3">{line.minute_display ?? "·"}</Num>
                    <span className="text-ink-2">{line.text}</span>
                  </li>
                ))}
              </ul>
            )}
            {data.commentary.length === 0 ? (
              <p className="mt-2 text-[11px] text-ink-3">{t("replay.noCommentary")}</p>
            ) : null}
          </Card>
        )}
      </section>

      {/* Deep links to the rest of the match story */}
      <div className="mt-4 grid grid-cols-2 gap-2">
        <Link
          to={`/match/${match.id}?tab=timeline`}
          className="flex min-h-11 items-center justify-center rounded-card border border-line bg-surface p-3 text-center text-xs font-bold text-ink transition-colors duration-[var(--t-fast)] hover:bg-elevated"
        >
          {t("match.tabTimeline")}
        </Link>
        <Link
          to={`/match/${match.id}?tab=stats`}
          className="flex min-h-11 items-center justify-center rounded-card border border-line bg-surface p-3 text-center text-xs font-bold text-ink transition-colors duration-[var(--t-fast)] hover:bg-elevated"
        >
          {t("match.tabStats")}
        </Link>
      </div>

      <p className="mt-3 text-center text-[11px] text-ink-3">
        {leagueLabel} · {t("replay.sourceNote")}
      </p>
    </>
  );
}

function EventRow({ event }: { event: ReplayEvent }) {
  const { t, localize } = useI18n();
  const isGoal = event.type === "goal";
  return (
    <li
      className={cx(
        "flex items-center gap-2 rounded-card border p-2.5",
        isGoal ? "border-volt/50 bg-elevated" : "border-line bg-surface",
      )}
    >
      <Num className="w-9 flex-none text-xs text-ink-3">{event.minuteDisplay}</Num>
      {isGoal ? (
        <BallIcon className="h-4 w-4 flex-none text-volt" />
      ) : (
        <span className="grid h-4 w-4 flex-none place-items-center text-[11px] text-ink-3">·</span>
      )}
      <span className="min-w-0 flex-1">
        <span className="block truncate text-xs font-bold text-ink">
          {event.participants.map(localize).join(" · ") || localize(event.description)}
        </span>
        <span className="block truncate text-[11px] text-ink-3">
          {t(
            isGoal
              ? "timeline.goal"
              : event.type === "card"
                ? "timeline.card"
                : event.type === "substitution"
                  ? "timeline.sub"
                  : "replay.otherEvent",
          )}
        </span>
      </span>
      {event.hasCoords ? (
        <Chip tone="volt" className="flex-none">
          {t("replay.onMap")}
        </Chip>
      ) : null}
    </li>
  );
}
