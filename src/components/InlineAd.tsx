import type { CSSProperties } from "react";

/**
 * The feed's inline ad: a 56px hosted iframe (A-ADS, adaptive size) sitting
 * inside a card that matches the rest of the feed's chrome. Token colours and
 * the shared card radius only — a monetization surface must read as part of
 * the product, and it must not read as "empty" (a dashed border here would
 * collide with the app's dashed-border-means-nothing-here language).
 */
export function InlineAd() {
  return (
    <div
      className="my-3 flex items-center gap-2 rounded-card border border-line bg-elevated p-2"
      style={{ minHeight: "56px", overflow: "hidden" }}
    >
      {/* Labelling: the strap matches the app's other micro-labels, not an
          arbitrary pill, so the slot reads as branded furniture. */}
      <span
        aria-label="Advertisement"
        className="grid h-7 min-w-[34px] flex-none place-items-center rounded-md border border-line bg-surface px-1.5 text-xs font-bold uppercase tracking-wide text-ink-3"
      >
        Ad
      </span>
      <iframe
        data-aa="2458182"
        src="//acceptable.a-ads.com/2458182/?size=Adaptive"
        style={{
          border: "0",
          padding: "0",
          margin: "0",
          display: "block",
          width: "100%",
          height: "56px",
          overflow: "hidden",
          flex: 1,
        } as CSSProperties}
        title="Advertisement"
      />
    </div>
  );
}
