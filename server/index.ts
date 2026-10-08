import express, { type Request, type Response, type NextFunction } from "express";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Project root. Two shapes reach this file and they are NOT the same depth:
 * the emitted build (dist-server/server/index.js) sits two levels below the
 * root, source (tsx server/index.ts) only one. So the depth cannot be
 * hardcoded — `path.resolve(__dirname, "..", "..")` was correct for the
 * build and one level too high for source, which pointed the static handler
 * at <drive-root>/dist and the rotating log at <drive-root>/logs/api.log
 * (outside the project, and missing). Walk up to the nearest package.json
 * instead: one rule, both layouts.
 */
function findProjectRoot(start: string): string {
  let dir = start;
  for (;;) {
    if (fs.existsSync(path.join(dir, "package.json"))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) return start; // hit the filesystem root — nothing better to offer
    dir = parent;
  }
}

const ROOT_DIR = findProjectRoot(__dirname);
import { getDb, get } from "./db/index.js";
import { pruneFootballDetail, pruneSessions, logCapKb, RotatingLogger } from "./db/retention.js";
import { startSyncLoop } from "./sync/service.js";
import { startBot } from "./bot/index.js";
import { startResolverLoop } from "./predictions/resolver.js";
import { gzip } from "./http/gzip.js";

// Route modules — one per domain, mounted below. Endpoint paths and behavior
// are identical to the pre-split monolith.
import { authRouter } from "./routes/auth.js";
import { meRouter } from "./routes/me.js";
import { matchesRouter } from "./routes/football.js";
import { predictionsRouter } from "./routes/predictions.js";
import { ratingsRouter } from "./routes/ratings.js";
import { leaderboardsRouter } from "./routes/leaderboards.js";
import { moderationRouter } from "./routes/moderation.js";
import { adminRouter } from "./routes/admin.js";

const app = express();
const db = getDb();

// File-based SQLite + in-process cron loops (sync, resolver, retention): the
// API must run as exactly one instance. Scale by making this box bigger, not
// by running more of it.
// apiLog writes into logs/ on the retention lines only, and appendFileSync
// throws ENOENT when the directory is absent. start.bat creates it, but
// `npm run server` on its own does not — so the directory is guaranteed here
// rather than assumed. Best-effort: a read-only checkout must not stop boot.
try {
  fs.mkdirSync(path.join(ROOT_DIR, "logs"), { recursive: true });
} catch {
  /* the rotating logger degrades to console output */
}
const apiLog = new RotatingLogger(path.join(ROOT_DIR, "logs", "api.log"), logCapKb());

// Exactly ONE trusted reverse-proxy hop sits in front of the API in every
// documented deployment: the vite dev proxy locally, Render's router in
// production. "1" makes req.ip the real client address from X-Forwarded-For
// while refusing to trust a client-supplied proxy chain (the old `true`
// trusted anything, so a direct connection could spoof its IP past the
// rate limiter's IP keys).
app.set("trust proxy", 1);
// Header hygiene: X-Powered-By advertises the stack for nothing, and nosniff
// stops a browser re-interpreting a response as some other type. Deliberately
// NO Content-Security-Policy yet: it has to be proven against the Telegram
// webview (which frames the Mini App), the ESPN logo CDN and the Adsgram SDK
// first — a wrong CSP bricks the app for every user at once.
app.disable("x-powered-by");
app.use((_req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  next();
});
// Buffered gzip (see http/gzip.ts): the bundles were going out uncompressed.
app.use(gzip);
// 64KB body cap: far above any legit prediction/comment payload, well below
// abuse size. (default was 100KB; explicit + smaller now that payloads are validated)
app.use(express.json({ limit: "64kb" }));

/* --------------------------------------------------------------- ops */

/**
 * Liveness probe. Unauthenticated and dependency-light: it says whether the
 * process is up and the database answers, which is all an uptime monitor or a
 * proxy health check needs. 503 on a broken DB so the check can actually fail.
 */
app.get("/health", (_req, res) => {
  try {
    get<{ ok: number }>(db, "SELECT 1 AS ok", []);
    res.json({ ok: true, uptime: Math.round(process.uptime()) });
  } catch (err) {
    res.status(503).json({ ok: false, error: String(err) });
  }
});

/* ------------------------------------------------------------ routes */

app.use(authRouter);
app.use(meRouter);
app.use(matchesRouter);
app.use(predictionsRouter);
app.use(ratingsRouter);
app.use(leaderboardsRouter);
app.use(moderationRouter);
app.use(adminRouter);

/* ------------------------------------------------------------ static frontend */

// Serve the built Vite frontend (dist/) so the React app loads in production.
app.use(
  express.static(path.join(ROOT_DIR, "dist"), {
    setHeaders: (res, filePath) => {
      // Vite fingerprints everything under /assets/, so those bytes cannot
      // change under the same URL — cache them for a year. Everything else
      // revalidates, index.html above all: shipping a stale shell after a
      // deploy is how users end up requesting bundles that no longer exist.
      const immutable = filePath.includes(`${path.sep}assets${path.sep}`);
      res.setHeader("Cache-Control", immutable ? "public, max-age=31536000, immutable" : "no-cache");
    },
  }),
);

// SPA fallback: any GET that didn't match an API route or a static file
// falls through to index.html so React Router owns client-side routing.
app.use((req, res, next) => {
  if (req.method !== "GET") return next();
  // Unmatched API paths answer in the API's dialect: a JSON client parsing an
  // HTML 404 turns a typo'd route into an opaque "Unexpected token" failure.
  if (req.path.startsWith("/api")) return res.status(404).json({ error: "not found" });
  // A MISS on a real file must 404 rather than fall through to the shell —
  // returning index.html with 200 for /assets/whatever.js is what turns a
  // post-deploy stale page into "Unexpected token '<'" instead of a reload.
  if (/\.[a-z0-9]+$/i.test(req.path)) return res.status(404).type("text/plain").send("Not found");
  return res.sendFile(path.join(ROOT_DIR, "dist", "index.html"), (err) => {
    if (err) next(err);
  });
});

/* ------------------------------------------------------------ errors */

app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  console.error("[api] unhandled:", err);
  if (!res.headersSent) res.status(500).json({ error: "internal error" });
});

const PORT = parseInt(process.env.PORT ?? "8787", 10);

// Production hard stop: DEV_AUTH_SECRET turns `dev:<any-id>` into ANY user's
// identity, so shipping it live is a full auth bypass. Refuse to boot rather
// than warn-and-continue — a warning scrolls away, an outage doesn't.
if (process.env.NODE_ENV === "production" && (process.env.DEV_AUTH_SECRET ?? "").trim()) {
  console.error(
    "[api] refusing to start: DEV_AUTH_SECRET is set with NODE_ENV=production — " +
      "dev tokens would let anyone impersonate any user id. Unset DEV_AUTH_SECRET.",
  );
  process.exit(1);
}

const server = app.listen(PORT, () => {
  // Print what was actually bound, not what we asked for: an unbound or
  // IPv6-only listener looks identical from the outside until something tries
  // to connect, and "listening" alone has already cost a debugging session.
  const addr = server.address();
  const bound = typeof addr === "object" && addr ? `${addr.address}:${addr.port}` : String(PORT);
  console.log(`[api] listening on http://${bound}`);
  console.log(`[api] reachable at http://localhost:${PORT} and http://127.0.0.1:${PORT}`);
  if (!process.env.TELEGRAM_BOT_TOKEN) {
    console.warn("[api] TELEGRAM_BOT_TOKEN not set — Telegram auth disabled");
  }
  runRetentionSweep("boot");
  if (process.env.SKIP_CRON === "1") {
    console.log("[api] SKIP_CRON=1 — sync/resolver cron loops disabled (dev fixtures stay put)");
  } else {
    startSyncLoop();
    startResolverLoop();
    startBot(process.env.TELEGRAM_BOT_TOKEN ?? "");
  }
});

// A bind failure (port taken) is otherwise an unhandled 'error' event.
server.on("error", (err) => {
  console.error("[api] listen failed:", String(err));
  process.exit(1);
});

/**
 * Boot + daily sweep: expired sessions and football detail past the retention
 * window. Every stage is individually caught — a failing DELETE must never
 * take the API down from inside housekeeping. Skip when SKIP_CRON=1 (dev
 * fixtures stay put, same rule the sync/resolver loops follow).
 */
function runRetentionSweep(when: string): void {
  if (process.env.SKIP_CRON === "1") return;
  try {
    const result = pruneFootballDetail(db);
    const removed = Object.values(result.deleted).reduce((sum, n) => sum + n, 0);
    if (result.candidates > 0 || removed > 0) {
      const line = `[api] retention(${when}): ${result.candidates} stale match(es), ${removed} detail row(s) pruned`;
      console.log(line);
      apiLog.append(`${new Date().toISOString()} ${line}\n`);
    }
  } catch (err) {
    console.error(`[api] retention(${when}) failed:`, String(err).slice(0, 200));
  }
  try {
    const n = pruneSessions(db);
    if (n > 0) console.log(`[api] pruned ${n} expired session(s)`);
  } catch (err) {
    console.error("[api] session sweep failed:", String(err).slice(0, 200));
  }
}

// Daily clock; the boot pass already ran inside app.listen's callback.
setInterval(() => runRetentionSweep("daily"), 24 * 3_600_000).unref();

for (const sig of ["SIGINT", "SIGTERM"] as const) {
  process.once(sig, () => {
    console.log(`[api] ${sig} — closing server`);
    // Drop keep-alives first: `close()` alone waits for them, and the vite
    // proxy holds some open, which used to leave a process alive with a closed
    // listener — the API looked started and answered nothing.
    server.closeAllConnections?.();
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 3_000);
  });
}
