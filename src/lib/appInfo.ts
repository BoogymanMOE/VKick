/** Injected at build time by vite.config `define` (package.json version). */
export const APP_VERSION: string = __APP_VERSION__;

export interface ReleaseNote {
  version: string;
  date: string;
  /** Plain-language lines — never the developer changelog verbatim. */
  lines: string[];
}

/**
 * User-facing release notes, rewritten from CHANGELOG.md for players: the
 * rule changes and features they can actually see, minus the migration and
 * endpoint talk. Update together with CHANGELOG.md on each release.
 */
export const WHATS_NEW: ReleaseNote[] = [
  {
    version: "0.2.0",
    date: "2026-09-28",
    lines: [
      "Half-time now really locks sub calls — the break is the deadline.",
      "Pinned match comments arrived: drop a take on any minute, clips allowed.",
      "Season boards now use your unique @username, and highlight your row.",
      "Goal alerts respect your notification toggles for real.",
    ],
  },
  {
    version: "0.1.0",
    date: "2026-09-01",
    lines: [
      "Vkick is live: follow your clubs, call every match before kickoff,",
      "rate the players after the whistle, and climb the season boards.",
    ],
  },
];
