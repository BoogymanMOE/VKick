/**
 * Shared HTTP middleware, extracted from server/index.ts so it is reachable
 * and testable without booting the whole server.
 */
import type { Request, Response, NextFunction } from "express";
import { logServerError } from "./errorLog.js";

/**
 * Unmatched `/api/*` requests answer in the API's dialect — JSON — regardless
 * of method. The old behaviour let a non-GET miss (e.g. `DELETE /api/me` on a
 * version without the route) fall through to Express's default handler and
 * return an HTML page, which a JSON client turns into "Unexpected token '<'".
 */
export function apiNotFound(req: Request, res: Response, next: NextFunction): void {
  if (req.path.startsWith("/api")) {
    res.status(404).json({ error: "not found" });
    return;
  }
  next();
}

/** Errors that declare their own HTTP status (body-parser and friends). */
interface HttpError extends Error {
  status?: number;
  statusCode?: number;
}

/**
 * The 4xx an error already declared, or null to treat it as a server fault.
 * Only 400-499 are honoured: a missing/NaN status (the unexpected case) and any
 * 5xx stay a plain 500, so a bug still reads as a server error rather than
 * echoing an attacker- or library-chosen code.
 */
function clientErrorStatus(err: HttpError): number | null {
  const status = Number(err.status ?? err.statusCode);
  if (!Number.isInteger(status) || status < 400 || status > 499) return null;
  return status;
}

/** Stable, non-leaky body label for a client error. */
function clientErrorLabel(status: number): string {
  if (status === 400) return "bad request";
  if (status === 413) return "payload too large";
  return "request error";
}

/**
 * Terminal error handler. Logs to the console AND to the rotating error log so
 * an unhandled failure survives a restart, then answers in JSON unless the
 * response has already started.
 *
 * Client-shaped failures keep their own status instead of being flattened to
 * 500: a body-parser overflow is a 413 (PayloadTooLargeError) and malformed
 * JSON is a 400 (SyntaxError from express.json), both of which used to read as
 * "internal error" and send a JSON client chasing a server bug. Anything else
 * — including a bare `throw new Error()` with no status — is still a 500.
 */
export function apiErrorHandler(err: HttpError, req: Request, res: Response, _next: NextFunction): void {
  console.error("[api] unhandled:", err);
  logServerError(err, `${req.method} ${req.path}`);
  if (res.headersSent) return;
  const status = clientErrorStatus(err);
  if (status !== null) {
    res.status(status).json({ error: clientErrorLabel(status) });
    return;
  }
  res.status(500).json({ error: "internal error" });
}
