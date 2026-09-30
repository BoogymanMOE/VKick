/**
 * Shot grid geometry — the coordinate bridge between ESPN field positions
 * and the 6×4 client grid. Zone CLASSIFICATION and Shot Predictor scoring
 * live in `shotZones.ts` / `predictionScore.ts` (scoring-rules.md §3);
 * this module keeps only the pure geometry the payload and client share.
 *
 * Coordinate systems (the easy place to get it backwards):
 * - ESPN `fieldPositionX` runs along the pitch LENGTH (0 = own goal line,
 *   100 = opponent's goal); `fieldPositionY` runs across the WIDTH (0..100).
 * - Our grid is stored with a top-left origin matching what the user sees:
 *     gridX 0-5  left -> right across the width
 *     gridY 0-3  top -> bottom along the length, where row 0 is the ATTACKING end
 */
export const GRID_COLS = 6;
export const GRID_ROWS = 4;

export interface ShotPin {
  id: string;
  gridX: number;
  gridY: number;
}

export interface PlotEvent {
  kind: "goal" | "on_target";
  fieldPositionX: number;
  fieldPositionY: number;
}

const clamp = (value: number, max: number) => Math.min(max - 1, Math.max(0, value));

/** Map an ESPN field position onto a grid cell (same math as the client). */
export function cellFromFieldPosition(
  fieldPositionX: number,
  fieldPositionY: number,
): { gridX: number; gridY: number } {
  const x = Math.min(100, Math.max(0, fieldPositionX));
  const y = Math.min(100, Math.max(0, fieldPositionY));
  const gridX = clamp(Math.floor(y / (100 / GRID_COLS)), GRID_COLS);
  const rowsFromOwnEnd = clamp(Math.floor(x / (100 / GRID_ROWS)), GRID_ROWS);
  // Flip so row 0 is the attacking end, matching the on-screen grid.
  return { gridX, gridY: GRID_ROWS - 1 - rowsFromOwnEnd };
}

/**
 * Cell centre in field coordinates (0..100, own end = 0 along the length).
 * Used by the resolver to map a stored grid pick onto the 6 scoring zones
 * (shotZones.ts); the client mirrors this geometry in src/lib/zones.ts.
 */
export function cellCenter(gridX: number, gridY: number): { x: number; y: number } {
  const rowsFromOwnEnd = GRID_ROWS - 1 - gridY;
  return {
    x: (rowsFromOwnEnd + 0.5) * (100 / GRID_ROWS),
    y: (gridX + 0.5) * (100 / GRID_COLS),
  };
}
