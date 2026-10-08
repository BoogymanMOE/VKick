/**
 * Client error reporting: the browser tells the server what went wrong.
 *
 *   POST /api/client-errors   { message, stack?, url?, source? }
 *
 * Anonymous is allowed on purpose — a crash during sign-in is exactly the one
 * worth capturing — but when a valid token rides along the user id is recorded
 * so a support question can be traced. Payloads are capped and rate-limited, and
 * nothing but the id is ever taken from the caller's identity (no names, no
 * tokens, no initData). The log line lands in logs/client-errors.log.
 */
import express from "express";
import { clientErrorLimiter } from "../auth/rateLimit.js";
import { logClientError } from "../http/errorLog.js";
import { bad, optionalUserId } from "./shared.js";

export const errorsRouter = express.Router();

const MAX_MESSAGE = 500;
const MAX_STACK = 2000;
const MAX_URL = 500;
const MAX_SOURCE = 40;

function clip(value: unknown, max: number): string | undefined {
  return typeof value === "string" ? value.slice(0, max) : undefined;
}

errorsRouter.post("/api/client-errors", clientErrorLimiter, (req, res) => {
  const body = (req.body ?? {}) as Record<string, unknown>;
  const message = typeof body.message === "string" ? body.message.trim() : "";
  if (!message) return bad(res, "message required");

  logClientError({
    userId: optionalUserId(req),
    message: message.slice(0, MAX_MESSAGE),
    stack: clip(body.stack, MAX_STACK),
    url: clip(body.url, MAX_URL),
    source: clip(body.source, MAX_SOURCE),
  });

  // Always 200: the report is best-effort and the client must not retry-loop.
  res.json({ ok: true });
});
