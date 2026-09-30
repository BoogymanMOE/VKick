import type { SVGProps } from "react";
import { cx } from "./ui";

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

/** "Back" chevron that mirrors itself in RTL (flips to point right in Persian). */
export const ArrowIcon = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)} width={16} height={16} className={cx("rtl:-scale-x-100", p.className)}>
    <path d="M14.5 5.5L8 12l6.5 6.5" />
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

/** Play — Match Replay entry points. */
export const PlayIcon = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)} width={14} height={14}>
    <path d="M7 4.5l12 7.5-12 7.5z" />
  </svg>
);

/** Pause — the replay transport. */
export const PauseIcon = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)} width={16} height={16}>
    <path d="M9 5v14M15 5v14" strokeWidth={2.4} />
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

/** Filled variant, for the "already your anchor club" state. */
export const StarFilledIcon = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)} width={12} height={12} fill="currentColor" strokeWidth={1.2}>
    <path d="M12 3.5l2.7 5.6 6.1.8-4.4 4.2 1.1 6-5.5-3-5.5 3 1.1-6L3.2 9.9l6.1-.8z" />
  </svg>
);
