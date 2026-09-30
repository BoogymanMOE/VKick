import crypto from "node:crypto";

export interface TelegramUser {
  id: number;
  first_name?: string;
  last_name?: string;
  username?: string;
}

/**
 * Verify Telegram WebApp initData (official algorithm):
 * secret = HMAC_SHA256(key="WebAppData", message=botToken)
 * hash   = HMAC_SHA256(key=secret,  message=dataCheckString)
 * where dataCheckString is all fields except `hash`, sorted, "k=v" joined by \n.
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

  if (computed !== hash) return { ok: false, reason: "hash mismatch" };

  // Freshness: reject data older than 24h (blocks replay of stale init data).
  const authDate = params.get("auth_date");
  if (authDate) {
    const age = Date.now() / 1000 - parseInt(authDate, 10);
    if (Number.isNaN(age) || age > 86_400) {
      return { ok: false, reason: "initData expired" };
    }
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
 * outside Telegram. Never set DEV_AUTH_SECRET in production.
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
