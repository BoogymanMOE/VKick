import type { SVGProps } from "react";
import { cx } from "../lib/cx";

const base = (props: SVGProps<SVGSVGElement>) => ({
  width: 22,
  height: 22,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.8,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  "aria-hidden": true,
  ...props,
});

export const BallIcon = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 7.5l3.4 2.5-1.3 4h-4.2l-1.3-4z" />
    <path d="M12 3v4.5M20.5 9.6L15.4 10M18.2 19.2L14.1 14M5.8 19.2L9.9 14M3.5 9.6L8.6 10" />
  </svg>
);

export const ShirtIcon = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}>
    <path d="M9 3l3 2 3-2 4 2.5-1.5 4-2-.8V21H8.5V8.7l-2 .8L5 5.5z" />
  </svg>
);

export const StarIcon = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}>
    <path d="M12 3.5l2.7 5.6 6.1.8-4.4 4.2 1.1 6-5.5-3-5.5 3 1.1-6L3.2 9.9l6.1-.8z" />
  </svg>
);

export const TableIcon = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}>
    <path d="M4 5h16v5H4zM4 14h16v5H4zM9.5 5v5M15 14v5" />
  </svg>
);

export const ChartIcon = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}>
    <path d="M4 20V10M10 20V4M16 20v-7M22 20H2" />
  </svg>
);

export const UserIcon = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}>
    <circle cx="12" cy="8.5" r="3.5" />
    <path d="M5 20c.8-3.4 3.6-5.5 7-5.5s6.2 2.1 7 5.5" />
  </svg>
);

/** Edit affordance — Profile's rename-display-name action. */
export const PencilIcon = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)} width={16} height={16}>
    <path d="M17 3a2.83 2.83 0 114 4L7.5 20.5 2 22l1.5-5.5L17 3z" />
  </svg>
);

export const ChevronLeftIcon = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)} width={20} height={20}>
    <path d="M14.5 5.5L8 12l6.5 6.5" />
  </svg>
);

/**
 * Trailing disclosure / "go" chevron — points toward the end edge and mirrors
 * itself in RTL so it never points back at the content in Persian. The links
 * that used to wrap `ChevronLeftIcon` with `rtl:rotate-180` pointed the WRONG
 * way in LTR (a left chevron trailing a row reads as "back"), so this is the
 * one affordance for "opens something ahead".
 */
export const ChevronRightIcon = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)} width={18} height={18} className={cx("rtl:-scale-x-100", p.className)}>
    <path d="M9.5 5.5L16 12l-6.5 6.5" />
  </svg>
);

/** "Back" chevron that mirrors itself in RTL (flips to point right in Persian). */
export const ArrowIcon = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)} width={16} height={16} className={cx("rtl:-scale-x-100", p.className)}>
    <path d="M14.5 5.5L8 12l6.5 6.5" />
  </svg>
);

/** Disclosure chevron — collapsible section headers. Rotation carries the
 *  state, so it needs no RTL mirror: down = open, end = closed in both dirs. */
export const ChevronDownIcon = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)} width={16} height={16}>
    <path d="M5.5 8.5L12 15l6.5-6.5" />
  </svg>
);

export const GlobeIcon = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)} width={18} height={18}>
    <circle cx="12" cy="12" r="8.5" />
    <path d="M3.5 12h17M12 3.5c2.2 2.4 3.3 5.3 3.3 8.5S14.2 18.1 12 20.5c-2.2-2.4-3.3-5.3-3.3-8.5S9.8 5.9 12 3.5z" />
  </svg>
);

export const LockIcon = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)} width={16} height={16}>
    <rect x="5" y="10.5" width="14" height="9.5" rx="2" />
    <path d="M8.5 10.5V8a3.5 3.5 0 017 0v2.5" />
  </svg>
);

/** Warning — ErrorState. */
export const AlertIcon = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)} width={24} height={24}>
    <path d="M12 4.5L21 20H3z" />
    <path d="M12 10v4.5" />
    <path d="M12 17.2v.1" />
  </svg>
);

/** Flame — the streak widget's run icon (replaces the 🔥 emoji glyph so it
 *  draws in the shared icon weight and never shifts with the system font). */
export const FlameIcon = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)} width={16} height={16}>
    <path d="M12 2.5c3 3.2 5.5 5.6 5.5 9.3A5.5 5.5 0 0112 21.5 5.5 5.5 0 016.5 11.8c0-1.9 1-3.2 2-4.3.2 1.4 1 2 1 2S11 7 12 2.5z" />
  </svg>
);

/** Refresh — Matches' sync action. Replaces the ↻ glyph so the whole icon set
 *  shares one stroke weight and optical size. */
export const RefreshIcon = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)} width={18} height={18}>
    <path d="M20 12a8 8 0 11-2.4-5.7" />
    <path d="M20 4v4.5h-4.5" />
  </svg>
);

/** Add — the "pick another club" tile at the end of the My Teams strip. */
export const PlusIcon = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)} width={20} height={20}>
    <path d="M12 5v14M5 12h14" />
  </svg>
);

/** Swap — the Sub Board prediction. */
export const SwapIcon = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)} width={14} height={14}>
    <path d="M4 8.5h13m0 0l-3.5-3.5M17 8.5L13.5 12" />
    <path d="M20 15.5H7m0 0l3.5-3.5M7 15.5L10.5 19" />
  </svg>
);

/** Target — the Shot Predictor / prediction idea. */
export const TargetIcon = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)} width={24} height={24}>
    <circle cx="12" cy="12" r="8.5" />
    <circle cx="12" cy="12" r="4" />
    <circle cx="12" cy="12" r="0.6" fill="currentColor" />
  </svg>
);

/** Clock — the timeline's empty-state pictogram (was the ⏱ emoji). */
export const ClockIcon = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)} width={28} height={28}>
    <circle cx="12" cy="12" r="8.5" />
    <path d="M12 7v5l3.2 2" />
  </svg>
);

/** Info — the "How points work" entry point on Predictions and Boards. */
export const InfoIcon = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)} width={18} height={18}>
    <circle cx="12" cy="12" r="8.5" />
    <path d="M12 11.2v5" />
    <path d="M12 7.9v.1" />
  </svg>
);

/** Check — the "already picked" state in the club picker. */
export const CheckIcon = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)} width={16} height={16} strokeWidth={2.4}>
    <path d="M5 12.5l4.5 4.5L19 7.5" />
  </svg>
);

/** Close — remove a club from My Teams. */
export const CloseIcon = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)} width={12} height={12} strokeWidth={2.4}>
    <path d="M6 6l12 12M18 6L6 18" />
  </svg>
);

/** Share — the referral "Share to Telegram" action. */
export const ShareIcon = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)} width={18} height={18}>
    <path d="M12 3l4 4m-4-4L8 7m4-4v13" />
    <path d="M5 12v7a1.5 1.5 0 001.5 1.5h11A1.5 1.5 0 0019 19v-7" />
  </svg>
);

/**
 * Booking — the timeline's card mark. Filled with currentColor so the caller
 * decides which: --gold for a yellow, --danger for a red.
 */
export const CardIcon = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)} width={13} height={15} stroke="none">
    <rect x="6.5" y="3.5" width="10" height="14.5" rx="2" fill="currentColor" transform="rotate(-13 12 11)" />
  </svg>
);

/** Tables / list view icon — three horizontal lines. */
export const ListIcon = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}>
    <line x1="4" x2="20" y1="6" y2="6" />
    <line x1="4" x2="20" y1="12" y2="12" />
    <line x1="4" x2="20" y1="18" y2="18" />
  </svg>
);

/** Filled variant, for the "already your anchor club" state. */
export const StarFilledIcon = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)} width={12} height={12} fill="currentColor" strokeWidth={1.2}>
    <path d="M12 3.5l2.7 5.6 6.1.8-4.4 4.2 1.1 6-5.5-3-5.5 3 1.1-6L3.2 9.9l6.1-.8z" />
  </svg>
);
