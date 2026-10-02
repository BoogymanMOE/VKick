/**
 * The live pitch's brain — turns ESPN's commentary text + timeline events into
 * a "what is happening right now" model: ball placement, the current action
 * (shot / corner / free kick / foul / goal / card / substitution) and who did
 * what to whom. Pure and synchronous so tests and the component share one
 * truth.
 *
 * Honest by design (PRODUCT.md rule 1): ESPN's live feeds carry no player
 * tracking, so this never invents movement. The ball sits where the tracked
 * action happened — real shot coordinates when published — the zone comes from
 * the commentary's own words ("outside the box", "attacking half") and the
 * distance is the pitch-distance of that spot. Feed silent? The pitch says so
 * instead of guessing.
 *
 * Commentary verbs are ESPN house style and remarkably consistent:
 *   "Attempt saved. Name (Team) left footed shot from outside the box ..."
 *   "Corner, Team. Conceded by Name."
 *   "Foul by Name (Team)."
 *   "Name (Team) wins a free kick in the attacking half."
 */

import type { ApiTimelineEvent } from "./api";
import { fieldPoint, seedHash, type FieldPoint } from "./pitchView";

/** FIFA-standard pitch, used to convert field fractions into metres. */
export const PITCH_LENGTH_M = 105;
export const PITCH_WIDTH_M = 68;

export type LiveActionKind =
  "goal" | "shot" | "corner" | "freekick" | "foul" | "card" | "substitution" | "var" | "none";

export interface LiveCommentaryLine {
  sequence: number;
  minute_display: string | null;
  minute_seconds: number | null;
  text: string;
}

export interface LiveSide {
  id: string;
  name: string;
  shortName: string;
  color: string;
}

export interface LiveMoment {
  kind: LiveActionKind;
  /** First tracked sentence after the lead-in, trimmed — raw ESPN wording. */
  detail: string;
  /** Shooter / fouler / carded player / player coming on. */
  actor: string | null;
  /** Fouled player, corner conceder, player going off. */
  recipient: string | null;
  side: "home" | "away" | null;
  /** Ball spot for this moment, in drawn-pitch field coords (home attacks right). */
  ball: FieldPoint;
  /** Metres from the goal under attack; only meaningful for shots and goals. */
  distanceM: number | null;
  /** Where the ball crossed the goal line (ESPN goalPositionY, 0..100 across
   *  the mouth) — goals only when ESPN published it. Drives the goal-direction
   *  marker on the pitch. */
  goalY: number | null;
  /** Minute number from the display ("45+2" → 45). */
  minute: number;
  minuteDisplay: string;
  sequence: number;
}

export interface LiveModel {
  moment: LiveMoment | null;
  /** The latest goal regardless of what came after — drives the celebration
   *  ring, so a 70' sub doesn't swallow the 69' goal's moment. */
  lastGoal: LiveMoment | null;
  /** Every goal on record, in match order — the pitch pins them all so the
   *  surface tells the whole story, not just the last act. */
  allGoals: LiveMoment[];
  /** Every tracked moment of the match, in match order — the raw material
   *  for the rhythm tape. Includes goals. */
  events: LiveMoment[];
  /** Every shot and goal on record with its spot — the persistent shot map.
   *  Empty when the feed carried no shot data. */
  shots: LiveMoment[];
  /** 0..1 read of which side play has tilted toward (1 = fully home). Sourced
   *  from the last few tracked actions; flat means an even game. */
  pressure: number;
  /** Up to the last three tracked ball spots, oldest → newest, for the trail. */
  trail: FieldPoint[];
}

/* ------------------------------------------------------------ text parsing */

/** Number before any stoppage suffix: "45+1" → 45, "82'" → 82. */
function minuteNumOf(display: string | null | undefined): number {
  const m = /\d+/.exec(display ?? "");
  return m ? Number(m[0]) : 0;
}

/**
 * "Name (Team)" where Name is the run of words between the last sentence break
 * and the bracket. Handles "Attempt saved. Max (Estonia) ...", "Foul by Max
 * (Bulgaria)." and "Own Goal by Max (Team)." without a full-name grammar.
 */
function nameTeamAfter(text: string, from: number): { name: string; team: string } | null {
  const open = text.indexOf("(", from);
  if (open < 0) return null;
  const close = text.indexOf(")", open);
  if (close < 0) return null;
  const team = text.slice(open + 1, close).trim();
  const before = text.slice(0, open);
  const start = Math.max(before.lastIndexOf(". "), before.lastIndexOf(", "), before.lastIndexOf("! "));
  let name = before.slice(start + 1).trim();
  name = name.replace(/^own goal by\s+/i, "").replace(/^by\s+/i, "");
  if (!name || name.length > 40) return null;
  return { name, team };
}

function resolveSide(team: string | null, sides: { home: LiveSide; away: LiveSide }): "home" | "away" | null {
  if (!team) return null;
  const n = team.trim().toLowerCase();
  if (!n) return null;
  for (const side of ["home", "away"] as const) {
    const s = sides[side];
    if (s.name.toLowerCase() === n || s.shortName.toLowerCase() === n) return side;
  }
  return null;
}

/**
 * Zone → how far from the goal under attack, as a fraction of the length.
 * Order matters: the most specific match wins.
 */
const ZONES: Array<[RegExp, number]> = [
  [/from the penalty spot|penalty kick|penalty - scored/i, 0.895],
  [/from (?:a )?difficult angle on the (?:left|right)/i, 0.9],
  [/inside (?:the )?six yard box|from very close range/i, 0.945],
  [/from (?:the )?six yard box/i, 0.945],
  [/close range/i, 0.93],
  [/from the (?:left|right) side of (?:the )?(?:six yard box|the box)/i, 0.9],
  [/from the centre of (?:the )?box/i, 0.875],
  [/in (?:the )?(?:centre|middle) of (?:the )?(?:goal|box)/i, 0.875],
  [/shot from outside the box|from outside the box/i, 0.81],
  [/from more than \d+ yards/i, 0.8],
  [/free kick/i, 0.78],
  [/in the (?:penalty )?box|in the area/i, 0.885],
];

/** "in the attacking half" → 0.72, "defensive"/"own" half → 0.28. */
function halfSpot(text: string): number | null {
  if (/in the attacking half/i.test(text)) return 0.72;
  if (/in the defensive half|in their own half|in (?:the )?own half/i.test(text)) return 0.28;
  return null;
}

function zoneOf(text: string): { lx: number; zone: string } | null {
  for (const [re, lx] of ZONES) {
    const m = re.exec(text);
    if (m)
      return {
        lx,
        zone: m[0]
          .replace(/^from\s+/i, "")
          .replace(/\s+/g, " ")
          .toLowerCase(),
      };
  }
  return null;
}

/** Deterministic width wobble so repeated builds render the same pitch. */
function wobble(id: string, spread: number): number {
  return (seedHash(id) - 0.5) * spread;
}

function clamp01(v: number): number {
  return Math.min(1, Math.max(0, v));
}

/** Mirror a spot fraction into drawn-pitch coords for the attacking side. */
function attackingSpot(side: "home" | "away" | null, lxBase: number, ly: number): FieldPoint {
  const lx = side === "away" ? 1 - lxBase : lxBase;
  return { lx: clamp01(lx), ly: clamp01(ly) };
}

/** Metres from the goal under attack for a drawn-pitch spot. */
export function distanceFromGoal(side: "home" | "away" | null, ball: FieldPoint): number | null {
  if (!side) return null;
  const toGoal = side === "home" ? 1 - ball.lx : ball.lx;
  return Math.round(toGoal * PITCH_LENGTH_M);
}

/**
 * Classify one commentary line. Returns null for lines with no pitch meaning
 * ("Fourth official has announced…"), "none" for tracked-but-unmappable
 * restarts (offside, delays) that shouldn't claim the annotation.
 */
export function classifyLine(text: string): LiveActionKind | null {
  const s = text.replace(/\s+/g, " ").trim();
  if (!s) return null;
  const head = s.split(/(?<=\.)\s/, 1)[0] ?? s;
  const low = s.toLowerCase();
  if (/^goal!/i.test(head) || /^own goal by/i.test(head)) return "goal";
  if (/^attempt (?:saved|missed|blocked)|^attempt by|^penalty (?:saved|missed)/i.test(head)) return "shot";
  if (/^corner/i.test(head)) return "corner";
  if (/^foul by|^hand ball/i.test(head)) return "foul";
  if (/wins a free kick/i.test(low)) return "freekick";
  if (/^penalty conceded/i.test(head)) return "foul";
  if (/is shown the (?:yellow|red) card|second yellow card/i.test(low)) return "card";
  if (/^substitution/i.test(head)) return "substitution";
  if (
    /^delay (?:in match|over)|^offside|^fourth official|^second half begins|^first half ends|^match ends|^match starts|^video review/i.test(
      head,
    )
  ) {
    return "none";
  }
  if (/\b(shot|attempt)\b/.test(low)) return "shot";
  return null;
}

interface RawMoment {
  kind: LiveActionKind;
  detail: string;
  actor: string | null;
  recipient: string | null;
  side: "home" | "away" | null;
  spot: FieldPoint | null;
  distanceM: number | null;
  goalY: number | null;
  minuteNum: number;
  minuteDisplay: string;
  order: number;
  /** goal-like raws absorb same-minute commentary shots when merging. */
  authoritative: boolean;
  /** Ball position just before this raw, filled during the model walk.
   *  Gives coord-less events (cards, fouls, some goals) their own spot. */
  posAt?: FieldPoint | null;
}

function detailAfterLead(text: string): string {
  const idx = text.indexOf(". ");
  const rest = idx >= 0 && idx < 60 ? text.slice(idx + 2) : text;
  const trimmed = rest.replace(/\s+/g, " ").trim();
  return trimmed.length > 96 ? `${trimmed.slice(0, 94).trimEnd()}…` : trimmed;
}

function momentFromCommentary(
  line: LiveCommentaryLine,
  sides: { home: LiveSide; away: LiveSide },
): RawMoment | null {
  const text = line.text.replace(/\s+/g, " ").trim();
  const kind = classifyLine(text);
  if (!kind || kind === "none") return null;
  const minuteNum = minuteNumOf(line.minute_display);
  const base: RawMoment = {
    kind,
    detail: detailAfterLead(text),
    actor: null,
    recipient: null,
    side: null,
    spot: null,
    distanceM: null,
    goalY: null,
    minuteNum,
    minuteDisplay: line.minute_display ?? (minuteNum ? `${minuteNum}'` : ""),
    order: line.sequence,
    authoritative: false,
  };

  if (kind === "shot" || kind === "goal") {
    const nt = nameTeamAfter(text, 0);
    base.actor = nt?.name ?? null;
    base.side = resolveSide(nt?.team ?? null, sides);
    const zone = zoneOf(text);
    const lxBase = zone?.lx ?? (kind === "goal" ? 0.86 : 0.78);
    const ly = clamp01(0.5 + wobble(`shot:${line.sequence}`, 0.36));
    base.spot = attackingSpot(base.side, lxBase, ly);
    base.distanceM = base.spot ? distanceFromGoal(base.side, base.spot) : null;
    return base;
  }

  if (kind === "corner") {
    const m = /^Corner,\s*([^,.]+?)\.?\s+(?:Conceded by\s+([^(.]+?)\.?)?$/i.exec(text);
    const team = m?.[1]?.trim() ?? null;
    base.recipient = m?.[2]?.trim() || null;
    base.side = resolveSide(team, sides);
    // The taker walks to the corner arc at the end they attack.
    base.spot = base.side ? attackingSpot(base.side, 0.985, 0.045) : null;
    return base;
  }

  if (kind === "freekick" || kind === "foul") {
    const nt = nameTeamAfter(text, 0);
    base.actor = nt?.name ?? null;
    base.side = resolveSide(nt?.team ?? null, sides);
    const half = halfSpot(text);
    base.spot = attackingSpot(base.side, half ?? 0.5, clamp01(0.5 + wobble(`fk:${line.sequence}`, 0.5)));
    if (kind === "foul") {
      // The awarded kick, not the fouler, moves the ball; often the paired
      // "X wins a free kick" line carries the spot for both.
      base.spot = base.spot && half != null ? base.spot : null;
    }
    return base;
  }

  if (kind === "card") {
    const nt = nameTeamAfter(text, 0);
    base.actor = nt?.name ?? null;
    base.side = resolveSide(nt?.team ?? null, sides);
    return base;
  }

  if (kind === "substitution") {
    const m = /^Substitution,\s*([^,.]+?)\.\s*(.+?)\s+replaces\s+(.+?)\./i.exec(text);
    if (m) {
      base.side = resolveSide(m[1]?.trim() ?? null, sides);
      base.actor = m[2]?.trim() ?? null;
      base.recipient = m[3]?.trim() ?? null;
    }
    return base;
  }

  return null;
}

/* ----------------------------------------------------------- shot extraction */

/** One shot (or goal) the commentary describes, with the spot it implies. */
export interface CommentaryShot {
  sequence: number;
  /** Minute number from the display ("45+2" → 45). */
  minuteNum: number;
  minuteDisplay: string;
  actor: string | null;
  side: "home" | "away" | null;
  /** Drawn-pitch field coords (home attacks right), zone-derived for shots. */
  ball: FieldPoint;
  distanceM: number | null;
  /** Goal lines are kept so a caller can mark them separately from shots. */
  goal: boolean;
  detail: string;
}

/**
 * Pull every shot and goal the stored commentary describes out of the text, in
 * match order. The replay's persistent shot map runs on this so a given line of
 * commentary always lands at the same spot on either pitch — one parsing truth,
 * shared by the live view and the replay.
 */
export function shotsFromCommentary(
  commentary: LiveCommentaryLine[],
  sides: { home: LiveSide; away: LiveSide },
): CommentaryShot[] {
  const shots: CommentaryShot[] = [];
  for (const line of commentary) {
    const m = momentFromCommentary(line, sides);
    if (!m || (m.kind !== "shot" && m.kind !== "goal") || !m.spot) continue;
    shots.push({
      sequence: m.order,
      minuteNum: m.minuteNum,
      minuteDisplay: m.minuteDisplay,
      actor: m.actor,
      side: m.side,
      ball: m.spot,
      distanceM: m.distanceM,
      goal: m.kind === "goal",
      detail: m.detail,
    });
  }
  return shots;
}

/* ------------------------------------------------- timeline authoritative */

const TIMELINE_KIND: Record<string, LiveActionKind> = {
  goal: "goal",
  card: "card",
  substitution: "substitution",
  var: "var",
};

function momentFromTimeline(
  ev: ApiTimelineEvent,
  kind: LiveActionKind,
  sides: { home: LiveSide; away: LiveSide },
): RawMoment {
  const side = ev.team_id === sides.home.id ? "home" : ev.team_id === sides.away.id ? "away" : null;
  const hasCoords = ev.field_x !== null && ev.field_y !== null;
  const minuteNum = minuteNumOf(ev.minute_display);
  const spot = hasCoords ? fieldPoint(side ?? "home", ev.field_x as number, ev.field_y as number) : null;
  return {
    kind,
    detail: detailAfterLead(ev.description ?? ""),
    actor: ev.participants[0]?.name || null,
    recipient: ev.participants[1]?.name || null,
    side,
    spot,
    distanceM: spot ? distanceFromGoal(side, spot) : null,
    goalY: ev.goal_y,
    minuteNum,
    minuteDisplay: ev.minute_display ? `${ev.minute_display}'` : "",
    order: 900_000 + minuteNum * 10 + (ev.participants.length ? 1 : 0),
    authoritative: true,
  };
}

/* ------------------------------------------------------------ the model */

/**
 * Build the live model: the latest tracked action (timeline events win over
 * their same-minute commentary duplicates) plus the last few ball spots for
 * the trajectory trail. `currentMinute` gates the future away — at 0 (clock
 * not started / halftime parse) everything recorded so far shows.
 */
export function buildLiveModel(input: {
  home: LiveSide;
  away: LiveSide;
  events: ApiTimelineEvent[];
  commentary: LiveCommentaryLine[];
  currentMinute: number;
}): LiveModel {
  const sides = { home: input.home, away: input.away };
  const now = input.currentMinute;
  const withinNow = (minuteNum: number) => (now > 0 ? minuteNum <= now + 1 : true);

  let raws: RawMoment[] = [];
  for (const line of input.commentary) {
    const m = momentFromCommentary(line, sides);
    if (m && withinNow(m.minuteNum)) raws.push(m);
  }
  for (const ev of input.events) {
    const kind = TIMELINE_KIND[ev.type];
    if (!kind) continue;
    const m = momentFromTimeline(ev, kind, sides);
    if (!withinNow(m.minuteNum)) continue;
    raws = raws.filter(
      (r) =>
        !(r.minuteNum === m.minuteNum && (r.kind === m.kind || (m.kind === "goal" && r.kind === "shot"))),
    );
    raws.push(m);
  }

  raws.sort((a, b) => a.minuteNum - b.minuteNum || a.order - b.order);

  // The ball is where the last spot-carrying action left it; spot-less raws
  // (fouls with no half mentioned, cards) inherit that position. `posAt`
  // remembers where the ball was at each raw, so a coord-less goal still
  // celebrates at its own place in the game rather than a later spot.
  let carried: FieldPoint | null = null;
  const spots: FieldPoint[] = [];
  for (const raw of raws) {
    raw.posAt = carried;
    if (raw.spot) {
      carried = raw.spot;
      spots.push(raw.spot);
    }
  }

  const last = raws[raws.length - 1];
  if (!last)
    return { moment: null, lastGoal: null, allGoals: [], events: [], shots: [], pressure: 0.5, trail: [] };

  const toMoment = (raw: RawMoment): LiveMoment => ({
    kind: raw.kind,
    detail: raw.detail,
    actor: raw.actor,
    recipient: raw.recipient,
    side: raw.side,
    ball: raw.spot ?? raw.posAt ?? { lx: 0.5, ly: 0.5 },
    distanceM: raw.distanceM,
    goalY: raw.goalY,
    minute: raw.minuteNum,
    minuteDisplay: raw.minuteDisplay,
    sequence: raw.order,
  });

  const moment = toMoment(last);
  // Goals always carry a spot (tracked coords or the zone fallback), so the
  // celebration ring lands where the ball crossed the line.
  const goalRaws = raws.filter((r) => r.kind === "goal");
  const shotRaws = raws.filter((r) => r.kind === "shot" || r.kind === "goal");
  const lastGoalRaw = goalRaws[goalRaws.length - 1] ?? null;
  // Territorial pressure: walk the last few spot-carrying actions, weighting
  // later ones more; each contributes its side's tilt. Both-null → perfectly
  // even. The score stays 0..1 with 0.5 = even, so the renderer can use it
  // directly as a centre-out wash without re-normalising.
  let tilt = 0;
  let weight = 0;
  for (const raw of raws.slice(-6)) {
    const w = raw.spot ? 2 : 1;
    if (raw.side === "home") tilt += w;
    else if (raw.side === "away") tilt -= w;
    weight += w;
  }
  const pressure = weight > 0 ? 0.5 + tilt / (2 * weight) : 0.5;
  return {
    moment,
    lastGoal: lastGoalRaw ? toMoment(lastGoalRaw) : null,
    allGoals: goalRaws.map(toMoment),
    events: raws.map(toMoment),
    shots: shotRaws.map(toMoment),
    pressure,
    trail: spots.slice(-3),
  };
}
