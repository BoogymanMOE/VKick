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
  await testReloadRecovery();
  console.log("  telegramUrl: hash/query/path extraction, real-route passthrough + reload recovery OK");
}
