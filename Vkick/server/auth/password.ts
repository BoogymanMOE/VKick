/**
 * Username-account passwords (option A): scrypt with a random per-user salt.
 *
 * Stored format (in user_credentials.password_hash) carries its own
 * parameters so they can be tightened later without a migration:
 *   scrypt$v=1$n=16384$r=8$p=1$salt=<base64url>$hash=<base64url>
 * Verification re-derives with the STORED parameters and compares with
 * crypto.timingSafeEqual — never a string comparison, never an early exit
 * on the secret bytes.
 *
 * Rules: 8–72 characters (JS string length), no composition requirements.
 * Password material never leaves this module except as the stored hash: no
 * logging, no error messages containing it, no echo in API responses.
 */
import crypto from "node:crypto";

export const PASSWORD_MIN = 8;
export const PASSWORD_MAX = 72;

/** Current scrypt cost parameters (baked into each new hash). */
const SCRYPT_N = 16384;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const SCRYPT_KEYLEN = 64;
const SALT_BYTES = 16;

/** True for an acceptable NEW password (registration). Anything else is BAD_PASSWORD. */
export function passwordValid(pw: unknown): pw is string {
  return typeof pw === "string" && pw.length >= PASSWORD_MIN && pw.length <= PASSWORD_MAX;
}

interface ParsedHash {
  n: number;
  r: number;
  p: number;
  salt: Buffer;
  hash: Buffer;
}

function parseStored(stored: string): ParsedHash | null {
  // scrypt $ v=1 $ n=.. $ r=.. $ p=.. $ salt=.. $ hash=..  (7 $-segments)
  const parts = stored.split("$");
  if (parts.length !== 7 || parts[0] !== "scrypt" || parts[1] !== "v=1") return null;
  const num = (prefix: string, v: string | undefined): number | null => {
    if (!v || !v.startsWith(prefix)) return null;
    const n = parseInt(v.slice(prefix.length), 10);
    return Number.isInteger(n) && n > 0 ? n : null;
  };
  const n = num("n=", parts[2]);
  const r = num("r=", parts[3]);
  const p = num("p=", parts[4]);
  if (n === null || r === null || p === null) return null;
  // Bound stored parameters so a tampered row cannot demand absurd work.
  if (n > 1048576 || r > 32 || p > 8) return null;
  const saltB64 = (parts[5] ?? "").startsWith("salt=") ? (parts[5] as string).slice("salt=".length) : null;
  const hashB64 = (parts[6] ?? "").startsWith("hash=") ? (parts[6] as string).slice("hash=".length) : null;
  if (saltB64 === null || hashB64 === null) return null;
  try {
    const salt = Buffer.from(saltB64, "base64url");
    const hash = Buffer.from(hashB64, "base64url");
    if (salt.length === 0 || hash.length === 0) return null;
    return { n, r, p, salt, hash };
  } catch {
    return null;
  }
}

/** Hash a validated new password for storage. */
export function hashPassword(pw: string): string {
  const salt = crypto.randomBytes(SALT_BYTES);
  const hash = crypto.scryptSync(pw, salt, SCRYPT_KEYLEN, { N: SCRYPT_N, r: SCRYPT_R, p: SCRYPT_P });
  return (
    `scrypt$v=1$n=${SCRYPT_N}$r=${SCRYPT_R}$p=${SCRYPT_P}` +
    `$salt=${salt.toString("base64url")}$hash=${hash.toString("base64url")}`
  );
}

/**
 * Verify a login attempt. False for wrong passwords AND for malformed stored
 * rows (indistinguishable by design — the caller maps both to the same
 * INVALID_CREDENTIALS). Throws never; returns boolean only.
 */
export function verifyPassword(pw: string, stored: string): boolean {
  const parsed = parseStored(stored);
  if (!parsed) return false;
  let derived: Buffer;
  try {
    derived = crypto.scryptSync(pw, parsed.salt, parsed.hash.length, {
      N: parsed.n,
      r: parsed.r,
      p: parsed.p,
    });
  } catch {
    return false;
  }
  return derived.length === parsed.hash.length && crypto.timingSafeEqual(derived, parsed.hash);
}
