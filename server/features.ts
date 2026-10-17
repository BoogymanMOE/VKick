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
