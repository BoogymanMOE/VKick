import type { PlayerRating, Team } from "../types";
import { useI18n } from "../i18n/I18nProvider";
import { haptic, selectionHaptic } from "../lib/telegram";
import { Chip, Num, TeamBadge, cx } from "./ui";

/**
 * The differentiator in one row: the stat score on one side, the crowd's
 * eye test on the other, deliberately never merged into a single number.
 */
export function RatingRow({
  rating,
  team,
  onRate,
  onTap,
}: {
  rating: PlayerRating;
  team: Team;
  onRate?: (playerId: string, value: number) => void;
  /** When set, the whole row opens the rating sheet instead of showing a slider. */
  onTap?: (player: PlayerRating) => void;
}) {
  const { t, localize } = useI18n();
  const hasCrowd = rating.crowdRating !== null;

  // Always a list item, so `ul > li` stays valid markup even when the row is tappable.
  const Tag = onTap ? "button" : "div";

  return (
    <li>
      <Tag
        {...(onTap
          ? {
              type: "button" as const,
              onClick: () => {
                haptic("light");
                onTap(rating);
              },
            }
          : {})}
        className={cx(
          "flex w-full items-center gap-3 rounded-card border border-line bg-surface p-3 text-start",
          onTap && "transition-colors duration-[var(--t-fast)] hover:bg-elevated",
        )}
      >
        <TeamBadge team={team} size="sm" />

        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-bold text-ink">{localize(rating.name)}</p>
          <div className="mt-1 flex items-center gap-2">
            <Chip tone="muted" normalCase>
              {t(`pos.${rating.position}`)}
            </Chip>
            {hasCrowd ? (
              <span className="text-[11px] text-ink-3">{t("ratings.votes", { count: rating.votes })}</span>
            ) : (
              <span className="text-[11px] text-ink-3">{t("ratings.pending")}</span>
            )}
          </div>
          {/* The eye-test comment — the crowd's why, not just its number. */}
          {(rating.myComment || rating.latestComment) && onTap ? (
            <p className="mt-1 line-clamp-2 text-[11px] italic text-ink-3">
              “{rating.myComment || rating.latestComment}”
            </p>
          ) : null}
        </div>

        {/* Crowd rating — gold, the only accent that means crowd approval. */}
        <div className="flex-none text-center">
          <Num className={cx("block text-xl leading-none", hasCrowd ? "text-gold" : "text-ink-3")}>
            {hasCrowd ? rating.crowdRating!.toFixed(1) : "–"}
          </Num>
          <span className="label text-ink-3">{t("ratings.crowd")}</span>
        </div>

        <div className="flex-none text-center">
          <Num className="block text-xl leading-none text-ink">{rating.fantasyPoints}</Num>
          <span className="label text-ink-3">{t("ratings.points")}</span>
        </div>

        {onRate ? (
          <div className="flex-none">
            <RatingSlider
              value={rating.myRating}
              disabled={rating.myRating !== null}
              onChange={(value) => {
                haptic("light");
                onRate(rating.playerId, value);
              }}
            />
          </div>
        ) : null}

        {onTap ? (
          rating.myRating !== null ? (
            <span className="grid h-9 min-w-9 flex-none place-items-center rounded-full border border-gold px-2 text-sm font-bold text-gold">
              <Num>{rating.myRating}</Num>
            </span>
          ) : (
            <span className="flex-none text-[11px] font-bold text-ink-3">{t("ratings.tapToRate")}</span>
          )
        ) : null}
      </Tag>
    </li>
  );
}

/**
 * 1–10 rating control. Rendered as a stepped range input so it stays accessible on
 * low-end Android, with an integer snap pulse per the design system.
 */
export function RatingSlider({
  value,
  disabled,
  onChange,
}: {
  value: number | null;
  disabled?: boolean;
  onChange: (value: number) => void;
}) {
  const { t } = useI18n();
  if (disabled) {
    return (
      // Your rating is evaluation: amber in every context (it used to flip to
      // volt here, so the same number wore two colours across screens).
      <span className="grid h-9 min-w-9 place-items-center rounded-full border border-gold text-sm font-bold text-gold">
        <Num>{value}</Num>
      </span>
    );
  }

  return (
    <label className="flex flex-col items-center">
      <span className="sr-only">{t("ratings.rateLabel")}</span>
      <input
        type="range"
        min={1}
        max={10}
        step={1}
        defaultValue={value ?? 6}
        onChange={(e) => {
          selectionHaptic();
          onChange(Number(e.target.value));
        }}
        onPointerUp={(e) => onChange(Number((e.target as HTMLInputElement).value))}
        className="h-11 w-20 accent-[var(--volt)]"
      />
      <Num className="text-[11px] text-ink-3">{value ?? "–"}</Num>
    </label>
  );
}
