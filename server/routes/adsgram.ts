/**
 * Adsgram reward webhook: Adsgram tells us a Task card was completed.
 *
 *   GET /api/adsgram/reward?userId=<adsgram user id>
 *
 * Adsgram calls this URL server-to-server (no Authorization header, so it must
 * stay unauthenticated) when a user finishes one of the Task cards rendered in
 * the Mini App. The response is unconditional: Adsgram only keeps the webhook
 * alive while it answers `200 { status: "ok" }`, and an error or a 4xx makes it
 * retry and eventually disable the callback — so an absent or unrecognised
 * userId is logged, never rejected.
 *
 * Nothing is credited yet. This endpoint proves the wiring end to end; the log
 * line is where a real grant hooks in once an Adsgram userId can be mapped to
 * an account (the card is shown inside Telegram, so the mapping is a product
 * decision, not a parse).
 */
import express from "express";

export const adsgramRouter = express.Router();

/**
 * The id arrives in a query string, so it is caller-controlled text on its way
 * into a log line: keep only id-shaped characters and cap the length.
 */
function cleanUserId(raw: unknown): string {
  return String(raw ?? "")
    .replace(/[^A-Za-z0-9._:@-]/g, "")
    .slice(0, 64);
}

adsgramRouter.get("/api/adsgram/reward", (req, res) => {
  const userId = cleanUserId(req.query.userId);
  if (userId) console.log(`[adsgram] reward webhook — userId=${userId}`);
  else console.warn("[adsgram] reward webhook without a userId");
  res.json({ status: "ok" });
});
