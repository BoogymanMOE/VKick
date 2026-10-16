/**
 * Client mirror of `server/scoring/shotZones.ts` (+ shotGrid.ts geometry):
 * which of the 6 scoring zones (left/center/right × inside/outside box) a
 * grid cell belongs to. Pure label/preview math — the server adjudicates.
 * If either side changes, both must change.
 */

import type { StringKey } from "../i18n/strings";

export type ShotZone =
  "inside_left" | "inside_center" | "inside_right" | "outside_left" | "outside_center" | "outside_right";

/** Grid dimensions — must mirror server/scoring/shotGrid.ts. */
export const GRID_COLS = 6;
export const GRID_ROWS = 4;

/** The penalty-area rectangle in field coords — mirrors shotZones.ts. */
const BOX_X_MIN = 82;
const BOX_Y_MIN = 21.5;
const BOX_Y_MAX = 78.5;
const WIDTH_THIRD = 100 / 3;

/** Cell centre in field coordinates (0..100, own end = 0 along the length). */
export function cellCenter(gridX: number, gridY: number): { x: number; y: number } {
  const rowsFromOwnEnd = GRID_ROWS - 1 - gridY;
  return {
    x: (rowsFromOwnEnd + 0.5) * (100 / GRID_ROWS),
    y: (gridX + 0.5) * (100 / GRID_COLS),
  };
}

/**
 * The grid cell an ESPN field position falls in — the inverse of `cellCenter`,
 * mirroring `cellFromFieldPosition` in server/scoring/shotGrid.ts. This is what
 * lets the live shot plot drop a real shot into the same 6×4 grid the Shot
 * Predictor scores against, so "inside left" means the same cell on both
 * screens. Out-of-range coordinates clamp into the grid instead of escaping it.
 */
export function cellFromFieldPosition(
  fieldPositionX: number,
  fieldPositionY: number,
): { gridX: number; gridY: number } {
  const clamp = (value: number, max: number) => Math.min(max - 1, Math.max(0, value));
  const x = Math.min(100, Math.max(0, fieldPositionX));
  const y = Math.min(100, Math.max(0, fieldPositionY));
  const gridX = clamp(Math.floor(y / (100 / GRID_COLS)), GRID_COLS);
  const rowsFromOwnEnd = clamp(Math.floor(x / (100 / GRID_ROWS)), GRID_ROWS);
  // Rows count from the attacking end so the drawing matches the Predictor grid.
  return { gridX, gridY: GRID_ROWS - 1 - rowsFromOwnEnd };
}

/** Classify a field position into one of the 6 zones (server parity). */
export function zoneForFieldPosition(fieldPositionX: number, fieldPositionY: number): ShotZone {
  const x = Math.min(100, Math.max(0, fieldPositionX));
  const y = Math.min(100, Math.max(0, fieldPositionY));
  const inside = x >= BOX_X_MIN && y >= BOX_Y_MIN && y <= BOX_Y_MAX;
  const column = y < WIDTH_THIRD ? "left" : y > 100 - WIDTH_THIRD ? "right" : "center";
  if (inside) {
    return column === "left" ? "inside_left" : column === "right" ? "inside_right" : "inside_center";
  }
  return column === "left" ? "outside_left" : column === "right" ? "outside_right" : "outside_center";
}

/** Which scoring zone a grid cell belongs to. */
export function cellZone(gridX: number, gridY: number): ShotZone {
  const c = cellCenter(gridX, gridY);
  return zoneForFieldPosition(c.x, c.y);
}

/** i18n keys per zone (strings.ts, EN + FA). */
export const ZONE_LABEL_KEY: Record<ShotZone, StringKey> = {
  inside_left: "shot.zoneInsideLeft",
  inside_center: "shot.zoneInsideCenter",
  inside_right: "shot.zoneInsideRight",
  outside_left: "shot.zoneOutsideLeft",
  outside_center: "shot.zoneOutsideCenter",
  outside_right: "shot.zoneOutsideRight",
};
