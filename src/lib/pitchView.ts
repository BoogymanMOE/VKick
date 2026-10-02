/**
 * Pure maths for the live tactical view — a flat 2D pitch laid out horizontally,
 * the classic broadcast map: the pitch length runs left to right, home defends
 * the left goal and attacks right, away does the reverse.
 *
 * Field coordinates (0..1 everywhere, matching ESPN's 0..100 axes):
 * - `lx` 0..1 along the LENGTH, 0 = home's own goal (left)
 * - `ly` 0..1 across the WIDTH, 0 = the top sideline
 */

import type { LineupPlayer, MatchLineup, Position } from "../types";
import { fillFormation, isValidFormationId, pitchRows, type SlotCandidate } from "./formations";

export interface TacticalViewport {
  /** Pixel size of the pitch surface. */
  width: number;
  height: number;
  /** Horizontal margin for the goal mouths; vertical margin for touchlines. */
  marginX: number;
  marginY: number;
}

export const TACTICAL_VIEWPORT: TacticalViewport = {
  width: 340,
  height: 180,
  marginX: 16,
  marginY: 8,
};

export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

export interface TacticalPoint {
  /** Screen px with the origin at the viewport's top-left. */
  x: number;
  y: number;
  /** Unused in the flat map; kept so callers stay written against one shape. */
  scale: number;
}

const clamp01 = (value: number) => Math.min(1, Math.max(0, value));

/** Map a field coordinate onto the 2D surface. */
export function project(lx: number, ly: number, vp: TacticalViewport = TACTICAL_VIEWPORT): TacticalPoint {
  const innerW = vp.width - vp.marginX * 2;
  const innerH = vp.height - vp.marginY * 2;
  return {
    x: vp.marginX + clamp01(lx) * innerW,
    y: vp.marginY + clamp01(ly) * innerH,
    scale: 1,
  };
}

/**
 * Corner points of a rectangle of the pitch (penalty area, six-yard box, goal
 * mouth, mowing stripe) as `lx`/`ly` pairs, ready for an SVG polygon.
 */
export function bandCorners(
  lx0: number,
  lx1: number,
  ly0: number,
  ly1: number,
  vp: TacticalViewport = TACTICAL_VIEWPORT,
): string {
  const a = project(lx0, ly0, vp);
  const b = project(lx1, ly0, vp);
  const c = project(lx1, ly1, vp);
  const d = project(lx0, ly1, vp);
  return `${a.x.toFixed(2)},${a.y.toFixed(2)} ${b.x.toFixed(2)},${b.y.toFixed(2)} ${c.x.toFixed(2)},${c.y.toFixed(2)} ${d.x.toFixed(2)},${d.y.toFixed(2)}`;
}

/**
 * The 9.15m penalty arc around a penalty spot, clipped to the part that bulges
 * outside the 18m penalty area. Drawn with SVG arc flags rather than guessed
 * control points. Home's spot sits 11m from the left goal line (lx 0.11), away's
 * mirrors it; the bulge always faces the centre circle.
 *
 * The drawn pitch isn't to scale (340x180 vs 105x68 metres), so the radius is
 * converted separately per axis.
 */
export function penaltyArcPath(side: "home" | "away", vp: TacticalViewport = TACTICAL_VIEWPORT): string {
  const innerW = vp.width - vp.marginX * 2;
  const innerH = vp.height - vp.marginY * 2;
  const spot = project(side === "home" ? 0.11 : 0.89, 0.5, vp);
  const rx = (9.15 / 105) * innerW;
  const ry = (9.15 / 68) * innerH;
  // Half-chord where the arc meets the penalty-area edge (18m deep, lx 0.171
  // for home): sqrt(r² − d²) with d = 7m (spot 11m, edge 18m).
  const halfChordM = Math.sqrt(Math.max(0, 9.15 * 9.15 - 7 * 7));
  const halfY = (halfChordM / 68) * innerH;
  const edgeX = project(side === "home" ? 0.171 : 0.829, 0.5, vp).x;
  const top = `${edgeX.toFixed(2)},${(spot.y - halfY).toFixed(2)}`;
  const bottom = `${edgeX.toFixed(2)},${(spot.y + halfY).toFixed(2)}`;
  const sweep = side === "home" ? 0 : 1;
  return `M ${top} A ${rx.toFixed(2)} ${ry.toFixed(2)} 0 0 ${sweep} ${bottom}`;
}

/**
 * The 1m corner arc at a pitch corner, swept onto the field of play. `cx`/`cy`
 * are 0 (top/left) or 1 (bottom/right) corner selectors.
 */
export function cornerArcPath(cx: 0 | 1, cy: 0 | 1, vp: TacticalViewport = TACTICAL_VIEWPORT): string {
  const innerW = vp.width - vp.marginX * 2;
  const innerH = vp.height - vp.marginY * 2;
  const rx = (1 / 105) * innerW;
  const ry = (1 / 68) * innerH;
  const c = project(cx, cy, vp);
  const dx = cx === 0 ? 1 : -1;
  const dy = cy === 0 ? 1 : -1;
  const from = `${(c.x + dx * rx).toFixed(2)},${c.y.toFixed(2)}`;
  const to = `${c.x.toFixed(2)},${(c.y + dy * ry).toFixed(2)}`;
  const sweep = dx === dy ? 1 : 0;
  return `M ${from} A ${rx.toFixed(2)} ${ry.toFixed(2)} 0 0 ${sweep} ${to}`;
}

export interface FormationSlot {
  /** Along the length, 0 (own goal) .. 1 (opponent's goal). */
  lx: number;
  /** Across the width, 0 (top) .. 1 (bottom). */
  ly: number;
}

const HOME_LINE_X: Record<Position, number> = { GK: 0.055, DEF: 0.2, MID: 0.44, FWD: 0.74 };

/** Where the keeper and the two outer outfield bands sit along the length. */
const KEEPER_LX = 0.055;
const DEEPEST_LX = 0.22;
const MOST_ADVANCED_LX = 0.78;

/**
 * Formation positions for a starting XI, on the drawn (length-first) pitch.
 * Home presses toward the right goal; away mirrors along the length so they
 * press left.
 *
 * When the match carries a real formation (ESPN publishes one per side) the
 * shape is the real one: a 4-2-3-1 draws two separate midfield bands and a lone
 * striker, and each player stands on their own side of the line from their
 * granular role. This reuses the same tested filler the Lineup Predictor draws
 * with, so the replay pitch and the picker can never disagree about a shape.
 *
 * Only when there is no usable formation does it fall back to four flat,
 * evenly-spaced lines — the old approximation.
 */
export function lineupSlots(lineup: MatchLineup, side: "home" | "away"): Record<string, FormationSlot> {
  const slots: Record<string, FormationSlot> = {};
  const mirror = (lx: number) => (side === "away" ? 1 - lx : lx);

  if (isValidFormationId(lineup.formation) && lineup.starters.length > 0) {
    const candidates: SlotCandidate[] = lineup.starters.map((player) => ({
      id: player.id,
      espnPosition: player.espnPosition ?? null,
      jersey: player.number ?? null,
      unit: player.position,
    }));
    const filled = fillFormation(lineup.formation, candidates);
    // Rows run attack -> keeper, so the last index is the keeper and the
    // outfield bands count down in depth from there.
    const outfield = pitchRows(lineup.formation).length - 1;
    filled.forEach((row, rowIndex) => {
      const lx =
        rowIndex === outfield
          ? KEEPER_LX
          : lerp(DEEPEST_LX, MOST_ADVANCED_LX, (outfield - 1 - rowIndex) / Math.max(1, outfield - 1));
      const n = row.length;
      row.forEach((candidate, i) => {
        if (!candidate) return;
        slots[candidate.id] = { lx: mirror(lx), ly: (i + 1) / (n + 1) };
      });
    });
    if (Object.keys(slots).length > 0) return slots;
  }

  const groups: Record<Position, LineupPlayer[]> = { GK: [], DEF: [], MID: [], FWD: [] };
  for (const player of lineup.starters) {
    (groups[player.position] ||= []).push(player);
  }

  const order: Position[] = ["GK", "DEF", "MID", "FWD"];
  for (const position of order) {
    const group = groups[position];
    const n = group.length;
    for (let i = 0; i < n; i += 1) {
      const player = group[i];
      const spacing = n === 1 ? 0.5 : (i + 1) / (n + 1);
      const stagger = i % 2 === 1 ? 0.015 : -0.015;
      slots[player.id] = { lx: mirror(HOME_LINE_X[position]), ly: spacing + stagger * 0.5 };
    }
  }
  return slots;
}

/* ---------------------------------------------------------------- momentum */

/** `home` is -1..1; positive means the home side is on the front foot. */
export interface MomentumPoint {
  minute: number;
  home: number;
}

/** Linear interpolation between script points; flat outside the range. */
export function momentumAt(script: MomentumPoint[], minute: number): number {
  if (script.length === 0) return 0;
  if (minute <= script[0].minute) return script[0].home;
  const last = script[script.length - 1];
  if (minute >= last.minute) return last.home;

  for (let i = 0; i < script.length - 1; i += 1) {
    const a = script[i];
    const b = script[i + 1];
    if (minute < b.minute) {
      const t = (minute - a.minute) / (b.minute - a.minute);
      return a.home + (b.home - a.home) * t;
    }
  }
  return last.home;
}

/** Deterministic 0..1 value from a string, for per-player wander phases. */
export function seedHash(input: string): number {
  let hash = 2166136261;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return ((hash >>> 0) % 10000) / 10000;
}

export interface FieldPoint {
  lx: number;
  ly: number;
}

/**
 * Map an ESPN shot position into our field coords for a given side.
 * `fieldPositionX` runs 0 (own goal) to 100 (opponent's goal) along the length;
 * `fieldPositionY` runs 0-100 across the width.
 */
export function fieldPoint(
  side: "home" | "away",
  fieldPositionX: number,
  fieldPositionY: number,
): FieldPoint {
  const len = clamp01(fieldPositionX / 100);
  const wid = clamp01(fieldPositionY / 100);
  return side === "home" ? { lx: len, ly: wid } : { lx: 1 - len, ly: wid };
}
