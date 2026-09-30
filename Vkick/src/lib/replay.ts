/**
 * Replay engine for the 2D pitch playback of a finished match.
 *
 * The stored `timeline_events` are the truth. This module fans them out into a
 * per-minute "state of the match" (score, which side is pressing) and derives a
 * plausible ball position between known moments, so a scrubber can render any
 * minute of a match that was never tracked frame-by-frame.
 *
 * Everything here is pure and synchronous: the page owns the clock, this owns
 * the meaning. Home always attacks left→right on the drawn pitch; ESPN's
 * `fieldPositionX` runs 0 (own goal) → 100 (opponent goal), mirrored per side
 * by `fieldPoint()` from pitchView.ts.
 */

import type { ApiReplay, ApiTimelineEvent } from "./api";
import { fieldPoint, lerp, type FieldPoint } from "./pitchView";
import { buildLiveModel, shotsFromCommentary } from "./livePitch";

export const REPLAY_MINUTES = 94; // 90 + a buffer for stoppage-time events

export type ReplayEventType =
  "goal" | "card" | "substitution" | "var" | "halftime" | "fulltime" | "kickoff" | "other";

export interface ReplayEvent extends FieldPointSide {
  id: string;
  minute: number;
  minuteDisplay: string;
  type: ReplayEventType;
  teamId: string | null;
  side: "home" | "away" | null;
  description: string;
  participants: string[];
  /** True when ESPN published shot coordinates for this event. */
  hasCoords: boolean;
  /** Where the ball crossed the line, across the width (goals only). */
  goalY: number | null;
}

interface FieldPointSide extends FieldPoint {
  /** False when no coordinates exist — callers draw a centre-spot fallback. */
  hasCoords: boolean;
}

export interface ReplayTick {
  minute: number;
  homeScore: number;
  awayScore: number;
  /** Goals that have happened at or before this minute. */
  goals: ReplayEvent[];
  /** Next event after this minute, for the "incoming" strip. */
  upcoming: ReplayEvent | null;
  /** -1..1; positive = home on the front foot this minute. */
  momentum: number;
  /** Ball position on the drawn pitch (lx/ly in field coords). */
  ball: FieldPoint;
}

/**
 * One positioned moment of the match, in drawn-pitch coords (home attacks
 * right). Built from the commentary and the tracked timeline together — the
 * raw material for the ball path.
 *
 * The stored timeline only publishes coordinates for goals, so on its own it
 * knows two or three spots per match and the ball has nowhere to travel. The
 * commentary describes every shot, corner, free kick and foul with a zone, so
 * folding it in gives the run of play its detail without inventing tracking.
 */
export interface ReplayMoment {
  minute: number;
  lx: number;
  ly: number;
  side: "home" | "away" | null;
}

/**
 * A shot the stored commentary describes, with the spot it implies. The stored
 * timeline only publishes coordinates for goals, so every other shot carries a
 * zone-derived spot — the same parsing the live pitch uses, so the same line of
 * commentary lands in the same place on either surface.
 */
export interface ReplayShot {
  id: string;
  minute: number;
  minuteDisplay: string;
  side: "home" | "away" | null;
  actor: string | null;
  /** Drawn-pitch field coords (home attacks right). */
  lx: number;
  ly: number;
  /** Metres from the goal under attack. */
  distanceM: number | null;
  /** A goal, so callers can let the goal pins own it instead of double-marking. */
  goal: boolean;
  description: string;
}

export interface ReplaySideInfo {
  id: string;
  /** Full club name — the form ESPN's commentary uses in "(Team)". */
  name: string;
  shortName: string;
  color: string;
}

export interface ReplayModel {
  home: ReplaySideInfo;
  away: ReplaySideInfo;
  finalHomeScore: number;
  finalAwayScore: number;
  /** Expected goals per side (Understat), null when the fixture wasn't
   *  matched — never a guessed zero. */
  xgHome: number | null;
  xgAway: number | null;
  events: ReplayEvent[];
  /** The positioned moments the ball path interpolates between, in match
   *  order. Every shot, goal, corner, free kick and foul the commentary
   *  describes, plus any timeline event with real coordinates. */
  moments: ReplayMoment[];
  /** Every shot and goal the commentary describes, in match order — the
   *  persistent shot map's raw material. Empty when there was no commentary. */
  shots: ReplayShot[];
  /** Possession share for the home side 0..100, if the sync captured it. */
  possessionHome: number | null;
  ticks: ReplayTick[];
  totalMinutes: number;
}

/** The five types the timeline tab already knows, plus kickoff/other. */
function eventTypeOf(raw: string): ReplayEventType {
  switch (raw) {
    case "goal":
    case "card":
    case "substitution":
    case "var":
    case "halftime":
    case "fulltime":
    case "kickoff":
      return raw;
    default:
      return "other";
  }
}

function minuteOf(display: string): number {
  const m = /\d+/.exec(display ?? "");
  return m ? Number(m[0]) : 0;
}

/**
 * Deterministic per-event "pressure wave": a goal or card makes that side's
 * momentum spike for a few minutes, then decay. Same input, same curve — no
 * random re-render drift between scrub positions.
 */
function eventPush(ev: ReplayEvent, minute: number): number {
  const minutesSince = minute - ev.minute;
  if (minutesSince < 0 || minutesSince > 6) return 0;
  const decay = 1 - minutesSince / 6;
  const weight =
    ev.type === "goal" ? 0.9 : ev.type === "card" ? 0.35 : ev.type === "substitution" ? 0.2 : 0.1;
  return weight * decay;
}

/**
 * Ball position for a minute: interpolated between the two positioned moments
 * that surround it, so the ball travels the run of play instead of hopping
 * between the few spots the tracked timeline knows. Before the first moment it
 * holds the first spot and after the last it holds the last, so the dot never
 * invents territory the feed never described. Deterministic: same minute, same
 * spot, so scrubbing back and forth shows the same pitch.
 */
function ballAt(minute: number, moments: ReplayMoment[]): FieldPoint {
  if (moments.length === 0) return { lx: 0.5, ly: 0.5 };
  let prev: ReplayMoment | null = null;
  let next: ReplayMoment | null = null;
  for (const moment of moments) {
    if (moment.minute <= minute) prev = moment;
    else {
      next = moment;
      break;
    }
  }
  if (!prev) return { lx: next!.lx, ly: next!.ly };
  if (!next) return { lx: prev.lx, ly: prev.ly };
  const span = Math.max(1, next.minute - prev.minute);
  const t = (minute - prev.minute) / span;
  return { lx: lerp(prev.lx, next.lx, t), ly: lerp(prev.ly, next.ly, t) };
}

/** Build the full model once per fetch; ticks are precomputed for scrubbing. */
export function buildReplayModel(
  replay: ApiReplay,
  sides: { home: ReplaySideInfo; away: ReplaySideInfo },
): ReplayModel {
  const events: ReplayEvent[] = replay.events
    .filter((e) => e.type !== "kickoff" || minuteOf(e.minute_display) === 0)
    .map((e: ApiTimelineEvent) => {
      const type = eventTypeOf(e.type);
      const side = e.team_id === sides.home.id ? "home" : e.team_id === sides.away.id ? "away" : null;
      const hasCoords = e.field_x !== null && e.field_y !== null;
      // ESPN coordinates face each team's own attacking direction; mirror for
      // the away side so the drawn pitch stays home-left, away-right.
      const field = hasCoords
        ? fieldPoint(side ?? "home", e.field_x as number, e.field_y as number)
        : { lx: 0.5, ly: 0.5 };
      return {
        id: String(e.id),
        minute: minuteOf(e.minute_display),
        minuteDisplay: e.minute_display,
        type,
        teamId: e.team_id,
        side,
        description: e.description,
        participants: e.participants.map((p) => p.name),
        hasCoords,
        goalY: e.goal_y,
        lx: field.lx,
        ly: field.ly,
      };
    });

  const goals = events.filter((e) => e.type === "goal");

  // Shots have no coordinates in the stored timeline (only goals do), so they
  // come out of the commentary text via the same parser the live pitch uses.
  const shots: ReplayShot[] = shotsFromCommentary(replay.commentary, sides).map((shot) => ({
    id: `shot-${shot.sequence}`,
    minute: shot.minuteNum,
    minuteDisplay: shot.minuteDisplay,
    side: shot.side,
    actor: shot.actor,
    lx: shot.ball.lx,
    ly: shot.ball.ly,
    distanceM: shot.distanceM,
    goal: shot.goal,
    description: shot.detail,
  }));

  // The ball path: every positioned moment the commentary and timeline
  // describe, in match order. Built with the live pitch's own model so a line
  // of commentary lands at the same spot on either surface (tracked goal
  // coordinates win over the commentary's same-minute zone guess).
  const live = buildLiveModel({
    home: sides.home,
    away: sides.away,
    events: replay.events,
    commentary: replay.commentary,
    currentMinute: 0,
  });
  const moments: ReplayMoment[] = live.events.map((m) => ({
    minute: m.minute,
    lx: m.ball.lx,
    ly: m.ball.ly,
    side: m.side,
  }));

  const possessionStat = replay.teamStats.find((s) => s.team_id === sides.home.id);
  const possessionHome =
    possessionStat?.possession_pct != null ? Number(possessionStat.possession_pct) : null;

  // Per-match expected goals, per side. Missing on both counts for a fixture
  // the sync never matched (or a non-big-five club) — the page says so.
  const xgFor = (teamId: string) => replay.xg?.find((r) => r.team_id === teamId)?.xg ?? null;

  const ticks: ReplayTick[] = [];
  let homeScore = 0;
  let awayScore = 0;
  for (let minute = 0; minute <= REPLAY_MINUTES; minute += 1) {
    for (const goal of goals) {
      if (goal.minute === minute && goal.minute > 0) {
        if (goal.side === "home") homeScore += 1;
        else if (goal.side === "away") awayScore += 1;
      }
    }
    let momentum = 0;
    for (const ev of events) {
      if (!ev.side) continue;
      const push = eventPush(ev, minute);
      momentum += ev.side === "home" ? push : -push;
    }
    // Possession nudges the baseline, clamped so a 70% possession side still
    // concedes spells of away pressure.
    if (possessionHome != null) momentum += (possessionHome - 50) / 100;
    momentum = Math.min(0.95, Math.max(-0.95, momentum));

    const upcoming = events.find((e) => e.minute > minute) ?? null;
    ticks.push({
      minute,
      homeScore,
      awayScore,
      goals: goals.filter((g) => g.minute <= minute),
      upcoming,
      momentum,
      ball: ballAt(minute, moments),
    });
  }

  const finalMinute = Math.max(REPLAY_MINUTES, ...events.map((e) => e.minute));
  const final = ticks[Math.min(finalMinute, ticks.length - 1)];

  return {
    home: sides.home,
    away: sides.away,
    finalHomeScore: final.homeScore,
    finalAwayScore: final.awayScore,
    xgHome: xgFor(sides.home.id),
    xgAway: xgFor(sides.away.id),
    events,
    moments,
    shots,
    possessionHome,
    ticks,
    totalMinutes: finalMinute,
  };
}
