import { useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type MouseEvent } from "react";
import { useI18n } from "../i18n/I18nProvider";
import type { Position } from "../types";
import { TACTICAL_VIEWPORT, lineupSlots, project, type MomentumPoint } from "../lib/pitchView";
import type { ReplayEvent, ReplayModel, ReplayTick } from "../lib/replay";
import { readableInk } from "../lib/colors";
import { haptic } from "../lib/telegram";
import { PitchArt } from "./PitchArt";
import { Num, cx } from "./ui";

const VP = TACTICAL_VIEWPORT;
const INNER_W = VP.width - VP.marginX * 2;
const INNER_H = VP.height - VP.marginY * 2;

/** Touch slop for picking a shot: the whole pitch is the target, not the ring. */
const TAP_RADIUS_PX = 44;

export interface ReplayPlayer {
  id: string;
  side: "home" | "away";
  name: string;
  number: number;
  position: Position;
  /** ESPN's granular role — sets which side of its line the disc stands on. */
  espnPosition?: string | null;
}

export interface ReplayPitchProps {
  model: ReplayModel;
  tick: ReplayTick;
  homeStarters: ReplayPlayer[];
  awayStarters: ReplayPlayer[];
  /** The side's real formation ("4-2-3-1"); empty falls back to flat lines. */
  homeFormation?: string;
  awayFormation?: string;
  playing: boolean;
}

/** Field coords → the SVG's own 340x180 space (same space as the art). */
function toSvg(p: { lx: number; ly: number }) {
  return { x: VP.marginX + p.lx * INNER_W, y: VP.marginY + p.ly * INNER_H };
}

/** Where a pin's line meets the goal line given ESPN's 0..100 mouth position. */
function goalMouth(side: "home" | "away", goalY: number) {
  const lx = side === "home" ? 1 : 0;
  const ly = side === "home" ? goalY / 100 : 1 - goalY / 100;
  return toSvg({ lx, ly });
}

/**
 * The replay surface: a static broadcast-style pitch (SVG) with per-minute
 * overlays — starting XI chips, the ball, goal pins and the score. All
 * positions derive from the tick, so scrubbing is instant and deterministic.
 * The pitch never mirrors in RTL (dir="ltr" on the surface), like ShotPlotter.
 *
 * It shares its ground with the live view (`PitchArt`): full markings, a
 * territory wash driven by the minute's momentum, the run of play as a dashed
 * trail, a persistent shot map built from the stored commentary and goal pins
 * that show where in the mouth the ball crossed.
 *
 * The shot map is the one interactive layer. Pointer: a tap anywhere on the
 * pitch picks the nearest shot (the rings are far too small to hit). Keyboard
 * and screen reader: each shot is a real button with a roving tab index, so Tab
 * enters the map and the arrow keys walk shot to shot, announcing each.
 */
export function ReplayPitch({
  model,
  tick,
  homeStarters,
  awayStarters,
  homeFormation = "",
  awayFormation = "",
  playing,
}: ReplayPitchProps) {
  const { t, localize } = useI18n();

  // Same trick as TacticalView: the marker layers live in the pitch's own
  // 340x180 space and get scaled to the rendered surface width so discs track
  // the stretched SVG art on any card width.
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

  // The tapped shot (see `selected` below for when it is released), plus a
  // handle on each shot's card so the arrow keys can move real DOM focus.
  const [picked, setPicked] = useState<string | null>(null);
  const shotRefs = useRef<Array<HTMLButtonElement | null>>([]);

  const slots = useMemo(() => {
    const mk = (starters: ReplayPlayer[], side: "home" | "away", formation: string) => {
      const lineup = {
        formation,
        coach: "",
        starters: starters.map((p) => ({
          id: p.id,
          name: p.name,
          position: p.position,
          number: p.number,
          espnPosition: p.espnPosition ?? null,
        })),
        subs: [],
      };
      return lineupSlots(lineup, side);
    };
    return {
      home: mk(homeStarters, "home", homeFormation),
      away: mk(awayStarters, "away", awayFormation),
    };
  }, [homeStarters, awayStarters, homeFormation, awayFormation]);

  // Club colours range from near-black to pastel; the ink flips per side so
  // every disc's number clears WCAG AA on its own fill.
  const homeInk = readableInk(model.home.color);
  const awayInk = readableInk(model.away.color);

  // Everything that has happened by this minute, oldest → newest.
  const past = useMemo(
    () => model.events.filter((e) => e.minute <= tick.minute && e.minute > 0),
    [model, tick.minute],
  );

  // Goal pins: every goal so far stays mapped at its origin. ESPN's stored
  // coords face each team's own attack and were already mirrored by
  // fieldPoint(); coord-less goals fall back to the edge of the box they
  // attacked rather than the centre spot.
  const goalPins = past
    .filter((e) => e.type === "goal")
    .map((e) => {
      const point = e.hasCoords ? toSvg(e) : toSvg({ lx: e.side === "home" ? 0.86 : 0.14, ly: 0.5 });
      const color = e.side === "away" ? model.away.color : model.home.color;
      return {
        id: e.id,
        x: point.x,
        y: point.y,
        color,
        label: e.minuteDisplay,
        mouth: e.side && e.goalY != null ? goalMouth(e.side, e.goalY) : null,
      };
    });

  // The run of play: the recent positioned moments as a dashed trail, so the
  // surface shows where the match has been, not just where the ball sits.
  const trailMoments = model.moments.filter((m) => m.minute <= tick.minute).slice(-5);
  const trail = trailMoments.map((m) => toSvg(m));
  const trailSide = trailMoments[trailMoments.length - 1]?.side ?? null;

  // Persistent shot map: every shot the commentary describes, accrued up to
  // this minute. Goals are left out — the pins below already own them — so the
  // rings read as the shots that didn't beat the keeper.
  const shotMarks = model.shots
    .filter((shot) => !shot.goal && shot.minute <= tick.minute)
    .map((shot) => ({ ...shot, ...toSvg(shot) }));

  // The tapped shot. The map is persistent, so the callout stays pinned while
  // playback runs on; it only lets go when a scrub back past that shot's minute
  // removes its ring from the map.
  const selected = picked ? (shotMarks.find((shot) => shot.id === picked) ?? null) : null;

  // Territorial wash: the minute's momentum tilts a soft glow toward the side
  // on the front foot, in their own colour. Flat momentum = no wash, which is
  // itself the read: an even game.
  const tilt = Math.max(-1, Math.min(1, tick.momentum));
  const washStrength = Math.abs(tilt);
  const washColor = tilt >= 0 ? model.home.color : model.away.color;
  const washCx = VP.marginX + INNER_W * (0.5 + 0.22 * tilt);
  const washCy = VP.marginY + INNER_H * 0.5;

  const ball = toSvg(tick.ball);
  const homeScored = (side: "home" | "away") => tick.goals.some((g) => g.side === side);

  const shotDistance = (distanceM: number | null) =>
    distanceM != null ? `${distanceM} ${t("live.metres")}` : "";
  /** The card's visible copy: who shot, and from where at what minute. */
  const shotName = (shot: { actor: string | null }) =>
    shot.actor ? localize(shot.actor) : t("live.actionShot");
  const shotMeta = (shot: { minute: number; minuteDisplay: string; distanceM: number | null }) => {
    const distance = shotDistance(shot.distanceM);
    return `${shot.minuteDisplay || `${shot.minute}'`}${distance ? ` · ${distance}` : ""}`;
  };
  /** What a screen reader hears for a shot: minute, shooter, range. */
  const shotLabel = (shot: {
    minute: number;
    minuteDisplay: string;
    actor: string | null;
    distanceM: number | null;
  }) => {
    const distance = shotDistance(shot.distanceM);
    return [
      shot.minuteDisplay || `${shot.minute}'`,
      t("live.actionShot"),
      shot.actor ? localize(shot.actor) : null,
      distance || null,
    ]
      .filter(Boolean)
      .join(", ");
  };

  /**
   * Where a shot's card sits. Shots cluster around the boxes (drawn y 60..120),
   * so a lower one gets its card above and an upper one below — clear of the
   * score chip at the top and the caption at the bottom. Horizontally it is
   * clamped so a card never runs off the touchline.
   */
  const cardAnchor = (shot: { x: number; y: number }) => ({
    left: `${Math.min(76, Math.max(24, (shot.x / VP.width) * 100))}%`,
    top: `${(shot.y / VP.height) * 100}%`,
    transform: `translate(-50%, ${shot.y > 90 ? "calc(-100% - 9px)" : "9px"})`,
  });

  /** Move roving focus one shot along; the focus handler sets the selection. */
  function stepShotFocus(from: number, delta: number) {
    const next = Math.min(shotMarks.length - 1, Math.max(0, from + delta));
    if (next !== from) shotRefs.current[next]?.focus();
  }

  /**
   * A ring is ~4px wide, far below a usable touch target, so a tap anywhere on
   * the pitch picks the nearest shot within a 44px radius — the whole ground is
   * the hit area, and a tap clear of every shot dismisses instead. Tapping the
   * pinned shot again releases it.
   */
  function handlePitchTap(event: MouseEvent<HTMLDivElement>) {
    const surface = surfaceRef.current;
    if (!surface || shotMarks.length === 0) return;
    // A pointer pick moves the callout, so any keyboard focus the map still
    // holds would be left on a card that has just been hidden.
    const active = document.activeElement;
    if (active instanceof HTMLElement && active.dataset.shotCard !== undefined) active.blur();
    const rect = surface.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;
    const vx = ((event.clientX - rect.left) / rect.width) * VP.width;
    const vy = ((event.clientY - rect.top) / rect.height) * VP.height;
    let nearest = shotMarks[0];
    let nearestDist = Infinity;
    for (const shot of shotMarks) {
      const dist = Math.hypot(shot.x - vx, shot.y - vy);
      if (dist < nearestDist) {
        nearestDist = dist;
        nearest = shot;
      }
    }
    const radius = (TAP_RADIUS_PX / rect.width) * VP.width;
    if (nearestDist > radius || selected?.id === nearest.id) {
      setPicked(null);
      return;
    }
    haptic("light");
    setPicked(nearest.id);
  }

  // The newest key moment, captioned on the pitch like a broadcast lower-third.
  const latest = past[past.length - 1] ?? null;
  const TYPE_LABEL: Record<ReplayEvent["type"], string> = {
    goal: t("timeline.goal"),
    card: t("timeline.card"),
    substitution: t("timeline.sub"),
    var: t("timeline.var"),
    halftime: t("timeline.halftime"),
    fulltime: t("timeline.fulltime"),
    kickoff: t("replay.otherEvent"),
    other: t("replay.otherEvent"),
  };
  const latestNames = latest ? latest.participants.map(localize).join(" · ") : "";
  const latestColor = latest?.side === "away" ? model.away.color : model.home.color;

  return (
    <div
      dir="ltr"
      className={cx("tac-surface", shotMarks.length > 0 && "cursor-pointer")}
      ref={surfaceRef}
      onClick={handlePitchTap}
    >
      <PitchArt
        id="rp"
        homeLabel={`${localize(model.home.shortName)} →`}
        awayLabel={`← ${localize(model.away.shortName)}`}
        defs={
          <radialGradient id="rp-territory" cx="0.5" cy="0.5" r="0.5">
            <stop offset="0" stopColor={washColor} stopOpacity={0.05 + washStrength * 0.2} />
            <stop offset="1" stopColor={washColor} stopOpacity="0" />
          </radialGradient>
        }
        wash={
          washStrength > 0.04 ? (
            <ellipse
              cx={washCx}
              cy={washCy}
              rx={64 + washStrength * 46}
              ry={40 + washStrength * 22}
              fill="url(#rp-territory)"
            />
          ) : null
        }
      >
        {/* The run of play: a dashed polyline through the recent spots, dots
            growing toward the newest one. */}
        {trail.length > 1 ? (
          <>
            <polyline
              points={trail.map((s) => `${s.x.toFixed(1)},${s.y.toFixed(1)}`).join(" ")}
              fill="none"
              stroke={trailSide === "away" ? "#FF6B8A" : "var(--volt)"}
              strokeWidth="1.4"
              strokeDasharray="3 4"
              opacity="0.7"
            />
            {trail.map((s, i) => (
              <circle key={i} cx={s.x} cy={s.y} r={1.6 + i * 0.5} fill="rgba(247,251,249,0.45)" />
            ))}
          </>
        ) : null}

        {/* The shot map: home shots volt, away shots rose, one ring per shot.
            Zone-derived from the commentary, not tracked, so it fills the
            pitch honestly without pretending to be real positions. */}
        {shotMarks.map((shot) => {
          const isOn = selected?.id === shot.id;
          const color = shot.side === "away" ? "#FF6B8A" : "var(--volt)";
          return (
            <g key={shot.id}>
              {isOn ? <circle cx={shot.x} cy={shot.y} r="5.4" fill={color} opacity="0.22" /> : null}
              <circle
                cx={shot.x}
                cy={shot.y}
                r={isOn ? "3" : "2.2"}
                fill={isOn ? color : "none"}
                stroke={color}
                strokeWidth={isOn ? "1.4" : "1.1"}
                opacity={isOn ? 1 : 0.72}
              />
            </g>
          );
        })}

        {/* Goal pins: spot halo + minute, with a hairline to the exact point in
            the mouth the ball crossed when ESPN published goalPositionY. */}
        {goalPins.map((pin) => (
          <g key={`g-${pin.id}`} opacity="0.9">
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

      {/* Formation chips (per minute of the match — subs don't reposition the XI) */}
      <div className="tac-layers" ref={layersRef} style={{ width: VP.width, height: VP.height }}>
        {homeStarters.map((player) => {
          const slot = slots.home[player.id] ?? { lx: 0.5, ly: 0.5 };
          const point = project(slot.lx, slot.ly);
          return (
            <span
              key={`h-${player.id}`}
              className="tac-c absolute"
              style={{
                left: point.x,
                top: point.y,
                width: 15,
                height: 15,
                marginLeft: -7.5,
                marginTop: -7.5,
                background: model.home.color,
                color: homeInk,
              }}
              title={`${player.number} ${localize(player.name)}`}
            >
              <Num>{player.number}</Num>
            </span>
          );
        })}
        {awayStarters.map((player) => {
          const slot = slots.away[player.id] ?? { lx: 0.5, ly: 0.5 };
          const point = project(slot.lx, slot.ly);
          return (
            <span
              key={`a-${player.id}`}
              className="tac-c absolute"
              style={{
                left: point.x,
                top: point.y,
                width: 15,
                height: 15,
                marginLeft: -7.5,
                marginTop: -7.5,
                background: model.away.color,
                color: awayInk,
              }}
              title={`${player.number} ${localize(player.name)}`}
            >
              <Num>{player.number}</Num>
            </span>
          );
        })}

        {/* The ball: the same white-and-black disc as the live view. While the
            replay plays it breathes and glides between minutes; paused, it
            holds still so scrubbing is instant. */}
        <span
          className={cx("tac-ball", playing && "lp-pulse tac-ball-glide")}
          style={{ transform: `translate(${ball.x}px, ${ball.y}px)`, "--glide": "900ms" } as CSSProperties}
          aria-hidden="true"
        />
      </div>

      {/* Score line pinned over the pitch, broadcast style */}
      <div className="pointer-events-none absolute inset-x-0 top-2 flex items-center justify-center gap-2">
        <span className="flex items-center gap-1.5 rounded-md border border-line bg-base/85 px-2 py-1 text-[11px] font-bold text-ink backdrop-blur-sm">
          <span
            className={cx("h-2 w-2 rounded-full", !homeScored("home") && "opacity-40")}
            style={{ backgroundColor: model.home.color }}
            aria-hidden="true"
          />
          {localize(model.home.shortName)}
          <Num className="text-base">
            {tick.homeScore}–{tick.awayScore}
          </Num>
          {localize(model.away.shortName)}
          <span
            className={cx("h-2 w-2 rounded-full", !homeScored("away") && "opacity-40")}
            style={{ backgroundColor: model.away.color }}
            aria-hidden="true"
          />
        </span>
        <span className="flex items-center gap-1 rounded-md border border-line bg-base/85 px-1.5 py-1 text-[11px] font-bold text-ink-2 backdrop-blur-sm">
          {tick.minute >= 90 ? (
            <Num>90+{Math.max(0, tick.minute - 90)}&#39;</Num>
          ) : (
            <Num>{tick.minute}&#39;</Num>
          )}
        </span>
      </div>

      {/* The shot map's hit layer: one real button per shot, parked where its
          card shows. Unpicked cards are hidden with opacity rather than
          display, so they stay focusable and in the accessibility tree for the
          arrow keys to walk; only the picked one is visible and tappable. */}
      {shotMarks.length > 0 ? (
        <>
          {/* The map is arrow-driven; say so, since nothing on screen does. */}
          <span id="rp-shot-keys" className="sr-only">
            {t("replay.shotKeys")}
          </span>
          <div
            role="group"
            aria-label={t("replay.shotMap")}
            aria-describedby="rp-shot-keys"
            className="pointer-events-none absolute inset-0 z-10"
          >
            {shotMarks.map((shot, index) => {
              const isOn = selected?.id === shot.id;
              return (
                <button
                  key={shot.id}
                  type="button"
                  ref={(element) => {
                    shotRefs.current[index] = element;
                  }}
                  data-shot-card=""
                  tabIndex={isOn || (!selected && index === 0) ? 0 : -1}
                  aria-label={shotLabel(shot)}
                  aria-pressed={isOn}
                  onFocus={() => setPicked(shot.id)}
                  onClick={(event) => {
                    // Keep the pitch's nearest-shot handler out of it; a card
                    // is only clickable while it is the picked one, so release.
                    event.stopPropagation();
                    setPicked(null);
                    event.currentTarget.blur();
                  }}
                  onKeyDown={(event) => {
                    if (event.key === "ArrowRight" || event.key === "ArrowDown") {
                      event.preventDefault();
                      stepShotFocus(index, 1);
                    } else if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
                      event.preventDefault();
                      stepShotFocus(index, -1);
                    } else if (event.key === "Home") {
                      event.preventDefault();
                      shotRefs.current[0]?.focus();
                    } else if (event.key === "End") {
                      event.preventDefault();
                      shotRefs.current[shotMarks.length - 1]?.focus();
                    } else if (event.key === "Escape") {
                      setPicked(null);
                      event.currentTarget.blur();
                    }
                  }}
                  className={cx(
                    "absolute flex flex-col items-center rounded-lg border border-line bg-base/90 px-2 py-1 text-center backdrop-blur-sm",
                    isOn ? "pointer-events-auto" : "pointer-events-none opacity-0",
                  )}
                  style={cardAnchor(shot)}
                >
                  <span className="max-w-[9rem] truncate text-[11px] font-bold text-ink">
                    {shotName(shot)}
                  </span>
                  <Num className="text-[10px] font-semibold text-ink-3">{shotMeta(shot)}</Num>
                </button>
              );
            })}
          </div>
        </>
      ) : null}

      {/* The lower third, one row: the newest moment this minute on the left
          (so a scrub lands on a described happening, not a bare dot) and, on
          the right, a nudge that the shot rings are tappable until one is. */}
      {latest || (shotMarks.length > 0 && !selected) ? (
        <div className="pointer-events-none absolute inset-x-2 bottom-2 flex items-center gap-2">
          {latest ? (
            <span className="flex min-w-0 items-center gap-1.5 rounded-full border border-line bg-base/90 px-2.5 py-1.5 text-[11px] font-bold text-ink-2 backdrop-blur-sm">
              <span
                className="h-2 w-2 flex-none rounded-full"
                style={{ backgroundColor: latestColor }}
                aria-hidden="true"
              />
              <Num className="flex-none text-ink-3">{latest.minuteDisplay}</Num>
              <span className="truncate">
                <span className="text-ink">{TYPE_LABEL[latest.type]}</span>
                {latestNames ? <span> · {latestNames}</span> : null}
              </span>
            </span>
          ) : null}
          {shotMarks.length > 0 && !selected ? (
            <span
              aria-hidden="true"
              className="ml-auto flex flex-none items-center gap-1 rounded-full border border-line bg-base/85 px-2 py-1.5 text-[10px] font-semibold text-ink-3 backdrop-blur-sm"
            >
              {t("replay.shotHint")}
              <span className="font-normal opacity-70">← →</span>
            </span>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

/** Momentum strip over match minutes for the replay scrubber context. */
export function ReplayMomentum({ model, minute }: { model: ReplayModel; minute: number }) {
  const { localize } = useI18n();
  const script: MomentumPoint[] = useMemo(
    () => model.ticks.map((tick) => ({ minute: tick.minute, home: tick.momentum })),
    [model],
  );
  return (
    <div className="mt-2 border-t border-line pt-2">
      <p className="mb-1 label text-ink-3">
        {localize(model.home.shortName)} vs {localize(model.away.shortName)}
      </p>
      <svg viewBox="0 0 320 40" className="block h-10 w-full" aria-hidden="true">
        <line
          x1="0"
          y1="20"
          x2="320"
          y2="20"
          stroke="rgba(147,174,166,0.25)"
          strokeWidth="1"
          strokeDasharray="3 3"
        />
        <polyline
          points={script
            .map(
              (p) => `${((p.minute / model.totalMinutes) * 320).toFixed(1)},${(20 - p.home * 16).toFixed(1)}`,
            )
            .join(" ")}
          fill="none"
          stroke={model.home.color}
          strokeWidth="1.4"
        />
        <polyline
          points={script
            .map(
              (p) =>
                `${((p.minute / model.totalMinutes) * 320).toFixed(1)},${(20 + Math.max(0, -p.home) * 16).toFixed(1)}`,
            )
            .join(" ")}
          fill="none"
          stroke={model.away.color}
          strokeWidth="1.4"
        />
        <line
          x1={(Math.min(minute, model.totalMinutes) / model.totalMinutes) * 320}
          y1="0"
          x2={(Math.min(minute, model.totalMinutes) / model.totalMinutes) * 320}
          y2="40"
          stroke="var(--volt)"
          strokeWidth="1.4"
        />
      </svg>
    </div>
  );
}
