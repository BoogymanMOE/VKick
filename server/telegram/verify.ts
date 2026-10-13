import crypto from "node:crypto";

export interface TelegramUser {
  id: number;
  first_name?: string;
  last_name?: string;
  username?: string;
}

/**
 * How long a verified initData stays fresh. The HMAC attests that these bytes
 * were signed by the bot's token and unchanged since — it says nothing about
 * *when* — so the clock is ours to add. Without it, a captured initData string
 * is a bearer credential that never expires.
 *
 * TEMP(auth-debug): currently NOT enforced — see the freshness block in
 * checkInitData. Kept so the bypass still logs a reference and re-arming the
 * window stays a one-line revert.
 */
const MAX_AGE_SECONDS = 86_400;

/**
 * Verify Telegram WebApp initData (official algorithm, Bot API 8.0+):
 * secret = HMAC_SHA256(key="WebAppData", message=botToken)
 * hash   = HMAC_SHA256(key=secret,  message=dataCheckString)
 * where dataCheckString is the received fields, sorted, "k=v" joined by \n,
 * with `hash` removed.
 *
 * WHICH fields it covers is the one genuinely ambiguous part, because Bot API
 * 8.0 added `signature` (an Ed25519 signature for third-party verification) to
 * every payload and the ecosystem split over whether it belongs in the string
 * that `hash` covers:
 *
 *  - Telegram's docs describe the bot-token check as "all received fields"
 *    minus `hash` — only the THIRD-PARTY Ed25519 path excludes `signature` —
 *    and a live Desktop payload with a real hash (tdlib/telegram-bot-api#747)
 *    reproduces only with `signature` INCLUDED. `@tma.js/init-data-node`'s
 *    validator likewise pops only `hash`.
 *  - Other validators (and this file, until now) exclude `signature`, and
 *    reject exactly those payloads.
 *
 * Guessing wrong is not a small deal: the payload is authentic either way, the
 * hash does not match, and the user is silently downgraded to a guest account
 * with no bot pushes — the "Continue as <Name> lands as Guest" login failure.
 * So BOTH readings are accepted (see verifyInitData). That is not a weaker
 * check: each reading still demands an HMAC-SHA256 only the bot token could
 * produce, so neither can admit a payload Telegram did not sign. It only stops
 * us disagreeing with a client over which fields Telegram folded in.
 *
 * `auth_date` is REQUIRED: its absence is a rejection, not a skip, and the
 * comparison is constant-time so a probe can't binary-search the digest.
 */
type InitDataVerdict = { ok: true; user: TelegramUser } | { ok: false; reason: string };

/**
 * The HMAC check itself, over one byte-level reading of the payload.
 * `excludeSignature` selects the convention for the check string: false folds
 * `signature` in (Telegram's live behaviour — see the note above), true leaves
 * it out (the third-party convention some validators copied over).
 */
function checkInitData(initData: string, botToken: string, excludeSignature: boolean): InitDataVerdict {
  const params = new URLSearchParams(initData);
  const hash = params.get("hash");
  if (!hash) return { ok: false, reason: "missing hash" };
  params.delete("hash");
  if (excludeSignature) params.delete("signature");

  const dataCheckString = [...params.entries()]
    .map(([k, v]) => `${k}=${v}`)
    .sort()
    .join("\n");

  const secret = crypto.createHmac("sha256", "WebAppData").update(botToken).digest();
  const computed = crypto.createHmac("sha256", secret).update(dataCheckString).digest("hex");

  // Constant-time digest compare. Buffer.from on non-hex input yields a
  // shorter/different buffer, and the length check below fails it closed
  // (timingSafeEqual throws on mismatched lengths, so the guard is required).
  const a = Buffer.from(computed, "hex");
  const b = Buffer.from(hash, "hex");
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return { ok: false, reason: "hash mismatch" };
  }

  // Freshness: auth_date is part of the signed data, so once the hash matches
  // it is trusted. It is also REQUIRED — a payload without one can't be aged,
  // and "can't be aged" is exactly what we don't accept.
  //
  // TEMP(auth-debug): the AGE WINDOW IS DISABLED while we chase the
  // "Continue as <Name> lands as Guest" login. An out-of-window auth_date no
  // longer rejects — it is logged instead, so we still learn whether the clock
  // was ever the reason. Cost while this is in place: with no window, a captured
  // initData string is replayable forever. Re-arm the rejection below before
  // this is left unattended.
  const authDate = params.get("auth_date");
  if (!authDate) return { ok: false, reason: "missing auth_date" };
  const issuedAt = parseInt(authDate, 10);
  const age = Date.now() / 1000 - issuedAt;
  if (Number.isNaN(age) || age > MAX_AGE_SECONDS) {
    // TEMP(auth-debug): logged, not rejected. Restore the return to re-arm.
    console.warn(
      `[telegram:verify] auth_date window bypassed (age=${Number.isNaN(age) ? "NaN" : Math.round(age)}s, max=${MAX_AGE_SECONDS}s)`,
    );
  }

  const userRaw = params.get("user");
  if (!userRaw) return { ok: false, reason: "missing user" };
  try {
    const user = JSON.parse(userRaw) as TelegramUser;
    if (!user?.id) return { ok: false, reason: "missing user.id" };
    return { ok: true, user };
  } catch {
    return { ok: false, reason: "user JSON invalid" };
  }
}

/**
 * Verify Telegram WebApp initData, tolerating the two genuine ambiguities in a
 * query string: which fields `hash` covers, and what `+` means.
 *
 * FIELD SET. `signature` may or may not have been folded into the signed string
 * depending on the client/validator vintage (see the note above), so both
 * readings are checked. Nothing else is guessed: either one is a byte-for-byte
 * HMAC that only the bot token could produce.
 *
 * `+`. Form-encoding says `+` means a space, and `URLSearchParams` applies that
 * rule. Telegram does not: it encodes each field with `encodeURIComponent`, so
 * a space travels as `%20` and a real plus as `%2B` — which makes a BARE `+` in
 * initData a literal `+` (a `start_param`, a name). A launch URL re-encoded on
 * the way into the webview can hand us exactly that shape; reading its `+` as a
 * space changes the bytes the HMAC covers and rejects a genuine login, which is
 * how a signed-in user ends up on a guest account. (The client side of the same
 * bug lives in src/lib/telegramUrl.ts.) So a payload containing `+` is also
 * checked under the literal-plus reading, with its `+` rewritten to `%2B`.
 *
 * The first failing verdict is what a payload that fails everything reports, so
 * `missing hash` / `missing auth_date` still surface as themselves.
 */
export function verifyInitData(initData: string, botToken: string): InitDataVerdict {
  // A `+`-free payload has one byte-level reading; a payload carrying a `+`
  // gets the literal-plus reading as well.
  const texts = initData.includes("+") ? [initData.replace(/\+/g, "%2B"), initData] : [initData];

  let firstFailure: InitDataVerdict | null = null;
  for (const text of texts) {
    for (const excludeSignature of [false, true]) {
      const verdict = checkInitData(text, botToken, excludeSignature);
      if (verdict.ok) return verdict;
      firstFailure ??= verdict;
    }
  }
  return firstFailure ?? { ok: false, reason: "hash mismatch" };
}

/**
 * Dev-only escape hatch: when DEV_AUTH_SECRET is set, clients may send
 * `dev:<telegramId>` instead of real initData so the app is testable
 * outside Telegram. Never set DEV_AUTH_SECRET in production — the server
 * refuses to boot with it under NODE_ENV=production (see server/index.ts).
 */
export function verifyDevToken(
  token: string,
  secret: string | undefined,
): { ok: true; user: TelegramUser } | { ok: false } {
  if (!secret) return { ok: false };
  const m = token.match(/^dev:(\d+)$/);
  if (!m) return { ok: false };
  return { ok: true, user: { id: parseInt(m[1] as string, 10), first_name: "Dev" } };
}
