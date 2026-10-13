/**
 * Inline sponsored banner (Anonymous Ads / A-ADS).
 *
 * The iframe is only created when ADS_ENABLED was exactly "true" at build time,
 * which vite.config's `define` injects as `__ADS_ENABLED__`. Returning null
 * before the iframe exists means a disabled build never requests the A-ADS unit
 * at all, rather than loading it and hiding it with CSS.
 *
 * The switch is read through the define (not `import.meta.env`) so it is baked
 * at build time: flipping it needs a rebuild. See `.env.example`.
 */
const ADS_ENABLED = __ADS_ENABLED__ === "true";

export default function AdBanner() {
  if (!ADS_ENABLED) return null;

  return (
    <div className="mx-auto my-6 max-w-[468px] min-h-[100px]">
      <iframe
        data-aa="2458182"
        src="//acceptable.a-ads.com/2458182/?size=Adaptive"
        style={{
          border: 0,
          padding: 0,
          overflow: "hidden",
          display: "block",
          margin: "auto",
        }}
        width="100%"
        height="auto"
        title="Advertisement"
      ></iframe>
    </div>
  );
}
