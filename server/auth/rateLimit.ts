/**
 * Minimal fixed-window rate limiter (no external deps).
 *
 * Single-process by design: this server runs as one Node process with SQLite,
 * so an in-memory map is honest state. Keys are namespaced (`n:ip` / `u:name`)
 * and swept lazily — every ~50th hit prunes expired buckets so the map cannot
 * grow unbounded under scan traffic.
 *
 * On the auth endpoints the limiter is keyed by BOTH IP and username:
 * IP-only keys stop naive flooding, while the username key stops a
 * distributed attacker from spraying one name from many IPs.
 */
import type { Request, Response, NextFunction } from "express";

interface Bucket {
  count: number;
  resetAt: number;
}

const buckets = new Map<string, Bucket>();

let hits = 0;
function sweep(): void {
  if (++hits % 50 !== 0) return;
  const now = Date.now();
  for (const [k, b] of buckets) {
    if (b.resetAt <= now) buckets.delete(k);
  }
}

function clientIp(req: Request): string {
  // Behind the vite dev proxy (or a reverse proxy), trust proxy is on and
  // req.ip is the real client; otherwise it's the socket address.
  return req.ip ?? req.socket.remoteAddress ?? "unknown";
}

export interface LimitOptions {
  windowMs: number;
  max: number;
  /** Extra key component (e.g. the username being attempted) so one account
   *  can't be sprayed from rotating IPs. */
  extraKey?: (req: Request) => string | undefined;
  /** Named so two limiters on one route don't share buckets. */
  name: string;
}

export function rateLimit(opts: LimitOptions) {
  return (req: Request, res: Response, next: NextFunction): void => {
    sweep();
    const parts = [opts.name, clientIp(req)];
    const extra = opts.extraKey?.(req);
    if (extra) parts.push(`u:${extra.toLowerCase()}`);
    const key = parts.join("|");
    const now = Date.now();

    let bucket = buckets.get(key);
    if (!bucket || bucket.resetAt <= now) {
      bucket = { count: 0, resetAt: now + opts.windowMs };
      buckets.set(key, bucket);
    }
    bucket.count += 1;

    if (bucket.count > opts.max) {
      const retry = Math.ceil((bucket.resetAt - now) / 1000);
      res.set("Retry-After", String(retry));
      res.status(429).json({ error: "TOO_MANY_REQUESTS", retryAfter: retry });
      return;
    }
    next();
  };
}

/** Presets shared by the auth routes. */
export const authLimiter = rateLimit({
  name: "auth",
  windowMs: 15 * 60_000,
  max: 20,
});

/** Credential attempts (sign-in / register): stricter, keyed per-account too. */
export const credentialLimiter = rateLimit({
  name: "pw",
  windowMs: 15 * 60_000,
  max: 10,
  extraKey: (req) => {
    const u = req.body?.username;
    return typeof u === "string" && u.trim() ? u.trim() : undefined;
  },
});

/** General write endpoints (ratings, comments, predictions). */
export const writeLimiter = rateLimit({
  name: "write",
  windowMs: 60_000,
  max: 60,
});
