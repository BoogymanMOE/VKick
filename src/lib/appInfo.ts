/** Injected at build time by vite.config `define` (package.json version). */
export const APP_VERSION: string = __APP_VERSION__;

/**
 * Which build this bundle is, for the "did Telegram actually load the new
 * deploy?" question. Read from the build, not from the network: a client that
 * reports a commit older than the one you pushed is a cached bundle, full stop.
 */
export const APP_COMMIT: string = __APP_COMMIT__;

/** ISO timestamp of the build. Pairs with APP_COMMIT; not shown to users. */
export const APP_BUILT_AT: string = __APP_BUILT_AT__;

export interface ReleaseNote {
  version: string;
  date: string;
  /** Plain-language lines — never the developer changelog verbatim. */
  lines: string[];
  /** The same lines in Persian (strings.ts is per-UI, notes are per-release). */
  linesFa: string[];
}

/**
 * User-facing release notes, rewritten from CHANGELOG.md for players: the
 * rule changes and features they can actually see, minus the migration and
 * endpoint talk. Update together with CHANGELOG.md on each release.
 */
export const WHATS_NEW: ReleaseNote[] = [
  {
    version: "0.3.0",
    date: "2026-10-18",
    lines: [
      "Pick any day with the new date strip.",
      "Calmer match cards with clear live status.",
      "League tables now fit on your phone.",
    ],
    linesFa: [
      "با نوار روزها هر روزی را انتخاب کن.",
      "کارت‌های بازی آرام‌تر شدند؛ وضعیت زنده روشن است.",
      "جدول‌های لیگ حالا در گوشی جا می‌شوند.",
    ],
  },
  {
    version: "0.2.0",
    date: "2026-09-28",
    lines: [
      "Half-time now really locks sub calls — the break is the deadline.",
      "Pinned match comments arrived: drop a take on any minute, clips allowed.",
      "Season boards now use your unique @username, and highlight your row.",
      "Goal alerts respect your notification toggles for real.",
    ],
    linesFa: [
      "زمان تعویض‌ها با سوت نیمه قفل می‌شود — نیمه آخر مهلت است.",
      "نظرات سنجاق‌شده آمد: وقتی نظر بده، ویدیو هم مجاز است.",
      "تابلوهای فصل با @یوزرنیم یکتای خودت کار می‌کنند و ردیف تو برجسته است.",
      "هشدار گل واقعاً به کلیدهای اعلان‌های تو احترام می‌گذارد.",
    ],
  },
  {
    version: "0.1.0",
    date: "2026-09-01",
    lines: [
      "Vkick is live: follow your clubs, catch every matchday,",
      "and check every table as the season unfolds.",
    ],
    linesFa: [
      "وی‌کیک آمد: باشگاه‌هایت را دنبال کن، هیچ هفته‌ای را از دست نده",
      "و همه جدول‌ها را با پیش‌رفت فصل ببین.",
    ],
  },
];
