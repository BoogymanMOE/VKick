/**
 * The inline sponsored card — Adsgram's Task format in our own chrome.
 *
 * Renders <adsgram-task> (registered by the SDK in src/lib/ads.ts) only when
 * the placement can actually serve: inside Telegram with a block id. Adsgram
 * fires custom events on the element, and the card collapses itself on
 * "nothing to show" or a load error — an empty sponsored slot is worse than
 * none. On a completed task the user gets the success haptic; the component's
 * own claim/done slots handle the visual state.
 */
import { useEffect, useRef, useState } from "react";
import { loadAdsgramScript, taskAdsAvailable, taskBlockId } from "../lib/ads";
import { notifyHaptic } from "../lib/telegram";
import { useI18n } from "../i18n/I18nProvider";

export function TaskAdCard() {
  const { t } = useI18n();
  const [ready, setReady] = useState(false);
  const [hidden, setHidden] = useState(false);
  const ref = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!taskAdsAvailable()) return;
    let cancelled = false;
    loadAdsgramScript()
      .then(() => {
        if (!cancelled) setReady(true);
      })
      .catch(() => {
        /* no SDK, no card — the placement stays silent */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Custom events live on the element itself (docs.adsgram.ai/publisher/task-integration-example).
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const hide = () => setHidden(true);
    const reward = () => notifyHaptic("success");
    el.addEventListener("reward", reward);
    el.addEventListener("onError", hide);
    el.addEventListener("onBannerNotFound", hide);
    el.addEventListener("onTooLongSession", hide);
    return () => {
      el.removeEventListener("reward", reward);
      el.removeEventListener("onError", hide);
      el.removeEventListener("onBannerNotFound", hide);
      el.removeEventListener("onTooLongSession", hide);
    };
  }, [ready]);

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
