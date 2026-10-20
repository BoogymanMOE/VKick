/**
 * useLocalState contract (registered in tests/run.ts as its own group):
 *
 *   1. a key the user never touched stays ABSENT from storage after mount —
 *      the mounted hook must not persist its computed default (this locks the
 *      fat-finger bug from the mount-cause effect that used to write `initial`
 *      on first run and would later pin a derived `defaultOpen` as if a user
 *      had chosen it);
 *   2. a real setter change IS persisted;
 *   3. a stored value wins over the passed default, and is not rewritten.
 *
 * The hook is exercised through a real React root in a real browser (Vite dev
 * server started in-process; Playwright page), like tests/matchCardCenter
 * before it. Needs the browser; every other npm test group stays pure Node.
 */
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import type { ChromiumBrowser } from "playwright";

interface Case1 {
  stored: string | null;
  values: boolean[];
}
interface Case2 {
  stored: string | null;
  values: boolean[];
}
interface Case3 {
  stored: string | null;
  values: boolean[];
}

const HARNESS_URL = "/@fs/" + fileURLToPath(new URL("./useLocalState.harness.tsx", import.meta.url)).replace(/\\/g, "/");

export async function runUseLocalStateTests() {
  let chromium: (typeof import("playwright"))["chromium"] | null = null;
  try {
    ({ chromium } = await import("playwright"));
  } catch {
    console.log("~ useLocalState SKIPPED: playwright not installed");
    return;
  }

  const { createServer } = await import("vite");
  const vite = await createServer({
    configFile: "vite.config.ts",
    root: fileURLToPath(new URL("..", import.meta.url)),
    logLevel: "error",
    server: { port: 0, strictPort: false },
  });
  await vite.listen();
  const base = vite.resolvedUrls?.local?.[0] ?? vite.resolvedUrls?.network?.[0];
  assert.ok(base, "vite dev server did not produce a base url");
  const appUrl = base + "?devUser=9005070000#/profile";

  const launchOptions: Record<string, unknown> = { headless: true, args: ["--no-sandbox"] };
  let browser: ChromiumBrowser;
  if (process.env.SMOKE_CHANNEL) {
    browser = await chromium.launch({ ...launchOptions, channel: process.env.SMOKE_CHANNEL });
  } else {
    try {
      browser = await chromium.launch(launchOptions);
    } catch {
      // Bundled browser not downloaded: fall back to the system Chrome channel.
      browser = await chromium.launch({ ...launchOptions, channel: "chrome" });
    }
  }
  try {
    const page = await browser.newPage();
    await page.goto(appUrl, { waitUntil: "domcontentloaded", timeout: 30_000 });
    await page.waitForSelector("body", { timeout: 15_000 });
    // The dev server eagerly loads app modules on first hit; wait for the vite
    // client + module graph to be warm so the later /@fs import is live.
    await page.waitForTimeout(2500);

    const [untouched, toggled, stored] = (await page.evaluate(async (harnessUrl) => {
      const h = (await import(harnessUrl)) as {
        defaultUntouched(k: string): Promise<Case1>;
        togglePersist(k: string): Promise<Case2>;
        storedWins(k: string, initial: boolean): Promise<Case3>;
      };
      const stamp = Date.now();
      const untouched = await h.defaultUntouched(`t7ls.untouched.${stamp}`);
      const toggled = await h.togglePersist(`t7ls.toggle.${stamp}`);
      const stored = await h.storedWins(`t7ls.stored.${stamp}`, false);
      return [untouched, toggled, stored] as const;
    }, HARNESS_URL)) as readonly [Case1, Case2, Case3];

    assert.equal(untouched.stored, null, `case1 untouched key must stay absent, saw ${untouched.stored}`);
    assert.equal(untouched.values.at(-1), false, "case1 value defaults to initial");
    console.log("  ✓ useLocalState: untouched key stays absent after mount");

    assert.equal(toggled.stored, "true", `case2 toggled key must persist, saw ${toggled.stored}`);
    assert.equal(toggled.values.at(-1), true, "case2 final value is the toggled one");
    console.log("  ✓ useLocalState: setter change persists");

    assert.equal(stored.stored, "true", `case3 stored value must win, saw ${stored.stored}`);
    assert.equal(stored.values.at(-1), true, "case3 hook reads the stored value, not the default");
    console.log("  ✓ useLocalState: stored value wins over the default and is never rewritten");
  } finally {
    await browser.close();
    await vite.close();
  }
}
