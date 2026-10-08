/**
 * Error plumbing, driven over real HTTP.
 *
 * Three promises are checked here:
 *  1. an unhandled API error is answered as JSON *and* persisted to
 *     logs/server-errors.log (console output is not durability);
 *  2. POST /api/client-errors accepts anonymous and signed-in reports, caps the
 *     payload, is rate-limited, and records identity only as a user id;
 *  3. an unmatched non-GET /api/* path answers JSON 404 rather than falling
 *     through to Express's HTML default handler.
 *
 * WHY A CHILD PROCESS: route modules call `getDb()` at module scope and ESM
 * caches modules per process, so router-driving suites cannot share one (see
 * tests/guestMerge.test.ts).
 */
import { strict as assert } from "node:assert";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { AddressInfo } from "node:net";
import express from "express";
import { closeDb, getDb, run } from "../server/db/index.js";
import { clientErrorLogFile, serverErrorLogFile } from "../server/http/errorLog.js";

const CHILD_FLAG = "VKICK_ERRORS_CHILD";
const SUMMARY =
  "  errors: unhandled error persisted to logs/, client-errors 200+cap+rate-limit+identity, non-GET /api/* JSON 404 OK";

interface Res {
  status: number;
  contentType: string;
  body: Record<string, unknown> | null;
  retryAfter: string | null;
}

function listen(app: express.Express): Promise<{ port: number; close: () => Promise<void> }> {
  const server = app.listen(0);
  return new Promise((resolve) => {
    server.once("listening", () => {
      const port = (server.address() as AddressInfo).port;
      resolve({ port, close: () => new Promise<void>((r) => server.close(() => r())) });
    });
  });
}

function parseBody(buf: string): Record<string, unknown> | null {
  if (!buf) return null;
  try {
    return JSON.parse(buf) as Record<string, unknown>;
  } catch {
    return { raw: buf.slice(0, 120) };
  }
}

function call(
  port: number,
  method: string,
  url: string,
  headers: Record<string, string> = {},
  body?: unknown,
): Promise<Res> {
  const raw = body === undefined ? undefined : JSON.stringify(body);
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        host: "127.0.0.1",
        port,
        path: url,
        method,
        headers: {
          ...(raw ? { "content-type": "application/json", "content-length": Buffer.byteLength(raw) } : {}),
          ...headers,
        },
      },
      (res) => {
        let buf = "";
        res.on("data", (c) => (buf += c));
        res.on("end", () =>
          resolve({
            status: res.statusCode ?? 0,
            contentType: String(res.headers["content-type"] ?? ""),
            body: parseBody(buf),
            retryAfter: (res.headers["retry-after"] as string) ?? null,
          }),
        );
      },
    );
    req.on("error", reject);
    req.end(raw);
  });
}

function readLog(file: string): string {
  try {
    return fs.readFileSync(file, "utf8");
  } catch {
    return "";
  }
}

async function suite(): Promise<void> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vkick-errors-"));
  const previousDb = process.env.SQLITE_PATH;
  closeDb();
  process.env.SQLITE_PATH = path.join(dir, "errors.db");
  try {
    const { errorsRouter } = await import("../server/routes/errors.js");
    const { apiNotFound, apiErrorHandler } = await import("../server/http/middleware.js");

    const db = getDb();
    const now = new Date().toISOString();
    run(db, "INSERT INTO users (telegram_id, display_name, created_at) VALUES ('800001', 'Err User', ?)", [
      now,
    ]);
    const userId = (db.prepare("SELECT id FROM users WHERE telegram_id = '800001'").get() as { id: number })
      .id;
    const token = "mg_errors_test_token";
    run(db, "INSERT INTO user_sessions (token, user_id, created_at, last_used_at) VALUES (?, ?, ?, ?)", [
      token,
      userId,
      now,
      now,
    ]);
    const auth = { authorization: `Bearer ${token}` };

    const app = express();
    app.use(express.json());
    const boomMarker = `kaboom-${Date.now()}`;
    app.get("/api/boom", () => {
      throw new Error(boomMarker);
    });
    app.use(errorsRouter);
    app.use(apiNotFound);
    app.use(apiErrorHandler);
    const { port, close } = await listen(app);

    try {
      /* ------------------------------------------------ unhandled error persists */
      const serverBefore = readLog(serverErrorLogFile);
      const boom = await call(port, "GET", "/api/boom");
      assert.equal(boom.status, 500, "an unhandled error answers 500");
      assert.equal(boom.body?.error, "internal error");
      assert.ok(boom.contentType.includes("application/json"), "and in JSON, not HTML");
      const serverAfter = readLog(serverErrorLogFile);
      assert.ok(serverAfter.length > serverBefore.length, "the error appended to logs/server-errors.log");
      assert.ok(serverAfter.includes(boomMarker), "the log carries the error message");
      assert.ok(serverAfter.includes("GET /api/boom"), "and the request context");

      /* ------------------------------------------------ client-errors: signed in */
      const signed = await call(port, "POST", "/api/client-errors", auth, {
        message: "signed-in marker",
        stack: "at foo",
        url: "https://app.example/x",
        source: "react-boundary",
      });
      assert.equal(signed.status, 200, `signed-in report accepted (${JSON.stringify(signed.body)})`);
      assert.equal(signed.body?.ok, true);
      const log1 = readLog(clientErrorLogFile);
      assert.ok(log1.includes("signed-in marker"), "the message is logged");
      assert.ok(log1.includes(`user=${userId}`), "the signed-in user id is attached");
      assert.ok(log1.includes("source=react-boundary"), "the source is recorded");

      /* ------------------------------------------------ client-errors: anonymous */
      const anon = await call(port, "POST", "/api/client-errors", {}, { message: "anon marker" });
      assert.equal(anon.status, 200, "anonymous reporting is allowed");
      const log2 = readLog(clientErrorLogFile);
      assert.ok(log2.includes("anon marker"));
      assert.ok(log2.includes("user=-"), "an anonymous report records no identity");

      /* ------------------------------------------------ client-errors: validation */
      const empty = await call(port, "POST", "/api/client-errors", {}, { message: "   " });
      assert.equal(empty.status, 400, "an empty message is refused");

      /* ------------------------------------------------ client-errors: logged out */
      // Deleting the session simulates a signing-out user: the token no longer
      // resolves, but reporting must still succeed and must not throw.
      run(db, "DELETE FROM user_sessions WHERE token = ?", [token]);
      const loggedOut = await call(port, "POST", "/api/client-errors", auth, {
        message: "logged-out marker",
      });
      assert.equal(loggedOut.status, 200, "a dead session does not turn reporting into an error");
      assert.ok(readLog(clientErrorLogFile).includes("logged-out marker"));

      /* ------------------------------------------------ client-errors: payload cap */
      const huge = "A".repeat(1000);
      const capped = await call(port, "POST", "/api/client-errors", {}, { message: huge });
      assert.equal(capped.status, 200);
      const log3 = readLog(clientErrorLogFile);
      assert.ok(log3.includes("A".repeat(500)), "500 chars of the message are kept");
      assert.ok(!log3.includes("A".repeat(501)), "everything past the 500-char cap is dropped");

      /* ------------------------------------------------ client-errors: rate limit */
      // Budget is 30/60s. Steps above spent five successful reports, so the next
      // 25 pass and the 26th is the first refusal.
      const spent = 5;
      const statuses: number[] = [];
      for (let i = 0; i < 35; i++) {
        const r = await call(port, "POST", "/api/client-errors", {}, { message: `spam-${i}` });
        statuses.push(r.status);
        if (r.status === 429) {
          assert.equal(i, 30 - spent, `first refusal at request ${30 - spent}, got ${i}`);
          assert.equal(r.body?.error, "TOO_MANY_REQUESTS");
          assert.ok(Number(r.retryAfter) > 0, "a Retry-After is sent");
          break;
        }
      }
      assert.equal(statuses.filter((s) => s === 429).length, 1, "the limiter trips");

      /* ------------------------------------------------ JSON 404 for non-GET */
      for (const method of ["DELETE", "PUT", "POST", "GET"]) {
        const miss = await call(port, method, "/api/does-not-exist");
        assert.equal(miss.status, 404, `${method} /api/does-not-exist is 404`);
        assert.ok(
          miss.contentType.includes("application/json"),
          `${method} miss must be JSON, got ${miss.contentType}`,
        );
        assert.equal(miss.body?.error, "not found");
      }
    } finally {
      await close();
    }
  } finally {
    if (previousDb === undefined) delete process.env.SQLITE_PATH;
    else process.env.SQLITE_PATH = previousDb;
    closeDb();
    try {
      fs.rmSync(dir, { recursive: true, force: true, maxRetries: 3 });
    } catch {
      /* a leftover temp dir must not fail a passing suite */
    }
  }
}

export async function runErrorsTests(): Promise<void> {
  if (process.env[CHILD_FLAG] === "1") {
    await suite();
    return;
  }
  const result = spawnSync(process.execPath, ["--import", "tsx", fileURLToPath(import.meta.url)], {
    stdio: "inherit",
    env: { ...process.env, [CHILD_FLAG]: "1" },
  });
  if (result.error) throw result.error;
  assert.equal(result.status, 0, `errors child process failed (exit ${result.status})`);
  console.log(SUMMARY);
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  await runErrorsTests();
}
