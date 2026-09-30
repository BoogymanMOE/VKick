import crypto from "node:crypto";

/**
 * Opaque session token for the username login path: 32 random bytes, hex,
 * not derived from anything. Stored in user_sessions; logout deletes the row,
 * which invalidates the token everywhere.
 *
 * (Account auth is username-only now — there is no password or recovery code
 * to hash, so this module is just the token generator.)
 */
export function newSessionToken(): string {
  return crypto.randomBytes(32).toString("hex");
}
