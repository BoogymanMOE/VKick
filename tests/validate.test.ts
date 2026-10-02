/**
 * Prediction payload validation — the abuse gate in front of the resolver.
 * Everything a user can POST passes through here, so each mechanic's schema
 * (and the rejection paths) are pinned by these tests. The grid parity block
 * pins that a stored grid pick maps to the same zone the client showed.
 */
import { strict as assert } from "node:assert";
import { validatePayload } from "../server/predictions/validate.js";
import { cellCenter, cellFromFieldPosition } from "../server/scoring/shotGrid.js";
import { zoneForFieldPosition } from "../server/scoring/shotZones.js";

const ELEVEN_IDS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "10", "11"];

function testLineup() {
  const ok = validatePayload("lineup", { playerIds: ELEVEN_IDS, formation: "4-3-3" });
  assert.ok(ok, "valid lineup accepted");
  assert.deepEqual(ok, { playerIds: ELEVEN_IDS, formation: "4-3-3" });

  // Formation must sum to 10 outfielders.
  assert.equal(
    validatePayload("lineup", { playerIds: ELEVEN_IDS, formation: "4-4-3" }),
    null,
    "formation not summing to 10 rejected",
  );
  assert.equal(
    validatePayload("lineup", { playerIds: ELEVEN_IDS, formation: "11-0" }),
    null,
    "malformed formation rejected",
  );
  assert.equal(
    validatePayload("lineup", { playerIds: ELEVEN_IDS, formation: "4-4-2 " }),
    null,
    "whitespace in formation rejected",
  );

  // Duplicated ids would double-count points.
  assert.equal(
    validatePayload("lineup", { playerIds: [...ELEVEN_IDS.slice(0, 10), "1"], formation: "4-3-3" }),
    null,
    "duplicate player ids rejected",
  );
  // Wrong count in either direction.
  assert.equal(
    validatePayload("lineup", { playerIds: ELEVEN_IDS.slice(0, 10), formation: "4-3-3" }),
    null,
    "10 starters rejected",
  );
  assert.equal(
    validatePayload("lineup", { playerIds: [...ELEVEN_IDS, "12"], formation: "4-3-3" }),
    null,
    "12 starters rejected",
  );
  // Non-numeric ESPN-style ids are not athlete ids.
  assert.equal(
    validatePayload("lineup", { playerIds: ELEVEN_IDS.map((_, i) => `x${i}`), formation: "4-3-3" }),
    null,
    "non-numeric ids rejected",
  );
}

function testSub() {
  // The whole-board shape: one submission, list of {offId, onId} pairs.
  const ok = validatePayload("sub", {
    subs: [
      { offId: "123", onId: "456" },
      { offId: "789", onId: "321" },
    ],
  });
  assert.ok(ok, "valid sub board accepted");
  assert.deepEqual(ok, {
    subs: [
      { offId: "123", onId: "456" },
      { offId: "789", onId: "321" },
    ],
  });

  assert.equal(validatePayload("sub", { subs: [] }), null, "empty sub board rejected");
  assert.equal(
    validatePayload("sub", { subs: [{ offId: "123", onId: "123" }] }),
    null,
    "same player on and off rejected",
  );
  assert.equal(
    validatePayload("sub", { subs: [{ offId: "abc", onId: "456" }] }),
    null,
    "non-numeric ids rejected",
  );
  assert.equal(validatePayload("sub", { subs: [{ offId: "123", onId: "" }] }), null, "missing onId rejected");
  // The same player coming off twice is nonsense.
  assert.equal(
    validatePayload("sub", {
      subs: [
        { offId: "123", onId: "456" },
        { offId: "123", onId: "789" },
      ],
    }),
    null,
    "duplicate off player rejected",
  );
  // More pairs than legal substitute slots rejected.
  assert.equal(
    validatePayload("sub", {
      subs: Array.from({ length: 6 }, (_, i) => ({ offId: String(100 + i * 2), onId: String(101 + i * 2) })),
    }),
    null,
    "oversized sub board rejected",
  );
}

function testShotPredict() {
  // Single player + single grid point (the grid point encodes the zone).
  const ok = validatePayload("shot_predict", { playerId: "30531", grid: { gridX: 2, gridY: 0 } });
  assert.ok(ok, "valid shot pick accepted");
  assert.deepEqual(ok, { playerId: "30531", grid: { id: "pick", gridX: 2, gridY: 0 } });

  assert.equal(
    validatePayload("shot_predict", { playerId: "30531", grid: { gridX: 6, gridY: 0 } }),
    null,
    "gridX out of range rejected",
  );
  assert.equal(
    validatePayload("shot_predict", { playerId: "30531", grid: { gridX: 0, gridY: 4 } }),
    null,
    "gridY out of range rejected",
  );
  assert.equal(
    validatePayload("shot_predict", { playerId: "30531", grid: { gridX: 1.5, gridY: 0 } }),
    null,
    "float grid rejected",
  );
  assert.equal(
    validatePayload("shot_predict", { playerId: "30531", grid: { gridX: "2", gridY: 0 } }),
    null,
    "string grid rejected",
  );
  assert.equal(
    validatePayload("shot_predict", { playerId: "", grid: { gridX: 1, gridY: 1 } }),
    null,
    "empty playerId rejected",
  );
  assert.equal(
    validatePayload("shot_predict", { grid: { gridX: 1, gridY: 1 } }),
    null,
    "missing playerId rejected",
  );
}

function testPlayerWatch() {
  assert.deepEqual(
    validatePayload("player_watch", { playerId: "30531" }),
    { playerId: "30531" },
    "valid watch pick accepted",
  );
  assert.equal(validatePayload("player_watch", { playerId: "" }), null, "empty playerId rejected");
  assert.equal(validatePayload("player_watch", { playerId: 30531 }), null, "numeric playerId rejected");
}

function testVersus() {
  // User-chosen pair: two players from opposite sides, ids in the payload.
  const ok = validatePayload("versus", { playerAId: "30531", playerBId: "443" });
  assert.ok(ok, "valid versus pair accepted");
  assert.deepEqual(ok, { playerAId: "30531", playerBId: "443" });

  assert.equal(
    validatePayload("versus", { playerAId: "30531", playerBId: "30531" }),
    null,
    "same-player duel rejected",
  );
  assert.equal(
    validatePayload("versus", { playerAId: "", playerBId: "443" }),
    null,
    "empty playerAId rejected",
  );
  assert.equal(validatePayload("versus", { playerAId: "30531" }), null, "missing playerBId rejected");
  assert.equal(validatePayload("versus", { playerAId: 30531, playerBId: 443 }), null, "numeric ids rejected");
}

function testCommon() {
  const mechanics = ["lineup", "shot_predict", "sub", "player_watch", "versus"] as const;
  for (const m of mechanics) {
    assert.equal(validatePayload(m, null), null, `${m}: null rejected`);
    assert.equal(validatePayload(m, "string"), null, `${m}: string rejected`);
    assert.equal(validatePayload(m, [1, 2]), null, `${m}: array rejected`);
  }
}

/**
 * Grid parity: every cell's centre classifies into exactly one of the 6
 * zones, the attacking-end cells land inside the box, and the stored pick
 * survives the server's grid->zone round trip (validate.ts -> shotGrid ->
 * shotZones). This is what keeps client preview and server adjudication in
 * agreement without sharing code.
 */
function testGridZoneParity() {
  const zones = new Set<string>();
  for (let gy = 0; gy < 4; gy++) {
    for (let gx = 0; gx < 6; gx++) {
      const c = cellCenter(gx, gy);
      zones.add(zoneForFieldPosition(c.x, c.y));
    }
  }
  assert.ok(zones.size <= 6, "cell centres classify into the six zones");
  assert.ok(zones.has("inside_center"), "attacking central cells are inside the box");

  // Attacking row (gy=0): central cells inside the box, edge cells fall
  // outside its width (near the touchlines).
  const topRow = [0, 1, 2, 3, 4, 5].map((gx) =>
    zoneForFieldPosition(cellCenter(gx, 0).x, cellCenter(gx, 0).y),
  );
  assert.equal(topRow[0], "outside_left", "attacking-left cell near the touchline");
  assert.equal(topRow[5], "outside_right", "attacking-right cell near the touchline");
  for (const z of topRow.slice(1, 5)) {
    assert.ok(z.startsWith("inside_"), `central attacking cell inside the box (got ${z})`);
  }

  // A stored pick maps through the same chain the resolver uses.
  const pick = validatePayload("shot_predict", { playerId: "1", grid: { gridX: 3, gridY: 0 } });
  assert.ok(pick && "grid" in pick, "pick validates");
  if (pick && "grid" in pick) {
    const c = cellCenter(pick.grid.gridX, pick.grid.gridY);
    assert.equal(
      zoneForFieldPosition(c.x, c.y),
      "inside_center",
      "central attacking pick = inside_center zone",
    );
  }

  // Coordinate mapping sanity retained from the legacy contract.
  const cell = cellFromFieldPosition(95, 50);
  assert.deepEqual(cell, { gridX: 3, gridY: 0 }, "field position maps to attacking-end cell");
}

export function runValidateTests(): void {
  testLineup();
  testSub();
  testShotPredict();
  testPlayerWatch();
  testVersus();
  testCommon();
  testGridZoneParity();
  console.log("  validate: every mechanic's schema, rejection paths and zone parity OK");
}
