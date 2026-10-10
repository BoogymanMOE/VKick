/**
 * Ads — the Adsgram Task card, Telegram Mini App only.
 *
 * The Mini App monetization reality: Google AdSense needs native WebView
 * registration (impossible inside a Telegram webview) and a payout country
 * Google supports, so the Telegram surface runs Adsgram (docs.adsgram.ai)
 * instead. Their Task format is the only INLINE unit — a native "complete a
 * task, earn a reward" card rendered by the <adsgram-task> web component; their
 * rewarded/interstitial formats are fullscreen and deliberately unused (the
 * product chose passive placements only), and they ship no banner format at all.
 *
 * Everything here no-ops unless ALL THREE hold:
 *  - ADGRAM_ENABLED is exactly "true" (the master switch; both spellings below),
 *  - VITE_ADSGRAM_TASK_BLOCK_ID is set (a `task-…` id from partner.adsgram.ai),
 *  - the app runs inside Telegram (only there does the SDK fill).
 * The web build and any unset deployment never load the SDK — zero bytes, zero
 * requests, zero visual footprint.
 *
 * Adsgram allows exactly ONE Task block per project, so every placement shares
 * one block id and each screen renders at most one card.
 */
import { isTelegram } from "./telegram";

/** The SDK that registers the <adsgram-task> custom element. */
export const TASK_SCRIPT_SRC = "https://sad.adsgram.ai/js/sad.min.js";

/**
 * The ads master switch, read at BUILD time (Vite inlines both of these, so
 * flipping the value needs a rebuild — it is not a runtime toggle).
 *
 * Two spellings, one rule — the value must be exactly `true`:
 *  - `ADGRAM_ENABLED` (the name the deploy sets; vite.config maps it into
 *    `__ADGRAM_ENABLED__` because Vite only inlines `VITE_`-prefixed vars on
 *    its own),
 *  - `VITE_ADGRAM_ENABLED` (Vite's native client-visible prefix).
 *
 * Anything else — unset, `""`, `"false"`, `"1"`, `"yes"` — leaves the Task card
 * rendering null, so ads stay off during testing without touching the code.
 */
export const adsEnabled = (() => {
  const raw = `${import.meta.env.VITE_ADGRAM_ENABLED ?? ""}`.trim() || `${__ADGRAM_ENABLED__ ?? ""}`.trim();
  return raw.toLowerCase() === "true";
})();

/** `task-…` block id from partner.adsgram.ai; empty = ads fully disabled. */
export const taskBlockId = (import.meta.env.VITE_ADSGRAM_TASK_BLOCK_ID ?? "").trim();

/** True when the inline task card may render at all. */
export function taskAdsAvailable(): boolean {
  return adsEnabled && Boolean(taskBlockId) && isTelegram();
}

let scriptPromise: Promise<void> | null = null;

/**
 * Load the Adsgram SDK once per page load — it registers the <adsgram-task>
 * custom element the card component then renders. A failed load resets the
 * promise so a later mount can retry (transient network, webview quirks).
 */
export function loadAdsgramScript(): Promise<void> {
  if (scriptPromise) return scriptPromise;
  scriptPromise = new Promise((resolve, reject) => {
    if (typeof window === "undefined") return reject(new Error("no window"));
    if (window.customElements?.get("adsgram-task")) return resolve();
    const script = document.createElement("script");
    script.src = TASK_SCRIPT_SRC;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => {
      scriptPromise = null; // allow a retry on the next mount
      reject(new Error("adsgram SDK failed to load"));
    };
    document.head.appendChild(script);
  });
  return scriptPromise;
}
