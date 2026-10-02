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
 */
const MAX_AGE_SECONDS = 86_400;

/**
 * Verify Telegram WebApp initData (official algorithm):
 * secret = HMAC_SHA256(key="WebAppData", message=botToken)
 * hash   = HMAC_SHA256(key=secret,  message=dataCheckString)
 * where dataCheckString is all fields except `hash`, sorted, "k=v" joined by \n.
 *
 * Every other field — including Bot API 8.0's `signature` — is a regular
 * member of the check string (TEMP audit note: if live-client logging shows
 * real Telegram payloads carrying `signature` failing here, the field needs
 * excluding from the check string; don't change this speculatively).
 *
 * `auth_date` is REQUIRED: its absence is now a rejection, not a skip, and the
 * comparison is constant-time so a probe can't binary-search the digest.
 */
export function verifyInitData(
  initData: string,
  botToken: string,
): { ok: true; user: TelegramUser } | { ok: false; reason: string } {
  const params = new URLSearchParams(initData);
  const hash = params.get("hash");
  if (!hash) return { ok: false, reason: "missing hash" };
  params.delete("hash");

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
  const authDate = params.get("auth_date");
  if (!authDate) return { ok: false, reason: "missing auth_date" };
  const issuedAt = parseInt(authDate, 10);
  const age = Date.now() / 1000 - issuedAt;
  if (Number.isNaN(age) || age > MAX_AGE_SECONDS) {
    return { ok: false, reason: "initData expired" };
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
