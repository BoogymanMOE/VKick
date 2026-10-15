/**
 * "Did a pick just pay off?" — the one rule behind the match page's win
 * confetti, kept out of the component so it can be tested without a DOM.
 *
 * `previous` is the mechanic → status map observed on the render before this
 * one. `null` means this is the first payload of the session (a fresh mount),
 * and that must NEVER celebrate: opening a finished match whose picks already
 * resolved is not a win the user just watched happen, and re-reading the same
 * payload on a refetch must not shower the screen again.
 */
export interface ResolvedPick {
  mechanic: string;
  status: string;
  points_awarded: number;
}

export function justPaidOut(
  previous: ReadonlyMap<string, string> | null,
  rows: readonly ResolvedPick[],
): boolean {
  if (!previous) return false;
  return rows.some(
    (row) =>
      row.points_awarded > 0 &&
      (row.status === "correct" || row.status === "partial") &&
      previous.get(row.mechanic) !== row.status,
  );
}
