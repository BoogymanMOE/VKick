/**
 * Up to two initials from a player name — "Cole Palmer" → "CP", "Ronald" → "R".
 *
 * Lives here rather than next to `PlayerAvatar` so the zero-dependency test
 * runner can exercise it without pulling React in, and so `ui.tsx` stays a
 * components-only module for Fast Refresh.
 *
 * The result is rendered inside `<bdi>`, so an Arabic-script or Latin initial
 * isolates cleanly in either page direction. Splitting is whitespace-only, so
 * a non-Latin name takes the first letter of its first and last words
 * ("احمد مدنی" → "ام") rather than anything script-specific.
 */
export function initialsOf(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "?";
  const first = words[0]!.charAt(0);
  const last = words.length > 1 ? words[words.length - 1]!.charAt(0) : "";
  return (first + last).toUpperCase();
}
