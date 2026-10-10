/**
 * The inline sponsored card — Adsgram's Task format in our own chrome.
 *
 * Renders <adsgram-task> (registered by the SDK in src/lib/ads.ts) only when
 * the placement can actually serve: inside Telegram with a block id. Adsgram
 * fires custom events on the element, and the card collapses itself on
 * "nothing to show" or a load error — an empty sponsored slot is worse than
 * none. On a completed task the user gets the success haptic; the component's
 * own claim/done slots handle the visual state.
 *
 * Failure policy, because an ad is never allowed to nag: the moment the
 * placement reports a problem — its own error events, or an error escaping the
 * SDK script/unhandled rejections — the card unmounts (returns null) AND
 * remembers for the rest of the session, so a remount (tab switch, route
 * change, poll) cannot retry the same rejected block and re-fire the same
 * failure on top of the user's screen.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { loadAdsgramScript, taskAdsAvailable, taskBlockId } from "../lib/ads";
import { notifyHaptic } from "../lib/telegram";
import { useI18n } from "../i18n/context";

/**
 * Session-lifetime "this placement is broken" flag. Module scope on purpose:
 * navigation remounts the component, and retrying a block Adsgram has already
 * rejected is how one bad fill turns into a stream of error popups. A reload
 * clears it, so a fixed block id comes back on its own.
 */
let placementFailed = false;

/**
 * The SDK's own failure wording (it throws things like "Block is not active"
 * out of its script rather than only emitting an element event). Kept loose —
 * the exact string is not part of any contract we control.
 */
const ADSGRAM_ERROR_RE = /adsgram|block is not active|block is inactive|block not found/i;

export function TaskAdCard() {
  const { t } = useI18n();
  const [ready, setReady] = useState(false);
  const [hidden, setHidden] = useState(placementFailed);
  const ref = useRef<HTMLElement | null>(null);

  /** Give up for the rest of the session: nothing may render this slot again. */
  const giveUp = useCallback(() => {
    placementFailed = true;
    setReady(false);
    setHidden(true);
  }, []);

  useEffect(() => {
    if (placementFailed || !taskAdsAvailable()) return;
    let cancelled = false;
    loadAdsgramScript()
      .then(() => {
        if (!cancelled) setReady(true);
      })
      .catch(() => {
        // No SDK, no card. This mount stays silent but a later one may retry
        // (loadAdsgramScript resets its promise), so the flag is not set here.
        if (!cancelled) setHidden(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Custom events live on the element itself (docs.adsgram.ai/publisher/task-integration-example).
  // `onError` is a hard failure (the retained-flag path); the other two mean
  // "nothing to show right now", which only collapses this mount so a later one
  // can still fill.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const hide = () => setHidden(true);
    const reward = () => notifyHaptic("success");
    el.addEventListener("reward", reward);
    el.addEventListener("onError", giveUp);
    el.addEventListener("onBannerNotFound", hide);
    el.addEventListener("onTooLongSession", hide);
    return () => {
      el.removeEventListener("reward", reward);
      el.removeEventListener("onError", giveUp);
      el.removeEventListener("onBannerNotFound", hide);
      el.removeEventListener("onTooLongSession", hide);
    };
  }, [ready, giveUp]);

  // The SDK also throws out of its own script — an uncaught error, or a rejected
  // promise — and that never reaches the element listeners above. Catch those at
  // the window and collapse the slot; otherwise the card stays mounted with a
  // toast the user cannot dismiss.
  useEffect(() => {
    if (!taskAdsAvailable()) return;
    const fromAdsgram = (event: ErrorEvent) =>
      ADSGRAM_ERROR_RE.test(`${event.message ?? ""} ${event.filename ?? ""}`);
    const onError = (event: ErrorEvent) => {
      if (fromAdsgram(event)) giveUp();
    };
    const onRejection = (event: PromiseRejectionEvent) => {
      const reason = event.reason as { message?: string } | string | undefined;
      const message = typeof reason === "string" ? reason : (reason?.message ?? "");
      if (ADSGRAM_ERROR_RE.test(message)) giveUp();
    };
    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onRejection);
    return () => {
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onRejection);
    };
  }, [giveUp]);

  if (!taskAdsAvailable() || hidden) return null;

  return (
    <div className="mt-6">
      <p className="mb-1 text-center text-[10px] font-bold uppercase tracking-widest text-ink-3">
        {t("ads.sponsored")}
      </p>
      {ready ? (
        <adsgram-task
          ref={ref}
          data-block-id={taskBlockId}
          data-debug={import.meta.env.DEV ? "true" : undefined}
          className="block w-full"
        />
      ) : null}
    </div>
  );
}
