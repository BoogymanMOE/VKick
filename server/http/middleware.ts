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

/**
 * Terminal error handler. Logs to the console AND to the rotating error log so
 * an unhandled failure survives a restart, then answers 500 unless the response
 * has already started.
 */
export function apiErrorHandler(err: Error, req: Request, res: Response, _next: NextFunction): void {
  console.error("[api] unhandled:", err);
  logServerError(err, `${req.method} ${req.path}`);
  if (!res.headersSent) res.status(500).json({ error: "internal error" });
}
