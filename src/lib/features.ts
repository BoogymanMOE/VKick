/**
 * Master switch for every prediction-related surface (intro slide,
 * notification toggle, admin counter, Predict pills). Set to true to bring
 * the prediction UI back. The prediction code itself stays in the repo.
 */
export const PREDICTIONS_ENABLED = false;

/**
 * Master switch for every player-ratings surface (Ratings page, intro slide,
 * notification toggle, stats "points" column). Set to true to bring them back.
 * The ratings code stays in the repo.
 */
export const RATINGS_ENABLED = false;

/**
 * Algorithmic per-player ratings derived from ESPN event data.
 * Default off until enabled on Render.
 */
export const ALGORITHMIC_RATINGS = import.meta.env.VITE_ALGORITHMIC_RATINGS === "true";
console.log("ALGORITHMIC_RATINGS=", import.meta.env.VITE_ALGORITHMIC_RATINGS, "->", ALGORITHMIC_RATINGS);
