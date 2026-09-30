/**
 * Formation catalogue for the Lineup Predictor.
 *
 * A formation is the outfield lines back to front, always summing to 10 — the
 * same shape `server/predictions/validate.ts` enforces on submit
 * (`/^[1-5](-[1-5]){2,4}$/`, lines sum to 10). Everything here is pure so the
 * picker can validate a XI against a shape without touching the network, and
 * so the rules stay testable.
 *
 * The first outfield line is the defence, the last the attack, and anything
 * between is midfield: a 3-line "4-3-3" is DEF/MID/FWD, a 4-line "4-2-3-1" is
 * DEF/MID/MID/FWD.
 */

export type Unit = "GK" | "DEF" | "MID" | "FWD";

/** Units in the order the pitch draws them, back to front. */
export const UNITS: Unit[] = ["GK", "DEF", "MID", "FWD"];

/**
 * Where a player sits across the pitch. The coarse unit alone can't place
 * anyone: a 4-3-3 defence of four is a left-back, two centre-backs and a
 * right-back, and the granular ESPN abbreviation is the only thing that says
 * which is which.
 */
export type SlotSide = "left" | "center" | "right";

export interface SlotRole {
  unit: Unit;
  side: SlotSide;
}

export interface FormationShape {
  id: string;
  /** Outfield line sizes, back to front. Length 3-5, sums to 10. */
  lines: number[];
}

export const FORMATIONS: FormationShape[] = [
  { id: "4-3-3", lines: [4, 3, 3] },
  { id: "4-2-3-1", lines: [4, 2, 3, 1] },
  { id: "4-4-2", lines: [4, 4, 2] },
  { id: "3-5-2", lines: [3, 5, 2] },
  { id: "3-4-3", lines: [3, 4, 3] },
  { id: "3-4-2-1", lines: [3, 4, 2, 1] },
  { id: "4-1-4-1", lines: [4, 1, 4, 1] },
  { id: "4-3-1-2", lines: [4, 3, 1, 2] },
  { id: "4-4-1-1", lines: [4, 4, 1, 1] },
  { id: "5-3-2", lines: [5, 3, 2] },
  { id: "5-2-3", lines: [5, 2, 3] },
  { id: "3-3-4", lines: [3, 3, 4] },
];

/** Same rule as the server's validator, so the picker never offers a value the
 *  submit endpoint would reject. */
export function isValidFormationId(id: string): boolean {
  return /^[1-5](-[1-5]){2,4}$/.test(id) && id.split("-").reduce((a, b) => a + Number(b), 0) === 10;
}

export function getFormation(id: string): FormationShape {
  return FORMATIONS.find((f) => f.id === id) ?? FORMATIONS[0];
}

/** Which unit each outfield line belongs to, back to front. */
export function lineUnits(lines: number[]): Unit[] {
  const outfield: Unit[] = lines.map((_, index) => {
    if (index === 0) return "DEF";
    if (index === lines.length - 1) return "FWD";
    return "MID";
  });
  return ["GK", ...outfield];
}

/** How many of each unit a formation demands, e.g. { GK: 1, DEF: 4, MID: 3, FWD: 3 }. */
export function requiredUnits(formationId: string): Record<Unit, number> {
  const { lines } = getFormation(formationId);
  const units = lineUnits(lines);
  const counts: Record<Unit, number> = { GK: 1, DEF: 0, MID: 0, FWD: 0 };
  lines.forEach((size, index) => {
    counts[units[index + 1]] += size;
  });
  return counts;
}

export const XI_SIZE = 11;

/** ESPN's granular abbreviations, split into unit + side. */
const GRANULAR: Record<string, SlotRole> = {};
for (const abbr of ["LB", "LWB", "SW"]) GRANULAR[abbr] = { unit: "DEF", side: "left" };
for (const abbr of ["RB", "RWB"]) GRANULAR[abbr] = { unit: "DEF", side: "right" };
for (const abbr of ["CB", "CD", "D", "DEF", "CD-M", "CD-C"]) GRANULAR[abbr] = { unit: "DEF", side: "center" };
GRANULAR["CD-L"] = { unit: "DEF", side: "left" };
GRANULAR["CD-R"] = { unit: "DEF", side: "right" };

for (const abbr of ["LM", "LW", "AM-L", "W-L", "CM-L", "DM-L", "M-L", "LCM", "L"])
  GRANULAR[abbr] = { unit: "MID", side: "left" };
for (const abbr of ["RM", "RW", "AM-R", "W-R", "CM-R", "DM-R", "M-R", "RCM", "R"])
  GRANULAR[abbr] = { unit: "MID", side: "right" };
for (const abbr of ["CM", "AM", "DM", "CAM", "CDM", "M", "MID", "M-M", "M-C"])
  GRANULAR[abbr] = { unit: "MID", side: "center" };

for (const abbr of ["ST-L", "F-L", "CF-L"]) GRANULAR[abbr] = { unit: "FWD", side: "left" };
for (const abbr of ["ST-R", "F-R", "CF-R"]) GRANULAR[abbr] = { unit: "FWD", side: "right" };
for (const abbr of ["ST", "CF", "F", "FWD", "SS", "FW", "F-C"])
  GRANULAR[abbr] = { unit: "FWD", side: "center" };

for (const abbr of ["G", "GK", "GDP"]) GRANULAR[abbr] = { unit: "GK", side: "center" };

const SIDE_ORDER: Record<SlotSide, number> = { left: 0, center: 1, right: 2 };
const UNIT_ORDER: Record<Unit, number> = { GK: 0, DEF: 1, MID: 2, FWD: 3 };

/**
 * Granular position first, coarse unit as the fallback. A "SUB" or unknown
 * abbreviation lands in the middle of its unit rather than at a random edge.
 */
export function slotRoleFor(espnPosition: string | null | undefined, coarse: Unit): SlotRole {
  if (!espnPosition) return { unit: coarse, side: "center" };
  const key = String(espnPosition).trim().toUpperCase();
  const hit = GRANULAR[key];
  if (hit) return hit;
  if (key.includes("GK") || key.includes("GOALKEEPER")) return { unit: "GK", side: "center" };
  return { unit: coarse, side: "center" };
}

/** Minimal shape the placement helpers need, so they stay testable. */
export interface SlotCandidate {
  id: string;
  espnPosition: string | null;
  jersey: number | null;
  unit: Unit;
}

/**
 * How far up the pitch a role plays: 0 holding/deep, 1 normal, 2 most advanced.
 * This is what puts a defensive mid in the holding pair of a 4-2-3-1 and a
 * CAM in the attacking three — "centre of the pitch" alone can't tell them
 * apart, because ESPN files both as a central midfielder.
 */
export function advanceFor(espnPosition: string | null | undefined): number {
  const key = String(espnPosition ?? "")
    .trim()
    .toUpperCase();
  if (DEEP_ROLES.has(key)) return 0;
  if (ADVANCED_ROLES.has(key)) return 2;
  return 1;
}

const DEEP_ROLES = new Set([
  "DM",
  "CDM",
  "DM-L",
  "DM-R",
  "DM-M",
  "CB",
  "CD",
  "D",
  "DEF",
  "CD-L",
  "CD-R",
  "CD-M",
  "CD-C",
  "LB",
  "LWB",
  "SW",
  "G",
  "GK",
]);
const ADVANCED_ROLES = new Set([
  "AM",
  "CAM",
  "AM-L",
  "AM-R",
  "AM-M",
  "LW",
  "RW",
  "LM",
  "RM",
  "W-L",
  "W-R",
  "ST",
  "ST-L",
  "ST-R",
  "CF",
  "CF-L",
  "CF-R",
  "SS",
  "FW",
  "F",
  "FWD",
  "F-L",
  "F-R",
  "F-C",
]);

/** Left to right on the pitch, then by shirt number. */
export function orderForLine(candidates: SlotCandidate[]): SlotCandidate[] {
  return [...candidates].sort((a, b) => {
    const side =
      SIDE_ORDER[slotRoleFor(a.espnPosition, a.unit).side] -
      SIDE_ORDER[slotRoleFor(b.espnPosition, b.unit).side];
    if (side !== 0) return side;
    return (a.jersey ?? 99) - (b.jersey ?? 99);
  });
}

/**
 * Place a whole XI on the pitch, one row at a time.
 *
 * Placement is dealt per unit across *all* of that unit's rows, deepest band
 * first: a 4-2-3-1 gives the holding pair the two most defensive midfielders
 * and the attacking three what is left. Dealing row by row would hand the same
 * players to both bands.
 */
export function fillFormation(
  formationId: string,
  candidates: SlotCandidate[],
): Array<Array<SlotCandidate | null>> {
  const rows = pitchRows(formationId);
  const slots: Array<Array<SlotCandidate | null>> = rows.map((row) => new Array(row.size).fill(null));

  for (const unit of UNITS) {
    const rowIndexes = rows.map((row, index) => (row.unit === unit ? index : -1)).filter((i) => i >= 0);
    if (rowIndexes.length === 0) continue;

    // Deepest role first, then across the pitch, then shirt number.
    const pool = candidates
      .filter((c) => c.unit === unit)
      .sort((a, b) => {
        const depth = advanceFor(a.espnPosition) - advanceFor(b.espnPosition);
        if (depth !== 0) return depth;
        const side =
          SIDE_ORDER[slotRoleFor(a.espnPosition, a.unit).side] -
          SIDE_ORDER[slotRoleFor(b.espnPosition, b.unit).side];
        if (side !== 0) return side;
        return (a.jersey ?? 99) - (b.jersey ?? 99);
      });

    let next = 0;
    // Rows run attack -> keeper, so a unit's *last* row is its deepest band and
    // has to be dealt the deepest roles first.
    for (const rowIndex of [...rowIndexes].reverse()) {
      const size = rows[rowIndex].size;
      const taken = pool.slice(next, next + size);
      next += size;
      // Left to right for display, centred when the line isn't full.
      const ordered = orderForLine(taken);
      const start = Math.floor((size - ordered.length) / 2);
      ordered.forEach((player, i) => {
        slots[rowIndex][start + i] = player;
      });
    }
  }
  return slots;
}

/** One horizontal band of the pitch. */
export interface PitchRow {
  unit: Unit;
  size: number;
  /** true for the keeper's own box, drawn with a goal line. */
  goal: boolean;
}

/**
 * Pitch rows in draw order: attack at the top, the keeper's goal at the
 * bottom, which is how a shape is read when you build it up from your own goal.
 */
export function pitchRows(formationId: string): PitchRow[] {
  const { lines } = getFormation(formationId);
  const units = lineUnits(lines);
  return [
    ...lines.map((size, index) => ({ unit: units[index + 1], size, goal: false })).reverse(),
    { unit: "GK" as Unit, size: 1, goal: true },
  ];
}

/** Squad list order: unit, then across the pitch, then shirt number. */
export function compareSquad(a: SlotCandidate, b: SlotCandidate): number {
  const unit = UNIT_ORDER[a.unit] - UNIT_ORDER[b.unit];
  if (unit !== 0) return unit;
  const side =
    SIDE_ORDER[slotRoleFor(a.espnPosition, a.unit).side] -
    SIDE_ORDER[slotRoleFor(b.espnPosition, b.unit).side];
  if (side !== 0) return side;
  return (a.jersey ?? 99) - (b.jersey ?? 99);
}

/** A starting XI is submittable at 11 with exactly one keeper. */
export function isValidXI(picked: string[], positions: Map<string, Unit>): boolean {
  if (picked.length !== XI_SIZE) return false;
  const keepers = picked.filter((id) => positions.get(id) === "GK").length;
  return keepers === 1;
}

/** Per-unit picked vs required, for the pitch's counters and the shortfalls. */
export function unitTally(
  picked: string[],
  positions: Map<string, Unit>,
  formationId: string,
): Array<{ unit: Unit; picked: number; required: number }> {
  const required = requiredUnits(formationId);
  return UNITS.map((unit) => ({
    unit,
    picked: picked.filter((id) => positions.get(id) === unit).length,
    required: required[unit],
  }));
}
