/**
 * Client-side text matching for the search sheet: which characters of a
 * visible label match the typed query, so the sheet can highlight them.
 *
 * The server ranks with the same folding rules (case, accents, punctuation,
 * Arabic yeh/kaf → Persian) but the client only gets the finished strings.
 * Re-folding here is what keeps the bolded slice honest for "malaga" →
 * Málaga and for Persian names.
 */

const COMBINING = /[\u0300-\u036f]/g;

/** Case-, accent- and punctuation-insensitive form used on both sides. */
export function foldSearch(value: string): string {
  return value
    .normalize("NFD")
    .replace(COMBINING, "")
    .toLowerCase()
    .replace(/[\u064a\u0649]/g, "\u06cc")
    .replace(/\u0643/g, "\u06a9")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

export interface MatchRange {
  /** Index into `Array.from(text)` (code points, so emoji never split). */
  start: number;
  end: number;
}

/**
 * Character ranges of `text` that match any word of `query`. Folding can
 * change a character's length (NFD), so the search runs over a folded copy
 * that keeps a map back to the original code points. Overlapping hits merge,
 * and adjacent words stay as separate ranges so the gap between them is not
 * highlighted.
 */
export function matchRanges(text: string, query: string): MatchRange[] {
  const tokens = foldSearch(query).split(" ").filter(Boolean);
  if (tokens.length === 0) return [];

  const chars = Array.from(text);
  const folded: string[] = [];
  const startMap: number[] = [];
  const endMap: number[] = [];
  chars.forEach((char, index) => {
    for (const part of foldSearch(char)) {
      folded.push(part);
      startMap.push(index);
      endMap.push(index + 1);
    }
  });
  const haystack = folded.join("");

  const ranges: MatchRange[] = [];
  for (const token of tokens) {
    let from = 0;
    while (from <= haystack.length - token.length) {
      const at = haystack.indexOf(token, from);
      if (at === -1) break;
      ranges.push({ start: startMap[at], end: endMap[at + token.length - 1] });
      from = at + token.length;
    }
  }
  if (ranges.length === 0) return [];

  ranges.sort((a, b) => a.start - b.start);
  const merged: MatchRange[] = [];
  for (const range of ranges) {
    const last = merged[merged.length - 1];
    if (last && range.start <= last.end) last.end = Math.max(last.end, range.end);
    else merged.push({ ...range });
  }
  return merged;
}
