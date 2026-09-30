/**
 * Password module — scrypt hashing, verification, and the 8–72 rule.
 * HTTP-level behavior (register/login/throttling/guest merge) is covered by
 * the live scratch-DB probe; these pin the crypto contract underneath it.
 */
import { strict as assert } from "node:assert";
import {
  PASSWORD_MAX,
  PASSWORD_MIN,
  hashPassword,
  passwordValid,
  verifyPassword,
} from "../server/auth/password.js";

function testLengthRule() {
  assert.equal(PASSWORD_MIN, 8, "min 8");
  assert.equal(PASSWORD_MAX, 72, "max 72");
  assert.equal(passwordValid("1234567"), false, "7 chars rejected");
  assert.equal(passwordValid("12345678"), true, "8 chars accepted");
  assert.equal(passwordValid("x".repeat(72)), true, "72 chars accepted");
  assert.equal(passwordValid("x".repeat(73)), false, "73 chars rejected");
  assert.equal(passwordValid(""), false, "empty rejected");
  assert.equal(passwordValid(undefined), false, "missing rejected");
  assert.equal(passwordValid(12345678), false, "non-string rejected");
  // No composition rules: digits-only, no symbols, spaces all fine.
  assert.equal(passwordValid("alllowercase"), true, "no complexity gate");
  assert.equal(passwordValid("with spaces ok"), true, "spaces allowed");
}

function testHashAndVerify() {
  const h = hashPassword("correct horse");
  assert.ok(h.startsWith("scrypt$v=1$n="), "self-describing format with params");
  assert.equal(verifyPassword("correct horse", h), true, "right password verifies");
  assert.equal(verifyPassword("correct horsf", h), false, "wrong password fails");
  assert.equal(verifyPassword("", h), false, "empty fails");
}

function testSaltsAndTamper() {
  const a = hashPassword("same-password");
  const b = hashPassword("same-password");
  assert.notEqual(a, b, "random per-user salt");
  assert.equal(verifyPassword("same-password", a), true, "both verify");
  assert.equal(verifyPassword("same-password", b), true, "both verify");
  // Tampered or malformed stored rows fail closed (caller maps to
  // INVALID_CREDENTIALS, same as a wrong password).
  assert.equal(verifyPassword("same-password", a.slice(0, -4) + "AAAA"), false, "tampered hash fails");
  assert.equal(verifyPassword("same-password", "not-a-hash"), false, "garbage fails");
  assert.equal(verifyPassword("same-password", ""), false, "empty stored fails");
  assert.equal(
    verifyPassword("same-password", "scrypt$v=1$n=999999999$r=8$p=1$salt=AA$hash=AA"),
    false,
    "absurd params refused",
  );
}

export async function runPasswordTests(): Promise<void> {
  testLengthRule();
  testHashAndVerify();
  testSaltsAndTamper();
  console.log("  password: length rule, scrypt verify, salts, tamper-closed OK");
}
