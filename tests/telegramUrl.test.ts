/**
 * Telegram launch-URL normalisation.
 *
 * The Mini App is launched by Telegram with init data appended to the URL. Any
 * form left in place breaks boot: the hash form makes HashRouter treat
 * `tgWebAppData=...` as a route (404 screen), the path form trips the server's
 * file-extension 404. These cases pin the rewrite contract, including keeping
 * an unrelated query param and never touching a real hash route.
 */
import { strict as assert } from "node:assert";
import { normalizeTelegramUrl } from "../src/lib/telegramUrl.js";

/** Telegram init data is a query string that itself is percent-encoded. */
const INIT = "user=%7B%22id%22%3A1%7D&auth_date=1700000000&hash=abc";

function testHashForm(): void {
  const href = `https://app.example/#tgWebAppData=${encodeURIComponent(INIT)}&tgWebAppVersion=7.0&tgWebAppPlatform=android`;
  const out = normalizeTelegramUrl(href);
  assert.equal(out.changed, true, "the hash form is rewritten");
  assert.equal(out.url, "https://app.example/", "the Telegram fragment is stripped");
  assert.equal(out.initData, INIT, "init data is URL-decoded back to its raw value");
}

function testQueryForm(): void {
  const href = `https://app.example/?tgWebAppData=${encodeURIComponent(INIT)}&tgWebAppVersion=7.0&devUser=2`;
  const out = normalizeTelegramUrl(href);
  assert.equal(out.changed, true, "the query form is rewritten");
  assert.equal(out.initData, INIT, "init data recovered from the query string");
  assert.ok(out.url.includes("devUser=2"), "unrelated params survive");
  assert.ok(!out.url.includes("tgWebAppData"), "Telegram params are dropped");
}

function testPathForm(): void {
  // The mangled form the user reported: params straight after the path.
  const href = `https://app.example/tgWebAppData=${encodeURIComponent(INIT)}&tgWebAppVersion=7.0`;
  const out = normalizeTelegramUrl(href);
  assert.equal(out.changed, true, "the path form is rewritten");
  assert.equal(new URL(out.url).pathname, "/", "the mangled path resets to the app root");
  assert.equal(out.initData, INIT, "init data recovered from the path");
}

function testStartParamOnly(): void {
  // A launch carrying only a start param (no init data) must still be stripped,
  // or HashRouter would treat it as a route.
  const out = normalizeTelegramUrl("https://app.example/#tgWebAppStartParam=deeplink");
  assert.equal(out.changed, true, "tgWebAppStartParam alone is rewritten");
  assert.equal(out.url, "https://app.example/");
  assert.equal(out.initData, null, "no init data is invented");
}

function testLeavesRealRoutesAlone(): void {
  const out = normalizeTelegramUrl("https://app.example/#/matches");
  assert.equal(out.changed, false, "a real hash route is untouched");
  assert.equal(out.url, "https://app.example/#/matches");
  assert.equal(out.initData, null, "no init data invented for a plain browser");
}

function testSdkValueWins(): void {
  const href = `https://app.example/#tgWebAppData=${encodeURIComponent(INIT)}`;
  const out = normalizeTelegramUrl(href, "sdk-parsed-init-data");
  assert.equal(out.initData, "sdk-parsed-init-data", "the SDK's parsed value is authoritative");
  assert.equal(out.url, "https://app.example/", "the URL is still normalised");
}

export function runTelegramUrlTests(): void {
  testHashForm();
  testQueryForm();
  testPathForm();
  testStartParamOnly();
  testLeavesRealRoutesAlone();
  testSdkValueWins();
  console.log("  telegramUrl: hash/query/path init-data extraction + real-route passthrough OK");
}
