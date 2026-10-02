/**
 * Telegram initData verification — the auth contract underneath every
 * Telegram login. Payloads are forged locally with a throwaway bot token
 * (same algorithm Telegram documents); nothing here touches the network.
 *
 * Pins: valid payload passes, tampering fails, wrong token fails, auth_date
 * is required and enforced, non-hex digests fail closed (timing-safe path),
 * and Bot API 8.0's `signature` field is EXCLUDED from the check string —
 * payloads signed per the documented algorithm (signature left out of the
 * hashed fields) verify, while payloads that folded signature in fail, which
 * is exactly what old validators did to every current Telegram client.
 */
import { strict as assert } from "node:assert";
import crypto from "node:crypto";
import { verifyDevToken, verifyInitData } from "../server/telegram/verify.js";

const BOT_TOKEN = "7000000000:TEST-token-for-the-verify-suite";

/**
 * Sign a query-string of key=value pairs exactly like Telegram documents it.
 * `includeSignatureInCheck` reproduces the old-validator mistake (folding the
 * signature field into the hashed string) to pin its rejection.
 */
function sign(
  fields: Record<string, string>,
  botToken: string = BOT_TOKEN,
  includeSignatureInCheck = false,
): string {
  const secret = crypto.createHmac("sha256", "WebAppData").update(botToken).digest();
  const checkFields = includeSignatureInCheck ? fields : Object.fromEntries(Object.entries(fields).filter(([k]) => k !== "signature"));
  const dataCheckString = Object.entries(checkFields)
    .map(([k, v]) => `${k}=${v}`)
    .sort()
    .join("\n");
  const hash = crypto.createHmac("sha256", secret).update(dataCheckString).digest("hex");
  return new URLSearchParams({ ...fields, hash }).toString();
}

function freshInitData(botToken: string = BOT_TOKEN, ageSeconds = 60): string {
  return sign(
    {
      auth_date: String(Math.floor(Date.now() / 1000) - ageSeconds),
      query_id: "AAHtest",
      user: JSON.stringify({ id: 42, first_name: "Ali", username: "ali_fc" }),
    },
    botToken,
  );
}

function testValidPayload() {
  const r = verifyInitData(freshInitData(), BOT_TOKEN);
  assert.ok(r.ok, `valid payload must verify: ${r.ok ? "" : (r as { reason: string }).reason}`);
  assert.equal(r.ok ? r.user.id : 0, 42, "user id surfaced");
  assert.equal(r.ok ? r.user.username : "", "ali_fc", "username surfaced");
}

function testTampering() {
  // Edit the user AFTER signing: the digest no longer matches.
  const edited = freshInitData().replace("ali_fc", "hacker");
  const r = verifyInitData(edited, BOT_TOKEN);
  assert.equal(r.ok, false, "edited payload rejected");
  assert.equal(r.ok ? "" : r.reason, "hash mismatch", "tamper reason");

  // Wrong bot token: the secret derives from the token, so everything fails.
  const other = verifyInitData(freshInitData("8000000000:OTHER-token"), BOT_TOKEN);
  assert.equal(other.ok, false, "payload signed by another bot rejected");
}

function testAuthDateRules() {
  const expired = verifyInitData(freshInitData(BOT_TOKEN, 25 * 3600), BOT_TOKEN);
  assert.equal(expired.ok, false, "25h-old payload rejected");
  assert.equal(expired.ok ? "" : expired.reason, "initData expired", "expiry reason");

  const boundary = verifyInitData(freshInitData(BOT_TOKEN, 23 * 3600), BOT_TOKEN);
  assert.equal(boundary.ok, true, "23h-old payload still fresh");

  // auth_date is REQUIRED now: strip it and re-sign — still rejected.
  const noAuthDate = sign({ query_id: "AAHtest", user: '{"id":7}' });
  const r = verifyInitData(noAuthDate, BOT_TOKEN);
  assert.equal(r.ok, false, "missing auth_date rejected");
  assert.equal(r.ok ? "" : r.reason, "missing auth_date", "missing-auth_date reason");
}

function testMalformedDigests() {
  // Non-hex / truncated / padded digests must fail CLOSED on the
  // constant-time path (Buffer.from silently coerces bad input).
  for (const bad of ["zzzz", "abcd", "ABCD", `${"a".repeat(63)}`, `${"a".repeat(65)}`, ""]) {
    const payload = freshInitData().replace(/hash=[0-9a-f]+/, `hash=${bad}`);
    const r = verifyInitData(payload, BOT_TOKEN);
    assert.equal(r.ok, false, `bad digest "${bad.slice(0, 8)}" rejected`);
  }
  assert.equal(verifyInitData("user=%7B%22id%22%3A1%7D", BOT_TOKEN).ok, false, "no hash at all rejected");
}

function testSignatureExcludedFromCheckString() {
  const fields = {
    auth_date: String(Math.floor(Date.now() / 1000) - 30),
    query_id: "AAHtest",
    signature: "dGVzdC1zaWduYXR1cmU",
    user: '{"id":9,"first_name":"Sara"}',
  };
  // Documented algorithm: the client signs all fields EXCEPT hash and
  // signature. Our validator must accept exactly that payload.
  const authentic = sign(fields);
  const ok = verifyInitData(authentic, BOT_TOKEN);
  assert.equal(ok.ok, true, "signature-carrying payload (signed per spec) verifies");

  // The old-validator mistake: fold signature into the check string. Every
  // real Bot API 8.0+ payload would fail that way — pin the rejection.
  const legacyHashed = sign(fields, BOT_TOKEN, true);
  assert.equal(verifyInitData(legacyHashed, BOT_TOKEN).ok, false, "signature-in-check-string hash mismatches");

  // A legacy payload WITHOUT the field is unaffected by the exclusion.
  const legacy = sign({
    auth_date: fields.auth_date,
    query_id: fields.query_id,
    user: fields.user,
  });
  assert.equal(verifyInitData(legacy, BOT_TOKEN).ok, true, "pre-8.0 payload still verifies");
}

function testDevToken() {
  assert.deepEqual(verifyDevToken("dev:123", undefined), { ok: false }, "no secret: dev tokens dead");
  assert.ok(verifyDevToken("dev:123", "s").ok, "secret set: dev token accepted");
  assert.equal(verifyDevToken("dev:123", "s").ok ? verifyDevToken("dev:123", "s").user?.id : 0, 123);
  assert.equal(verifyDevToken("not-dev:123", "s").ok, false, "non-dev shape rejected");
  assert.equal(verifyDevToken("dev:abc", "s").ok, false, "non-numeric id rejected");
}

export async function runVerifyTests(): Promise<void> {
  testValidPayload();
  testTampering();
  testAuthDateRules();
  testMalformedDigests();
  testSignatureExcludedFromCheckString();
  testDevToken();
  console.log(
    "  verify: valid/tamper/wrong-token, auth_date required+fresh, bad digests closed, signature excluded, dev tokens OK",
  );
}
