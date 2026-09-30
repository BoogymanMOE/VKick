import { useState, type ButtonHTMLAttributes, type ReactNode } from "react";
import type { Team } from "../types";
import { useI18n } from "../i18n/I18nProvider";
import type { StringKey } from "../i18n/strings";
import { crestSources } from "../lib/logos";
import { haptic } from "../lib/telegram";
import { AlertIcon, RefreshIcon, StarFilledIcon, SwapIcon, TargetIcon } from "./icons";

export const cx = (...parts: Array<string | false | null | undefined>) => parts.filter(Boolean).join(" ");

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

/* -------------------------------------------------------------------- pieces */

/**
 * Club identity. Where a crest is bundled (src/lib/logos.ts) the badge is the
 * artwork, centred in the same square footprint at every size; clubs without
 * one fall back to their abbreviation on a club-coloured tile. Both states
 * share one shape so a list of fixtures reads as a single row rhythm.
 */
export function TeamBadge({ team, size = "md" }: { team: Team; size?: "sm" | "md" | "lg" }) {
  const dims = { sm: "h-6 w-6 text-[10px]", md: "h-9 w-9 text-xs", lg: "h-12 w-12 text-sm" }[size];
  const [broken, setBroken] = useState(false);
  const [remoteBroken, setRemoteBroken] = useState(false);
  // Bundled crest first: it is normalized to one footprint so a row of badges
  // reads evenly, and it needs no network. When a club has none, fall back to
  // the ESPN crest URL carried on every team payload — that URL used to be
  // stored and never rendered, so those clubs showed a bare abbreviation tile
  // even though artwork existed for them.
  const crest = broken ? null : crestSources(team.id);
  const remote = !crest && !remoteBroken ? (team.logoUrl ?? null) : null;
  const hasArt = Boolean(crest || remote);
  return (
    <span
      className={cx(
        "grid flex-none place-items-center font-num font-extrabold",
        dims,
        !hasArt && "rounded-md border",
      )}
      style={
        hasArt
          ? undefined
          : {
              borderColor: `color-mix(in srgb, ${team.color} 55%, transparent)`,
              backgroundColor: `color-mix(in srgb, ${team.color} 18%, transparent)`,
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
            loading="lazy"
            decoding="async"
            className="h-full w-full object-contain"
          />
        </picture>
      ) : remote ? (
        <img
          src={remote}
          alt=""
          onError={() => setRemoteBroken(true)}
          loading="lazy"
          decoding="async"
          className="h-full w-full object-contain"
        />
      ) : (
        team.abbreviation
      )}
    </span>
  );
}

export function LiveDot() {
  return <span className="live-dot" aria-hidden="true" />;
}

type ChipTone = "volt" | "live" | "gold" | "danger" | "pitch" | "muted";

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
  tone = "muted",
  children,
  className,
  normalCase = false,
}: {
  tone?: ChipTone;
  children: ReactNode;
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
}: {
  value: T;
  options: Array<{ value: T; label: string; badge?: ReactNode }>;
  onChange: (value: T) => void;
  className?: string;
}) {
  return (
    <div
      role="tablist"
      className={cx("flex gap-1 overflow-x-auto rounded-full border border-line bg-surface p-1", className)}
    >
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          role="tab"
          aria-selected={value === option.value}
          onClick={() => {
            if (value !== option.value) haptic("light");
            onChange(option.value);
          }}
          className={cx(
            "flex min-h-11 flex-1 items-center justify-center gap-1.5 rounded-full px-3 text-xs font-bold whitespace-nowrap transition-all duration-[var(--t-fast)]",
            value === option.value
              ? "bg-elevated text-volt shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--volt)_35%,transparent)]"
              : "text-ink-2 hover:text-ink",
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
          style={{ width: `${homePct}%`, backgroundColor: homeColor }}
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
          style={{ width: `${pct}%`, backgroundColor: colors[tone] }}
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
  icon,
}: {
  label: string;
  hint?: string;
  right?: ReactNode;
  onClick?: () => void;
  icon?: ReactNode;
}) {
  const Tag = onClick ? "button" : "div";
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
        : {})}
      className={cx(
        "flex w-full items-center gap-3 rounded-card border border-line bg-surface p-3 text-start transition-colors duration-[var(--t-fast)]",
        onClick && "hover:bg-elevated",
      )}
    >
      {icon ? <span className="flex-none text-ink-2">{icon}</span> : null}
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-bold text-ink">{label}</span>
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
      onClick={() => {
        haptic("light");
        onChange(!checked);
      }}
      className="relative h-6 w-11 flex-none rounded-full border border-line transition-colors duration-[var(--t-fast)] after:absolute after:-inset-2.5 after:content-['']"
      style={{
        backgroundColor: checked ? "var(--volt)" : "color-mix(in srgb, var(--text-muted) 35%, transparent)",
      }}
    >
      <span
        className="absolute top-0.5 h-4 w-4 rounded-full bg-black/80 transition-[inset-inline-start] duration-[var(--t-fast)]"
        style={{ insetInlineStart: checked ? "22px" : "3px" }}
      />
    </button>
  );
}

/* ------------------------------------------------------------------ loading */

export function EmptyState({ title, hint, action }: { title: string; hint?: string; action?: ReactNode }) {
  return (
    <div className="pitch-watermark rounded-card border border-dashed border-line px-4 py-10 text-center">
      <p className="text-sm font-bold text-ink-2">{title}</p>
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
    <div role="alert" className="pitch-watermark rounded-card border border-danger/40 px-4 py-10 text-center">
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
