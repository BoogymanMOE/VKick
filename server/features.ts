/** Server-side twin of the client PREDICTIONS_ENABLED flag. Off unless explicitly enabled. */
export const PREDICTIONS_ENABLED = process.env.PREDICTIONS_ENABLED === "true";

/**
 * The value the producers and the bot copy actually read.
 *
 * A function rather than the bare constant so the flag is consulted at call
 * time (a test can flip it for one scenario, and a future admin toggle has
 * somewhere to live) while production behaviour stays "env at boot".
 */
let override: boolean | null = null;

export function predictionsEnabled(): boolean {
  return override ?? PREDICTIONS_ENABLED;
}

/** Test seam: force the flag on/off, or pass null to go back to the env value. */
export function setPredictionsEnabledForTest(value: boolean | null): void {
  override = value;
}

/** Server-side twin of the client RATINGS_ENABLED flag. Off unless explicitly enabled. */
export const RATINGS_ENABLED = process.env.RATINGS_ENABLED === "true";

/**
 * The value the ratings producers and the bot copy actually read. Same reason
 * as predictionsEnabled(): the flag is consulted at call time so a test can
 * flip it for one scenario while production stays "env at boot".
 */
let ratingsOverride: boolean | null = null;

export function ratingsEnabled(): boolean {
  return ratingsOverride ?? RATINGS_ENABLED;
}

/** Test seam: force the ratings flag on/off, or pass null for the env value. */
export function setRatingsEnabledForTest(value: boolean | null): void {
  ratingsOverride = value;
}
