/**
 * Pure client helpers. These live in `src/lib` with no DOM and no React, so the
 * zero-dependency runner can exercise them directly. They carry real rules:
 * contrast-aware ink (WCAG AA on arbitrary club colours), the "why did I get X"
 * breakdown rendering, and the club-picker grouping that decides which tab a
 * non-big-five side lands under.
 */
import { strict as assert } from "node:assert";
import { readableInk } from "../src/lib/colors.js";
import { breakdownItems } from "../src/lib/breakdown.js";
import {
  buildPickerGroups,
  teamsInGroup,
  OTHER_GROUP,
  INTERNATIONAL_GROUP,
} from "../src/lib/pickerGroups.js";
import { scopeRankDelta, viewerStanding } from "../src/lib/leaderboard.js";
import type { StringKey } from "../src/i18n/strings.js";
import type { Team } from "../src/types.js";

/** Club colours come from ESPN and range from near-black to pastel. */
function testReadableInk(): void {
  assert.equal(readableInk("#FFFFFF"), "#04100B", "dark ink on a light fill");
  assert.equal(readableInk("#F3F3F3"), "#04100B", "off-white still takes dark ink");
  assert.equal(readableInk("#000000"), "#FFFFFF", "white ink on a dark fill");
  assert.equal(readableInk("#99C5EA"), "#04100B", "the pastel that failed AA with white");
  assert.equal(readableInk(null), "#FFFFFF", "an unknown colour keeps white");
  assert.equal(readableInk("not-a-colour"), "#FFFFFF", "a malformed value never throws");
}

function testBreakdownItems(): void {
  assert.deepEqual(breakdownItems(null, "en"), [], "a missing payload draws nothing");
  assert.deepEqual(breakdownItems("{not json", "en"), [], "malformed JSON draws nothing");
  assert.deepEqual(breakdownItems("[1,2]", "en"), [], "an array is not a breakdown");

  const items = breakdownItems(
    JSON.stringify({ startersCorrect: 9, zoneExact: 1, zoneAdjacent: 0, aNewThing: 2 }),
    "en",
  );
  const byKey = Object.fromEntries(items.map((i) => [i.key, i]));

  assert.equal(byKey.startersCorrect.label, "Starters called right", "known keys are labelled");
  assert.equal(byKey.startersCorrect.value, "9", "score lines keep their number");
  assert.equal(byKey.startersCorrect.flag, false, "score lines are not flags");

  assert.equal(byKey.zoneExact.value, "✓", "a passed gate renders as a tick, not a 1");
  assert.equal(byKey.zoneAdjacent.value, "—", "a failed gate renders as a dash, not a 0");
  assert.equal(byKey.zoneExact.flag, true, "gates are flagged for quieter styling");

  assert.equal(byKey.aNewThing.label, "A New Thing", "an unknown key is humanized, not dropped");
  assert.equal(byKey.aNewThing.value, "2");

  const fa = breakdownItems(JSON.stringify({ startersCorrect: 9 }), "fa").at(0);
  assert.ok(fa && fa.label !== "Starters called right", "Persian gets its own label");
}

function testPickerGroups(): void {
  const t = ((key: string) => `T:${key}`) as unknown as (key: StringKey) => string;
  const localize = (name: string) => name;
  const groups = buildPickerGroups(
    [
      { slug: "eng.1", kind: "league", name: "Premier League" },
      { slug: "esp.1", kind: "league", name: "LaLiga" },
      { slug: "ned.1", kind: "league", name: "Eredivisie" },
      { slug: "eng.fa", kind: "cup", name: "FA Cup" },
    ],
    t,
    localize,
  );

  const values = groups.map((g) => g.value);
  assert.deepEqual(
    values,
    ["PL", "LL", "SA", "BL", "L1", "ned.1", OTHER_GROUP, INTERNATIONAL_GROUP],
    "big five first, then other leagues, then the catch-alls",
  );
  assert.ok(!values.includes("eng.1"), "a big-five comp is skipped by slug, never duplicated");
  assert.ok(!values.includes("eng.fa"), "cups are not picker league tabs");
  assert.equal(groups[5]?.label, "Eredivisie", "a promoted league uses its localized name");
  assert.equal(groups[6]?.label, "T:picker.otherClubs", "the catch-alls stay translated");
}

function testTeamsInGroup(): void {
  const teams = [
    { id: "1", groupKey: "PL" },
    { id: "2", groupKey: "ned.1" },
    { id: "3", groupKey: "PL" },
  ] as unknown as Team[];
  assert.deepEqual(
    teamsInGroup(teams, "PL").map((t) => t.id),
    ["1", "3"],
    "the tab keeps the server's order",
  );
  assert.deepEqual(teamsInGroup(teams, "other"), [], "an empty group is empty, not everything");
}

/**
 * The leaderboard summary: which of the two server fields wins for the
 * viewer's own line. Getting this wrong either hides the viewer's rank or
 * prints it twice (on-page row plus below-page row) — the bug the strip's
 * extraction replaced.
 */
function testViewerStanding(): void {
  assert.equal(viewerStanding([], null), null, "anonymous or unscored shows nothing");

  const rows = [
    { rank: 1, total: 90 },
    { rank: 2, total: 70, is_you: true },
  ];
  assert.deepEqual(
    viewerStanding(rows, { rank: 137, total: 12 }),
    { rank: 2, total: 70, belowPage: false },
    "an on-page row beats the below-page rank",
  );

  assert.deepEqual(
    viewerStanding([{ rank: 1, total: 90 }], { rank: 137, total: 12 }),
    { rank: 137, total: 12, belowPage: true },
    "a below-page rank is used when no row is the viewer's",
  );

  assert.equal(
    viewerStanding([{ rank: 1, total: 90 }], null),
    null,
    "no viewer row and no below-page rank means no strip",
  );
}

/**
 * Rank movement between two observations of the same board. The delta chip
 * is client-session honesty only: a scope switch or a repeat observation at
 * the same rank must produce nothing rather than a stale "up 3".
 */
function testScopeRankDelta(): void {
  assert.equal(scopeRankDelta(null, "global", 12), null, "first observation has no history");
  assert.equal(
    scopeRankDelta({ scope: "league:eng.1", rank: 4 }, "global", 3),
    null,
    "a scope change resets the delta",
  );
  assert.equal(
    scopeRankDelta({ scope: "global", rank: 12 }, "global", 12),
    null,
    "no movement means no chip",
  );
  assert.equal(
    scopeRankDelta({ scope: "global", rank: 12 }, "global", 9),
    3,
    "a lower rank number is a climb",
  );
  assert.equal(
    scopeRankDelta({ scope: "global", rank: 9 }, "global", 12),
    -3,
    "a higher rank number is a drop",
  );
}

export function runClientTests(): void {
  testReadableInk();
  testBreakdownItems();
  testPickerGroups();
  testTeamsInGroup();
  testViewerStanding();
  testScopeRankDelta();
  console.log(
    "  client: contrast ink, breakdown rendering, picker grouping, viewer standing and rank deltas OK",
  );
}
