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
import crypto from "node:crypto";
import { normalizeTelegramUrl } from "../src/lib/telegramUrl.js";
import { verifyInitData } from "../server/telegram/verify.js";

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

/**
 * `+` preservation.
 *
 * Telegram's signed `signature` is base64 and legitimately contains `+`, and a
 * client that escapes only the structural characters leaves that `+` bare in
 * the fragment. `URLSearchParams` applies form-encoding rules, so it read the
 * bare `+` as a SPACE — one flipped byte, but the server HMACs over it, so the
 * signature check failed and the user was silently downgraded to a guest
 * account. `decodeURIComponent` never rewrites `+`, which is what Telegram's own
 * parsing does.
 */
const PLUS_INIT =
  "query_id=AAHdF6IQAAAAAN0XohDhrOrc&user=%7B%22id%22%3A1%7D&auth_date=1700000000&signature=Ab%2BC%2Fd%3D";
/** The same payload as it arrives when the signature's `+` was left unescaped. */
const PLUS_INIT_BARE =
  "query_id=AAHdF6IQAAAAAN0XohDhrOrc&user=%7B%22id%22%3A1%7D&auth_date=1700000000&signature=Ab+C%2Fd%3D";

/**
 * Encode a payload for the fragment the way the mangling shows up on a device:
 * the inner `%2B` reaches the fragment as a bare `+` instead of `%2B`/`%252B`.
 */
function fragmentWithBarePlus(payload: string): string {
  return encodeURIComponent(payload).replace(/%252B/g, "+");
}

function testPlusSurvivesHashForm(): void {
  const href = `https://app.example/#tgWebAppData=${fragmentWithBarePlus(PLUS_INIT)}&tgWebAppVersion=7.0`;
  const out = normalizeTelegramUrl(href);
  assert.equal(out.changed, true, "the hash form is still rewritten");
  assert.ok(!out.url.includes("+"), "the Telegram fragment is stripped from the URL");
  assert.equal(out.initData, PLUS_INIT_BARE, "a bare `+` is preserved, not turned into a space");
}

function testPlusSurvivesQueryForm(): void {
  const href = `https://app.example/?tgWebAppData=${fragmentWithBarePlus(PLUS_INIT)}&tgWebAppVersion=7.0&devUser=2`;
  const out = normalizeTelegramUrl(href);
  assert.equal(out.initData, PLUS_INIT_BARE, "the query form preserves `+`");
  assert.ok(out.url.includes("devUser=2"), "unrelated params still survive");
}

function testPlusSurvivesPathForm(): void {
  const href = `https://app.example/tgWebAppData=${fragmentWithBarePlus(PLUS_INIT)}&tgWebAppVersion=7.0`;
  const out = normalizeTelegramUrl(href);
  assert.equal(out.initData, PLUS_INIT_BARE, "the path form preserves `+`");
  assert.equal(new URL(out.url).pathname, "/", "the mangled path still resets to the root");
}

/**
 * The fix must not start decoding twice: Telegram's canonical fragment is
 * percent-encoded, so `%252B` still has to come back as `%2B` (the init data the
 * server expects), not as a bare `+`.
 */
function testCanonicalPlusDecodesExactlyOnce(): void {
  const href = `https://app.example/#tgWebAppData=${encodeURIComponent(PLUS_INIT)}&tgWebAppVersion=7.0`;
  const out = normalizeTelegramUrl(href);
  assert.equal(out.initData, PLUS_INIT, "a fully-encoded `%252B` decodes to `%2B`");
}

const BOT_TOKEN = "7000000000:TEST-token-for-the-telegramUrl-suite";

/** Sign a field set the way Telegram documents it (`signature` excluded). */
function signInitData(fields: Record<string, string>): string {
  const secret = crypto.createHmac("sha256", "WebAppData").update(BOT_TOKEN).digest();
  const dataCheckString = Object.entries(fields)
    .filter(([key]) => key !== "signature")
    .map(([key, value]) => `${key}=${value}`)
    .sort()
    .join("\n");
  const hash = crypto.createHmac("sha256", secret).update(dataCheckString).digest("hex");
  return new URLSearchParams({ ...fields, hash }).toString();
}

/**
 * The end the user actually experiences: whatever the URL recovery hands back
 * has to pass the server's HMAC check. A payload whose base64 signature carries
 * `+` is signed locally with a throwaway token, then pushed through the exact
 * launch shapes the Mini App sees. Before the fix the bare-`+` shape failed
 * here and the user landed on the guest account.
 */
function testRecoveredPayloadVerifies(): void {
  const signed = signInitData({
    query_id: "AAHdF6IQAAAAAN0XohDhrOrc",
    user: JSON.stringify({ id: 279058397, first_name: "Ali" }),
    auth_date: String(Math.floor(Date.now() / 1000)),
    signature: "Ab+C/d=",
  });
  const forms = {
    canonical: `https://app.example/#tgWebAppData=${encodeURIComponent(signed)}&tgWebAppVersion=7.0`,
    "bare +": `https://app.example/#tgWebAppData=${fragmentWithBarePlus(signed)}&tgWebAppVersion=7.0`,
  };
  for (const [name, href] of Object.entries(forms)) {
    const out = normalizeTelegramUrl(href);
    const res = verifyInitData(out.initData ?? "", BOT_TOKEN);
    assert.ok(res.ok, `${name}: recovered init data must verify (${res.ok ? "" : res.reason})`);
    assert.equal(res.ok ? res.user.id : 0, 279058397, `${name}: the Telegram user is surfaced`);
  }
}

interface FakeBrowserState {
  href: string;
}

/**
 * Install the minimal browser globals `applyTelegramUrlNormalization` reads.
 * Returns a restore function so a suite can never leak a fake `window` into the
 * next test group.
 */
function installFakeBrowser(state: FakeBrowserState, store: Map<string, string>): () => void {
  const fakeWindow = {
    Telegram: undefined,
    get location() {
      return { href: state.href };
    },
    history: {
      replaceState: (_state: unknown, _title: unknown, url: string) => {
        state.href = url;
      },
    },
  };
  const fakeSessionStorage = {
    getItem: (key: string) => (store.has(key) ? (store.get(key) as string) : null),
    setItem: (key: string, value: string) => {
      store.set(key, value);
    },
    removeItem: (key: string) => {
      store.delete(key);
    },
  };
  const g = globalThis as unknown as Record<string, unknown>;
  const hadWindow = "window" in g;
  const prevWindow = g.window;
  const hadStorage = "sessionStorage" in g;
  const prevStorage = g.sessionStorage;
  g.window = fakeWindow;
  g.sessionStorage = fakeSessionStorage;
  return () => {
    if (hadWindow) g.window = prevWindow;
    else delete g.window;
    if (hadStorage) g.sessionStorage = prevStorage;
    else delete g.sessionStorage;
  };
}

/**
 * Reload recovery. The first load strips Telegram's fragment (HashRouter would
 * otherwise read `tgWebAppData=...` as a route), and when the SDK script is
 * blocked — Iran — that fragment is the ONLY copy of the init data. A reload
 * used to arrive with nothing and silently downgrade the user to a guest
 * (`[auth:guest] initData=no`); the capture is now persisted so it survives.
 */
async function testReloadRecovery(): Promise<void> {
  const store = new Map<string, string>();
  const state: FakeBrowserState = {
    href: `https://app.example/#tgWebAppData=${encodeURIComponent(INIT)}&tgWebAppVersion=7.0`,
  };
  const restore = installFakeBrowser(state, store);
  const src = new URL("../src/lib/telegramUrl.ts", import.meta.url).href;
  try {
    // First load: fragment present, captured and persisted, URL rewritten.
    const first = (await import(`${src}?load=1`)) as typeof import("../src/lib/telegramUrl.js");
    first.applyTelegramUrlNormalization();
    assert.equal(first.capturedTelegramInitData(), INIT, "the fragment is captured on the first load");
    assert.equal(state.href, "https://app.example/", "the fragment is stripped from the URL");
    assert.equal(store.size, 1, "the capture is persisted for a future load");

    // Reload: fresh module state, and the fragment is already gone from the URL.
    state.href = "https://app.example/#/login";
    const second = (await import(`${src}?load=2`)) as typeof import("../src/lib/telegramUrl.js");
    assert.equal(
      second.capturedTelegramInitData(),
      INIT,
      "a reload recovers the persisted init data with no fragment in the URL",
    );
    second.applyTelegramUrlNormalization();
    assert.equal(second.capturedTelegramInitData(), INIT, "normalising on reload keeps the recovered value");
    assert.equal(
      state.href,
      "https://app.example/#/login",
      "a fragment-less reload leaves the route untouched",
    );
  } finally {
    restore();
  }
}

export async function runTelegramUrlTests(): Promise<void> {
  testHashForm();
  testQueryForm();
  testPathForm();
  testStartParamOnly();
  testLeavesRealRoutesAlone();
  testSdkValueWins();
  testPlusSurvivesHashForm();
  testPlusSurvivesQueryForm();
  testPlusSurvivesPathForm();
  testCanonicalPlusDecodesExactlyOnce();
  testRecoveredPayloadVerifies();
  await testReloadRecovery();
  console.log(
    "  telegramUrl: hash/query/path extraction, `+` preserved, server HMAC accepted, real-route passthrough + reload recovery OK",
  );
}
