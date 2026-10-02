/**
 * Literal color values for contexts CSS can't reach (inline SVG fills, canvas
 * paint, JS style objects). Keep in sync with tokens.css — the design system
 * is still the source of truth; this module only mirrors it.
 *
 * `TEAM_FALLBACK` replaces the retired #6E8880 (which failed AA on elevated
 * surfaces) with the muted-text token value #7B958C.
 */
export const TEAM_FALLBACK = "#7B958C";

/**
 * Ink color that stays readable on top of an arbitrary club colour: club
 * colours come from ESPN and range from near-black to pastel blue, so fixed
 * white text fails WCAG AA on every light fill (1.82:1 on #99C5EA). Returns
 * black-ish ink for light fills, white for dark ones — AA needs 4.5:1 for the
 * small jersey numbers these discs carry.
 */
export function readableInk(hex: string | null | undefined): string {
  const m = typeof hex === "string" ? hex.trim().match(/^#([0-9a-f]{6})$/i) : null;
  if (!m) return "#FFFFFF"; // unknown/fallback colours are mid-dark; keep white
  const n = parseInt(m[1]!, 16);
  const r = (n >> 16) & 0xff;
  const g = (n >> 8) & 0xff;
  const b = n & 0xff;
  // WCAG relative luminance (linear channel values, sRGB gamma).
  const lin = (v: number) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  const L = 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
  // Black text on white is 21:1; the crossover keeps every mid tone on white.
  return L > 0.2126 ? "#04100B" : "#FFFFFF";
}
