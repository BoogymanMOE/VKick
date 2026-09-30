/**
 * The live pitch, rebuilt around what ESPN's feeds can honestly support
 * (PRODUCT.md rule 1): one ball on a floodlit pitch, placed where the last
 * tracked action happened, with a short trail of the recent actions and an
 * annotation chip that says what it was and who did it. No formation discs —
 * without tracking data any player positions would be fake, and the replay
 * keeps those for scrubbed matches.
 *
 * Data plan: the `/api/matches/:id/replay` payload already carries the timeline
 * AND the full commentary track, so no extra endpoint is needed; the page just
 * polls it live. Classification of the commentary ("Attempt saved…", "Corner,
 * Team. Conceded by…") lives in src/lib/livePitch.ts.
 */
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { useI18n } from "../i18n/I18nProvider";
import { haptic } from "../lib/telegram";
import { Num, cx } from "./ui";
import {
  buildLiveModel,
  PITCH_LENGTH_M,
  PITCH_WIDTH_M,
  type LiveActionKind,
  type LiveSide,
} from "../lib/livePitch";
import { TACTICAL_VIEWPORT } from "../lib/pitchView";
import { PitchArt } from "./PitchArt";
import type { ApiTimelineEvent } from "../lib/api";

const VP = TACTICAL_VIEWPORT;

/** Per-side team stats from the boxscore — updated on every live poll. */
export interface LiveTeamStats {
  team_id: string;
  possession_pct: number | null;
  shots: number | null;
  shots_on_target: number | null;
  corners: number | null;
  fouls: number | null;
}

interface LivePitchProps {
  home: LiveSide;
  away: LiveSide;
  /** The match's current minute from the score sync. */
  currentMinute: number;
  /** Current score for the broadcast chip (0 before the first goal). */
  homeScore: number;
  awayScore: number;
  events: ApiTimelineEvent[];
  commentary: {
    sequence: number;
    minute_display: string | null;
    minute_seconds: number | null;
    text: string;
  }[];
  /** Live boxscore rows, keyed by team id — drives the stat duel. */
  teamStats: LiveTeamStats[];
}

/** Tailwind can't parameterise these; the chip tone follows the action kind. */
const KIND_TONE: Record<LiveActionKind, string> = {
  goal: "text-[#FFD466] border-volt/60",
  shot: "text-[#FFD466] border-[#FFD466]/35",
  corner: "text-ink border-line",
  freekick: "text-ink border-line",
  foul: "text-ink-2 border-line",
  card: "text-ink-2 border-line",
  substitution: "text-ink-2 border-line",
  var: "text-ink-2 border-line",
  none: "text-ink-3 border-line",
};

/** Per-kind glyph for the rhythm tape: one character, no icon dependency. */
const KIND_GLYPH: Record<LiveActionKind, string> = {
  goal: "●",
  shot: "✕",
  corner: "∡",
  freekick: "¯¯",
  foul: "✋",
  card: "■",
  substitution: "⇄",
  var: "◇",
  none: "·",
};

export function LivePitch({
  home,
  away,
  currentMinute,
  homeScore,
  awayScore,
  events,
  commentary,
  teamStats,
}: LivePitchProps) {
  const { t, localize } = useI18n();

  const model = useMemo(
    () =>
      buildLiveModel({
        home,
        away,
        events,
        commentary,
        currentMinute,
      }),
    [home, away, events, commentary, currentMinute],
  );

  // The tape moment under inspection: null = follow live. Tapping a tick pins
  // the annotation + ball there (a broadcast "watch that again" beat); tapping
  // the newest tick or the live chip returns to live.
  const [inspect, setInspect] = useState<number | null>(null);

  const moment = model.moment;

  // Same trick as ReplayPitch: the marker layer lives in the pitch's own
  // 340x180 space and is scaled to the rendered surface width, so the ball
  // and the trail dots track the stretched SVG art on any card width.
  const surfaceRef = useRef<HTMLDivElement | null>(null);
  const layersRef = useRef<HTMLDivElement | null>(null);
  useLayoutEffect(() => {
    const surface = surfaceRef.current;
    const layers = layersRef.current;
    if (!surface || !layers) return;
    const sync = (width: number) => {
      if (width > 0) layers.style.transform = `scale(${(width / VP.width).toFixed(4)})`;
    };
    sync(surface.clientWidth);
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry) sync(entry.contentRect.width);
    });
    observer.observe(surface);
    return () => observer.disconnect();
  }, []);

  // Pitch geometry (the replay's surface, reused) — trail and ball share the
  // SVG's coordinate space so the trail tracks the stretched art exactly.
  const innerW = VP.width - VP.marginX * 2;
  const innerH = VP.height - VP.marginY * 2;
  const toSvg = (p: { lx: number; ly: number }) => ({
    x: VP.marginX + p.lx * innerW,
    y: VP.marginY + p.ly * innerH,
  });

  const spots = model.trail.map((p) => toSvg(p));

  // Inspection replays a tracked moment; live follows the newest one.
  const shown = inspect != null ? (model.events.find((e) => e.sequence === inspect) ?? moment) : moment;
  const shownSpot = toSvg(shown?.ball ?? { lx: 0.5, ly: 0.5 });

  const showTrail = spots.length > 1 && inspect == null;
  const showBall = Boolean(shown);

  const actorSide = shown?.side ?? null;
  const sideColor = actorSide === "home" ? home.color : actorSide === "away" ? away.color : null;

  // --- Territorial pressure (the broadcast "who's on top" read) ----------
  // Straight from the model: it weighs the last few tracked actions into a
  // 0..1 tilt (0.5 = even). Pure and deterministic, built from tracked actions
  // only — no invented player positions. Flat means an even game, which is
  // itself information, so the wash fades out entirely.
  const tilt = Math.max(-1, Math.min(1, (model.pressure - 0.5) * 2));
  const pressure = Math.abs(tilt);
  const territoryCx = VP.marginX + innerW * (0.5 + 0.22 * tilt);
  const territoryCy = VP.marginY + innerH * 0.5;
  const territoryColor = tilt >= 0 ? home.color : away.color;

  // --- Live boxscore (real numbers from the ESPN stats sync) --------------
  const homeStats = teamStats.find((s) => s.team_id === home.id) ?? null;
  const awayStats = teamStats.find((s) => s.team_id === away.id) ?? null;
  const homePoss = homeStats?.possession_pct != null ? Number(homeStats.possession_pct) : null;
  const duelRows: Array<{ label: string; home: number; away: number }> = [];
  if (homeStats || awayStats) {
    const pair = (label: string, h: number | null | undefined, a: number | null | undefined) => {
      if (h == null && a == null) return;
      duelRows.push({ label, home: h ?? 0, away: a ?? 0 });
    };
    pair(t("stats.shots"), homeStats?.shots, awayStats?.shots);
    pair(t("stats.onTarget"), homeStats?.shots_on_target, awayStats?.shots_on_target);
    pair(t("stats.corners"), homeStats?.corners, awayStats?.corners);
    pair(t("stats.fouls"), homeStats?.fouls, awayStats?.fouls);
  }

  // --- Goal pins + persistent shot map ------------------------------------
  const goalPins = model.allGoals.map((goal) => {
    const spot = toSvg(goal.ball);
    const color = goal.side === "home" ? home.color : goal.side === "away" ? away.color : "#FFD466";
    const own = /own goal/i.test(goal.detail) ? ` (OG)` : "";
    // ESPN's goalPositionY (0..100 across the mouth) — a real broadcast fact:
    // the ball crossed here. Drawn coords mirror for the away side like every
    // other x/y, and the pin attacks the mirrored goal.
    const mouthY =
      goal.side != null && goal.goalY != null
        ? VP.marginY + innerH * (goal.side === "home" ? goal.goalY / 100 : 1 - goal.goalY / 100)
        : null;
    const goalLx = goal.side === "home" ? 1 : 0;
    return {
      x: spot.x,
      y: spot.y,
      color,
      label: `${goal.minuteDisplay || ""}${own}`,
      mouth: mouthY != null ? { x: VP.marginX + innerW * goalLx, y: mouthY } : null,
    };
  });
  // Shots persist for the whole match (except while inspecting — the tape owns
  // the spotlight then), so the map accrues like a chalkboard.
  const shotMarks = (inspect == null ? model.shots : []).map((shot) => {
    const spot = toSvg(shot.ball);
    return {
      x: spot.x,
      y: spot.y,
      color: shot.side === "away" ? "#FF6B8A" : "var(--volt)",
      goal: shot.kind === "goal",
    };
  });

  // Distance measure: for shots, a hairline from the spot to the goal centre
  // under attack plus the metre label — the geometry the chip only numbers.
  const measure =
    shown && (shown.kind === "shot" || shown.kind === "goal") && shown.side != null && shown.distanceM != null
      ? (() => {
          const goalLx = shown.side === "home" ? 1 : 0;
          const from = toSvg(shown.ball);
          const to = toSvg({ lx: goalLx, ly: 0.5 });
          return { from, to, label: shown.distanceM };
        })()
      : null;

  // Momentum ribbon: REAL possession when the boxscore has landed (ESPN
  // publishes it live), falling back to the latest action's side. A 62% side
  // gets a 62%-wide ribbon — honest broadcast numbers, not a vibe.
  const momentumPct =
    homePoss != null
      ? Math.min(80, Math.max(20, homePoss))
      : shown?.side == null
        ? 50
        : shown.side === "home"
          ? 68
          : 32;

  // Goal moment: celebrate only goals that land while this pitch is on
  // screen. `seenRef` absorbs whatever goals are already on record at mount
  // (opening a page at 78' must not replay the 47' one); the ref then fires
  // once per new goal. Switching matches unmounts this component, so the
  // seen-set resets naturally.
  const [goalFx, setGoalFx] = useState(0);
  const seenGoalRef = useRef<string | null>(null);
  const bootedRef = useRef(false);
  const timerRef = useRef<number | null>(null);
  const goalKey = model.lastGoal
    ? `${model.lastGoal.side ?? "?"}:${model.lastGoal.minuteDisplay}:${model.lastGoal.actor ?? ""}`
    : "";
  // "Loaded" = the replay payload has reached us; booting before that would
  // absorb an empty key and then celebrate goals that predate the page.
  const loaded = events.length > 0 || commentary.length > 0;
  useEffect(() => {
    if (!loaded) return;
    // First loaded render: absorb whatever goals are already on record —
    // opening a page at 78' must never replay the 47' one.
    if (!bootedRef.current) {
      bootedRef.current = true;
      seenGoalRef.current = goalKey;
      return;
    }
    if (!goalKey || seenGoalRef.current === goalKey) return;
    seenGoalRef.current = goalKey;
    setGoalFx((v) => v + 1);
    // The moment is a burst, not a state: after a few seconds the ball goes
    // back to wherever play resumed. Cleared on the next goal or unmount.
    if (timerRef.current) window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => setGoalFx(0), 6000);
    return () => {
      if (timerRef.current) window.clearTimeout(timerRef.current);
    };
  }, [goalKey, loaded]);

  const celebrate = goalFx > 0 && Boolean(model.lastGoal);
  const goalGlowColor =
    model.lastGoal?.side === "home" ? home.color : model.lastGoal?.side === "away" ? away.color : "#FFD466";
  const goalSpot = toSvg(model.lastGoal?.ball ?? { lx: 0.5, ly: 0.5 });

  const KIND_LABEL: Record<LiveActionKind, string> = {
    goal: t("live.actionGoal"),
    shot: t("live.actionShot"),
    corner: t("live.actionCorner"),
    freekick: t("live.actionFreekick"),
    foul: t("live.actionFoul"),
    card: t("live.actionCard"),
    substitution: t("live.actionSub"),
    var: t("live.actionVar"),
    none: t("live.actionNone"),
  };

  const surface = (
    <div className="tac-surface" dir="ltr" ref={surfaceRef}>
      <PitchArt
        id="lp"
        homeLabel={`${localize(home.shortName)} →`}
        awayLabel={`← ${localize(away.shortName)}`}
        defs={
          <radialGradient id="lp-territory" cx="0.5" cy="0.5" r="0.5">
            <stop offset="0" stopColor={territoryColor} stopOpacity="0.2" />
            <stop offset="1" stopColor={territoryColor} stopOpacity="0" />
          </radialGradient>
        }
        wash={
          /* Territorial pressure: a soft wash centred on the ball weighted by
             the running shot share — the "who's on top" read without fake
             player dots. Pure SVG paint; no layout cost. */
          pressure > 0 ? (
            <ellipse
              cx={territoryCx}
              cy={territoryCy}
              rx={64 + pressure * 46}
              ry={40 + pressure * 22}
              fill="url(#lp-territory)"
            />
          ) : null
        }
      >
        {/* The recent actions' trajectory: one dashed polyline, home volt /
            away rose, plus dots that grow toward the newest spot. */}
        {showTrail && (
          <>
            <polyline
              points={spots.map((s) => `${s.x.toFixed(1)},${s.y.toFixed(1)}`).join(" ")}
              fill="none"
              stroke={actorSide === "away" ? "#FF6B8A" : "var(--volt)"}
              strokeWidth="1.6"
              strokeDasharray="4 4"
              opacity="0.8"
            />
            {spots.slice(0, -1).map((s, i) => (
              <circle key={i} cx={s.x} cy={s.y} r={2 + i * 0.8} fill="rgba(247,251,249,0.5)" />
            ))}
          </>
        )}

        {/* Persistent shot map: every shot on record as a small ring — goals
            stay filled — accruing over the match like a chalkboard. */}
        {shotMarks.map((mark, index) => (
          <g key={`shot-${index}`}>
            {mark.goal ? (
              <circle cx={mark.x} cy={mark.y} r="2.4" fill={mark.color} opacity="0.95" />
            ) : (
              <circle
                cx={mark.x}
                cy={mark.y}
                r="2.2"
                fill="none"
                stroke={mark.color}
                strokeWidth="1.1"
                opacity="0.7"
              />
            )}
          </g>
        ))}

        {/* Distance measure for the shown shot: hairline to the goal centre
            under attack, tiny label at its midpoint. */}
        {measure && (
          <g opacity="0.85">
            <line
              x1={measure.from.x}
              y1={measure.from.y}
              x2={measure.to.x}
              y2={measure.to.y}
              stroke="rgba(255,212,102,0.6)"
              strokeWidth="0.9"
              strokeDasharray="3 3"
            />
            <text
              x={(measure.from.x + measure.to.x) / 2}
              y={(measure.from.y + measure.to.y) / 2 - 3}
              fontSize="6.5"
              fontWeight="700"
              textAnchor="middle"
              fill="#FFD466"
            >
              {measure.label}m
            </text>
            <circle cx={measure.to.x} cy={measure.to.y} r="1.4" fill="rgba(255,212,102,0.8)" />
          </g>
        )}

        {/* Goal pins: every goal on record stays mapped at its spot, so the
            pitch tells the whole story at a glance, not just the last act.
            When ESPN published goalPositionY, a hairline shows exactly where
            in the mouth the ball crossed. */}
        {goalPins.map((pin, index) => (
          <g key={index} opacity="0.9">
            {pin.mouth ? (
              <line
                x1={pin.x}
                y1={pin.y}
                x2={pin.mouth.x}
                y2={pin.mouth.y}
                stroke={pin.color}
                strokeWidth="0.8"
                strokeDasharray="2 2"
                opacity="0.55"
              />
            ) : null}
            <circle cx={pin.x} cy={pin.y} r="5.5" fill={pin.color} opacity="0.22" />
            <circle cx={pin.x} cy={pin.y} r="2.6" fill={pin.color} />
            <text
              x={pin.x}
              y={pin.y - 8}
              fontSize="6.5"
              fontWeight="700"
              textAnchor="middle"
              fill={pin.color}
            >
              {pin.label}
            </text>
          </g>
        ))}
      </PitchArt>

      {/* The one and only ball: classic white-and-black disc with a live
          pulse, inside the layers div so it scales with the surface. While a
          goal celebration runs, the ball parks on the goal spot and glows in
          the scorer's colour under the expanding rings. A slow transform
          transition makes position updates glide, not teleport — the ball
          "travels" the pitch between tracked actions. */}
      {showBall && (
        <div className="tac-layers" ref={layersRef} style={{ width: VP.width, height: VP.height }}>
          <span
            className={cx(
              "tac-ball",
              celebrate ? "lp-goal-glow" : inspect != null ? "lp-inspect" : "lp-pulse",
              // While celebrating the ball parks on the goal spot; otherwise it
              // glides between tracked actions (reduced motion drops the glide).
              !celebrate && "tac-ball-glide",
            )}
            style={
              celebrate
                ? ({
                    transform: `translate(${goalSpot.x}px, ${goalSpot.y}px)`,
                    "--goal-color": goalGlowColor,
                  } as CSSProperties)
                : ({
                    transform: `translate(${shownSpot.x}px, ${shownSpot.y}px)`,
                    "--glide": "1.6s",
                  } as CSSProperties)
            }
            aria-hidden="true"
          />
          {/* Where the tracked action happened: a single expanding ping in
              the acting side's colour, re-keyed per action. While inspecting,
              a steady spotlight ring pins the replayed moment instead. */}
          {!celebrate &&
            (inspect != null ? (
              <span
                className="lp-inspect-ring"
                style={{
                  left: shownSpot.x,
                  top: shownSpot.y,
                  borderColor: sideColor ?? "rgba(242,246,244,0.5)",
                }}
                aria-hidden="true"
              />
            ) : (
              <span
                key={shown?.sequence ?? "idle"}
                className="lp-action-ping"
                style={{
                  left: shownSpot.x,
                  top: shownSpot.y,
                  borderColor: sideColor ?? "rgba(242,246,244,0.5)",
                }}
                aria-hidden="true"
              />
            ))}
          {celebrate
            ? [
                <span
                  key={`ring-a-${goalFx}`}
                  className="lp-goal-ring"
                  style={{ left: goalSpot.x, top: goalSpot.y, borderColor: goalGlowColor }}
                  aria-hidden="true"
                />,
                <span
                  key={`ring-b-${goalFx}`}
                  className="lp-goal-ring lp-goal-ring-late"
                  style={{ left: goalSpot.x, top: goalSpot.y, borderColor: goalGlowColor }}
                  aria-hidden="true"
                />,
              ]
            : null}
        </div>
      )}

      {/* Broadcast score chip + minute, over the pitch — plus the momentum
          ribbon: tilt in the on-top side's colour, dead centre = even. */}
      <div className="pointer-events-none absolute inset-x-0 top-2 flex flex-col items-center gap-1">
        <div className="flex items-center justify-center gap-2">
          <span
            className={cx(
              "flex items-center gap-1.5 rounded-md border bg-base/85 px-2 py-1 text-[11px] font-bold text-ink backdrop-blur-sm",
              celebrate ? "lp-score-flash" : "border-line",
            )}
          >
            <span
              className="h-2 w-2 rounded-full"
              style={{ backgroundColor: home.color }}
              aria-hidden="true"
            />
            {localize(home.shortName)}
            <Num className="text-sm">
              {homeScore}–{awayScore}
            </Num>
            {localize(away.shortName)}
            <span
              className="h-2 w-2 rounded-full"
              style={{ backgroundColor: away.color }}
              aria-hidden="true"
            />
          </span>
          <span className="flex items-center gap-1 rounded-md border border-line bg-base/85 px-1.5 py-1 text-[11px] font-bold text-ink-2 backdrop-blur-sm">
            <Num>{currentMinute >= 90 ? `90+${Math.max(0, currentMinute - 90)}` : currentMinute}&#39;</Num>
          </span>
          {inspect != null ? (
            <button
              type="button"
              onClick={() => setInspect(null)}
              className="flex items-center gap-1 rounded-md border border-volt bg-volt/15 px-1.5 py-1 text-[10px] font-bold text-volt"
            >
              {t("live.backToLive")}
            </button>
          ) : null}
        </div>
        {moment ? (
          <span
            className="h-[3px] w-24 overflow-hidden rounded-full bg-base/70 backdrop-blur-sm"
            role="img"
            aria-label={t("live.momentum")}
          >
            <span
              className="block h-full w-[var(--w)] rounded-full transition-[width] duration-[var(--t-slow)] ease-[var(--ease-out)]"
              style={
                {
                  "--w": `${Math.round(momentumPct)}%`,
                  backgroundColor: momentumPct >= 50 ? home.color : away.color,
                  marginLeft: momentumPct >= 50 ? undefined : `${Math.round(momentumPct)}%`,
                } as CSSProperties
              }
            />
          </span>
        ) : null}
      </div>

      {/* The annotation: what just happened, to whom, and how far — for the
          live moment or the one under inspection. */}
      <div className="absolute inset-x-2 bottom-2 flex flex-col gap-1.5">
        {shown ? (
          <div
            className={cx(
              "flex items-center gap-1.5 self-start rounded-full border bg-base/90 px-2.5 py-1.5 text-[11px] font-bold backdrop-blur-sm",
              KIND_TONE[shown.kind],
            )}
          >
            <span
              className="h-2 w-2 flex-none rounded-full"
              style={{ backgroundColor: sideColor ?? "var(--ink-3)" }}
              aria-hidden="true"
            />
            <span className="whitespace-nowrap">
              {KIND_LABEL[shown.kind]}
              {shown.actor ? <span className="text-ink"> · {localize(shown.actor)}</span> : null}
              {shown.recipient ? (
                <span className="font-semibold text-ink-2">
                  {" "}
                  {t("live.to")} {localize(shown.recipient)}
                </span>
              ) : null}
            </span>
            <Num className="text-ink-3">{shown.minuteDisplay || `${currentMinute}'`}</Num>
            {shown.distanceM != null ? (
              <>
                <span className="text-ink-3">·</span>
                <span className="text-ink-2">
                  <Num>{shown.distanceM}</Num> {t("live.metres")}
                </span>
              </>
            ) : null}
          </div>
        ) : (
          <div className="self-start rounded-full border border-line bg-base/90 px-2.5 py-1.5 text-[11px] font-semibold text-ink-2 backdrop-blur-sm">
            {t("live.waiting")}
          </div>
        )}

        {shown?.detail ? (
          <p
            className="max-w-[92%] self-start rounded-xl border border-line bg-base/85 px-2.5 py-1.5 text-[11px] leading-snug text-ink-2 backdrop-blur-sm"
            style={{
              display: "-webkit-box",
              WebkitLineClamp: 2,
              WebkitBoxOrient: "vertical",
              overflow: "hidden",
            }}
          >
            {shown.detail}
          </p>
        ) : null}
      </div>

      {/* Quiet footprint: pitch size so the "N m" chip is self-explanatory. */}
      <div className="pointer-events-none absolute right-2 top-2 rounded-md border border-line bg-base/85 px-1.5 py-1 text-[10px] font-semibold text-ink-3 backdrop-blur-sm">
        <Num>
          {PITCH_LENGTH_M}×{PITCH_WIDTH_M}
        </Num>
      </div>
    </div>
  );

  const tape = model.events;
  return (
    <>
      {surface}
      {/* The live stat duel: real boxscore numbers in one compact row — the
          classic broadcast strip under the pitch. Appears only once ESPN has
          published stats for this match. */}
      {duelRows.length > 0 ? (
        <div className="mt-1.5 rounded-card border border-line bg-surface px-3 py-2">
          <div className="grid grid-cols-[2rem_1fr_2rem] items-center gap-x-2">
            {duelRows.map((row) => (
              <div key={row.label} className="col-span-3 grid grid-cols-subgrid items-baseline py-0.5">
                <Num className="text-end text-[11px] font-bold text-ink">{row.home}</Num>
                <span className="text-center text-[10px] font-semibold uppercase tracking-wide text-ink-3">
                  {row.label}
                </span>
                <Num className="text-[11px] font-bold text-ink">{row.away}</Num>
              </div>
            ))}
          </div>
        </div>
      ) : null}
      {/* The match rhythm: one tick per tracked event, oldest → newest, split
          around the HT marker. Amber ticks = shots/goals, grey = the rest;
          goal ticks carry a flag. Tap to replay a moment on the pitch; the
          newest tick (or Back to live) hands the spotlight back. */}
      {tape.length > 0 ? (
        <div className="lp-tape" role="tablist" aria-label={t("live.tape")} dir="ltr">
          {tape.map((ev, index) => {
            const key = ev.sequence;
            const selected = inspect === key || (inspect == null && index === tape.length - 1);
            const big = ev.kind === "shot" || ev.kind === "goal";
            const halfTimeGap =
              index > 0 &&
              minuteOfDisplay(ev.minuteDisplay) >= 45 &&
              minuteOfDisplay(tape[index - 1].minuteDisplay) < 45;
            return (
              <div
                key={key}
                className="flex min-w-0 items-end gap-px"
                style={halfTimeGap ? { marginLeft: 10 } : undefined}
              >
                {halfTimeGap ? <span className="lp-tape-ht" aria-hidden="true" /> : null}
                <button
                  type="button"
                  role="tab"
                  aria-selected={selected}
                  title={`${ev.minuteDisplay || ""} ${KIND_LABEL[ev.kind]}${ev.actor ? ` · ${ev.actor}` : ""}`.trim()}
                  onClick={() => {
                    haptic("light");
                    // Toggle: tap the shown moment again (or the newest, which
                    // is "live") to hand the spotlight back to the feed.
                    setInspect(selected ? null : key);
                  }}
                  className="lp-tick-wrap"
                >
                  {ev.kind === "goal" ? (
                    <span
                      className="lp-tick-flag"
                      style={{ backgroundColor: ev.side === "away" ? away.color : home.color }}
                      aria-hidden="true"
                    />
                  ) : null}
                  <span
                    className={cx("lp-tick", big && "lp-tick-big", selected && "lp-tick-on")}
                    style={
                      big ? { backgroundColor: ev.side === "away" ? "#FF6B8A" : "var(--volt)" } : undefined
                    }
                    aria-hidden="true"
                  >
                    {KIND_GLYPH[ev.kind]}
                  </span>
                  {selected ? (
                    <span className="lp-tick-minute">
                      <Num>{ev.minuteDisplay || `${currentMinute}'`}</Num>
                    </span>
                  ) : null}
                </button>
              </div>
            );
          })}
        </div>
      ) : null}
    </>
  );
}

/** "45+2'" → 45; "" → 0. Tape-only helper. */
function minuteOfDisplay(display: string): number {
  const m = /\d+/.exec(display ?? "");
  return m ? Number(m[0]) : 0;
}
