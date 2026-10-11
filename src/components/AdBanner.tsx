/**
 * Anonymous Ads (A-ADS) banner.
 *
 * Renders the A-ADS iframe snippet when ADS_ENABLED is "true". Because the
 * snippet contains an <iframe> with custom attributes, it is injected via
 * innerHTML into a ref so React doesn't complain about the unknown element.
 *
 * The ad container collapses away when nothing fills it, so we never ship an
 * empty box to the user.
 */
import { useEffect, useRef, useState } from "react";
import { adsAvailable } from "../lib/ads";

/**
 * A-ADS snippet (unit 2458182). z-index lowered from the provider default of
 * 99998 to 1 so the ad never covers the app's bottom navigation or modals.
 */
const AADS_SNIPPET = `<!-- BEGIN AADS AD UNIT 2458182 -->
<div id="frame" style="width: 100%;margin: auto;position: relative; z-index: 1;">
  <iframe data-aa='2458182' src='//acceptable.a-ads.com/2458182/?size=Adaptive'
    style='border:0; padding:0; width:70%; height:auto; overflow:hidden;display: block;margin: auto'></iframe>
</div>
<!-- END AADS AD UNIT 2458182 -->`;

export function AdBanner() {
  const ref = useRef<HTMLDivElement | null>(null);
  const [filled, setFilled] = useState(false);

  useEffect(() => {
    if (!adsAvailable() || !ref.current) return;
    ref.current.innerHTML = AADS_SNIPPET;
    const frame = ref.current.querySelector<HTMLIFrameElement>("#frame iframe");
    if (frame) {
      const check = () => {
        try {
          // If the iframe is cross-origin we cannot read its content, but a
          // successful load event plus a non-zero offsetHeight is a decent
          // fill signal for same-origin or when the provider allows it.
          if (frame.offsetHeight > 0) setFilled(true);
        } catch {
          // Cross-origin — assume filled if the load event fired.
          setFilled(true);
        }
      };
      frame.addEventListener("load", check);
      // Also check immediately in case it already loaded.
      check();
      return () => frame.removeEventListener("load", check);
    }
  }, []);

  if (!adsAvailable() || !filled) return null;

  return (
    <div className="mx-auto max-w-[468px] mt-6">
      <p className="mb-2 text-center text-[10px] font-bold uppercase tracking-widest text-ink-3">Sponsored</p>
      <div ref={ref} className="rounded-card border border-line bg-surface p-2 text-center" />
    </div>
  );
}
