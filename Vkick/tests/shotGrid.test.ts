/**
 * Shot grid geometry — the client (`ShotPredictor` panel + src/lib/zones.ts)
 * mirrors this server module; these tests pin the shared geometry contract.
 * Zone classification and Shot Predictor scoring live in shotZones.ts /
 * predictionScore.ts (covered by predictionScore.test.ts).
 */
import { strict as assert } from "node:assert";
import { GRID_COLS, GRID_ROWS, cellFromFieldPosition, cellCenter } from "../server/scoring/shotGrid.js";
import { zoneForFieldPosition, SHOT_ZONES } from "../server/scoring/shotZones.js";

type Cell = { gridX: number; gridY: number };

const cells = (x: number, y: number): Cell => cellFromFieldPosition(x, y);

/** Every ESPN coordinate in the payload range maps inside the grid. */
function testBounds() {
  for (let x = -20; x <= 120; x += 5) {
    for (let y = -20; y <= 120; y += 5) {
      const c = cells(x, y);
      assert.ok(c.gridX >= 0 && c.gridX < GRID_COLS, `gridX in range for (${x},${y})`);
      assert.ok(c.gridY >= 0 && c.gridY < GRID_ROWS, `gridY in range for (${x},${y})`);
    }
  }
}

function testQuadrants() {
  // X near 100 = opponent's goal = attacking end = row 0 (after the flip).
  // y=50 sits exactly on the column boundary -> column 3 (of 0..5).
  assert.deepEqual(cells(100, 50), { gridX: 3, gridY: 0 }, "opponent goal -> attacking row 0");
  // X near 0 = own goal = row GRID_ROWS-1. Same y=50 column boundary as above.
  assert.deepEqual(cells(0, 50), { gridX: 3, gridY: GRID_ROWS - 1 }, "own goal -> bottom row");
  // Y near 0 = left edge -> column 0; Y near 100 -> last column.
  assert.equal(cells(50, 0).gridX, 0, "left edge -> column 0");
  assert.equal(cells(50, 99).gridX, GRID_COLS - 1, "right edge -> last column");
  // Spot-check the flip: mid-pitch X lands in a middle row.
  assert.equal(cells(50, 50).gridY >= 1, true, "mid-pitch X is not in the attacking row");
}

/** Cell centres sit at the middle of their cell in field coordinates. */
function testCellCenters() {
  const c = cellCenter(0, 0);
  // Row 0 = attacking end => along-the-length x near 100.
  assert.equal(c.x, 87.5, "attacking row centre along the length");
  assert.equal(c.y, 100 / (GRID_COLS * 2), "first column centre across the width");

  const far = cellCenter(GRID_COLS - 1, GRID_ROWS - 1);
  assert.equal(far.x, 12.5, "own-end row centre along the length");
  assert.ok(far.y > 80, "last column centre near the right edge");
}

/** Zone classification: the box edge and the width thirds (shotZones.ts). */
function testZones() {
  assert.equal(SHOT_ZONES.length, 6, "exactly six zones");

  // Inside the box: X >= 82 and 21.5 <= Y <= 78.5.
  assert.equal(zoneForFieldPosition(95, 50), "inside_center", "central box shot");
  assert.equal(zoneForFieldPosition(90, 25), "inside_left", "box, left third");
  assert.equal(zoneForFieldPosition(82, 78.5), "inside_right", "box edge Y counts inside");
  assert.equal(zoneForFieldPosition(100, 21.5), "inside_left", "box edge lower bound inside");
  assert.equal(zoneForFieldPosition(100, 80), "outside_right", "wide of the box, right third");
  assert.equal(zoneForFieldPosition(70, 50), "outside_center", "edge of the box X = outside");
  assert.equal(zoneForFieldPosition(60, 10), "outside_left", "left third outside");
  assert.equal(zoneForFieldPosition(60, 90), "outside_right", "right third outside");
  // Out-of-range coordinates clamp (120,-5 -> 100,0 = outside the box, left third).
  assert.equal(zoneForFieldPosition(120, -5), "outside_left", "coordinates clamp into range");
}

export function runShotGridTests(): void {
  testBounds();
  testQuadrants();
  testCellCenters();
  testZones();
  console.log("  shotGrid: grid mapping, cell centres and zone classification OK");
}
