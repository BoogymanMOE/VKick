/**
 * Recent searches: the queries a person actually committed (tapped a result,
 * or pressed Enter), newest first. Kept to a handful so the empty state stays
 * a shortcut row rather than a second results screen.
 */
export const MAX_RECENT_SEARCHES = 6;

/**
 * Append a committed query to the list. Duplicates are dropped
 * case-insensitively and the trimmed query keeps its original casing for
 * display. A too-short query (below the server's own two-character floor) is
 * not worth remembering and returns the input array unchanged.
 */
export function rememberSearch(recent: readonly string[], query: string): string[] {
  const term = query.trim().replace(/\s+/g, " ");
  if (term.length < 2) return recent as string[];
  const without = recent.filter((entry) => entry.toLowerCase() !== term.toLowerCase());
  return [term, ...without].slice(0, MAX_RECENT_SEARCHES);
}
