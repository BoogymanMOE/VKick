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
 * Ads (the in-feed A-ADS unit). Build-time switch: set VITE_ADS_ENABLED=false
 * to ship a build with no ad iframe at all. The standalone A-ADS/Tapsell tags
 * that used to sit in index.html are gone — both loaded third-party scripts
 * on every boot, above the app, whether or not the feed ad rendered.
 */
export const ADS_ENABLED = import.meta.env.VITE_ADS_ENABLED !== "false";

/**
 * Algorithmic per-player ratings derived from ESPN event data.
 * Default off until enabled on Render.
 */
export const ALGORITHMIC_RATINGS = import.meta.env.VITE_ALGORITHMIC_RATINGS === "true";
