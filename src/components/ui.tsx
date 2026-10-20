import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from "react";
import type { Team } from "../types";
import { useI18n } from "../i18n/context";
import type { StringKey } from "../i18n/strings";
import { cx } from "../lib/cx";
import { crestSources } from "../lib/logos";
import { haptic } from "../lib/telegram";
import { useLocalState } from "../lib/useLocalState";
import { AlertIcon, BallIcon, ChartIcon, ClockIcon, ChevronDownIcon, ListIcon, RefreshIcon, ShirtIcon, StarFilledIcon, SwapIcon, TargetIcon } from "./icons";

/* ------------------------------------------------------------------ surfaces */

export function Card({
  children,
  className,
  style,
  as: Tag = "div",
}: {
  children: ReactNode;
  className?: string;
  style?: React.CSSProperties;
  as?: "div" | "section" | "li";
}) {
  return (
    <Tag className={cx("rounded-card border border-line bg-surface", className)} style={style}>
      {children}
    </Tag>
  );
}

export function SectionHeading({ title, action }: { title: string; action?: ReactNode }) {
  return (
    <div className="mb-2 flex items-baseline justify-between gap-3">
      <h2 className="label label-lg text-ink-2">{title}</h2>
      {action}
    </div>
  );
}

/**
 * A section whose body folds away under its heading — the APG disclosure
 * pattern, with the heading OUTSIDE the toggle: the heading wraps the button,
 * so screen-reader users navigating by headings still find
 * Live/Upcoming/Previous (the old span-inside-button made these sections
 * invisible to H-key nav).
 *
 * `level` sets the heading element. Default h3 for a section sitting under an
 * h2; a top-level page section passes `level={2}` so heading order never jumps
 * straight from the page h1 to an h3.
 * The heading row is the toggle (min-height keeps the 44px touch floor), the
 * count badge and chevron ride along as affordances, and the panel carries
 * aria-labelledby/aria-expanded so it reads as one control. The open/closed
 * choice persists per key, so a collapsed "Previous matches" stays collapsed
 * across reloads. Mount the body only while open — hidden lists stay out of
 * the DOM and the layout.
 *
 * `openOverride` supports bulk expand/collapse (Cups bracket rounds): while
 * set, it wins over the stored state, and the first individual toggle releases
 * it via `onUserToggle` so the per-section choice becomes the ongoing truth.
 */
export function CollapsibleSection({
  id,
  title,
  count,
  defaultOpen = true,
  openOverride,
  onUserToggle,
  /** Optional badge replacement, shown while the section is collapsed — the
   *  pulsing LiveDot on the folded "Live now" header is the reason it exists. */
  collapsedBadge,
  /** Heading level; 3 unless this section is a top level of the page itself. */
  level = 3,
  children,
}: {
  id: string;
  title: string;
  count?: number;
  /** Live/Upcoming start open; dense history sections start closed. */
  defaultOpen?: boolean;
  openOverride?: { open: boolean };
  onUserToggle?: () => void;
  collapsedBadge?: ReactNode;
  level?: 2 | 3;
  children: ReactNode;
}) {
  const [storedOpen, setOpen] = useLocalState<boolean>(`section.open.${id}`, defaultOpen);
  const open = openOverride ? openOverride.open : storedOpen;
  const headingId = `${id}-heading`;
  const panelId = `${id}-panel`;
  const Heading = level === 2 ? "h2" : "h3";
  const headerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const handleToggle = () => {
    haptic("light");
    if (openOverride) {
      // First individual toggle during a bulk action: release the override and
      // land on the opposite of the bulk state, so this section moves while
      // the rest keep the bulk position.
      onUserToggle?.();
      setOpen(!openOverride.open);
      return;
    }
    // Folding unmounts the panel: catch keyboard focus hiding inside it and
    // move it to the header, or the next Tab would restart from the page top.
    const active = document.activeElement;
    if (!open && active instanceof Node && panelRef.current?.contains(active)) {
      headerRef.current?.focus();
    }
    setOpen((value) => !value);
  };
  return (
    <section className="mt-6">
      <Heading id={headingId} className="mb-2">
        <button
          ref={headerRef}
          type="button"
          aria-expanded={open}
          aria-controls={panelId}
          onClick={handleToggle}
          className="flex min-h-11 w-full items-center justify-between gap-3 text-start transition-transform duration-[var(--t-fast)] active:scale-[0.98]"
        >
          <span className="flex min-w-0 items-center gap-2">
            <span className={cx("label label-lg", open ? "text-ink" : "text-ink-2")}>{title}</span>
            {!open && collapsedBadge ? (
              collapsedBadge
            ) : count ? (
              <Chip tone={open ? "muted" : "volt"}>
                <Num>{count}</Num>
              </Chip>
            ) : null}
          </span>
          <span
            className={cx(
              "flex-none text-ink-3 transition-transform duration-[var(--t-fast)] ease-[var(--ease-out)]",
              open && "rotate-180",
            )}
            aria-hidden="true"
          >
            <ChevronDownIcon />
          </span>
        </button>
      </Heading>
      {open ? (
        <div ref={panelRef} id={panelId} role="region" aria-labelledby={headingId} className="panel-in">
          {children}
        </div>
      ) : null}
    </section>
  );
}

/* -------------------------------------------------------------------- pieces */

/**
 * Club identity. Where a crest is bundled (src/lib/logos.ts) the badge is the
 * artwork, centred in the same square footprint at every size; clubs without
 * one fall back to their abbreviation on a club-coloured tile. Both states
 * share one shape so a list of fixtures reads as a single row rhythm.
 */
export function TeamBadge({ team, size = "md" }: { team: Team; size?: "sm" | "md" | "lg" | "xl" }) {
  const dims = {
    sm: "h-6 w-6 text-[10px]",
    md: "h-9 w-9 text-xs",
    lg: "h-12 w-12 text-sm",
    xl: "h-16 w-16 text-base",
  }[size];
  const [broken, setBroken] = useState(false);
  const [remoteBroken, setRemoteBroken] = useState(false);
  // Crests that arrive over the network otherwise pop in from nothing; fade
  // them up on load (bundled and remote share it) so the tile settles in.
  const [loaded, setLoaded] = useState(false);
  const crestImgClass = cx(
    "h-full w-full object-contain transition-opacity duration-[var(--t-fast)] ease-[var(--ease-out)]",
    loaded ? "opacity-100" : "opacity-0",
  );
  // Bundled crest first: it is normalized to one footprint so a row of badges
  // reads evenly, and it needs no network. When a club has none, fall back to
  // the ESPN crest URL carried on every team payload — that URL used to be
  // stored and never rendered, so those clubs showed a bare abbreviation tile
  // even though artwork existed for them.
  const crest = broken ? null : crestSources(team.id);
  const remote = !crest && !remoteBroken ? (team.logoUrl ?? null) : null;
  const hasArt = Boolean(crest || remote);
  // The abbreviation is the last resort, so it must never itself be blank — a
  // team with no ESPN abbreviation falls back to the first letters of its name.
  const abbreviation = team.abbreviation?.trim() || team.shortName.slice(0, 3).toUpperCase();
  return (
    <span
      className={cx(
        "grid flex-none place-items-center font-num font-extrabold rounded-md border",
        dims,
      )}
      style={
        {
          borderColor: hasArt
            ? "rgba(255,255,255,0.18)"
            : `color-mix(in srgb, ${team.color} 55%, transparent)`,
          backgroundColor: hasArt
            ? undefined
            : `color-mix(in srgb, ${team.color} 18%, transparent)`,
          color: "var(--text-primary)",
        }
      }
      aria-hidden="true"
    >
      {crest ? (
        <picture className="contents">
          <source type="image/webp" srcSet={crest.webp} />
          <img
            src={crest.png}
            alt=""
            onError={() => setBroken(true)}
            onLoad={() => setLoaded(true)}
            loading="lazy"
            decoding="async"
            className={crestImgClass}
          />
        </picture>
      ) : remote ? (
        <img
          src={remote}
          alt=""
          onError={() => setRemoteBroken(true)}
          onLoad={() => setLoaded(true)}
          loading="lazy"
          decoding="async"
          className={crestImgClass}
        />
      ) : (
        abbreviation
      )}
    </span>
  );
}

export function LiveDot() {
  return <span className="live-dot" aria-hidden="true" />;
}

export type ChipTone = "volt" | "live" | "gold" | "danger" | "pitch" | "muted";

const chipStyles: Record<ChipTone, { className: string; style?: React.CSSProperties }> = {
  volt: {
    className: "text-volt border-volt",
    style: { backgroundColor: "color-mix(in srgb, var(--volt) 12%, transparent)" },
  },
  live: {
    className: "text-live border-live",
    style: { backgroundColor: "color-mix(in srgb, var(--live) 12%, transparent)" },
  },
  gold: {
    className: "text-gold border-gold",
    style: { backgroundColor: "color-mix(in srgb, var(--gold) 12%, transparent)" },
  },
  danger: {
    className: "text-danger border-danger",
    style: { backgroundColor: "color-mix(in srgb, var(--danger) 12%, transparent)" },
  },
  /* Turf green: positive states (tokens.css). Not LIVE, not evaluation. */
  pitch: {
    className: "text-pitch border-pitch",
    style: { backgroundColor: "color-mix(in srgb, var(--pitch) 12%, transparent)" },
  },
  muted: { className: "text-ink-2 border-line bg-elevated" },
};

export function Chip({
  children,
  tone = "muted",
  className,
  normalCase = false,
}: {
  children: ReactNode;
  tone?: ChipTone;
  className?: string;
  /** Opt out of the badge default for inline labels (names, positions). */
  normalCase?: boolean;
}) {
  const { className: toneClass, style } = chipStyles[tone];
  return (
    <span
      className={cx(
        "inline-flex items-center gap-1.5 rounded-md border px-1.5 py-0.5 text-[11px] font-bold",
        !normalCase && "uppercase",
        toneClass,
        className,
      )}
      style={style}
    >
      {children}
    </span>
  );
}

/** Numbers use the display face with tabular figures so scores never jitter. */
export function Num({ children, className }: { children: ReactNode; className?: string }) {
  return <span className={cx("num-display tabular-nums", className)}>{children}</span>;
}

/**
 * A player's face, in the circle every roster row and pitch slot uses.
 *
 * The feed carries an ESPN headshot URL for most players but not all, and a
 * CDN URL can 404 long after the sync stored it, so both cases fall back to the
 * player's initials on the same footprint — a roster reads evenly either way,
 * and a squad with no artwork at all still looks deliberate. The image is
 * decorative (the name is always rendered next to it) and lazy, since a squad
 * list is 25 of these.
 */
export function PlayerAvatar({
  name,
  src,
  size = "md",
  className,
}: {
  name: string;
  src?: string | null;
  size?: "sm" | "md" | "lg";
  className?: string;
}) {
  const [broken, setBroken] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const dims = { sm: "h-8 w-8 text-[10px]", md: "h-10 w-10 text-xs", lg: "h-12 w-12 text-sm" }[size];
  const photo = src && !broken ? src : null;
  return (
    <span
      className={cx(
        "relative grid flex-none place-items-center overflow-hidden rounded-full border border-line bg-elevated font-bold text-ink-2",
        dims,
        className,
      )}
      aria-hidden="true"
    >
      {photo ? (
        <img
          src={photo}
          alt=""
          onError={() => setBroken(true)}
          onLoad={() => setLoaded(true)}
          loading="lazy"
          decoding="async"
          className={cx(
            "h-full w-full object-cover transition-opacity duration-[var(--t-fast)] ease-[var(--ease-out)]",
            loaded ? "opacity-100" : "opacity-0",
          )}
        />
      ) : (
        initialsOf(name)
      )}
    </span>
  );
}

/** Up to two initials from a player name — "Cole Palmer" → "CP", "Ronald" → "R". */
function initialsOf(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "?";
  const first = words[0]!.charAt(0);
  const last = words.length > 1 ? words[words.length - 1]!.charAt(0) : "";
  return (first + last).toUpperCase();
}

/**
 * Evaluative (gold) totals count up from zero on mount — season points,
 * standings points, xPts — so a number that just appeared reads as earned
 * rather than snapped in. Integer-only; a reduced-motion user sees the value
 * immediately (no animation, no intermediate frames).
 */
export function CountUp({
  value,
  className,
  duration = 650,
  decimals = 0,
}: {
  value: number;
  className?: string;
  duration?: number;
  /** Decimal places (xPts carry one); integers round instead. */
  decimals?: number;
}) {
  const [progressValue, setProgressValue] = useState(value);
  useLayoutEffect(() => {
    const reduce =
      typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (reduce) {
      setProgressValue(value);
      return;
    }
    // Runs before paint, so the first frame is already 0 — no flash of the
    // final value before the count starts.
    setProgressValue(0);
    const start = performance.now();
    let frame = requestAnimationFrame(function tick(now) {
      const progress = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - progress, 3);
      setProgressValue(value * eased);
      if (progress < 1) frame = requestAnimationFrame(tick);
    });
    return () => cancelAnimationFrame(frame);
  }, [value, duration]);
  const shown = decimals > 0 ? progressValue.toFixed(decimals) : String(Math.round(progressValue));
  return <Num className={className}>{shown}</Num>;
}

/* ------------------------------------------------------------------- buttons */

type Variant = "primary" | "ghost" | "volt-outline";

const variants: Record<Variant, string> = {
  primary: "bg-volt text-black hover:brightness-95 active:brightness-90",
  ghost: "border border-line text-ink hover:bg-elevated",
  "volt-outline": "border border-volt text-volt hover:bg-elevated",
};

export function Button({
  variant = "primary",
  className,
  children,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }) {
  return (
    <button
      {...rest}
      className={cx(
        "inline-flex min-h-11 items-center justify-center gap-2 rounded-full px-4 text-sm font-bold transition-[filter,background-color,transform] duration-[var(--t-fast)] active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-40",
        variants[variant],
        className,
      )}
    >
      {children}
    </button>
  );
}

/* --------------------------------------------------------------- navigation */

export function Segmented<T extends string>({
  value,
  options,
  onChange,
  className,
  /** Optional id prefix that wires the tabs to their panel:
   *  tab `${id}-${value}`, panel `${id}-panel`, tabs carry aria-controls.
   *  Call sites that use this as a real tab control (MatchDetail, TeamPage)
   *  give their panel the matching id + role="tabpanel"; filter-style uses
   *  omit it and stay plain buttons-with-role="tab" until arrow-key APG is
   *  what they want (they are toggles, so they don't). */
  id,
}: {
  value: T;
  options: Array<{ value: T; label: string; badge?: ReactNode }>;
  onChange: (value: T) => void;
  className?: string;
  id?: string;
}) {
  const { dir } = useI18n();
  const activeIndex = options.findIndex((option) => option.value === value);
  // The selected pill slides along the track instead of the background
  // snapping between tabs. Position and width are MEASURED from the active
  // button (not derived from 1/n): a crowded track scrolls and its tabs can
  // carry different widths (Cups, Ratings), so equal-width math would misalign.
  // Only the travel is animated (transform); width settles instantly.
  const trackRef = useRef<HTMLDivElement | null>(null);
  const [indicator, setIndicator] = useState<{ start: number; width: number } | null>(null);
  useLayoutEffect(() => {
    const track = trackRef.current;
    if (!track || activeIndex < 0) {
      setIndicator(null);
      return;
    }
    const measure = () => {
      const tab = track.querySelectorAll<HTMLButtonElement>('[role="tab"]')[activeIndex];
      if (!tab) return;
      // The pill is position:absolute INSIDE the scroll container, so it scrolls
      // with the content — its offset has to be measured in the track's CONTENT
      // space, not its viewport space. A viewport offset is only correct while
      // scrollLeft is 0: scroll a crowded row and switch tabs, and the pill lands
      // `scrollLeft` pixels to the left of the active tab (off-screen entirely on
      // the 8-tab Ratings row). Adding the scroll puts both on the same axis.
      const origin = track.getBoundingClientRect().left + track.clientLeft;
      const rect = tab.getBoundingClientRect();
      setIndicator({ start: rect.left - origin + track.scrollLeft, width: rect.width });
    };
    measure();
    // Guarded: legacy webviews without ResizeObserver still get a correct
    // indicator, it just won't re-measure on container resize.
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(track);
    return () => observer.disconnect();
  }, [activeIndex, options.length, dir]);
  // Roving focus for the APG tab pattern: the selected tab is the only tab
  // stop, and Arrow keys walk the tabs (visual order — mirrored in RTL),
  // selecting as they go. A tablist that accepts focus but ignores arrows
  // breaks the expectation role="tab" itself creates.
  const selectAndFocus = (index: number) => {
    const next = options[Math.max(0, Math.min(options.length - 1, index))];
    if (!next) return;
    if (next.value !== value) {
      haptic("light");
      onChange(next.value);
    }
    // Focus follows selection even when the value didn't change (at the ends).
    const track = trackRef.current;
    requestAnimationFrame(() => {
      track
        ?.querySelector<HTMLButtonElement>(`[data-tab-value="${next.value}"]`)
        ?.focus();
    });
  };
  const onTabKeyDown = (event: ReactKeyboardEvent) => {
    // Visual arrows, not logical: in an RTL row the visually-rightmost tab is
    // options[0], so ArrowRight walks backwards through the array.
    const rtl = dir === "rtl";
    if (event.key === "ArrowRight") selectAndFocus(activeIndex + (rtl ? -1 : 1));
    else if (event.key === "ArrowLeft") selectAndFocus(activeIndex + (rtl ? 1 : -1));
    else if (event.key === "Home") selectAndFocus(0);
    else if (event.key === "End") selectAndFocus(options.length - 1);
    else return;
    event.preventDefault();
  };

  // Scroll hint: when a crowded track actually overflows, a faint inline-end
  // fade says "there is more past this edge" without a visible arrow to
  // maintain. Recomputed on the same observer that measures the pill.
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const track = trackRef.current;
    if (!track || typeof ResizeObserver === "undefined") return;
    const check = () => setScrolled(track.scrollWidth > track.clientWidth + 2);
    check();
    const observer = new ResizeObserver(check);
    observer.observe(track);
    return () => observer.disconnect();
  }, [options.length]);

  return (
    <div
      ref={trackRef}
      role="tablist"
      className={cx(
        "relative flex gap-1 overflow-x-auto rounded-full border border-line bg-surface p-1",
        className,
      )}
    >
      {scrolled ? (
        <span
          aria-hidden="true"
          className="pointer-events-none sticky end-0 shrink-0"
          style={{
            width: 14,
            marginInlineEnd: -4,
            // The fade sits on the END edge, which flips in RTL — so the
            // gradient flips with it.
            background:
              dir === "rtl"
                ? "linear-gradient(to left, transparent, var(--bg-surface))"
                : "linear-gradient(to right, transparent, var(--bg-surface))",
          }}
        />        ) : null}
      {indicator ? (
        <span
          aria-hidden="true"
          className="pointer-events-none absolute top-1 bottom-1 rounded-full bg-elevated shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--volt)_35%,transparent)] transition-transform duration-[var(--t-fast)] ease-[var(--ease-pop)]"
          style={{ left: 0, width: indicator.width, transform: `translateX(${indicator.start}px)` }}
        />
      ) : null}
      {options.map((option, index) => (
        <button
          key={option.value}
          data-tab-value={option.value}
          id={id ? `${id}-${option.value}` : undefined}
          aria-controls={id ? `${id}-panel` : undefined}
          type="button"
          role="tab"
          aria-selected={value === option.value}
          tabIndex={index === activeIndex ? 0 : -1}
          onKeyDown={onTabKeyDown}
          onClick={() => {
            if (value !== option.value) haptic("light");
            onChange(option.value);
          }}
          className={cx(
            // relative keeps each label painted above the sliding pill; flex-1
            // fills the track, and with whitespace-nowrap each tab's min-content
            // width is its label, so a crowded row (the five match tabs in
            // Persian) scrolls rather than breaking a word.
            "relative flex min-h-11 flex-1 items-center justify-center gap-1.5 rounded-full px-3 text-xs font-bold whitespace-nowrap transition-colors duration-[var(--t-fast)]",
            value === option.value ? "text-volt" : "text-ink-2 hover:text-ink",
          )}
        >
          {option.label}
          {option.badge}
        </button>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------- data display */

/** Two-sided comparison bar — used for team stats and rating distributions.
 *  Sides wear their own club colour: teal would imply broadcast/live state. */
export function StatBar({
  label,
  home,
  away,
  homeColor = "var(--volt)",
  awayColor = "var(--text-muted)",
}: {
  label: string;
  home: number;
  away: number;
  homeColor?: string;
  awayColor?: string;
}) {
  const total = home + away || 1;
  const homePct = (home / total) * 100;
  // Seed at 0 and grow on the next frame, so the width transition actually
  // runs on mount instead of the final value painting in one step.
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const id = requestAnimationFrame(() => setReady(true));
    return () => cancelAnimationFrame(id);
  }, []);
  return (
    <li className="space-y-1">
      <div className="flex items-center justify-between text-[11px]">
        <Num className={cx("w-8", home >= away ? "text-ink" : "text-ink-2")}>{home}</Num>
        <span className="text-ink-3">{label}</span>
        <Num className={cx("w-8 text-end", away >= home ? "text-ink" : "text-ink-2")}>{away}</Num>
      </div>
      <div className="flex h-1.5 overflow-hidden rounded-full bg-elevated">
        <span
          className="h-full rounded-s-full transition-[width] duration-[var(--t-std)] ease-[var(--ease-out)]"
          style={{ width: ready ? `${homePct}%` : "0%", backgroundColor: homeColor }}
        />
        <span className="h-full flex-1 rounded-e-full" style={{ backgroundColor: awayColor }} />
      </div>
    </li>
  );
}

/** Horizontal progress with an optional label row above it. */
export function ProgressBar({
  value,
  max = 100,
  tone = "volt",
  label,
  valueLabel,
}: {
  value: number;
  max?: number;
  tone?: "volt" | "gold" | "live";
  label?: string;
  valueLabel?: ReactNode;
}) {
  const pct = Math.max(0, Math.min(100, (value / max) * 100));
  const colors = { volt: "var(--volt)", gold: "var(--gold)", live: "var(--live)" };
  // Same as StatBar: paint full-width on mount, then animate down to value.
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const id = requestAnimationFrame(() => setReady(true));
    return () => cancelAnimationFrame(id);
  }, []);
  return (
    <div className="space-y-1">
      {label || valueLabel ? (
        <div className="flex items-center justify-between text-[11px] text-ink-2">
          <span>{label}</span>
          {valueLabel}
        </div>
      ) : null}
      <div className="h-1.5 overflow-hidden rounded-full bg-elevated">
        <span
          className="block h-full rounded-full transition-[width] duration-[var(--t-slow)] ease-[var(--ease-out)]"
          style={{ width: ready ? `${pct}%` : "0%", backgroundColor: colors[tone] }}
        />
      </div>
    </div>
  );
}

/** Gold star row — crowd ratings and bonus points only. */
export function Stars({ value, max = 10 }: { value: number; max?: number }) {
  const filled = Math.round((value / max) * 5);
  return (
    <span className="inline-flex gap-0.5" aria-label={`${value} / ${max}`}>
      {Array.from({ length: 5 }, (_, index) => (
        <StarFilledIcon
          key={index}
          className={cx("h-3.5 w-3.5", index < filled ? "text-gold" : "text-ink-3/40")}
          aria-hidden="true"
        />
      ))}
    </span>
  );
}

/** Initial-based avatar. Team or user, never a photo dependency. */
export function Avatar({
  name,
  tone = "muted",
  size = "md",
}: {
  name: string;
  tone?: "volt" | "muted";
  size?: "sm" | "md" | "lg";
}) {
  const dims = { sm: "h-7 w-7 text-[11px]", md: "h-9 w-9 text-sm", lg: "h-12 w-12 text-lg" }[size];
  return (
    <span
      className={cx(
        "grid flex-none place-items-center rounded-full border font-extrabold",
        dims,
        tone === "volt" ? "border-volt text-volt" : "border-line text-ink-2",
      )}
      style={{ backgroundColor: "var(--bg-elevated)" }}
      aria-hidden="true"
    >
      {name.slice(0, 1).toUpperCase()}
    </span>
  );
}

/** Tappable settings-style row. */
export function ListRow({
  label,
  hint,
  right,
  onClick,
  onToggle,
  icon,
  danger,
}: {
  label: string;
  hint?: string;
  right?: ReactNode;
  onClick?: () => void;
  /**
   * Whole-row tap for a row whose control is a switch on the right: users tap
   * the label, not the 44×24 track. The row stays a <div> so the switch inside
   * it is never a button nested in a button — the switch remains the real,
   * keyboard-operable control.
   */
  onToggle?: () => void;
  icon?: ReactNode;
  /** Destructive rows: the label carries the --live coral so the action's
      stakes are visible before the tap, not only after. */
  danger?: boolean;
}) {
  const Tag = onClick ? "button" : "div";
  const active = Boolean(onClick || onToggle);
  return (
    <Tag
      {...(onClick
        ? {
            type: "button" as const,
            onClick: () => {
              haptic("light");
              onClick();
            },
          }
        : onToggle
          ? { onClick: onToggle }
          : {})}
      className={cx(
        "flex w-full items-center gap-3 rounded-card border border-line bg-surface p-3 text-start",
        active
          ? "cursor-pointer transition-[color,background-color,transform] duration-[var(--t-fast)] hover:bg-elevated active:scale-[0.98]"
          : "transition-colors duration-[var(--t-fast)]",
      )}
    >
      {icon ? <span className="flex-none text-ink-2">{icon}</span> : null}
      <span className="min-w-0 flex-1">
        <span
          className={cx(
            "block truncate text-sm font-bold",
            danger ? "text-danger" : "text-ink",
          )}
        >
          {label}
        </span>
        {hint ? <span className="block truncate text-xs text-ink-3">{hint}</span> : null}
      </span>
      {right}
    </Tag>
  );
}

/** Switch used by the notification settings. */
export function Switch({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={(e) => {
        // The row can toggle too (ListRow.onToggle): without this the tap would
        // reach both handlers and cancel itself out.
        e.stopPropagation();
        haptic("light");
        onChange(!checked);
      }}
      className="relative h-6 w-11 flex-none rounded-full border border-line transition-colors duration-[var(--t-fast)] after:absolute after:-inset-2.5 after:content-['']"
      style={{
        backgroundColor: checked ? "var(--volt)" : "color-mix(in srgb, var(--text-muted) 35%, transparent)",
      }}
    >
      <span
        className="absolute top-0.5 h-4 w-4 rounded-full bg-black/80 transition-[inset-inline-start] duration-[var(--t-fast)] ease-[var(--ease-pop)]"
        style={{ insetInlineStart: checked ? "22px" : "3px" }}
      />
    </button>
  );
}

/* ------------------------------------------------------------------ loading */

/**
 * Empty-state emoji shorthand → drawn icons. The design system's icon rule is
 * "drawn, never emoji" (see TimelineList's eventIcon), so these strings are
 * swapped for the shared SVG set here, once, instead of at every call site.
 * Unknown emoji are stripped so a new call site can never ship a system-font
 * glyph that shifts weight against the drawn set.
 */
const GLYPHS: Record<string, ReactNode> = {
  "⚽": <BallIcon />,
  "⏱": <ClockIcon />,
  "📊": <ChartIcon />,
  "📋": <ListIcon />,
  "👥": <ShirtIcon />,
  "📈": <ChartIcon />,
  "⭐": <StarFilledIcon />,
};

export function EmptyState({
  title,
  hint,
  action,
  icon,
}: {
  title: string;
  hint?: string;
  action?: ReactNode;
  /** A small pictogram above the title. Call sites still pass their original
   *  emoji shorthand; the strings are swapped for the drawn icon set here so
   *  every empty state obeys the design system's "drawn, never emoji" icon
   *  rule without touching 8 call sites. */
  icon?: ReactNode;
}) {
  return (
    <div className="rise-in pitch-watermark rounded-card border border-dashed border-line px-4 py-10 text-center">
      {icon ? (
        <div
          className="grid place-items-center text-ink-3 [&>svg]:h-7 [&>svg]:w-7"
          aria-hidden="true"
        >
          {typeof icon === "string" ? (GLYPHS[icon] ?? icon.replace(/[\u{1F300}-\u{1FAFF}\u{2300}-\u{23FF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}]/gu, "")) : icon}
        </div>
      ) : null}
      <p className={cx(icon ? "mt-3" : undefined, "text-sm font-bold text-ink-2")}>{title}</p>
      {hint ? <p className="mt-1 text-xs text-ink-3">{hint}</p> : null}
      {action ? <div className="mt-4 flex justify-center">{action}</div> : null}
    </div>
  );
}

/**
 * The third state: the fetch failed. Distinct from empty (which means "no
 * data" and would be a lie here) — honest about the failure, with a retry
 * wired to the query's refetch so the user is never stuck on the screen.
 */
export function ErrorState({ title, hint, onRetry }: { title?: string; hint?: string; onRetry: () => void }) {
  const { t } = useI18n();
  return (
    <div
      role="alert"
      className="rise-in pitch-watermark rounded-card border border-danger/40 px-4 py-10 text-center"
    >
      <p className="text-danger">
        <AlertIcon className="mx-auto h-6 w-6" />
      </p>
      <p className="mt-2 text-sm font-bold text-ink">{title ?? t("error.title")}</p>
      {hint ? <p className="mt-1 text-xs text-ink-3">{hint}</p> : null}
      <button
        type="button"
        onClick={() => {
          haptic("light");
          onRetry();
        }}
        className="mt-4 inline-flex min-h-11 items-center gap-1.5 rounded-full border border-volt px-5 text-xs font-bold text-volt transition-colors duration-[var(--t-fast)] hover:bg-elevated"
      >
        <RefreshIcon />
        {t("common.retry")}
      </button>
    </div>
  );
}

/** Small labels previewing prediction mechanics played on a match. */
const PREDICT_LABEL: Record<string, StringKey> = {
  lineup: "predict.lineup",
  shot: "predict.shot",
  sub: "predict.sub",
  watch: "predict.watch",
  versus: "predict.versus",
};

export function PredictionIcons({ kinds }: { kinds: string[] }) {
  const { t, lang } = useI18n();
  if (kinds.length === 0) return null;
  // Abbreviations stay as text (they are labels); the pictographic kinds get the
  // shared icon set so they don't shift weight with the system font.
  const text: Record<string, string> = { lineup: "XI", versus: "VS" };
  const Icon: Record<string, typeof StarFilledIcon> = {
    shot: TargetIcon,
    sub: SwapIcon,
    watch: StarFilledIcon,
  };
  const title = kinds.map((k) => t(PREDICT_LABEL[k] ?? "predict.lineup")).join(lang === "fa" ? "، " : ", ");
  return (
    <span className="inline-flex items-center gap-1" title={title}>
      {/* The glyphs are decorative; the joined names carry the meaning for
          screen readers (a title attribute alone is hover-only on touch). */}
      <span className="sr-only">{title}</span>
      {kinds.map((k) => {
        const Glyph = Icon[k];
        return (
          <span
            key={k}
            className="grid h-5 min-w-5 place-items-center rounded-full border border-volt px-1 text-[10px] font-bold text-volt"
            style={{ backgroundColor: "color-mix(in srgb, var(--volt) 12%, transparent)" }}
            aria-hidden="true"
          >
            {Glyph ? <Glyph className="h-3 w-3" /> : (text[k] ?? "•")}
          </span>
        );
      })}
    </span>
  );
}
