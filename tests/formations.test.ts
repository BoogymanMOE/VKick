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
  balanceForFormation,
  compareSquad,
  fillFormation,
  fillRows,
  getFormation,
  isValidFormationId,
  isValidXI,
  lineUnits,
  pitchRows,
  pitchRowsFromUnits,
  placePublishedXI,
  requiredUnits,
  slotRoleFor,
  unitCounts,
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
  assert.deepEqual(requiredUnits("4-3-3"), { GK: 1, DEF: 4, MID: 3, FWD: 3, OTHER: 0 }, "4-3-3");
  assert.deepEqual(requiredUnits("4-2-3-1"), { GK: 1, DEF: 4, MID: 5, FWD: 1, OTHER: 0 }, "two midfield bands merge");
  assert.deepEqual(requiredUnits("3-4-2-1"), { GK: 1, DEF: 3, MID: 6, FWD: 1, OTHER: 0 }, "3-4-2-1");
  for (const f of FORMATIONS) {
    const r = requiredUnits(f.id);
    assert.equal(r.GK + r.DEF + r.MID + r.FWD + r.OTHER, XI_SIZE, `${f.id} requires exactly 11`);
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

/** Same candidate, but with ESPN's formation slot instead of a shirt number. */
const p = (id: string, espnPosition: string | null, formationPlace: string, unit: Unit): SlotCandidate => ({
  id,
  espnPosition,
  jersey: null,
  unit,
  formationPlace,
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

/**
 * The published-XI pitch draws from the shape ESPN sent, and from what the XI
 * actually contains when ESPN sent no usable shape — the fallback exists so a
 * leaked lineup still renders a full XI instead of an empty pitch.
 */
function testDerivedRows(): void {
  assert.deepEqual(
    pitchRowsFromUnits({ GK: 1, DEF: 4, MID: 3, FWD: 3 }).map((r) => `${r.unit}${r.size}`),
    ["FWD3", "MID3", "DEF4", "GK1"],
    "same draw order as a 4-3-3's own rows",
  );
  const fiveMid = pitchRowsFromUnits({ GK: 1, DEF: 4, MID: 5, FWD: 1 });
  assert.deepEqual(
    fiveMid.map((r) => `${r.unit}${r.size}`),
    ["FWD1", "MID5", "DEF4", "GK1"],
    "a five-man midfield keeps all five in one band",
  );
  assert.equal(fiveMid[fiveMid.length - 1].goal, true, "the keeper's row is still the goal line");
  // A unit nobody plays in simply has no row — never an empty band on the pitch.
  assert.deepEqual(
    pitchRowsFromUnits({ GK: 1, DEF: 3, MID: 4, FWD: 0 }).map((r) => r.unit),
    ["MID", "DEF", "GK"],
    "no attack row for a squad with no forwards",
  );
}

/** fillRows is fillFormation without the catalogue: same placement rules. */
function testFillRows(): void {
  const squad = [
    c("gk", "G", 1, "GK"),
    c("lb", "LB", 3, "DEF"),
    c("cb1", "CB", 5, "DEF"),
    c("rb", "RB", 2, "DEF"),
    c("cm1", "CM", 8, "MID"),
    c("cm2", "CM", 6, "MID"),
    c("cm3", "CM", 10, "MID"),
    c("st1", "ST", 9, "FWD"),
    c("st2", "ST", 11, "FWD"),
    c("st3", "ST", 7, "FWD"),
  ];
  const derived = pitchRowsFromUnits(unitCounts(squad));
  assert.deepEqual(
    fillRows(derived, squad)
      .flat()
      .filter(Boolean)
      .map((p) => p.id),
    ["st3", "st1", "st2", "cm2", "cm1", "cm3", "lb", "cb1", "rb", "gk"],
    "drawn attack to keeper, left to right inside each line",
  );
  // Every player lands in exactly one slot.
  const placed = fillRows(derived, squad).flat().filter(Boolean);
  assert.equal(new Set(placed.map((x) => x.id)).size, placed.length, "nobody is drawn twice");
}

/**
 * A published 4-3-3 arrives from ESPN as five midfielders and one forward —
 * the wingers wear the MID unit. Drawn as-is, two starters vanish; the shape
 * rebalance moves the advanced ones up front, where the shape has room.
 */
function testPublishedShape(): void {
  const published433 = [
    c("gk", "G", 1, "GK"),
    c("lb", "LB", 3, "DEF"),
    c("cb1", "CB", 5, "DEF"),
    c("cb2", "CB", 4, "DEF"),
    c("rb", "RB", 2, "DEF"),
    c("cdm", "CDM", 6, "MID"),
    c("cm1", "CM", 8, "MID"),
    c("cm2", "CM", 10, "MID"),
    c("lw", "LW", 11, "MID"),
    c("rw", "RW", 7, "MID"),
    c("st", "ST", 9, "FWD"),
  ];

  const drawn = placePublishedXI("4-3-3", published433);
  assert.deepEqual(
    drawn.rows.map((r) => `${r.unit}${r.size}`),
    ["FWD3", "MID3", "DEF4", "GK1"],
    "the named shape is used once the units are rebalanced",
  );
  const slots = drawn.slots;
  const placed = slots.flat().filter(Boolean);
  assert.equal(placed.length, 11, "every starter is on the pitch");
  assert.deepEqual(
    slots[0].map((p) => p?.id ?? "-"),
    ["lw", "st", "rw"],
    "the wide men stand in the front three, on their own sides",
  );
  assert.deepEqual(
    slots[1].map((p) => p?.id ?? "-"),
    ["cdm", "cm1", "cm2"],
    "the central trio keeps the midfield band",
  );

  // A shape the XI already fits is left alone — no spurious promotions.
  const balanced = balanceForFormation("4-2-3-1", [
    c("cdm", "CDM", 6, "MID"),
    c("cm", "CM", 8, "MID"),
    c("lw", "LW", 11, "MID"),
    c("am", "CAM", 10, "MID"),
    c("rw", "RW", 7, "MID"),
    c("st", "ST", 9, "FWD"),
  ]);
  assert.deepEqual(
    unitCounts(balanced),
    { GK: 0, DEF: 0, MID: 5, FWD: 1, OTHER: 0 },
    "a 4-2-3-1's five midfielders stay midfielders",
  );

  // A plain central midfielder is never promoted, however many there are.
  const allCentral = balanceForFormation("4-3-3", [
    c("cm1", "CM", 8, "MID"),
    c("cm2", "CM", 10, "MID"),
    c("cm3", "CM", 6, "MID"),
    c("cm4", "CM", 4, "MID"),
  ]);
  assert.deepEqual(unitCounts(allCentral), { GK: 0, DEF: 0, MID: 4, FWD: 0, OTHER: 0 }, "plain midfielders stay grouped");
}

/** Rows always hold every candidate, whatever the shape says. */
function testPublishedRowsNeverDrop(): void {
  for (const shape of ["", "nonsense", "4-3-3", "3-5-2", "4-2-3-1", "5-3-2"]) {
    const squad = [
      c("gk", "G", 1, "GK"),
      c("lb", "LB", 3, "DEF"),
      c("cb1", "CB", 5, "DEF"),
      c("cb2", "CB", 4, "DEF"),
      c("cb3", "CB", 15, "DEF"),
      c("rb", "RB", 2, "DEF"),
      c("cdm", "CDM", 6, "MID"),
      c("cm", "CM", 8, "MID"),
      c("lm", "LM", 11, "MID"),
      c("rm", "RM", 7, "MID"),
      c("st", "ST", 9, "FWD"),
    ];
    const counts = unitCounts(squad);
    const required = requiredUnits("4-3-3");
    const fitted = balanceForFormation("4-3-3", squad);
    const drawn = placePublishedXI(shape, squad);
    // The hand-made squad above never matches a catalogue shape exactly, so the
    // derived rows are the ones that must survive.
    assert.equal(
      drawn.rows.reduce((a, r) => a + r.size, 0),
      11,
      `${shape}: 11 slots`,
    );
    assert.equal(
      new Set(
        drawn.slots
          .flat()
          .filter(Boolean)
          .map((p) => p.id),
      ).size,
      11,
      `${shape}: all eleven placed`,
    );
    assert.ok(counts.DEF === 5 && required.DEF === 4, "the fixture really is a mismatch");
    assert.equal(unitCounts(fitted).DEF, 5, "defenders are never rearranged");
  }
}

/** ESPN's formation slot orders a line when the feed has no granular roles. */
function testFormationPlaceTiebreak(): void {
  // Four plain defenders, slots 2-5: the slot decides the order, not the shirt.
  const plain = fillFormation("4-3-3", [
    p("d1", null, "2", "DEF"),
    p("d2", null, "3", "DEF"),
    p("d3", null, "4", "DEF"),
    p("d4", null, "5", "DEF"),
  ]);
  assert.deepEqual(
    plain[2].map((x) => x?.id ?? "-"),
    ["d1", "d2", "d3", "d4"],
    "formation slot is the tiebreaker once the side is resolved",
  );
  // A granular role still outranks the slot: the left-back stays left.
  const mixed = fillFormation("4-3-3", [
    c("lb", "LB", 66, "DEF"),
    { ...p("others", null, "2", "DEF"), jersey: 4 },
    { ...p("other2", null, "3", "DEF"), jersey: 5 },
  ]);
  assert.equal(mixed[2][0]?.id, "lb", "a real left-back keeps the left slot");
}

/** The squad list reads in the same order the pitch does. */
function testUnknownPositionsStayVisible(): void {
  const unknown = c("unknown", "MYSTERY", null, "OTHER");
  const placed = placePublishedXI("4-3-3", [unknown]);
  assert.equal(placed.rows.reduce((sum, row) => sum + row.size, 0), 1, "fallback category is drawn instead of dropped");
  assert.equal(placed.slots.flat().filter((player) => player?.id === "unknown").length, 1, "unknown player appears once");
}

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
  testDerivedRows();
  testPublishedShape();
  testPublishedRowsNeverDrop();
  testFillLine();
  testFillRows();
  testFillFormationPlacement();
  testFormationPlaceTiebreak();
  testCompareSquad();
  testUnknownPositionsStayVisible();
  console.log(`  formations: ${FORMATIONS.length} shapes, unit mapping, XI rules, slot placement OK`);
}
