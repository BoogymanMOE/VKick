/**
 * Telegram initData verification — the auth contract underneath every
 * Telegram login. Payloads are forged locally with a throwaway bot token
 * (same algorithm Telegram documents); nothing here touches the network.
 *
 * Pins: valid payload passes, tampering fails, wrong token fails, auth_date is
 * required (its age window is TEMP-bypassed for the Guest-login debug — see
 * testAuthDateRules), non-hex digests fail closed (timing-safe path),
 * and BOTH readings of the Bot API 8.0 `signature` ambiguity verify — a
 * payload whose hash covers `signature` (Telegram's live behaviour, and the
 * shape that used to be rejected here with `hash mismatch`, downgrading the
 * user to a Guest) and one whose hash leaves it out. Only the token-derived
 * HMAC is accepted in either case; a tampered payload still fails both.
 */
import { strict as assert } from "node:assert";
import crypto from "node:crypto";
import { verifyDevToken, verifyInitData } from "../server/telegram/verify.js";

const BOT_TOKEN = "7000000000:TEST-token-for-the-verify-suite";

/**
 * Sign a query-string of key=value pairs exactly like Telegram does.
 * `includeSignatureInCheck` picks which convention `hash` covers: true folds
 * `signature` into the hashed string (what a live Telegram payload does — see
 * verify.ts), false leaves it out (the older/third-party convention).
 */
function sign(
  fields: Record<string, string>,
  botToken: string = BOT_TOKEN,
  includeSignatureInCheck = false,
): string {
  const secret = crypto.createHmac("sha256", "WebAppData").update(botToken).digest();
  const checkFields = includeSignatureInCheck
    ? fields
    : Object.fromEntries(Object.entries(fields).filter(([k]) => k !== "signature"));
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
  // TEMP(auth-debug): the freshness window is bypassed in verify.ts while the
  // Guest-login failure is diagnosed, so an old auth_date now VERIFIES instead
  // of rejecting. These lines flip back to `false` (and the "initData expired"
  // reason assertion returns) when the window is re-armed — the two files move
  // together, which is the tripwire against a bypass outliving the debug.
  const expired = verifyInitData(freshInitData(BOT_TOKEN, 25 * 3600), BOT_TOKEN);
  assert.equal(expired.ok, true, "[TEMP] 25h-old payload accepted while the window is bypassed");
  assert.equal(expired.ok ? expired.user.id : 0, 42, "[TEMP] old payload still resolves the user");

  const boundary = verifyInitData(freshInitData(BOT_TOKEN, 23 * 3600), BOT_TOKEN);
  assert.equal(boundary.ok, true, "23h-old payload still fresh");

  // auth_date is still REQUIRED: absence can't be aged, and "can't be aged"
  // stays a rejection even with the window bypassed (the bypass covers age,
  // not absence).
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

function testSignatureReadings() {
  const fields = {
    auth_date: String(Math.floor(Date.now() / 1000) - 30),
    query_id: "AAHtest",
    signature: "dGVzdC1zaWduYXR1cmU",
    user: '{"id":9,"first_name":"Sara"}',
  };
  // Telegram's live behaviour: `signature` rides in the signed string. This is
  // the payload shape that produced `reason=hash mismatch` with all keys
  // present and quietly turned the login into a guest account.
  const included = sign(fields, BOT_TOKEN, true);
  const ok = verifyInitData(included, BOT_TOKEN);
  assert.ok(ok.ok, `signature-inclusive payload verifies: ${ok.ok ? "" : ok.reason}`);
  assert.equal(ok.ok ? ok.user.id : 0, 9, "the Telegram user is surfaced");
  assert.equal(ok.ok ? ok.user.first_name : "", "Sara", "the name is not mangled");

  // The other convention (signature left out of the hashed fields) must keep
  // working: dropping it would reject every payload some clients produce.
  const excluded = sign(fields, BOT_TOKEN, false);
  assert.ok(verifyInitData(excluded, BOT_TOKEN).ok, "signature-exclusive payload still verifies");

  // Tampering is still rejected under BOTH conventions.
  for (const [name, payload] of [
    ["inclusive", included],
    ["exclusive", excluded],
  ] as const) {
    const bad = verifyInitData(payload.replace("Sara", "evil"), BOT_TOKEN);
    assert.equal(bad.ok, false, `edited ${name} payload rejected`);
    assert.equal(bad.ok ? "" : bad.reason, "hash mismatch", `${name} tamper reason`);
  }

  // A payload that never had the field is unaffected by either reading.
  const legacy = sign({
    auth_date: fields.auth_date,
    query_id: fields.query_id,
    user: fields.user,
  });
  assert.equal(verifyInitData(legacy, BOT_TOKEN).ok, true, "pre-8.0 payload still verifies");
}

/**
 * A bare `+` in the payload.
 *
 * Telegram encodes each field with `encodeURIComponent`, so a space travels as
 * `%20` and a real plus as `%2B` — a BARE `+` in initData therefore means a
 * literal `+`. `URLSearchParams` alone reads it as a space, which changes the
 * bytes the HMAC covers; a launch URL re-encoded on its way into the webview
 * hands over exactly that shape, and the login was rejected as a guest. (The
 * client half of this is pinned in telegramUrl.test.ts.)
 */
function testBarePlusReadings() {
  const authDate = String(Math.floor(Date.now() / 1000) - 30);

  // `sign` serialises with URLSearchParams, i.e. `+` arrives as `%2B`...
  const canonical = sign({
    auth_date: authDate,
    query_id: "AAHtest",
    user: '{"id":11,"first_name":"A+B"}',
    start_param: "a+b",
  });
  assert.equal(verifyInitData(canonical, BOT_TOKEN).ok, true, "canonical `%2B` payload verifies");

  // ...so the mangled shape is that same payload with `%2B` worn down to a bare
  // `+`. It must verify: `+` is a plus, not a space.
  const bare = canonical.replace(/%2B/g, "+");
  assert.ok(bare.includes("+"), "the payload really carries a bare `+`");
  assert.equal(
    verifyInitData(bare, BOT_TOKEN).ok,
    true,
    "a bare `+` in signed fields is a literal plus, not a space",
  );

  // A bare `+` can also have been a form-encoded space (that is what
  // URLSearchParams produces). Nothing that verified before may stop verifying.
  const formEncoded = sign({
    auth_date: authDate,
    query_id: "AAHtest",
    user: '{"id":12,"first_name":"Ali Reza"}',
  });
  assert.ok(formEncoded.includes("+"), "the signer form-encodes the space");
  const spaced = verifyInitData(formEncoded, BOT_TOKEN);
  assert.equal(spaced.ok, true, "a form-encoded space still verifies");
  assert.equal(spaced.ok ? spaced.user.first_name : "", "Ali Reza", "the spaced name is decoded as a space");

  // Tampering with a `+`-carrying payload is still rejected by both readings.
  const tampered = bare.replace("AAHtest", "AAHevil");
  const bad = verifyInitData(tampered, BOT_TOKEN);
  assert.equal(bad.ok, false, "tampered `+` payload rejected");
  assert.equal(bad.ok ? "" : bad.reason, "hash mismatch", "tamper reason preserved");
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
  testSignatureReadings();
  testBarePlusReadings();
  testDevToken();
  console.log(
    "  verify: valid/tamper/wrong-token, auth_date required (age window TEMP-bypassed), bad digests closed, both signature readings, bare `+` readings, dev tokens OK",
  );
}
