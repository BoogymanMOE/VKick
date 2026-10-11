/**
 * Ads — Anonymous Ads (A-ADS) banner.
 *
 * A-ADS is a lightweight, privacy-friendly ad network that works inside
 * Telegram Mini Apps via a simple iframe snippet. Unlike legacy ad providers whose only inline unit was a Task card, A-ADS provides a banner-style
 * format (their only inline unit, now retired), A-ADS provides a banner-style
 * placement that fits naturally between feed sections.
 *
 * Everything here no-ops unless ALL of these hold:
 *  - ADS_ENABLED is exactly "true" (the master switch; both spellings below),
 *  - the app runs inside Telegram (A-ADS fill is optimized for Telegram
 *    webviews; plain browsers also work but we gate on Telegram to match the
 *    original Telegram-only monetization policy).
 *
 * The web build and any unset deployment never load the ad snippet — zero
 * bytes, zero requests, zero visual footprint.
 */
import { isTelegram } from "./telegram";

/**
 * The ads master switch, read at BUILD time (Vite inlines both of these, so
 * flipping the value needs a rebuild — it is not a runtime toggle).
 *
 * Two spellings, one rule — the value must be exactly `true`:
 *  - `ADS_ENABLED` (the name the deploy sets; vite.config maps it into
 *    `__ADS_ENABLED__` because Vite only inlines `VITE_`-prefixed vars on
 *    its own),
 *  - `VITE_ADS_ENABLED` (Vite's native client-visible prefix).
 *
 * Anything else — unset, "", "false", "1", "yes" — leaves the banner
 * rendering null, so ads stay off during testing without touching the code.
 */
export const adsEnabled = (() => {
  const raw = `${import.meta.env.VITE_ADS_ENABLED ?? ""}`.trim() || `${__ADS_ENABLED__ ?? ""}`.trim();
  return raw.toLowerCase() === "true";
})();

/** True when the A-ADS banner may render at all. */
export function adsAvailable(): boolean {
  return adsEnabled && isTelegram();
}
