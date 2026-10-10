/**
 * The Adsgram reward webhook, driven over real HTTP.
 *
 * What is pinned here:
 *  1. `GET /api/adsgram/reward?userId=…` answers `200 { status: "ok" }` — the
 *     exact shape Adsgram requires, and the only reason it keeps the callback;
 *  2. a call WITHOUT a userId still gets 200 (an error would make Adsgram retry
 *     and eventually disable the webhook), and logs a distinguishable line;
 *  3. the userId reaches the server log, which is the deliverable at this stage.
 *
 * No database, no child process: unlike the other router suites this module
 * imports nothing that opens the shared handle at module scope (see
 * tests/errors.test.ts for why that matters elsewhere).
 */
import { strict as assert } from "node:assert";
import http from "node:http";
import { pathToFileURL } from "node:url";
import type { AddressInfo } from "node:net";
import express from "express";
import { adsgramRouter } from "../server/routes/adsgram.js";

const SUMMARY = '  adsgram: reward webhook 200 + {status:"ok"} with and without userId, userId logged';

interface Res {
  status: number;
  contentType: string;
  body: Record<string, unknown> | null;
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

function get(port: number, url: string): Promise<Res> {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: "127.0.0.1", port, path: url, method: "GET" }, (res) => {
      let buf = "";
      res.on("data", (c) => (buf += c));
      res.on("end", () => {
        let body: Record<string, unknown> | null = null;
        try {
          body = JSON.parse(buf) as Record<string, unknown>;
        } catch {
          body = { raw: buf.slice(0, 120) };
        }
        resolve({
          status: res.statusCode ?? 0,
          contentType: String(res.headers["content-type"] ?? ""),
          body,
        });
      });
    });
    req.on("error", reject);
    req.end();
  });
}

export async function runAdsgramTests(): Promise<void> {
  const app = express();
  app.use(adsgramRouter);
  const { port, close } = await listen(app);
  try {
    // The console line is part of the contract right now (it is how the first
    // real reward gets noticed), so capture both streams around the two calls.
    const lines: string[] = [];
    const originalLog = console.log;
    const originalWarn = console.warn;
    const capture = (...args: unknown[]) => {
      lines.push(args.map((a) => String(a)).join(" "));
    };
    console.log = capture;
    console.warn = capture;
    let reward: Res;
    let missing: Res;
    try {
      reward = await get(port, "/api/adsgram/reward?userId=abc-123");
      missing = await get(port, "/api/adsgram/reward");
    } finally {
      console.log = originalLog;
      console.warn = originalWarn;
    }

    assert.equal(reward.status, 200, `reward webhook answers 200 (got ${reward.status})`);
    assert.ok(reward.contentType.includes("application/json"), "and as JSON");
    assert.equal(reward.body?.status, "ok", 'the body is exactly { status: "ok" }');

    assert.equal(missing.status, 200, "a call without userId is still accepted, never a 4xx/5xx");
    assert.equal(missing.body?.status, "ok");

    assert.ok(
      lines.some((line) => line.includes("userId=abc-123")),
      "the userId is logged so a real reward is visible",
    );
    assert.ok(
      lines.some((line) => line.includes("without a userId")),
      "and a malformed call is distinguishable in the log",
    );
  } finally {
    await close();
  }
  console.log(SUMMARY);
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  await runAdsgramTests();
}
