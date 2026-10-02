/**
 * Shot Predictor zone geometry — the 6-zone pitch grid from
 * `scoring-rules.md` §3: left/center/right × inside/outside the box.
 *
 * The user picks one of the 6 zones (the client renders them as a 3×2 zone
 * picker over the pitch). The server classifies an actual shot's ESPN
 * field position into the same zones. Kept as pure functions so the client
 * preview and the server adjudication share one definition — if one side
 * changes, both change (mirrored in `src/lib/zones.ts` for labels only).
 *
 * Coordinate systems (the easy place to get it backwards):
 * - ESPN `fieldPositionX` runs along the pitch LENGTH (0 = own goal line,
 *   100 = opponent's goal); `fieldPositionY` runs across the WIDTH (0..100).
 * - Zones are always defined against the SHOOTING team's attacking direction,
 *   which the ESPN event coordinates already are: high X = near the goal.
 */

export type ShotZone =
  "inside_left" | "inside_center" | "inside_right" | "outside_left" | "outside_center" | "outside_right";

export const SHOT_ZONES: ShotZone[] = [
  "inside_left",
  "inside_center",
  "inside_right",
  "outside_left",
  "outside_center",
  "outside_right",
];

/**
 * The penalty-area rectangle in field coordinates, per scoring-rules.md §3.
 * A regulation box spans the central ~57% of the pitch width and extends
 * 16.5m (~18% of length) from the goal line; ESPN coordinates are
 * normalized 0..100, so inside-the-box = X ≥ 82 and 21.5 < Y < 78.5.
 */
export const BOX_X_MIN = 82;
export const BOX_Y_MIN = 21.5;
export const BOX_Y_MAX = 78.5;

/** Thirds of the pitch width: left / center / right. */
const WIDTH_THIRD = 100 / 3; // ≈ 33.33

/**
 * Classify a shot's field position into one of the 6 zones.
 * Inside/outside is decided first (the box edge), then left/center/right
 * thirds of the width. Edge coordinate Y = 21.5/78.5 counts as inside the
 * box (regulation: the box line belongs to the box); Y = 33.33/66.67 is the
 * first third boundary — exactly on it counts as center.
 */
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
