/**
 * Referral mechanics over a real (in-memory) database: one code per user,
 * one redemption per account, capped global-only rewards through the ledger.
 * These are the anti-abuse rules — they get the same pinning as the scoring
 * state machine.
 */
import { strict as assert } from "node:assert";
import { DatabaseSync } from "node:sqlite";
import {
  ensureReferralCode,
  generateReferralCode,
  referralStats,
  redeemReferralCode,
} from "../server/scoring/referral.js";
import { POINTS } from "../server/scoring/predictionScore.js";

const ALPHABET = new Set("ABCDEFGHJKMNPQRSTUVWXYZ23456789".split(""));

function makeDb(): DatabaseSync {
  const db = new DatabaseSync(":memory:");
  db.exec(`
    -- Minimal mirror (see tests/predictionScore.test.ts): just what the
    -- ledger + referral tables need.
    CREATE TABLE users (id INTEGER PRIMARY KEY AUTOINCREMENT, display_name TEXT NOT NULL);
    CREATE TABLE matches (
      id TEXT PRIMARY KEY, league TEXT NOT NULL,
      home_team_id TEXT NOT NULL, away_team_id TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'finished'
    );
    CREATE TABLE point_ledger (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL, match_id TEXT, source TEXT NOT NULL, mechanic TEXT,
      points INTEGER NOT NULL CHECK (points >= 0), scope_season TEXT NOT NULL,
      awarded_at TEXT NOT NULL, source_id INTEGER NOT NULL, UNIQUE(source, source_id)
    );
    CREATE TABLE user_point_totals (
      user_id INTEGER NOT NULL, scope TEXT NOT NULL, scope_season TEXT NOT NULL,
      total INTEGER NOT NULL DEFAULT 0, reached_total_at TEXT NOT NULL,
      PRIMARY KEY (user_id, scope, scope_season)
    );
    CREATE TABLE referral_codes (
      code TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL UNIQUE,
      created_at TEXT NOT NULL
    );
    CREATE TABLE referral_redemptions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      code TEXT NOT NULL,
      referrer_user_id INTEGER NOT NULL,
      invitee_user_id INTEGER NOT NULL UNIQUE,
      rewarded INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    );
  `);
  return db;
}

function addUser(db: DatabaseSync, name: string): number {
  const info = db.prepare("INSERT INTO users (display_name) VALUES (?)").run(name);
  return Number(info.lastInsertRowid);
}

function globalTotal(db: DatabaseSync, userId: number): number {
  const row = db
    .prepare("SELECT total FROM user_point_totals WHERE user_id = ? AND scope = 'global'")
    .get(userId) as { total: number } | undefined;
  return row?.total ?? 0;
}

function ledgerCount(db: DatabaseSync, userId: number): number {
  return (db.prepare("SELECT COUNT(*) AS n FROM point_ledger WHERE user_id = ?").get(userId) as { n: number })
    .n;
}

function testCodeGeneration(): void {
  for (let i = 0; i < 50; i += 1) {
    const code = generateReferralCode();
    assert.equal(code.length, 8, "codes are 8 characters");
    for (const ch of code) {
      assert.ok(ALPHABET.has(ch), `unambiguous alphabet only, saw "${ch}"`);
    }
  }
  assert.notEqual(generateReferralCode(), generateReferralCode(), "random codes differ");
}

function testEnsureCode(): void {
  const db = makeDb();
  const a = addUser(db, "referrer");
  const b = addUser(db, "other");
  const first = ensureReferralCode(db, a);
  assert.equal(ensureReferralCode(db, a), first, "one code per user, stable across calls");
  assert.notEqual(ensureReferralCode(db, b), first, "different users get different codes");
}

function testRedeemHappyPath(): void {
  const db = makeDb();
  const referrer = addUser(db, "referrer");
  const invitee = addUser(db, "friend");
  const code = ensureReferralCode(db, referrer);

  const result = redeemReferralCode(db, invitee, code.toLowerCase());
  assert.ok(result.ok, "lowercase input still redeems (normalized)");
  if (result.ok) {
    assert.equal(result.rewarded, true, "first invite pays");
    assert.equal(result.points, POINTS.referral.perInvite);
  }

  assert.equal(globalTotal(db, referrer), POINTS.referral.perInvite, "referrer's global total grew");
  assert.equal(ledgerCount(db, referrer), 1, "exactly one ledger row");
  const row = db
    .prepare("SELECT source, mechanic, match_id FROM point_ledger WHERE user_id = ?")
    .get(referrer) as { source: string; mechanic: string; match_id: string | null };
  assert.equal(row.source, "referral_bonus");
  assert.equal(row.mechanic, "referral");
  assert.equal(row.match_id, null, "referrals are not tied to a match");

  // Global scope ONLY: no league/club boards were bumped.
  const scopes = db.prepare("SELECT scope FROM user_point_totals WHERE user_id = ?").all(referrer) as Array<{
    scope: string;
  }>;
  assert.deepEqual(
    scopes.map((s) => s.scope),
    ["global"],
    "referral rewards feed the global board only",
  );

  const stats = referralStats(db, referrer);
  assert.equal(stats.invited, 1);
  assert.equal(stats.rewarded, 1);
  assert.equal(stats.youRedeemed, false, "the referrer hasn't redeemed anyone");
  const inviteeStats = referralStats(db, invitee);
  assert.equal(inviteeStats.youRedeemed, true, "the invitee's one-shot is used");
}

function testRedeemGuards(): void {
  const db = makeDb();
  const referrer = addUser(db, "referrer");
  const other = addUser(db, "other");
  const invitee = addUser(db, "friend");
  const code = ensureReferralCode(db, referrer);
  const otherCode = ensureReferralCode(db, other);

  const self = redeemReferralCode(db, referrer, code);
  assert.ok(!self.ok && self.error === "SELF_REFERRAL", "own code is refused");

  const invalid = redeemReferralCode(db, invitee, "ZZZZZZZZ");
  assert.ok(!invalid.ok && invalid.error === "INVALID_CODE", "unknown codes are refused");

  assert.ok(redeemReferralCode(db, invitee, code).ok);
  const again = redeemReferralCode(db, invitee, otherCode);
  assert.ok(!again.ok && again.error === "ALREADY_REDEEMED", "one redemption per account, ever");
  assert.equal(ledgerCount(db, referrer), 1, "the refused redeem moved nothing");
  assert.equal(globalTotal(db, other), 0, "the second referrer got nothing from a spent account");
}

function testCap(): void {
  const db = makeDb();
  const referrer = addUser(db, "referrer");
  const code = ensureReferralCode(db, referrer);
  const { perInvite, maxPaidInvites } = POINTS.referral;

  for (let i = 0; i < maxPaidInvites + 3; i += 1) {
    const invitee = addUser(db, `friend${i}`);
    const result = redeemReferralCode(db, invitee, code);
    assert.ok(result.ok, `redemption ${i} records`);
    if (result.ok) {
      assert.equal(result.rewarded, i < maxPaidInvites, "rewards stop at the cap");
      assert.equal(result.points, i < maxPaidInvites ? perInvite : 0);
    }
  }

  const stats = referralStats(db, referrer);
  assert.equal(stats.invited, maxPaidInvites + 3, "every connection is recorded");
  assert.equal(stats.rewarded, maxPaidInvites, "paid invites cap exactly");
  assert.equal(globalTotal(db, referrer), maxPaidInvites * perInvite, "totals stop at the cap");
  assert.equal(ledgerCount(db, referrer), maxPaidInvites, "no ledger rows beyond the cap");
}

function testConstants(): void {
  assert.ok(POINTS.referral.perInvite > 0, "the referral bonus is positive (§7: no negative scoring)");
  assert.ok(Number.isInteger(POINTS.referral.perInvite));
  assert.ok(POINTS.referral.maxPaidInvites >= 1, "the cap admits at least one invite");
}

export function runReferralTests(): void {
  testCodeGeneration();
  testEnsureCode();
  testRedeemHappyPath();
  testRedeemGuards();
  testCap();
  testConstants();
  console.log("  referral: codes, one-shot redemption, global-only capped ledger rewards OK");
}
