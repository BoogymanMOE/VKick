/**
 * True when the app runs inside the share-mode frame (/frame.html loads it with ?embed=1).
 */
export const IS_EMBED =
  typeof window !== "undefined" && new URLSearchParams(window.location.search).get("embed") === "1";
