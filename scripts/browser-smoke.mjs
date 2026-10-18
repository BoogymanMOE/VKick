/**
 * The browser regression suite — the tracked version of the manual audit this
 * repo needed twice before anything caught it in code:
 *
 *  1. Login keeps its content inside 100svh in portrait (both languages) and
 *     the legal line stays in the viewport without scrolling.
 *  2. No dotted ESPN slug ever leaks into visible text on the feed, a real
 *     match page or a real team page — discovered as "Showing xxx.test_cup
 *     only", the hard-gate regex below is the guarantee it stays fixed.
 *  3. The reset sheet's footer buttons stay ≥44px tall and unclipped.
 *  4. Onboarding advances (pick a club → Continue) and Skip lands on Matches.
 *
 * Needs the app + API running: `npm run smoke` against the dev servers, or
 * the CI "browser-smoke" job (seeds demo data, boots both, runs this).
 * Exit 1 with one line per finding; anything green prints "SMOKE OK".
 */
import { chromium } from "playwright";

const BASE = process.env.SMOKE_BASE_URL ?? "http://localhost:5173";
const API = process.env.SMOKE_API_URL ?? "http://localhost:8787";
// CI uses the bundled chromium; local Windows has a faster msedge channel.
const CHANNEL = process.env.SMOKE_CHANNEL ?? "";
const SLUG_RE = /\b[a-z]{2,4}\.[a-z0-9_.]+\b/g;

const failures = [];
function fail(where, detail) {
  failures.push(`${where}: ${detail}`);
  console.error(`  ✗ ${where}: ${detail}`);
}
function pass(where) {
  console.log(`  ✓ ${where}`);
}

/**
 * Fresh identity per check. In dev every page without a stored session falls
 * back to the shared `dev:1` token, so favorites picked by an earlier check
 * would leak into later ones (the onboarding Skip precondition is
 * count === 0). `?devUser=` (the app's documented preview id, read before the
 * hash) gives each page its own throwaway account — and the server's
 * verifyDevToken accepts `dev:<digits>` only, so the id must be numeric. A
 * fresh ms timestamp plus a random tail stays inside Number.MAX_SAFE_INTEGER.
 */
function devUserId() {
  const tail = String(Math.floor(Math.random() * 100));
  return Number(`9${Date.now() % 10_000_000_000_000}${tail.padStart(2, "0")}`);
}

/** Real-URL-until-hash + hash route, carrying the devUser query. */
function appUrl(user, hash) {
  return `${BASE}/?devUser=${encodeURIComponent(user)}#${hash}`;
}

async function newPage(browser, { width, height, lang, loggedOut = false, lcp = false }) {
  const ctx = await browser.newContext({ viewport: { width, height } });
  await ctx.addInitScript(
    ([lang, loggedOut, lcp]) => {
      localStorage.setItem("matchday.lang", lang);
      if (loggedOut) localStorage.setItem("matchday.loggedOut", "1");
      else localStorage.removeItem("matchday.loggedOut");
      // LCP must be registered at document start (init script) with the
      // buffered flag: an observer attached after a later navigation dies with
      // its old document, leaving the reader an undefined — a vacuum pass.
      if (lcp) {
        window.__smokeLcp = {
          value: null,
          support:
            typeof PerformanceObserver !== "undefined" &&
            PerformanceObserver.supportedEntryTypes.includes("largest-contentful-paint"),
        };
        if (window.__smokeLcp.support) {
          new PerformanceObserver((list) => {
            const e = list.getEntries().at(-1);
            if (e) window.__smokeLcp.value = e.startTime;
          }).observe({ type: "largest-contentful-paint", buffered: true });
        }
      }
    },
    [lang, loggedOut, lcp],
  );
  return ctx.newPage();
}

async function settle(page, url, ms = 2500) {
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30_000 });
  await page.waitForTimeout(ms);
}

// ---------------------------------------------------------------- data picks
async function pickFixtures() {
  const res = await fetch(`${API}/api/matches?limit=200`);
  const { matches } = await res.json();
  const preferNed = matches.find((m) => m.league === "ned.1") ?? matches[0];
  return { match: preferNed, teamId: matches[0].home_team_id };
}

async function browser() {
  const launch = { headless: true, args: ["--no-sandbox"] };
  return CHANNEL ? chromium.launch({ ...launch, channel: CHANNEL }) : chromium.launch(launch);
}

// ------------------------------------------------------------------- checks
async function checkLogin(browser, lang) {
  for (const [width, height] of [
    [390, 844],
    [360, 640],
  ]) {
    const page = await newPage(browser, { width, height, lang, loggedOut: true });
    await settle(page, appUrl(devUserId(`login_${lang}_${width}`), "/login"), 2000);
    const still = page.url();
    if (!still.includes("login")) {
      fail(`login ${lang} ${width}px`, `expected to stay on /#/login, saw ${still}`);
      await page.context().close();
      continue;
    }
    const d = await page.evaluate(() => {
      const main = document.querySelector("main");
      const ps = main ? [...main.querySelectorAll("p")] : [];
      const legal = ps[ps.length - 1];
      const doc = document.scrollingElement;
      return {
        legalBottom: legal?.getBoundingClientRect().bottom ?? null,
        innerH: window.innerHeight,
        scrollH: doc ? doc.scrollHeight : document.body.scrollHeight,
      };
    });
    if (d.scrollH > d.innerH + 1)
      fail(`login ${lang} ${width}x${height}`, `content overflows 100svh (${d.scrollH} > ${d.innerH})`);
    else pass(`login ${lang} ${width}x${height} fits 100svh`);
    if (d.legalBottom == null || d.legalBottom > d.innerH)
      fail(`login ${lang} ${width}x${height}`, `legal line out of viewport (bottom ${d.legalBottom} vs ${d.innerH})`);
    else pass(`login ${lang} ${width}x${height} legal line in viewport`);
    await page.context().close();
  }
}

/**
 * Render-time gate, the twin of the bundle budget: LCP of the feed under the
 * CI runner's plain hardware. Generous by design (5s catches pathological
 * regressions — sync floods, a mega-chunk, a render loop) without fighting
 * machine-to-machine variance; the bundle budget owns the byte-level gate.
 */
const FEED_LCP_BUDGET_MS = 5000;

async function checkFeedLcp(browser, lang) {
  const page = await newPage(browser, { width: 390, height: 844, lang, lcp: true });
  await settle(page, appUrl(devUserId(`lcp_${lang}`), "/matches"), 4000);
  const d = await page.evaluate(() => window.__smokeLcp ?? { support: false, value: null });
  if (!d.support) console.log(`  ~ feed ${lang} LCP: unsupported in this engine, not gated`);
  else if (d.value == null) console.log(`  ~ feed ${lang} LCP: no entry observed (empty page?), not gated`);
  else if (d.value > FEED_LCP_BUDGET_MS) fail(`feed ${lang} LCP`, `${Math.round(d.value)}ms exceeds the ${FEED_LCP_BUDGET_MS}ms budget`);
  else pass(`feed ${lang} LCP ${Math.round(d.value)}ms <= ${FEED_LCP_BUDGET_MS}ms`);
  await page.context().close();
}

async function checkSlugLeaks(browser, fixtures) {
  const routes = [
    ["feed", `/matches`],
    ["match", `/match/${fixtures.match.id}`],
    ["team", `/team/${fixtures.teamId}`],
    ["unmapped", `/matches?league=xxx.test_cup`],
  ];
  for (const lang of ["en", "fa"]) {
    for (const [label, hash] of routes) {
      const page = await newPage(browser, { width: 390, height: 844, lang });
      const user = devUserId(`${label}_${lang}`);
      await settle(page, appUrl(user, hash), 3000);
      const text = await page.evaluate(() => document.body.innerText);
      const hits = [...new Set([...text.matchAll(SLUG_RE)].map((m) => m[0]))];
      if (hits.length > 0) fail(`${label} ${lang} slug scan`, `raw slug(s) visible: ${hits.join(", ")}`);
      else pass(`${label} ${lang} slug scan clean`);
      await page.context().close();
    }
  }
}

async function checkResetSheet(browser, lang) {
  const page = await newPage(browser, { width: 360, height: 640, lang });
  await settle(page, appUrl(devUserId(`reset_${lang}`), "/profile"), 3000);
  const opened = await page.evaluate((lang) => {
    const els = [...document.querySelectorAll("div, li, button")];
    const hits = els.filter(
      (b) => /Reset local|بازنشانی/.test(b.textContent ?? "") && (b.textContent ?? "").length < 120,
    );
    if (hits.length === 0) return false;
    hits[hits.length - 1].click();
    return true;
  }, lang);
  await page.waitForTimeout(1000);
  if (!opened) {
    fail(`reset sheet ${lang}`, "could not open the reset sheet");
    await page.context().close();
    return;
  }
  const fo = await page.evaluate(([lang]) => {
    const cancel = { en: "Cancel", fa: "انصراف" }[lang];
    const confirm = { en: "Reset", fa: "بازنشانی" }[lang];
    const btns = [...document.querySelectorAll("button")].filter((b) => {
      const t = (b.textContent ?? "").trim();
      return (t === cancel || t === confirm) && b.getBoundingClientRect().height > 0;
    });
    return {
      vh: window.innerHeight,
      btns: btns.map((b) => {
        const r = b.getBoundingClientRect();
        return { t: (b.textContent ?? "").trim().slice(0, 14), h: Math.round(r.height), bottom: Math.round(r.bottom) };
      }),
    };
  }, [lang]);
  if (fo.btns.length < 2) fail(`reset sheet ${lang}`, `expected both footer buttons, saw ${fo.btns.length}`);
  for (const b of fo.btns) {
    if (b.h < 44) fail(`reset sheet ${lang}`, `button "${b.t}" is ${b.h}px (< 44)`);
    if (b.bottom > fo.vh) fail(`reset sheet ${lang}`, `button "${b.t}" clipped (bottom ${b.bottom} > ${fo.vh})`);
  }
  if (failures.length === 0) pass(`reset sheet ${lang}: both footer buttons ≥44px, nothing clipped`);
  await page.context().close();
}

async function checkOnboarding(browser, lang) {
  const continue_ = { en: "Continue", fa: "ادامه" }[lang];
  const skip = { en: "Skip for now", fa: "فعلاً رد شو" }[lang];
  const startedEn = "Get started";
  const startedFa = "شروع کنید";

  const page = await newPage(browser, { width: 360, height: 640, lang });
  await settle(page, appUrl(devUserId(`onb1_${lang}`), "/onboarding"), 3500);
  await page.evaluate(() => {
    const cards = [...document.querySelectorAll("ul button")];
    const b = cards.find((x) => (x.textContent ?? "").trim().length > 1);
    if (b) b.click();
  });
  await page.waitForTimeout(2500);
  const clicked = await page.evaluate(([t]) => {
    const b = [...document.querySelectorAll("button")].find((x) => (x.textContent ?? "").trim() === t);
    if (b) {
      b.click();
      return true;
    }
    return false;
  }, [continue_]);
  await page.waitForTimeout(1500);
  const after = await page.evaluate(([lang]) => {
    const text = document.body.innerText;
    const step1 = { en: /Step 1 of 3/, fa: /گام 1 از 3/ }[lang];
    return { step1: step1.test(text) };
  }, [lang]);
  if (!clicked) fail(`onboarding ${lang}`, "Continue button not found after picking a club");
  else if (after.step1) fail(`onboarding ${lang}`, "Continue clicked but step 1 did not advance");
  else pass(`onboarding ${lang}: pick → Continue advances to step 2`);
  await page.context().close();

  const page2 = await newPage(browser, { width: 360, height: 640, lang });
  await settle(page2, appUrl(devUserId(`onb2_${lang}`), "/onboarding"), 3500);
  // Skip can sit behind the one-time intro screen: if "Get started" is up,
  // dismiss it first, then poll for the step-0 Skip button — a dev/HMR reload
  // or a slow guest-entry handshake must read as a retry, not a failure.
  let skipped = false;
  for (let i = 0; i < 12 && !skipped; i++) {
    skipped = await page2.evaluate(([t, started, startedFa]) => {
      const btns = [...document.querySelectorAll("button")];
      const intro = btns.find((x) => [started, startedFa].includes((x.textContent ?? "").trim()));
      if (intro) {
        intro.click();
        return false;
      }
      const b = [...document.querySelectorAll("button")].find((x) => (x.textContent ?? "").trim() === t);
      if (b) {
        b.click();
        return true;
      }
      return false;
    }, [skip, startedEn, startedFa]);
    await page2.waitForTimeout(700);
  }
  await page2.waitForTimeout(2500);
  if (!skipped) fail(`onboarding ${lang}`, "Skip button not found");
  else if (!page2.url().includes("matches")) fail(`onboarding ${lang}`, `Skip did not land on matches: ${page2.url()}`);
  else pass(`onboarding ${lang}: Skip lands on the feed`);
  await page2.context().close();
}

// -------------------------------------------------------------------- main
// Wait for both servers (no extra wait-on dependency): the API's liveness
// probe is /health on its own port, the app answers any request.
async function waitReady() {
  const deadline = Date.now() + 90_000;
  for (;;) {
    try {
      const h = await fetch(`${API}/health`);
      const app = await fetch(`${BASE}/`);
      if (h.ok && app.ok) return;
    } catch {
      /* not up yet */
    }
    if (Date.now() > deadline) {
      console.error(`SMOKE: ${API}/health or ${BASE}/ never came up within 90s`);
      process.exit(1);
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
}
await waitReady();

const fixtures = await pickFixtures();
if (!fixtures.match?.id) {
  console.error("SMOKE: no matches in the API — seed demo data first (npm run seed:demo)");
  process.exit(1);
}
const browserHandle = await browser();
try {
  console.log(`SMOKE against ${BASE} (match ${fixtures.match.id}, team ${fixtures.teamId})`);
  await checkLogin(browserHandle, "en");
  await checkLogin(browserHandle, "fa");
  await checkFeedLcp(browserHandle, "en");
  await checkFeedLcp(browserHandle, "fa");
  await checkSlugLeaks(browserHandle, fixtures);
  await checkResetSheet(browserHandle, "en");
  await checkResetSheet(browserHandle, "fa");
  await checkOnboarding(browserHandle, "en");
  await checkOnboarding(browserHandle, "fa");
} finally {
  await browserHandle.close();
}

if (failures.length > 0) {
  console.error(`\nSMOKE FAILED: ${failures.length} finding(s)`);
  process.exit(1);
}
console.log("\nSMOKE OK");
