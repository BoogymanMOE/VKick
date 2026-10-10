/**
 * AdBanner — the reusable banner-ad slot.
 *
 * WHY A SLOT AND NOT A PASTED TAG: the ad <script> cannot live in JSX (React
 * renders no script tags), and the same banner must appear in two places, so the
 * component owns the container and injects the provider's code into it from an
 * effect, once, after mount.
 *
 * TWO THINGS TO DO BEFORE THIS SHOWS ANYTHING:
 *  1. paste your Adsgram snippet into the `TODO` block below (the file is
 *     structured for it — see the step-by-step there);
 *  2. set `ADGRAM_ENABLED=true` in the environment (or `VITE_ADGRAM_ENABLED=true`)
 *     and rebuild — without it this component returns null and no script or
 *     request is ever made.
 *
 * The slot wears the app's own chrome (`rounded-card`, `border-line`,
 * `bg-surface`, centred, capped at a 468px banner width so desktop does not
 * stretch it) and labels itself "Sponsored" for honesty.
 *
 * An empty sponsored box is worse than none — the rule the Task card already
 * follows — so the component renders NOTHING until the provider SDK is ready
 * (a blocked, offline or hanging load therefore leaves no hollow frame and no
 * empty wrapper in the feed), and a slot that is still empty a few seconds
 * after the SDK lands hides itself too.
 */
import { useEffect, useRef, useState } from "react";
import { bannerAdsEnabled, loadAdsgramScript } from "../lib/ads";
import { useI18n } from "../i18n/context";
import { cx } from "../lib/cx";

/** How long an empty slot may sit before it hides. Generous: ad fill is slow. */
const EMPTY_SLOT_MS = 5000;

/** Standard banner width — also keeps the slot honest on a desktop viewport. */
const SLOT_MAX_WIDTH = 468;

export function AdBanner({ className }: { className?: string }) {
  const { t } = useI18n();
  const [sdkReady, setSdkReady] = useState(false);
  const [hidden, setHidden] = useState(false);
  /** The div the provider's code renders into (or the script tag is appended to). */
  const slotRef = useRef<HTMLDivElement | null>(null);

  // 1. Load the provider SDK. `loadAdsgramScript` is the same loader the Task
  //    card uses: it appends <script src="https://sad.adsgram.ai/js/sad.min.js">
  //    to <head> once per page load, and retries after a failed load. Nothing
  //    here runs at all unless the switch above is on.
  useEffect(() => {
    if (!bannerAdsEnabled) return;
    let cancelled = false;
    loadAdsgramScript()
      .then(() => {
        if (!cancelled) setSdkReady(true);
      })
      .catch(() => {
        // No SDK (blocked, offline, provider down): hide the slot rather than
        // render an empty frame.
        if (!cancelled) setHidden(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // 2. Inject the ad itself. This is the effect to edit. It runs after the
  //    commit that first renders the slot (the render gate above waits for
  //    `sdkReady`), so `slotRef.current` is the live element here.
  useEffect(() => {
    const slot = slotRef.current;
    if (!sdkReady || !slot) return;

    // ==================== TODO: PASTE YOUR ADGRAM SCRIPT HERE ====================
    //
    // Adsgram gives you a snippet that looks like this (partner.adsgram.ai →
    // your Banner block):
    //
    //   <script src="https://sad.adsgram.ai/js/sad.min.js"></script>
    //   <script>
    //     window.Adsgram.init({ blockId: "12345" }).show();
    //   </script>
    //
    // The <script src> half is ALREADY loaded by the effect above, so paste only
    // the second half here, pointed at this slot:
    //
    //     const adsgram = (window as unknown as {
    //       Adsgram?: { init: (opts: { blockId: string }) => { show: () => unknown } };
    //     }).Adsgram;
    //     if (adsgram) adsgram.init({ blockId: "YOUR_BLOCK_ID" }).show();
    //
    // If your snippet instead hands you a self-contained block with its own
    // inline <script>, append it to the slot we render — that is what `slot` is
    // for. A script node created this way runs on append:
    //
    //     const script = document.createElement("script");
    //     script.text = "/* your snippet body */";
    //     slot.appendChild(script);
    //
    // Or, if the provider renders into an element you name, give it the slot:
    //
    //     window.MyAdProvider.render({ container: slot, blockId: "…" });
    //
    // Two rules when you paste it:
    //  - keep it inside this effect, so it runs once per mount and only after
    //    the SDK is ready (never on every render);
    //  - delete the `EMPTY_SLOT_MS` timer below if your provider can legitimately
    //    fill later than 5s, and call `setHidden(true)` yourself when it reports
    //    "no fill" / "error" (that keeps an empty framed box out of the feed).
    //
    // Nothing is pasted yet, so the slot stays empty and hides itself after
    // EMPTY_SLOT_MS. That is expected until you fill this in.
    //
    // ============================================================================

    const emptyTimer = window.setTimeout(() => {
      if (slot.childElementCount === 0) setHidden(true);
    }, EMPTY_SLOT_MS);

    return () => {
      window.clearTimeout(emptyTimer);
    };
  }, [sdkReady]);

  // Off, still loading, or already known to have nothing to show: no wrapper,
  // no label, no empty frame. The whole component is a no-op in every one of
  // those states — which is also what keeps a hung SDK load invisible.
  if (!bannerAdsEnabled || !sdkReady || hidden) return null;

  return (
    <aside
      aria-label={t("ads.sponsored")}
      className={cx("mx-auto mt-6 w-full", className)}
      style={{ maxWidth: SLOT_MAX_WIDTH }}
    >
      <p className="mb-1 text-center text-[10px] font-bold uppercase tracking-widest text-ink-3">
        {t("ads.sponsored")}
      </p>
      {/* The provider renders inside this slot. `data-ad-slot` makes it easy to
          find in devtools (and to target from a CSS/blocked-ad rule). */}
      <div
        ref={slotRef}
        data-ad-slot="adgram-banner"
        className="grid min-h-[60px] place-items-center overflow-hidden rounded-card border border-line bg-surface"
      />
    </aside>
  );
}
