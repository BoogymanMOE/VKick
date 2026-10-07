/**
 * The YOU chip renders on the viewer's own leaderboard row and nowhere else.
 *
 * The bug this pins: the label was passed to every BoardRow unconditionally,
 * so a six-row board showed six YOU chips — the launch audit's DOM check read
 * "1 D Dev YOU 170 / 2 D Demo User 2 YOU 146 / …" for all six rows. The chip
 * condition inside BoardRow is `youLabel ? <Chip/> : null`, so counting the
 * projected views that carry a label is exactly counting the chips the board
 * would render.
 */
import { strict as assert } from "node:assert";
import { boardRowView, type ViewerBoardRow } from "../src/lib/leaderboard.js";

/** Six rows as the API hands them over — ranks 1…6, one of them the viewer. */
function sixRowBoard(viewerRank: number | null): ViewerBoardRow[] {
  const names = ["Dev", "Demo User 2", "Demo User 3", "Demo User 5", "Demo User 4", "Demo User 6"];
  return names.map((_, i) => ({
    rank: i + 1,
    total: 170 - i * 7,
    is_you: viewerRank === i + 1,
  }));
}

export async function runLeaderboardTests(): Promise<void> {
  // 1. The audit's board: six rows, one is_you → exactly ONE chip, on that row.
  {
    const rows = sixRowBoard(2);
    const views = rows.map((row) => boardRowView(row, "You"));
    const chips = views.filter((v) => v.youLabel !== undefined);
    assert.equal(chips.length, 1, `expected exactly one YOU chip, got ${chips.length}`);
    assert.equal(views[1]!.youLabel, "You", "the chip must sit on the viewer's own row");
    assert.equal(views[1]!.highlight, true, "the viewer's row is the highlighted one");
    // Nobody else's row claims to be the viewer.
    for (const [i, view] of views.entries()) {
      if (i === 1) continue;
      assert.equal(view.youLabel, undefined, `row ${i + 1} must not carry a YOU chip`);
      assert.equal(view.highlight, false, `row ${i + 1} must not be highlighted`);
    }
  }

  // 2. Viewer below the page (server marks no row) → zero chips anywhere.
  {
    const views = sixRowBoard(null).map((row) => boardRowView(row, "You"));
    assert.equal(
      views.filter((v) => v.youLabel !== undefined).length,
      0,
      "an unmarked board renders no YOU chips",
    );
  }

  // 3. The exact regression: even when every other prop is identical, the
  //    label only materialises for is_you — never from position or rank.
  {
    const views = sixRowBoard(1).map((row) => boardRowView(row, "تو"));
    assert.deepEqual(
      views.map((v) => v.youLabel),
      ["تو", undefined, undefined, undefined, undefined, undefined],
      "only row 1 carries the label (FA copy included)",
    );
  }

  console.log("  leaderboard YOU chip: one row, one chip OK");
}
