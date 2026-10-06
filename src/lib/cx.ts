/**
 * Class-name joiner for conditional Tailwind classes.
 *
 * Deliberately NOT in `components/ui.tsx`: React Fast Refresh only preserves
 * component state when a module exports nothing but components, and a shared
 * helper exported from the primitive kit invalidated that file's refresh
 * boundary on every edit — remounting every card, chip and button in dev.
 */
export const cx = (...parts: Array<string | false | null | undefined>) => parts.filter(Boolean).join(" ");
