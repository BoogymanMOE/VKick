import { useState } from "react";
import { useI18n } from "../../i18n/I18nProvider";
import { haptic, notifyHaptic, selectionHaptic } from "../../lib/telegram";
import { useToast } from "../Toast";
import { BottomSheet } from "../BottomSheet";
import { Button, Chip, Num, Stars, cx } from "../ui";
import type { PlayerRating } from "../../types";

/**
 * One 3-card rating sheet: a 1–10 slider (integer snap pulse, signature
 * animation 6) plus the eye-test comment that makes the card worth reading.
 * Cosmetic only — never feeds points.
 */
export function RateSheet({
  rating,
  open,
  onClose,
  onSave,
  distribution,
  cardsUsed,
  cardsMax,
}: {
  rating: PlayerRating;
  open: boolean;
  onClose: () => void;
  onSave: (playerId: string, value: number, comment: string) => void;
  /** 10 buckets, counts per integer rating. Derived from crowd_ratings server-side. */
  distribution: number[];
  cardsUsed?: number;
  cardsMax?: number;
}) {
  const { t, localize } = useI18n();
  const { push } = useToast();
  const [value, setValue] = useState(rating.myRating ?? 6);
  const [comment, setComment] = useState(rating.myComment ?? "");

  const totalVotes = distribution.reduce((sum, count) => sum + count, 0) || 1;
  const peak = Math.max(...distribution, 1);

  return (
    <BottomSheet
      open={open}
      onClose={onClose}
      title={localize(rating.name)}
      subtitle={`${t(`pos.${rating.position}`)} · ${t("ratings.points")} ${rating.fantasyPoints}`}
      footer={
        <div className="flex gap-2">
          <Button variant="ghost" className="flex-1" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button
            className="flex-1"
            onClick={() => {
              haptic("medium");
              onSave(rating.playerId, value, comment.trim());
              notifyHaptic("success");
              push({
                text: t("toast.ratingSaved", { player: localize(rating.name) }),
                tone: "gold",
                icon: "★",
              });
              onClose();
            }}
          >
            {t("ratings.save")}
          </Button>
        </div>
      }
    >
      <div className="text-center">
        {/* keyed so the pulse retriggers on every integer change */}
        <Num key={value} className="rating-pulse text-[40px] leading-none text-gold">
          {value}
        </Num>
        <p className="text-[11px] text-ink-3">{t("ratings.yourRating")}</p>
        {typeof cardsUsed === "number" && typeof cardsMax === "number" ? (
          <p className="mt-1 text-[10px] text-ink-3">
            {t("ratings.cards", { used: cardsUsed, max: cardsMax })}
          </p>
        ) : null}
      </div>

      <input
        type="range"
        min={1}
        max={10}
        step={1}
        value={value}
        aria-label={t("ratings.yourRating")}
        onChange={(event) => {
          selectionHaptic();
          setValue(Number(event.target.value));
        }}
        className="mt-4 h-11 w-full accent-[var(--gold)]"
      />

      <div className="flex justify-between text-[10px] text-ink-3">
        <span>1</span>
        <span>5</span>
        <span>10</span>
      </div>

      {/* The eye-test comment — what separates a verdict from a number. */}
      <div className="mt-4">
        <label className="block">
          <span className="mb-1 block label text-ink-3">{t("ratings.commentLabel")}</span>
          <textarea
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            rows={2}
            maxLength={280}
            placeholder={t("ratings.commentPlaceholder")}
            className="w-full resize-none rounded-card border border-line bg-elevated p-3 text-sm text-ink placeholder:text-ink-3 focus-visible:outline-2 focus-visible:outline-gold"
          />
        </label>
      </div>

      <div className="mt-4 border-t border-line pt-3">
        <div className="mb-2 flex items-center justify-between">
          <span className="label text-ink-2">{t("ratings.distribution")}</span>
          <span className="flex items-center gap-2">
            <Stars value={rating.crowdRating ?? 0} />
            <Num className="text-sm text-gold">
              {rating.crowdRating !== null ? rating.crowdRating.toFixed(1) : "–"}
            </Num>
          </span>
        </div>

        <div className="flex h-20 items-end gap-1">
          {distribution.map((count, index) => (
            <div key={index} className="flex flex-1 flex-col items-center gap-1">
              <span
                className={cx(
                  "w-full rounded-t-sm transition-[height] duration-[var(--t-std)] ease-[var(--ease-out)]",
                  // All bars are evaluation, so all amber; yours is the solid one.
                  index + 1 === value ? "bg-gold" : "bg-gold/45",
                )}
                style={{ height: `${Math.max(3, (count / peak) * 64)}px` }}
              />
              <span className="text-[9px] text-ink-3">{index + 1}</span>
            </div>
          ))}
        </div>

        <div className="mt-2 flex items-center justify-between text-[11px] text-ink-3">
          <span>{t("ratings.votes", { count: totalVotes })}</span>
          <Chip tone="gold">{t("ratings.eyeTest")}</Chip>
        </div>
      </div>
    </BottomSheet>
  );
}
