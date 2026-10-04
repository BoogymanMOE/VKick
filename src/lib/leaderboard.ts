/**
 * The viewer's own standing on a leaderboard, as a pure function.
 *
 * The board endpoint is viewer-aware: a row carries `is_you` when the viewer
 * sits on the page, and `you` (rank + total, computed with the board's own
 * first-to-reach tiebreak) when they sit below it. The screen leads with this
 * one fact, so the rule governing which source wins lives here, with a test,
 * instead of inline in the render.
 */

export interface ViewerBoardRow {
  rank: number;
  total: number;
  is_you?: boolean;
}

export interface ViewerRank {
  rank: number;
  total: number;
}

export interface ViewerStanding {
  rank: number;
  total: number;
  /** True when the viewer is below the page limit and not shown in the list. */
  belowPage: boolean;
}

/**
 * Prefer the on-page row (it means the viewer is visible in the list); fall
 * back to the server-computed below-page rank. Returns null when the viewer
 * has no score, or when the board was read anonymously.
 */
export function viewerStanding(
  rows: ViewerBoardRow[],
  you: ViewerRank | null | undefined,
): ViewerStanding | null {
  const onBoard = rows.find((row) => row.is_you);
  if (onBoard) return { rank: onBoard.rank, total: onBoard.total, belowPage: false };
  if (you) return { rank: you.rank, total: you.total, belowPage: true };
  return null;
}
