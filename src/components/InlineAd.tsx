import type { CSSProperties } from "react";
import { useI18n } from "../i18n/context";
import { IS_EMBED } from "../lib/embed";

/**
 * The feed's inline ad: a hosted iframe (A-ADS, adaptive size) inside a dark
 * rounded slot — deliberately capped at 60px with the overflow clipped, so a
 * tall third-party creative can never blow open the feed's rhythm, and the
 * slot's own surface stays on-token even while the iframe itself paints.
 * The small "تبلیغ" label keeps the monetization surface branded, not bare.
 */
export function InlineAd() {
  const { t } = useI18n();
  // Share mode (?embed=1 inside /frame.html): clean screenshots, no ad iframe.
  if (IS_EMBED) return null;
  return (
    <div
      className="my-3 flex items-center gap-2 overflow-hidden rounded-card bg-elevated p-1.5"
      style={{ maxHeight: "60px" }}
    >
      {/* Labelling: the strap matches the app's other micro-labels, not an
          arbitrary pill, so the slot reads as branded furniture. */}
      <span
        aria-label={t("ads.label")}
        className="grid h-6 min-w-[30px] flex-none place-items-center rounded-md border border-line bg-surface px-1 text-[10px] font-bold tracking-wide text-ink-3"
      >
        {t("ads.label")}
      </span>
      {/* loading="lazy": the ad chain is ~1.6s of third-party work and the
          slot usually sits below the fold. Deferring the iframe keeps that
          cost off first paint, and a reader who never scrolls past the fold
          never pays it at all. */}
      <iframe
        data-aa="2458182"
        src="//acceptable.a-ads.com/2458182/?size=Adaptive"
        loading="lazy"
        style={{
          border: "0",
          padding: "0",
          margin: "0",
          display: "block",
          width: "100%",
          height: "48px",
          minHeight: "0",
          overflow: "hidden",
          flex: 1,
          borderRadius: "8px",
          colorScheme: "dark",
        } as CSSProperties}
        title={t("ads.label")}
      />
    </div>
  );
}
