/**
 * Referral mechanics — invite codes and their (capped) point bonuses.
 *
 * Rules (scoring-rules.md "Referral bonuses"):
 *  - Every account owns exactly ONE reusable invite code (created lazily on
 *    first ask — codes are not minted for users who never open Profile).
 *  - An account may redeem someone else's code exactly ONCE, ever: the
 *    invitee_user_id UNIQUE constraint is the backstop, the pre-check gives
 *    the friendly error.
 *  - The referrer earns POINTS.referral.perInvite per PAID invite, on the
 *    GLOBAL scope only (like streak bonuses — referrals are growth, not
 *    match prediction, so they never touch league/club boards).
 *  - Paid invites cap at POINTS.referral.maxPaidInvites per referrer.
 *    Redemptions beyond the cap are still recorded (the social graph stays
 *    true) but pay nothing — `rewarded = 0` marks them.
 *  - Self-referral is structurally impossible: the owner of a code can never
 *    redeem it.
 *
 * Points flow through the SAME ledger as everything else (source =
 * `referral_bonus`, source_id = the referral_redemptions row), so idempotency
 * and the tiebreak come for free. Constants live in POINTS (config, not
 * schema — see scoring-rules.md "Notes for implementation").
 */
import { randomBytes } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { get, run, tx } from "../db/index.js";
import { award } from "./ledger.js";
import { POINTS } from "./predictionScore.js";

/** Unambiguous alphabet: no I/L/O/0/1 — codes are typed by hand into a chat. */
const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const CODE_LENGTH = 8;

/** A fresh invite code, crypto-random. */
export function generateReferralCode(): string {
  const bytes = randomBytes(CODE_LENGTH);
  let code = "";
  for (const byte of bytes) {
    code += ALPHABET[byte % ALPHABET.length];
  }
  return code;
}

/**
 * The user's code, creating it on first call. PK collisions retry a handful
 * of times before giving up loudly (the keyspace is 31^8 ≈ 8.5e11, so a
 * collision means something is deeply wrong).
 */
export function ensureReferralCode(db: DatabaseSync, userId: number): string {
  const existing = get<{ code: string }>(db, "SELECT code FROM referral_codes WHERE user_id = ?", [
    userId,
  ]);
  if (existing) return existing.code;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const code = generateReferralCode();
    try {
      run(db, "INSERT INTO referral_codes (code, user_id, created_at) VALUES (?, ?, ?)", [
        code,
        userId,
        new Date().toISOString(),
      ]);
      return code;
    } catch (err) {
      if (!String(err).includes("UNIQUE")) throw err;
    }
  }
  throw new Error("referral: could not allocate a unique code");
}

export interface ReferralStats {
  code: string;
  /** Redemptions attributed to this user's code. */
  invited: number;
  /** How many of those paid points (cap-bounded). */
  rewarded: number;
  maxPaidInvites: number;
  perInvite: number;
  /** Whether THIS user already redeemed someone's code. */
  youRedeemed: boolean;
}

export function referralStats(db: DatabaseSync, userId: number): ReferralStats {
  const code = ensureReferralCode(db, userId);
  const invited = get<{ n: number; paid: number }>(
    db,
    "SELECT COUNT(*) AS n, COALESCE(SUM(rewarded), 0) AS paid FROM referral_redemptions WHERE referrer_user_id = ?",
    [userId],
  );
  const mine = get<{ n: number }>(
    db,
    "SELECT COUNT(*) AS n FROM referral_redemptions WHERE invitee_user_id = ?",
    [userId],
  );
  return {
    code,
    invited: invited?.n ?? 0,
    rewarded: invited?.paid ?? 0,
    maxPaidInvites: POINTS.referral.maxPaidInvites,
    perInvite: POINTS.referral.perInvite,
    youRedeemed: (mine?.n ?? 0) > 0,
  };
}

export type RedeemResult =
  | { ok: true; rewarded: boolean; points: number }
  | { ok: false; error: "INVALID_CODE" | "SELF_REFERRAL" | "ALREADY_REDEEMED" };

/**
 * Redeem `rawCode` on behalf of `inviteeId`. Order matters inside the tx:
 * the redemption row is written FIRST (its id feeds the ledger source_id),
 * then the award appends — any throw rolls both back. The invitee UNIQUE
 * constraint is the race backstop for two simultaneous submits.
 */
export function redeemReferralCode(db: DatabaseSync, inviteeId: number, rawCode: string): RedeemResult {
  const code = rawCode.trim().toUpperCase();
  if (!code) return { ok: false, error: "INVALID_CODE" };
  const row = get<{ user_id: number }>(db, "SELECT user_id FROM referral_codes WHERE code = ?", [code]);
  if (!row) return { ok: false, error: "INVALID_CODE" };
  if (row.user_id === inviteeId) return { ok: false, error: "SELF_REFERRAL" };
  const already = get<{ n: number }>(
    db,
    "SELECT COUNT(*) AS n FROM referral_redemptions WHERE invitee_user_id = ?",
    [inviteeId],
  );
  if ((already?.n ?? 0) > 0) return { ok: false, error: "ALREADY_REDEEMED" };

  try {
    return tx(db, () => {
      const paid = get<{ n: number }>(
        db,
        "SELECT COUNT(*) AS n FROM referral_redemptions WHERE referrer_user_id = ? AND rewarded = 1",
        [row.user_id],
      );
      const rewarded = (paid?.n ?? 0) < POINTS.referral.maxPaidInvites;
      const info = db
        .prepare(
          `INSERT INTO referral_redemptions (code, referrer_user_id, invitee_user_id, rewarded, created_at)
           VALUES (?, ?, ?, ?, ?)`,
        )
        .run(code, row.user_id, inviteeId, rewarded ? 1 : 0, new Date().toISOString());
      const redemptionId = Number(info.lastInsertRowid);
      if (rewarded) {
        award(db, {
          userId: row.user_id,
          matchId: null,
          source: "referral_bonus",
          mechanic: "referral",
          points: POINTS.referral.perInvite,
          sourceId: redemptionId,
          league: null,
          teamIds: [],
        });
      }
      return { ok: true, rewarded, points: rewarded ? POINTS.referral.perInvite : 0 };
    });
  } catch (err) {
    // Lost a race against another redeem from this same account.
    if (String(err).includes("UNIQUE")) return { ok: false, error: "ALREADY_REDEEMED" };
    throw err;
  }
}
