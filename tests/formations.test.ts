/**
 * Formation logic for the Lineup Predictor. The picker's shape checks and the
 * server's submit validation have to agree, so these tests pin both sides of
 * that contract: every catalogue entry passes the server's rule, and the
 * per-unit requirements always add up to a legal starting XI.
 */
import { strict as assert } from "node:assert";
import {
  FORMATIONS,
  XI_SIZE,
  compareSquad,
  fillFormation,
  getFormation,
  isValidFormationId,
  isValidXI,
  lineUnits,
  pitchRows,
  requiredUnits,
  slotRoleFor,
  unitTally,
  type SlotCandidate,
  type Unit,
} from "../src/lib/formations.js";

/** Every offered formation would survive the submit endpoint. */
function testCatalogueIsSubmittable(): void {
  const ids = FORMATIONS.map((f) => f.id);
  assert.equal(new Set(ids).size, ids.length, "no duplicate formation ids");
  for (const f of FORMATIONS) {
    assert.ok(isValidFormationId(f.id), `${f.id} passes the server formation rule`);
    assert.ok(f.lines.length >= 3 && f.lines.length <= 5, `${f.id} has 3-5 outfield lines`);
    assert.equal(
      f.lines.reduce((a, b) => a + b, 0),
      10,
      `${f.id} outfield lines sum to 10`,
    );
  }
}

/** Nonsense shapes are rejected the same way the server rejects them. */
function testValidation(): void {
  assert.ok(!isValidFormationId("4-3"), "two lines is not a formation");
  assert.ok(!isValidFormationId("4-3-2"), "4-3-2 is 9 outfielders");
  assert.ok(!isValidFormationId("4-3-4"), "4-3-4 is 11 outfielders");
  assert.ok(!isValidFormationId("6-2-2"), "no line may be 6");
  assert.ok(!isValidFormationId(""), "empty string is not a formation");
  assert.ok(isValidFormationId("5-3-1-1"), "five lines is legal");
}

/** Back line is defence, last line is attack, everything between is midfield. */
function testLineUnits(): void {
  assert.deepEqual(lineUnits([4, 3, 3]), ["GK", "DEF", "MID", "FWD"], "three lines");
  assert.deepEqual(
    lineUnits([4, 2, 3, 1]),
    ["GK", "DEF", "MID", "MID", "FWD"],
    "four lines, two midfield bands",
  );
  assert.deepEqual(lineUnits([5, 3, 1, 1]), ["GK", "DEF", "MID", "MID", "FWD"], "5-3-1-1");
  assert.deepEqual(
    lineUnits([3, 2, 2, 2, 1]),
    ["GK", "DEF", "MID", "MID", "MID", "FWD"],
    "five lines, three midfield bands",
  );
}

/** The per-unit requirements are what the pitch counters and validation use. */
function testRequiredUnits(): void {
  assert.deepEqual(requiredUnits("4-3-3"), { GK: 1, DEF: 4, MID: 3, FWD: 3 }, "4-3-3");
  assert.deepEqual(requiredUnits("4-2-3-1"), { GK: 1, DEF: 4, MID: 5, FWD: 1 }, "two midfield bands merge");
  assert.deepEqual(requiredUnits("3-4-2-1"), { GK: 1, DEF: 3, MID: 6, FWD: 1 }, "3-4-2-1");
  for (const f of FORMATIONS) {
    const r = requiredUnits(f.id);
    assert.equal(r.GK + r.DEF + r.MID + r.FWD, XI_SIZE, `${f.id} requires exactly 11`);
  }
  assert.deepEqual(getFormation("nonsense").id, FORMATIONS[0].id, "unknown id falls back to the default");
}

function positionsOf(...units: Array<[id: string, unit: Unit]>): Map<string, Unit> {
  return new Map(units);
}

/** A starting XI needs 11 names and exactly one keeper. */
function testXIRules(): void {
  const eleven: Array<[string, Unit]> = [["gk", "GK"]];
  for (let i = 0; i < 4; i++) eleven.push([`d${i}`, "DEF"]);
  for (let i = 0; i < 3; i++) eleven.push([`m${i}`, "MID"]);
  for (let i = 0; i < 3; i++) eleven.push([`f${i}`, "FWD"]);
  const map = positionsOf(...eleven);
  const ids = eleven.map(([id]) => id);

  assert.ok(isValidXI(ids, map), "4-3-3 shaped XI is valid");
  assert.ok(!isValidXI(ids.slice(0, 10), map), "ten names is not an XI");
  assert.ok(!isValidXI([...ids, "f9"], map), "twelve names is not an XI");
  assert.ok(!isValidXI([...ids.filter((id) => id !== "gk"), "f9"], map), "no goalkeeper");
  const twoKeepers = ids.map((id) => (id === "d0" ? "gk2" : id));
  assert.ok(!isValidXI(twoKeepers, positionsOf(...eleven, ["gk2", "GK"])), "two goalkeepers");
  // A legal XI that doesn't match the chosen shape is still submittable — the
  // shape mismatch is a warning in the picker, not a hard block.
  const flat = ids.filter((id) => id !== "gk");
  assert.ok(isValidXI(["gk", ...flat], map), "shape mismatch does not block submit");
}

/** The pitch counters read picked-vs-required per unit. */
function testUnitTally(): void {
  const eleven: Array<[string, Unit]> = [["gk", "GK"]];
  for (let i = 0; i < 4; i++) eleven.push([`d${i}`, "DEF"]);
  for (let i = 0; i < 3; i++) eleven.push([`m${i}`, "MID"]);
  for (let i = 0; i < 3; i++) eleven.push([`f${i}`, "FWD"]);
  const map = positionsOf(...eleven);

  const tallied = unitTally(["gk", "d0", "d1"], map, "4-3-3");
  assert.deepEqual(
    tallied.map((t) => `${t.unit} ${t.picked}/${t.required}`),
    ["GK 1/1", "DEF 2/4", "MID 0/3", "FWD 0/3"],
    "counters read against the chosen formation",
  );
  const full = unitTally(
    eleven.map(([id]) => id),
    map,
    "4-3-3",
  );
  assert.ok(
    full.every((t) => t.picked === t.required),
    "a matching XI satisfies every counter",
  );
}

/** Granular positions decide who stands where on the pitch. */
function testSlotRoles(): void {
  assert.deepEqual(slotRoleFor("LB", "DEF"), { unit: "DEF", side: "left" }, "left-back");
  assert.deepEqual(slotRoleFor("RB", "DEF"), { unit: "DEF", side: "right" }, "right-back");
  assert.deepEqual(slotRoleFor("CB", "DEF"), { unit: "DEF", side: "center" }, "centre-back");
  assert.deepEqual(slotRoleFor("CD-L", "DEF"), { unit: "DEF", side: "left" }, "granular centre-left");
  assert.deepEqual(slotRoleFor("CM", "MID"), { unit: "MID", side: "center" }, "central mid");
  assert.deepEqual(slotRoleFor("AM-R", "MID"), { unit: "MID", side: "right" }, "attacking mid right");
  assert.deepEqual(
    slotRoleFor("LW", "MID"),
    { unit: "MID", side: "left" },
    "winger stays a mid in the coarse unit",
  );
  assert.deepEqual(slotRoleFor("ST", "FWD"), { unit: "FWD", side: "center" }, "striker");
  assert.deepEqual(slotRoleFor("ST-R", "FWD"), { unit: "FWD", side: "right" }, "right striker");
  assert.deepEqual(slotRoleFor("G", "GK"), { unit: "GK", side: "center" }, "keeper");
  // Unknown or a role marker stays in the middle of its own unit.
  assert.deepEqual(slotRoleFor("SUB", "DEF"), { unit: "DEF", side: "center" }, "SUB keeps the coarse unit");
  assert.deepEqual(slotRoleFor(null, "MID"), { unit: "MID", side: "center" }, "no abbreviation");
}

const c = (id: string, espnPosition: string | null, jersey: number | null, unit: Unit): SlotCandidate => ({
  id,
  espnPosition,
  jersey,
  unit,
});

/** The pitch draws attack at the top and the keeper's goal at the bottom. */
function testPitchRows(): void {
  const rows = pitchRows("4-3-3");
  assert.deepEqual(
    rows.map((r) => `${r.unit}${r.size}`),
    ["FWD3", "MID3", "DEF4", "GK1"],
    "attack first, keeper last",
  );
  assert.equal(rows[rows.length - 1].goal, true, "the keeper's row is the goal line");
  assert.equal(rows.filter((r) => r.goal).length, 1, "exactly one goal line");
  for (const f of FORMATIONS) {
    const drawn = pitchRows(f.id);
    const sizes = drawn.filter((r) => r.unit !== "GK").reduce((a, r) => a + r.size, 0);
    assert.equal(sizes, 10, `${f.id} draws 10 outfield slots`);
    assert.equal(drawn[0].unit, "FWD", `${f.id} starts at the attack`);
  }
  const deep = pitchRows("4-2-3-1");
  assert.deepEqual(
    deep.map((r) => `${r.unit}${r.size}`),
    ["FWD1", "MID3", "MID2", "DEF4", "GK1"],
    "the deeper midfield band is drawn below the attacking one",
  );
}

/** A full back four is ordered left-back, two centre-backs, right-back. */
function testFillLine(): void {
  const rows = fillFormation("4-3-3", [
    c("gk", "G", 1, "GK"),
    c("st", "ST", 9, "FWD"),
    c("st2", "ST-R", 11, "FWD"),
    c("st3", "ST-L", 7, "FWD"),
    c("rb", "RB", 2, "DEF"),
    c("cb1", "CB", 5, "DEF"),
    c("cb2", "CB", 4, "DEF"),
    c("lb", "LB", 66, "DEF"),
  ]);
  // Draw order is attack -> keeper, so the defence row is index 2.
  assert.deepEqual(
    rows[2].map((p) => p?.id ?? "-"),
    ["lb", "cb2", "cb1", "rb"],
    "left-back left, right-back right, shirt number among equals",
  );
  assert.deepEqual(
    rows[0].map((p) => p?.id ?? "-"),
    ["st3", "st", "st2"],
    "attackers sit by side too",
  );
  assert.deepEqual(
    rows[3].map((p) => p?.id ?? "-"),
    ["gk"],
    "keeper last",
  );

  // A squad of five defenders only fits four; the odd one is left out.
  const crowded = fillFormation("4-3-3", [
    c("gk", "G", 1, "GK"),
    c("rb", "RB", 2, "DEF"),
    c("cb1", "CB", 5, "DEF"),
    c("cb2", "CB", 4, "DEF"),
    c("lb", "LB", 66, "DEF"),
    c("fifth", "CB", 3, "DEF"),
  ]);
  const placed = crowded[2].filter(Boolean).map((p) => p.id);
  assert.equal(placed.length, 4, "a four-line holds four");
  assert.ok(!placed.includes("rb"), "the least deep role is left out of a crowded back four");
}

/** A part-filled line is centred, and each player appears exactly once. */
function testFillFormationPlacement(): void {
  const partial = fillFormation("4-3-3", [c("cb1", "CB", 5, "DEF"), c("cb2", "CB", 4, "DEF")]);
  assert.deepEqual(
    partial[2].map((p) => p?.id ?? "-"),
    ["-", "cb2", "cb1", "-"],
    "two centre-backs sit in the middle, shirt number left to right",
  );

  const squad = [
    c("gk", "G", 1, "GK"),
    c("lb", "LB", 3, "DEF"),
    c("cb1", "CB", 5, "DEF"),
    c("cb2", "CB", 4, "DEF"),
    c("rb", "RB", 2, "DEF"),
    c("dm", "DM", 6, "MID"),
    c("cm", "CM", 8, "MID"),
    c("am", "CAM", 10, "MID"),
    c("lw", "LW", 11, "MID"),
    c("rw", "RW", 7, "MID"),
    c("st", "ST", 9, "FWD"),
  ];
  const rows = fillFormation("4-2-3-1", squad);
  const ids = rows
    .flat()
    .filter(Boolean)
    .map((p) => p.id);
  assert.equal(new Set(ids).size, ids.length, "no player is drawn twice");
  assert.equal(ids.length, 11, "an XI fills every slot once");

  // Draw order: FWD1, MID3, MID2, DEF4, GK1.
  assert.deepEqual(
    rows[1].map((p) => p?.id ?? "-"),
    ["lw", "am", "rw"],
    "the attacking three",
  );
  assert.deepEqual(
    rows[2].map((p) => p?.id ?? "-"),
    ["dm", "cm"],
    "the holding pair takes the defensive mids",
  );
}

/** The squad list reads in the same order the pitch does. */
function testCompareSquad(): void {
  const sorted = [
    c("gk", "G", 1, "GK"),
    c("rb", "RB", 2, "DEF"),
    c("cb", "CB", 5, "DEF"),
    c("lb", "LB", 3, "DEF"),
    c("st", "ST", 9, "FWD"),
    c("cm", "CM", 8, "MID"),
  ].sort(compareSquad);
  assert.deepEqual(
    sorted.map((p) => p.id),
    ["gk", "lb", "cb", "rb", "cm", "st"],
    "unit, then across the pitch",
  );
}

export function runFormationTests(): void {
  testCatalogueIsSubmittable();
  testValidation();
  testLineUnits();
  testRequiredUnits();
  testXIRules();
  testUnitTally();
  testSlotRoles();
  testPitchRows();
  testFillLine();
  testFillFormationPlacement();
  testCompareSquad();
  console.log(`  formations: ${FORMATIONS.length} shapes, unit mapping, XI rules, slot placement OK`);
}
