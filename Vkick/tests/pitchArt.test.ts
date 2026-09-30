/**
 * The drawn pitch geometry: the penalty and corner arc helpers are pure maths
 * both the live and replay surfaces paint with, so pin the shape here (valid
 * SVG path, points inside the surface, bulge facing the right way) rather than
 * eyeballing the render.
 */
import { strict as assert } from "node:assert";
import {
  TACTICAL_VIEWPORT,
  cornerArcPath,
  lineupSlots,
  penaltyArcPath,
  project,
} from "../src/lib/pitchView.js";
import type { LineupPlayer, Position } from "../src/types.js";

const VP = TACTICAL_VIEWPORT;
const ARC = /^M [\d.-]+,[\d.-]+ A [\d.]+ [\d.]+ 0 0 [01] [\d.-]+,[\d.-]+$/;

/** Pull every "x,y" pair out of a path string (arc flags have no commas). */
function pointsOf(path: string): Array<{ x: number; y: number }> {
  return [...path.matchAll(/(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/g)].map((m) => ({
    x: Number(m[1]),
    y: Number(m[2]),
  }));
}

function assertInBounds(path: string, label: string): Array<{ x: number; y: number }> {
  const pts = pointsOf(path);
  assert.equal(pts.length, 2, `${label} has exactly two endpoints`);
  for (const p of pts) {
    assert.ok(p.x >= -0.01 && p.x <= VP.width + 0.01, `${label} x ${p.x} stays inside the surface`);
    assert.ok(p.y >= -0.01 && p.y <= VP.height + 0.01, `${label} y ${p.y} stays inside the surface`);
  }
  return pts;
}

/** The 9.15m arc sits at the penalty-area edge and bulges away from the goal. */
function testPenaltyArc(): void {
  for (const side of ["home", "away"] as const) {
    const path = penaltyArcPath(side);
    assert.match(path, ARC, `${side} penalty arc is a well-formed SVG path`);
    const pts = assertInBounds(path, `${side} penalty arc`);
    const spotX = project(side === "home" ? 0.11 : 0.89, 0.5).x;
    for (const p of pts) {
      // The arc's ends lie beyond the spot, toward the centre circle.
      if (side === "home") assert.ok(p.x > spotX, "home arc bulges toward the centre");
      else assert.ok(p.x < spotX, "away arc bulges toward the centre");
    }
  }
}

/** Every 1m corner arc meets both lines at its corner without leaving the pitch. */
function testCornerArcs(): void {
  const corners: Array<[0 | 1, 0 | 1]> = [
    [0, 0],
    [0, 1],
    [1, 0],
    [1, 1],
  ];
  for (const [cx, cy] of corners) {
    const path = cornerArcPath(cx, cy);
    assert.match(path, ARC, `corner ${cx},${cy} is a well-formed arc`);
    const pts = assertInBounds(path, `corner ${cx},${cy}`);
    const corner = project(cx, cy);
    assert.ok(
      pts.some((p) => Math.abs(p.x - corner.x) < 0.01),
      `corner ${cx},${cy} meets the goal line`,
    );
    assert.ok(
      pts.some((p) => Math.abs(p.y - corner.y) < 0.01),
      `corner ${cx},${cy} meets the touchline`,
    );
  }
}

const p = (
  id: string,
  position: Position,
  number: number,
  espnPosition: string | null = null,
): LineupPlayer => ({ id, name: id, position, number, espnPosition });

/** A 4-2-3-1 drawn on the replay pitch: four real bands, not flat lines. */
function testLineupSlotsRealFormation(): void {
  const lineup = {
    formation: "4-2-3-1",
    coach: "",
    subs: [],
    starters: [
      p("gk", "GK", 1),
      p("lb", "DEF", 3, "LB"),
      p("cb1", "DEF", 5, "CB"),
      p("cb2", "DEF", 4, "CB"),
      p("rb", "DEF", 2, "RB"),
      p("dm1", "MID", 6, "DM"),
      p("dm2", "MID", 8, "DM"),
      p("lw", "MID", 11, "LW"),
      p("am", "MID", 10, "CAM"),
      p("rw", "MID", 7, "RW"),
      p("st", "FWD", 9, "ST"),
    ],
  };
  const home = lineupSlots(lineup, "home");
  assert.equal(Object.keys(home).length, 11, "every starter gets a slot");

  // Four separate outfield bands, deepest first: GK < DEF < holding mid <
  // attacking mid < striker. Flat lines would only produce three.
  assert.ok(home.gk.lx < home.cb1.lx, "keeper sits deepest");
  assert.ok(home.cb1.lx < home.dm1.lx, "defence sits behind the holding pair");
  assert.ok(home.dm1.lx < home.am.lx, "the 4-2-3-1 draws two midfield bands");
  assert.ok(home.am.lx < home.st.lx, "the loan striker is the most advanced");

  // Within a line, the granular role decides the side of the pitch.
  assert.ok(home.lb.ly < home.rb.ly, "left-back stands left of right-back");
  assert.ok(home.lw.ly < home.rw.ly, "left winger stands left of right winger");
  assert.ok(home.dm1.ly !== home.dm2.ly, "the holding pair is spread, not stacked");

  // Away mirrors along the length so they attack the other way.
  const away = lineupSlots(lineup, "away");
  for (const id of Object.keys(home)) {
    assert.ok(Math.abs(away[id].lx - (1 - home[id].lx)) < 1e-9, `${id} mirrors for the away side`);
  }
}

/** No usable formation keeps the old flat-line fallback, never a blank pitch. */
function testLineupSlotsFallback(): void {
  const lineup = {
    formation: "",
    coach: "",
    subs: [],
    starters: [p("gk", "GK", 1), p("d1", "DEF", 2), p("d2", "DEF", 3), p("m1", "MID", 4), p("f1", "FWD", 9)],
  };
  const slots = lineupSlots(lineup, "home");
  assert.equal(Object.keys(slots).length, 5, "the fallback still places everyone");
  assert.ok(slots.gk.lx < slots.d2.lx && slots.d2.lx < slots.m1.lx, "flat lines stay in order");
}

export function runPitchArtTests(): void {
  testPenaltyArc();
  testCornerArcs();
  testLineupSlotsRealFormation();
  testLineupSlotsFallback();
  console.log("  pitchArt: arcs in bounds + formation slots (real shape and fallback) OK");
}
