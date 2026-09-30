/**
 * Crest normalization shared by fetch-logos.mjs (ESPN CDN) and
 * import-logos.mjs (local collection).
 *
 * Both sources pad their artwork to a fixed canvas — the local collection at
 * 139x181 — so a plain "fit inside 96px" scales the *padding*, not the crest.
 * A 139x37 wordmark ends up the same canvas size as a 139x139 roundel and
 * renders far smaller in the badge. Normalizing trims the transparent border
 * first, then scales the artwork to one fixed footprint and re-centres it on a
 * square canvas, so every crest reads at the same size in a badge.
 *
 * ARTWORK_PX is the knob: it is the crest's longest edge, inside a CANVAS_PX
 * badge box. Lower it to make crests smaller relative to the badge.
 */
import sharp from "sharp";

export const CANVAS_PX = 96;
export const ARTWORK_PX = 80;
const TRIM_THRESHOLD = 10;

/**
 * Trim -> scale longest edge to `target` -> centre on a transparent
 * `canvas`x`canvas` square. Returns null if the input can't be read, so
 * callers can keep the unprocessed file rather than dropping a crest.
 */
export async function normalizeCrest(input, { target = ARTWORK_PX, canvas = CANVAS_PX } = {}) {
  try {
    const art = await sharp(input)
      .trim({ threshold: TRIM_THRESHOLD })
      .resize(target, target, { fit: "inside", withoutEnlargement: false })
      .png()
      .toBuffer();
    return await sharp({
      create: {
        width: canvas,
        height: canvas,
        channels: 4,
        background: { r: 0, g: 0, b: 0, alpha: 0 },
      },
    })
      .composite([{ input: art, gravity: "center" }])
      .png({ compressionLevel: 9 })
      .toBuffer();
  } catch {
    return null;
  }
}

/**
 * WebP is the format the browser actually downloads; PNG is kept as the
 * <picture> fallback. AVIF is smaller again (~2.2KB vs 3.5KB per crest) but
 * its decode cost is punishing on the low-end Android webviews this app ships
 * into, and the Matches feed alone can pull hundreds of crests — so it loses.
 */
export async function toWebp(png, { quality = 82 } = {}) {
  try {
    return await sharp(png).webp({ quality, effort: 6, alphaQuality: 90 }).toBuffer();
  } catch {
    return null;
  }
}
