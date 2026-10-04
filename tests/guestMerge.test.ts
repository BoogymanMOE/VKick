/**
 * The guest -> real-identity upgrade, driven over real HTTP against a
 * throwaway database.
 *
 * Why this suite exists: `mergeGuestIntoUser` deletes the guest `users` row
 * at the end, and `referral_codes` / `referral_redemptions` reference
 * `users(id)` with NO `ON DELETE CASCADE`. Leaving those rows behind is an FK
 * violation, so the whole merge transaction threw. It was not an edge case —
 * `GET /api/me/referral` mints a code lazily, so any guest who had ever
 * opened the Invite tab had one, and because `tx()` rolled the merge back the
 * guest row survived, which meant every retry threw again. The account could
 * never leave the guest profile: no Telegram login, no username register,
 * picks stranded. This suite walks that exact path.
 *
 * WHY A CHILD PROCESS: the route modules call `getDb()` at module scope and
 * capture the handle in a module-level const, and ESM caches modules for the
 * life of the process. Two router-driving suites cannot coexist — the second
 * one to import gets the first one's already-closed handle. Rather than
 * refactor production wiring for the test harness, this suite re-invokes
 * itself in a child process and reports the child's verdict.
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
import { closeDb, getDb, run, get } from "../server/db/index.js";
import { ensureReferralCode, redeemReferralCode } from "../server/scoring/referral.js";

const CHILD_FLAG = "VKICK_GUEST_MERGE_CHILD";
const SUMMARY =
  "  guestMerge: upgrade survives a minted code + redemption, referrals move, one-shot preserved OK";

/** Device ids must match DEVICE_ID_RE (8-64 chars of [A-Za-z0-9_-]). */
const DEVICE = "guestmerge_device_01";
const PASSWORD = "correct-horse-battery";

interface Res {
  status: number;
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

/**
 * Express's default error handler answers with an HTML page, not JSON. Parsing
 * that blindly turns every failed assertion into a confusing SyntaxError, so a
 * non-JSON body becomes `{ raw }` and the status code carries the diagnosis.
 */
function parseBody(buf: string): Record<string, unknown> | null {
  if (!buf) return null;
  try {
    return JSON.parse(buf) as Record<string, unknown>;
  } catch {
    return { raw: buf.slice(0, 120) };
  }
}

function post(port: number, url: string, body: unknown, headers: Record<string, string> = {}): Promise<Res> {
  const raw = JSON.stringify(body);
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        host: "127.0.0.1",
        port,
        path: url,
        method: "POST",
        headers: {
          "content-type": "application/json",
          "content-length": Buffer.byteLength(raw),
          ...headers,
        },
      },
      (res) => {
        let buf = "";
        res.on("data", (c) => (buf += c));
        res.on("end", () => resolve({ status: res.statusCode ?? 0, body: parseBody(buf) }));
      },
    );
    req.on("error", reject);
    req.end(raw);
  });
}

function userIdByTelegram(telegramId: string): number | undefined {
  return get<{ id: number }>(getDb(), "SELECT id FROM users WHERE telegram_id = ?", [telegramId])?.id;
}

/** The actual assertions, run inside the child process. */
async function suite(): Promise<void> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vkick-merge-"));
  const previousDb = process.env.SQLITE_PATH;
  closeDb();
  process.env.SQLITE_PATH = path.join(dir, "merge.db");
  try {
    // Imported AFTER SQLITE_PATH is set: the route module calls getDb() at
    // module scope, so a stale path here would aim the suite at the dev data.
    const { authRouter } = await import("../server/routes/auth.js");
    const db = getDb();

    // A club the guest follows, so the merge has real rows to move.
    run(db, "INSERT INTO teams (id, name, league) VALUES ('359', 'Test FC', 'eng.1')");
    // Someone else with an invite code, for the redemption case.
    run(db, "INSERT INTO users (telegram_id, display_name, created_at) VALUES ('424242', 'Referrer', ?)", [
      new Date().toISOString(),
    ]);
    const referrer = userIdByTelegram("424242") as number;
    const referrerCode = ensureReferralCode(db, referrer);

    const app = express();
    app.use(express.json());
    app.use(authRouter);
    const { port, close } = await listen(app);

    try {
      /* ---- 1. the guest exists and mints a referral code -------------- */
      const guestRes = await post(port, "/api/auth/guest", { deviceId: DEVICE, initData: null });
      assert.equal(guestRes.status, 200, "silent guest entry works");
      const guestId = userIdByTelegram(`guest:${DEVICE.toLowerCase()}`);
      assert.ok(guestId, "guest row created under the synthetic id");

      // Profile -> Invite friends. ensureReferralCode is the exact call that
      // route makes, and this row is what used to block the merge.
      const guestCode = ensureReferralCode(db, guestId as number);
      assert.ok(guestCode, "guest owns a referral code before upgrading");

      // The guest also redeemed somebody else's invite, so BOTH referral
      // tables hold rows pointing at the guest.
      assert.ok(redeemReferralCode(db, guestId as number, referrerCode).ok, "guest redeemed a friend's code");

      run(db, "INSERT INTO favorite_teams (user_id, team_id, created_at) VALUES (?, '359', ?)", [
        guestId,
        new Date().toISOString(),
      ]);

      /* ---- 2. upgrade to a username account --------------------------- */
      // This is the request that used to 500 with FOREIGN KEY constraint
      // failed, on every attempt, forever.
      const reg = await post(port, "/api/auth/register", {
        username: "mergeuser",
        password: PASSWORD,
        displayName: "Merge User",
        deviceId: DEVICE,
      });
      assert.equal(reg.status, 200, `register must not 500 on a guest with referrals (got ${JSON.stringify(reg.body)})`);
      assert.equal(reg.body?.ok, true);

      /* ---- 3. the guest row is gone, its data is not ------------------ */
      assert.equal(userIdByTelegram(`guest:${DEVICE.toLowerCase()}`), undefined, "guest row deleted");

      const targetId = userIdByTelegram("pwd:mergeuser");
      assert.ok(targetId, "username account created");

      const favs = db.prepare("SELECT team_id FROM favorite_teams WHERE user_id = ?").all(targetId) as Array<{
        team_id: string;
      }>;
      assert.deepEqual(
        favs.map((f) => f.team_id),
        ["359"],
        "the guest's favorite followed the account",
      );

      /* ---- 4. the referral graph moved instead of vanishing ----------- */
      const code = db
        .prepare("SELECT user_id FROM referral_codes WHERE code = ?")
        .get(guestCode) as { user_id: number } | undefined;
      assert.ok(code, "the guest's invite code still exists");
      assert.equal(code.user_id, targetId, "and now belongs to the upgraded account");

      // The redemption the guest made must move, not be dropped: dropping it
      // would hand the same person a second one-shot redemption.
      const moved = db
        .prepare("SELECT referrer_user_id FROM referral_redemptions WHERE invitee_user_id = ?")
        .get(targetId) as { referrer_user_id: number } | undefined;
      assert.ok(moved, "the redemption followed the invitee");
      assert.equal(moved.referrer_user_id, referrer, "and still names the original referrer");

      const dangling = db
        .prepare("SELECT COUNT(*) AS n FROM referral_redemptions WHERE invitee_user_id = ?")
        .get(guestId) as { n: number };
      assert.equal(dangling.n, 0, "no redemption row was left pointing at the deleted guest");

      /* ---- 5. the one-shot redemption is genuinely spent ------------ */
      const second = redeemReferralCode(db, targetId as number, referrerCode);
      assert.ok(!second.ok && second.error === "ALREADY_REDEEMED", "the upgrade did not reset the one-shot");

      /* ---- 6. and the session from the upgrade actually works -------- */
      const token = String(reg.body?.token ?? "");
      assert.ok(token.startsWith("mg_"), "register returned a session token");
      const logout = await post(port, "/api/auth/logout", {}, { authorization: `Bearer ${token}` });
      assert.equal(logout.status, 200, "the upgraded account is usable");
    } finally {
      await close();
    }
  } finally {
    if (previousDb === undefined) delete process.env.SQLITE_PATH;
    else process.env.SQLITE_PATH = previousDb;
    // Close before sweeping: Windows refuses to delete an open file. Never let
    // cleanup fail a passing suite.
    closeDb();
    try {
      fs.rmSync(dir, { recursive: true, force: true, maxRetries: 3 });
    } catch {
      /* a leftover temp dir must not fail a passing suite */
    }
  }
}

export async function runGuestMergeTests(): Promise<void> {
  if (process.env[CHILD_FLAG] === "1") {
    await suite();
    return;
  }

  // Parent: hand the whole suite to a child process and adopt its verdict.
  const result = spawnSync(process.execPath, ["--import", "tsx", fileURLToPath(import.meta.url)], {
    stdio: "inherit",
    env: { ...process.env, [CHILD_FLAG]: "1" },
  });
  if (result.error) throw result.error;
  assert.equal(result.status, 0, `guestMerge child process failed (exit ${result.status})`);
  console.log(SUMMARY);
}

// Run ONLY when this file is the process entry point — i.e. the child spawned
// above. Importing it from tests/run.ts must not fire the suite a second time.
if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  await runGuestMergeTests();
}