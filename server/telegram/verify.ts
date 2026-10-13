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
 * where dataCheckString is all fields except `hash` and `signature`, sorted,
 * "k=v" joined by \n.
 *
 * `signature` (an Ed25519 signature for third-party verification, added in
 * Bot API 8.0) is NOT part of the bot-token HMAC check string. Current
 * Telegram clients attach it to every payload; folding it in makes every
 * authentic login fail. Excluding it is strictly safe: payloads without the
 * field hash identically either way. (Spec: core.telegram.org/bots/webapps
 * "Validating data received via the Mini App"; empirically confirmed against
 * a live bot token — validators that exclude only `hash` reject authentic
 * signature-carrying payloads, which is exactly the failure the TEMP probe
 * was watching for.)
 *
 * `auth_date` is REQUIRED: its absence is a rejection, not a skip, and the
 * comparison is constant-time so a probe can't binary-search the digest.
 */
type InitDataVerdict = { ok: true; user: TelegramUser } | { ok: false; reason: string };

/** The HMAC check itself, over one byte-level reading of the payload. */
function checkInitData(initData: string, botToken: string): InitDataVerdict {
  const params = new URLSearchParams(initData);
  const hash = params.get("hash");
  if (!hash) return { ok: false, reason: "missing hash" };
  params.delete("hash");
  params.delete("signature");

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
 * Verify Telegram WebApp initData, tolerating the one genuine ambiguity in a
 * query string: `+`.
 *
 * Form-encoding says `+` means a space, and `URLSearchParams` applies that rule.
 * Telegram does not: it encodes each field with `encodeURIComponent`, so a space
 * travels as `%20` and a real plus as `%2B` — which makes a BARE `+` in
 * initData a literal `+` (the base64 `signature`, a `start_param`, a name).
 * A launch URL re-encoded on the way into the webview can hand us exactly that
 * shape; reading its `+` as a space changes the bytes the HMAC covers and
 * rejects a genuine login, which is how a signed-in user ends up on a guest
 * account. (The client side of the same bug lives in src/lib/telegramUrl.ts.)
 *
 * So a payload containing `+` is checked under both readings — literal plus
 * first, then the legacy form-encoded one. Both still require an HMAC that only
 * the bot token could produce, so this cannot admit a payload Telegram did not
 * sign; it only stops us disagreeing with Telegram over what `+` means.
 */
export function verifyInitData(initData: string, botToken: string): InitDataVerdict {
  // No `+`, no ambiguity — one reading, exactly as before.
  if (!initData.includes("+")) return checkInitData(initData, botToken);

  const literalPlus = checkInitData(initData.replace(/\+/g, "%2B"), botToken);
  if (literalPlus.ok) return literalPlus;
  // Legacy reading last so its verdict (and its reason string) is what a
  // payload that fails BOTH readings reports, as it did before.
  return checkInitData(initData, botToken);
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
