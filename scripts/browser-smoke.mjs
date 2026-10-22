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
import { mkdirSync } from "node:fs";

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
function pass(where, detail) {
  console.log(detail ? `  ✓ ${where}: ${detail}` : `  ✓ ${where}`);
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

// ------------------------------------------------------- round-4 visual work
// Tasks 1b/2/3/4 acceptance, ported from the untracked .tmp verify scripts:
// pick-banner persistence, state groups with a collapsed Finished, the 4s
// loading skeleton, the empty-day state, and the compact timeline rows. All
// new seeding goes through storageState — addInitScript re-runs on every
// reload and would wipe whichever persisted key the check is testing.

const PICK_BANNER_KEY = "verdikick.pickBannerDismissed";
const FINISHED_KEY = "section.open.feed-finished";

function round4Storage(lang, seed = {}) {
  return {
    cookies: [],
    origins: [
      {
        origin: BASE,
        localStorage: [
          { name: "matchday.lang", value: lang },
          ...Object.entries(seed).map(([name, value]) => ({ name, value: JSON.stringify(value) })),
        ],
      },
    ],
  };
}

function t4Payload({ live = 0, halftime = 0, upcoming = 0, finished = 0 }) {
  const kick = new Date();
  kick.setHours(14, 0, 0, 0);
  const kickoff = kick.toISOString();
  const mk = (i, patch) => ({
    id: `sm${i}`,
    gameweek_id: null,
    league: "eng.1",
    home_team_id: patch.ht ?? `h${i}`,
    away_team_id: `a${i}`,
    kickoff_at: kickoff,
    last_synced_at: null,
    home_formation: null,
    away_formation: null,
    home_name: `Home ${i}`,
    home_short: `Home${i}`,
    home_abbr: `H${i}`,
    home_color: "#1fbfa0",
    home_logo: null,
    away_name: `Away ${i}`,
    away_short: `Away${i}`,
    away_abbr: `A${i}`,
    away_color: "#ff5a4d",
    away_logo: null,
    ...patch,
  });
  const list = [];
  let n = 0;
  for (let k = 0; k < live; k++, n++)
    list.push(mk(n, { status: "live", minute_display: `${12 + k}'`, home_score: k % 2, away_score: 0, ht: k === 0 ? "fH" : undefined }));
  for (let k = 0; k < halftime; k++, n++)
    list.push(mk(n, { status: "halftime", minute_display: "HT", home_score: 1, away_score: 0 }));
  for (let k = 0; k < upcoming; k++, n++)
    list.push(mk(n, { status: "scheduled", minute_display: null, home_score: null, away_score: null }));
  for (let k = 0; k < finished; k++, n++)
    list.push(mk(n, { status: "finished", minute_display: "FT", home_score: k % 5, away_score: (k + 1) % 4 }));
  return list;
}

function mockFeed(page, matches, { delayMs = 0 } = {}) {
  return page.route("**/api/matches*", async (r) => {
    if (r.request().method() !== "GET") return r.fallback();
    if (delayMs) await new Promise((res) => setTimeout(res, delayMs));
    return r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ matches, count: matches.length }) });
  });
}

const REVIEW4 = ".ui-shots/review4";
try {
  mkdirSync(REVIEW4, { recursive: true });
} catch {
  /* the screenshots are a bonus, never a gating dependency */
}

async function captureSplash(browser, lang) {
  const label = `splash ${lang} 390x844`;
  const ctx = await browser.newContext({
    viewport: { width: 390, height: 844 },
    reducedMotion: "no-preference",
    storageState: round4Storage(lang),
  });
  const page = await ctx.newPage();
  // Hold the entry chunk so the 150ms-delayed splash has its moment; the shot
  // lands inside that window, before anything mounts.
  await page.route("**/src/main.tsx", async (r) => {
    await new Promise((res) => setTimeout(res, 900));
    r.continue();
  });
  await page.goto(appUrl(devUserId(`splash_${lang}`), "/matches"), { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.waitForTimeout(350);
  const boot = await page.evaluate(() => {
    const el = document.getElementById("boot");
    if (!el) return null;
    return { opacity: getComputedStyle(el).opacity, img: Boolean(el.querySelector("img")), ring: Boolean(el.querySelector(".boot-ring")) };
  });
  if (!boot || boot.opacity !== "1" || !boot.img || !boot.ring) fail(label, `splash not on screen at 350ms: ${JSON.stringify(boot)}`);
  else pass(label, "mark + ring visible mid-boot");
  try {
    await page.screenshot({ path: `${REVIEW4}/splash-${lang}-390.png` });
  } catch {
    /* screenshots never gate */
  }
  await page.waitForTimeout(3500);
  const gone = await page.evaluate(() => !document.getElementById("boot"));
  if (!gone) fail(label, "splash still in DOM after the app mounts");
  await ctx.close();
}

async function checkPickBanner(browser, lang) {
  for (const [width, height] of [
    [390, 844],
    [360, 640],
  ]) {
    const label = `pickBanner ${lang} ${width}x${height}`;
    const ctx = await browser.newContext({ viewport: { width, height }, storageState: round4Storage(lang) });
    const page = await ctx.newPage();
    await settle(page, appUrl(devUserId(`banner_${lang}_${width}`), "/matches"), 4000);
    const shown = await page.evaluate(() => {
      const region = [...document.querySelectorAll('[role="region"]')].find(
        (r) => (r.getAttribute("aria-label") ?? "").length > 0 && r.querySelector("a"),
      );
      if (!region) return null;
      const link = region.querySelector("a");
      const btn = region.querySelector("button");
      const rect = region.getBoundingClientRect();
      return {
        h: Math.round(rect.height),
        bottom: Math.round(rect.bottom),
        vh: window.innerHeight,
        // The pill is 36px tall now; what a thumb hits is its invisible ::after
        // band, so measure the probed target, not the box.
        cta: (() => {
          if (!link) return -1;
          const b = link.getBoundingClientRect();
          const x = b.left + b.width / 2;
          const inside = (y) => {
            const el = document.elementFromPoint(x, y);
            return el === link || link.contains(el);
          };
          let top = b.top;
          while (inside(top - 0.5) && b.top - top < 10) top -= 0.5;
          let bottom = b.bottom;
          while (inside(bottom + 0.5) && bottom - b.bottom < 10) bottom += 0.5;
          return Math.round(bottom - top);
        })(),
        dismiss: Math.round(btn?.getBoundingClientRect().height ?? -1),
      };
    });
    if (!shown) {
      fail(label, "banner absent for a zero-favourite fresh user");
    } else {
      pass(label, `banner h=${shown.h}px bottom=${shown.bottom}/${shown.vh} cta=${shown.cta}px dismiss=${shown.dismiss}px`);
      if (shown.bottom > shown.vh) fail(label, "banner clipped");
      if (shown.cta < 44 || shown.dismiss < 44) fail(label, `targets <44px (${shown.cta}/${shown.dismiss})`);
      const bodyText = await page.evaluate(() => document.body.innerText);
      if (/No club picked yet|هنوز باشگاهی/.test(bodyText)) fail(label, 'old "No club picked yet" card still in the feed');
      await page.evaluate(() => {
        const region = [...document.querySelectorAll('[role="region"]')].find((r) => r.querySelector("a"));
        region?.querySelector("button")?.click();
      });
      await page.waitForTimeout(600);
      const stored = await page.evaluate((k) => localStorage.getItem(k), PICK_BANNER_KEY);
      await page.reload({ waitUntil: "domcontentloaded" });
      await page.waitForTimeout(3500);
      const after = await page.evaluate(
        (k) => ({
          gone: ![...document.querySelectorAll('[role="region"]')].some((r) => r.querySelector("a")),
          stored: localStorage.getItem(k),
        }),
        PICK_BANNER_KEY,
      );
      if (stored !== "true" || !after.gone || after.stored !== "true")
        fail(label, `dismiss not persisted (stored=${stored} after=${after.stored} gone=${after.gone})`);
      else pass(label, "dismiss hides instantly and survives reload");
      try {
        await page.screenshot({ path: `${REVIEW4}/banner-${lang}-${width}.png` });
      } catch {
        /* screenshots never gate */
      }
    }
    await ctx.close();
  }
}

async function checkGroups(browser, lang, width) {
  const label = `groups ${lang} ${width}x844`;
  const want = {
    en: ["Live now", "Half-time", "Later today", "Finished"],
    fa: ["زنده", "نیمه‌وقت", "بعداً امروز", "تمام‌شده"],
  }[lang];
  const ctx = await browser.newContext({ viewport: { width, height: 844 }, storageState: round4Storage(lang) });
  const page = await ctx.newPage();
  await mockFeed(page, t4Payload({ live: 4, halftime: 8, upcoming: 2, finished: 13 }));
  await page.route("**/team/**/logo", (r) => r.fulfill({ body: "" }));
  await settle(page, appUrl(devUserId(`groups_${lang}_${width}`), "/matches"), 4000);
  const headers = await page.evaluate(() =>
    [...document.querySelectorAll("h2")]
      .filter((h) => /feed-group-|feed-finished-heading/.test(h.id))
      .map((h) => {
        const raw = h.textContent ?? "";
        const row = h.closest("button") ?? h.parentElement;
        const inH = [...h.querySelectorAll(".num-display")];
        const inRow = [...(row?.querySelectorAll(".num-display") ?? [])];
        const nums = [...inH, ...inRow].map((s) => s.textContent ?? "");
        const count = Number(nums.find((x) => /^\d+$/.test(x.trim())) ?? raw.match(/\d+/)?.[0] ?? -1);
        return { id: h.id, label: raw.replace(/\d+/g, "").trim(), count, top: Math.round(h.getBoundingClientRect().top) };
      }),
  );
  const counts = [4, 8, 2, 13];
  const okOrder =
    headers.length === 4 &&
    want.every((w, i) => headers[i]?.label === w) &&
    headers.every((h, i) => h.count === counts[i] && (i === 0 || headers[i].top > headers[i - 1].top));
  if (!okOrder) fail(label, `headers ${JSON.stringify(headers)}`);
  else pass(label, `${headers.map((h) => `${h.label}=${h.count}`).join(" · ")} (t=${headers.map((h) => h.top).join("<")})`);
  const state = await page.getAttribute('[aria-controls="feed-finished-panel"]', "aria-expanded");
  if (state !== "false") fail(label, `Finished not collapsed by default (aria-expanded=${state})`);
  else pass(label, "Finished collapsed by default");
  await page.click('[aria-controls="feed-finished-panel"]');
  await page.waitForTimeout(500);
  try {
    await page.screenshot({ path: `${REVIEW4}/groups-${lang}-${width}.png` });
  } catch {
    /* screenshots never gate */
  }
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForTimeout(3500);
  const persisted = await page.evaluate(
    (k) => ({
      open: Boolean(document.getElementById("feed-finished-panel")),
      stored: localStorage.getItem(k),
    }),
    FINISHED_KEY,
  );
  if (!persisted.open || persisted.stored !== "true") fail(label, `expanded choice lost after reload (stored=${persisted.stored})`);
  else pass(label, `expanded choice survives reload (stored=${persisted.stored})`);
  const overflow = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: window.innerWidth }));
  if (overflow.sw > overflow.iw + 1) fail(label, `horizontal overflow ${overflow.sw}>${overflow.iw}`);
  await ctx.close();
}

async function checkSavedChoiceBeatsDefault(browser, lang) {
  const label = `savedChoice ${lang} 390x844`;
  const ctx = await browser.newContext({
    viewport: { width: 390, height: 844 },
    storageState: round4Storage(lang, { [FINISHED_KEY]: false }),
  });
  const page = await ctx.newPage();
  await mockFeed(page, t4Payload({ finished: 2 }));
  await page.route("**/team/**/logo", (r) => r.fulfill({ body: "" }));
  await settle(page, appUrl(devUserId(`saved_${lang}`), "/matches"), 4000);
  const r = await page.evaluate(
    (k) => ({
      open: Boolean(document.getElementById("feed-finished-panel")),
      stored: localStorage.getItem(k),
    }),
    FINISHED_KEY,
  );
  if (r.open) fail(label, `saved collapsed choice lost on a finished-only day (stored=${r.stored})`);
  else pass(label, 'saved "false" wins over the computed expand default');
  await ctx.close();
}

async function checkLoadingSkeleton(browser, lang, width) {
  const label = `skeleton ${lang} ${width}x844`;
  const ctx = await browser.newContext({ viewport: { width, height: 844 }, storageState: round4Storage(lang) });
  const page = await ctx.newPage();
  await mockFeed(page, [], { delayMs: 4000 });
  await page.goto(appUrl(devUserId(`skel_${lang}_${width}`), "/matches"), { waitUntil: "domcontentloaded", timeout: 30000 });
  // The route holds the response for 4s; the app needs ~1.5s to paint (cold
  // module graph). Catch the skeleton window in between.
  await page.waitForTimeout(1600);
  const s = await page.evaluate(() => {
    // The loading list is the one the feed marks aria-busy — its <li> children
    // ARE the skeletons, whatever the shimmer's DOM depth is.
    const skels = [...document.querySelectorAll('ul[aria-busy="true"] > li')];
    return {
      n: skels.length,
      h: Math.round(skels[0]?.getBoundingClientRect().height ?? -1),
      banner: [...document.querySelectorAll('[role="region"]')].some((x) => x.querySelector("a")),
      h2: document.querySelectorAll("h2").length,
    };
  });
  if (s.n !== 4) fail(label, `want 4 skeletons while loading, saw ${s.n}`);
  else if (!(s.h >= 100 && s.h <= 120)) fail(label, `skeleton height ${s.h}px (want ≈108)`);
  else pass(label, `4 skeletons, h=${s.h}px, banner=${s.banner} h2=${s.h2}`);
  try {
    await page.screenshot({ path: `${REVIEW4}/skeleton-${lang}-${width}.png` });
  } catch {
    /* screenshots never gate */
  }
  await ctx.close();
}

async function checkEmptyDay(browser, lang, width, later) {
  const label = `emptyDay ${lang} ${width}x844 later=${later}`;
  const ctx = await browser.newContext({ viewport: { width, height: 844 }, storageState: round4Storage(lang) });
  const page = await ctx.newPage();
  const matches = later
    ? t4Payload({ upcoming: 1 }).map((m) => ({
        ...m,
        kickoff_at: new Date(new Date().setDate(new Date().getDate() + 2)).toISOString(),
      }))
    : [];
  await mockFeed(page, matches);
  await page.route("**/team/**/logo", (r) => r.fulfill({ body: "" }));
  await settle(page, appUrl(devUserId(`empty_${lang}_${width}_${later}`), "/matches"), 4000);
  const s = await page.evaluate(() => {
    const empty = document.querySelector(".pitch-watermark");
    const btn = [...document.querySelectorAll("button")].find((b) => /Go to |برو به /.test(b.textContent ?? ""));
    return {
      title: empty?.querySelector("p")?.textContent ?? "",
      btn: btn ? { h: Math.round(btn.getBoundingClientRect().height), text: (btn.textContent ?? "").trim() } : null,
    };
  });
  const wantTitle = lang === "en" ? /No matches on/ : /بازی‌ای نیست/;
  if (!wantTitle.test(s.title)) fail(label, `title "${s.title}" does not name the day`);
  else if (later && s.btn && s.btn.h >= 44) pass(label, `"${s.title}" + "${s.btn.text}" (${s.btn.h}px)`);
  else if (later) fail(label, "go-to-day button missing or <44px");
  else if (s.btn) fail(label, "button must not exist when no later day");
  else pass(label, `"${s.title}", no jump button (no later day)`);
  try {
    await page.screenshot({ path: `${REVIEW4}/empty-day-${lang}-${width}-${later ? "later" : "none"}.png` });
  } catch {
    /* screenshots never gate */
  }
  await ctx.close();
}

async function checkTimelineRows(browser, lang, width) {
  const label = `timeline ${lang} ${width}x844`;
  const ctx = await browser.newContext({ viewport: { width, height: 844 }, storageState: round4Storage(lang) });
  const page = await ctx.newPage();
  const match = t4Payload({ upcoming: 1 })[0];
  match.status = "finished";
  match.home_score = 1;
  match.away_score = 1;
  match.minute_display = "FT";
  const HOME = match.home_team_id;
  const AWAY = match.away_team_id;
  await mockFeed(page, [match]);
  await page.route(`**/api/matches/${match.id}**`, (r) => {
    const p = new URL(r.request().url()).pathname;
    if (p.endsWith("/timeline"))
      return r.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ events: [
          { id: 1, match_id: match.id, minute_display: "12'", minute_seconds: 720, type: "card", team_id: AWAY, description: "Yellow Card", participants: [{ id: "p1", name: "Enzo Perspective" }], comment_count: 2, field_x: null, field_y: null },
          { id: 2, match_id: match.id, minute_display: "26'", minute_seconds: 1560, type: "substitution", team_id: HOME, description: "Substitution", participants: [{ id: "p2", name: "Out Player" }, { id: "p3", name: "In Player" }], comment_count: 0, field_x: null, field_y: null },
          { id: 4, match_id: match.id, minute_display: "32'", minute_seconds: 1920, type: "goal", team_id: AWAY, description: "Normal Goal", participants: [{ id: "p4", name: "Away Scorer" }], comment_count: 1, field_x: null, field_y: null },
          { id: 5, match_id: match.id, minute_display: "38'", minute_seconds: 2280, type: "goal", team_id: HOME, description: "Normal Goal", participants: [{ id: "p5", name: "Home Scorer" }], comment_count: 0, field_x: null, field_y: null },
          { id: 6, match_id: match.id, minute_display: "HT", minute_seconds: 2700, type: "halftime", team_id: null, description: "First Half Ends", participants: [], comment_count: 0, field_x: null, field_y: null },
        ] }),
      });
    if (p.includes("/comments"))
      return r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ comments: [] }) });
    return r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ match, lineups: [], players: [], teams: [], stats: [] }) });
  });
  await page.route("**/team/**/logo", (r) => r.fulfill({ body: "" }));
  await settle(page, appUrl(devUserId(`tl_${lang}_${width}`), `/match/${match.id}`), 4500);
  const rows = await page.evaluate(() =>
    [...document.querySelectorAll("ol li")].map((li) => {
      const rct = li.getBoundingClientRect();
      return {
        role: li.getAttribute("role"),
        h: Math.round(rct.height),
        tint: /rounded-card/.test(li.className || "") && /bg-elevated/.test(li.className || ""),
        score: [...li.querySelectorAll('span[dir="ltr"] .num-display')].map((s) => s.textContent ?? "").find((x) => /[0-9]+–[0-9]+/.test(x)) ?? null,
      };
    }),
  );
  const plain = rows.filter((r) => !r.role);
  const sep = rows.find((r) => r.role === "separator");
  const goalRows = rows.filter((r) => r.tint);
  if (plain.length === 0 || plain.some((r) => r.h > 56 || r.h < 40)) fail(label, `plain rows ${JSON.stringify(plain.map((r) => r.h))}`);
  else pass(label, `plain rows ${plain.map((r) => r.h).join("/")}px (40-56 band)`);
  if (goalRows.length < 2 || !goalRows.every((r) => /[0-9]+–[0-9]+/.test(r.score ?? "")))
    fail(label, `goal rows tinted+score: ${JSON.stringify(goalRows)}`);
  else pass(label, `goal rows tinted, LTR scores ${goalRows.map((r) => r.score).join(",")}`);
  if (!sep || !/[0-9]+–[0-9]+/.test(sep.score ?? "")) fail(label, `half-time divider missing/no score: ${JSON.stringify(sep)}`);
  else pass(label, `half-time divider with score ${sep.score}`);
  try {
    await page.screenshot({ path: `${REVIEW4}/timeline-${lang}-${width}.png` });
  } catch {
    /* screenshots never gate */
  }
  await ctx.close();
}

// ------------------------------------------------------- round-5 feed polish
/**
 * Task 1 (seven-chip strip, calendar button in the header) and Task 2 (pill
 * banner CTA, 8px rhythm on the feed top), measured in a real browser. Same
 * rules as round 4: localStorage is seeded through storageState — an
 * addInitScript would re-run on every reload and wipe what a check asserts —
 * and every number is printed, not just judged.
 */
const REVIEW5 = ".ui-shots/review5";
try {
  mkdirSync(REVIEW5, { recursive: true });
} catch {
  /* screenshots never gate */
}

/** [name, measured, wanted] for every feed-top number this section checks. */
const FEED_TOP_ROWS = [];
function expectAt(label, name, got, want, tol = 1) {
  FEED_TOP_ROWS.push([`${label} · ${name}`, Number.isFinite(got) ? Number(got.toFixed(1)) : String(got), want]);
  if (!Number.isFinite(got) || Math.abs(got - want) > tol)
    fail(label, `${name} = ${Number.isFinite(got) ? got.toFixed(1) : got}px, want ${want}px`);
}
function printFeedTopTable() {
  const width = Math.max(...FEED_TOP_ROWS.map((r) => r[0].length));
  console.log("\n  measurement table — feed top (px)");
  for (const [name, got, want] of FEED_TOP_ROWS)
    console.log(`    ${name.padEnd(width)}  ${String(got).padStart(7)}   want ${want}`);
}

/** A localised day number, so a chip can be found in either language. */
const dayNumber = (lang, offset) =>
  new Intl.NumberFormat(lang === "fa" ? "fa-IR" : undefined, { useGrouping: false }).format(
    new Date(new Date().setDate(new Date().getDate() + offset)).getDate(),
  );

/**
 * The number a CALENDAR-SHEET cell carries for a date: the strip chips stay on
 * Gregorian day numbers in both languages, but the sheet runs on the ACTIVE
 * calendar — Jalali day under Persian, Gregorian day under English — so the
 * far-day pick must ask Intl for that day of that system.
 */
const calendarDayNumber = (lang, date) => {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const day = Number(
    new Intl.DateTimeFormat(lang === "fa" ? "en-US-u-ca-persian" : "en-US", {
      day: "numeric",
      timeZone: "UTC",
    }).format(d),
  );
  return new Intl.NumberFormat(lang === "fa" ? "fa-IR" : undefined, { useGrouping: false }).format(day);
};

/** Server-side favourite for a throwaway dev identity (the feed's banner gate). */
async function seedFavorite(user, teamId) {
  const res = await fetch(`${API}/api/me/favorites`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer dev:${user}` },
    body: JSON.stringify({ teamId }),
  });
  return res.ok;
}

/**
 * Everything the feed top has to prove at one viewport in one language: the
 * strip's geometry and hit bands, the header's two actions, the pill banner
 * CTA, the 8px rhythm, and the calendar round trip (far date → re-centre →
 * Today → default week).
 */
async function checkFeedTop(browser, lang, width, height) {
  const label = `feedTop ${lang} ${width}x${height}`;
  const ctx = await browser.newContext({ viewport: { width, height }, storageState: round4Storage(lang) });
  const page = await ctx.newPage();
  // Three groups on one day (so "between groups" is measurable) plus ONE
  // fixture two days out, so a chip tap can prove the feed really filters.
  const feed = t4Payload({ live: 2, upcoming: 3, finished: 1 });
  const inTwoDays = new Date();
  inTwoDays.setDate(inTwoDays.getDate() + 2);
  inTwoDays.setHours(18, 0, 0, 0);
  feed.push({
    ...feed[0],
    id: "sm-day-after-tomorrow",
    kickoff_at: inTwoDays.toISOString(),
    status: "scheduled",
    minute_display: null,
    home_score: null,
    away_score: null,
  });
  await mockFeed(page, feed);
  await page.route("**/team/**/logo", (r) => r.fulfill({ body: "" }));
  await settle(page, appUrl(devUserId(`feedtop_${lang}_${width}`), "/matches"), 4500);

  const geo = await page.evaluate(() => {
    const rectOf = (el) => {
      const b = el.getBoundingClientRect();
      return { l: b.left, r: b.right, t: b.top, b: b.bottom, w: b.width, h: b.height };
    };
    const inside = (el, x, y) => {
      const hit = document.elementFromPoint(x, y);
      return hit === el || el.contains(hit);
    };
    const group = document.querySelector('[role="group"]');
    const chips = group ? [...group.querySelectorAll(":scope > button")] : [];
    const chipData = chips.map((c) => {
      const b = c.getBoundingClientRect();
      const y = b.top + b.height / 2;
      let left = b.left;
      while (inside(c, left - 0.5, y) && b.left - left < 8) left -= 0.5;
      let right = b.right;
      while (inside(c, right + 0.5, y) && right - b.right < 8) right += 0.5;
      return {
        w: b.width,
        h: b.height,
        l: b.left,
        r: b.right,
        hitW: right - left,
        bandOk: inside(c, b.left - 2, y) && inside(c, b.right + 2, y),
        pressed: c.getAttribute("aria-pressed"),
        current: c.getAttribute("aria-current"),
        num: c.children[1]?.textContent ?? "",
        ariaLabel: c.getAttribute("aria-label") ?? "",
        outlined: c.classList.contains("border-volt") && !c.classList.contains("bg-volt"),
      };
    });
    const header = document.querySelector("header");
    const actions = [...header.querySelectorAll("button")].map((b) => {
      const r = b.getBoundingClientRect();
      const y = r.top + r.height / 2;
      return {
        ariaLabel: b.getAttribute("aria-label"),
        popup: b.getAttribute("aria-haspopup"),
        w: r.width,
        h: r.height,
        l: r.left,
        t: r.top,
        bandOk:
          inside(b, r.left - 2, y) && inside(b, r.right + 2, y) && inside(b, r.left + r.width / 2, r.top - 2),
      };
    });
    const card = document.querySelector("main ul li");
    return {
      dir: document.documentElement.dir,
      chipCount: chips.length,
      chips: chipData,
      card: card ? rectOf(card) : null,
      actions,
      overflow: document.documentElement.scrollWidth - window.innerWidth,
    };
  });

  // ---- strip geometry
  const widths = geo.chips.map((c) => c.w);
  if (geo.chipCount !== 7) fail(label, `want 7 day chips, saw ${geo.chipCount}`);
  expectAt(label, "chip count", geo.chipCount, 7, 0);
  expectAt(label, "chip width spread", Math.max(...widths) - Math.min(...widths), 0);
  expectAt(label, "chip height", geo.chips[0]?.h ?? NaN, 56);
  const ordered = [...geo.chips].sort((a, b) => a.l - b.l);
  const realGaps = ordered.slice(1).map((c, i) => c.l - ordered[i].r);
  expectAt(label, "chip gap", realGaps[0] ?? NaN, 6);
  expectAt(label, "strip left vs card left", Math.abs(ordered[0].l - geo.card.l), 0);
  expectAt(label, "strip right vs card right", Math.abs(ordered[ordered.length - 1].r - geo.card.r), 0);
  const minHitWidth = Math.min(...geo.chips.map((c) => c.hitW));
  FEED_TOP_ROWS.push([`${label} · chip tappable width (min)`, Number(minHitWidth.toFixed(1)), "≥ 44"]);
  if (minHitWidth < 44) fail(label, `chip tappable width ${minHitWidth.toFixed(1)}px (< 44)`);
  if (geo.chips.some((c) => !c.bandOk)) fail(label, "a chip's hit band is missing 2px outside its edge");
  if (geo.chips.some((c) => !c.ariaLabel)) fail(label, "a chip has no full-date aria-label");
  if (geo.overflow > 1) fail(label, `horizontal overflow ${geo.overflow}px`);
  if (lang === "fa" && !(geo.chips[0].l > geo.chips[6].l)) fail(label, "FA strip did not mirror");
  if (lang === "fa" && !/[۰-۹]/.test(geo.chips[0].num)) fail(label, `FA chip number not Persian: ${geo.chips[0].num}`);
  const todayChip = geo.chips.find((c) => c.current === "date");
  if (!todayChip || todayChip.pressed !== "true") fail(label, "today is not marked and selected by default");
  if (geo.chips[0].num !== dayNumber(lang, -1)) fail(label, `first chip is not yesterday (${geo.chips[0].num})`);

  // ---- header actions: calendar first, then refresh
  const cal = geo.actions.find((a) => a.popup === "dialog");
  const refresh = geo.actions.find((a) => a.popup !== "dialog");
  if (!cal) fail(label, "no calendar button (aria-haspopup=dialog) in the header");
  if (!refresh) fail(label, "no refresh button in the header");
  for (const action of [cal, refresh]) {
    if (!action) continue;
    expectAt(label, `header ${action.popup ? "calendar" : "refresh"} width`, action.w, 40);
    expectAt(label, `header ${action.popup ? "calendar" : "refresh"} height`, action.h, 40);
    if (!action.bandOk) fail(label, `${action.ariaLabel} has no 44px hit band 2px outside its edge`);
  }
  if (cal && refresh) {
    expectAt(label, "header action gap", Math.abs(Math.abs(cal.l - refresh.l) - cal.w), 8);
    expectAt(label, "header action top delta", Math.abs(cal.t - refresh.t), 0);
    const leading = lang === "en" ? cal.l < refresh.l : cal.l > refresh.l;
    if (!leading) fail(label, "calendar is not the leading header action");
  }

  // ---- spacing rhythm (12 / 12 / 16 / 8 / 8 / 16)
  const flowNow = async () =>
    page.evaluate(() => {
      const rectOf = (el) => {
        const b = el.getBoundingClientRect();
        return { top: b.top, bottom: b.bottom, left: b.left, right: b.right, h: b.height };
      };
      const container = document.querySelector("main > div");
      const headerEls = [...document.querySelectorAll('h2[id^="feed-group-"], h2#feed-finished-heading')];
      return {
        header: rectOf(document.querySelector("header")),
        strip: rectOf(document.querySelector('[role="group"]')),
        blocks: [...container.children].map((el) => ({
          ...rectOf(el),
          isBanner: el.getAttribute("role") === "region",
          isStrip: Boolean(el.querySelector('[role="group"]')),
          text: (el.textContent ?? "").trim().slice(0, 16),
        })),
        headerTops: headerEls.map((h) => h.parentElement.getBoundingClientRect().top),
        headerBottoms: headerEls.map((h) => h.parentElement.getBoundingClientRect().bottom),
        cards: [...document.querySelectorAll("main ul li")].map(rectOf),
        overflow: document.documentElement.scrollWidth - window.innerWidth,
      };
    });

  const m = await flowNow();
  const stripBlock = m.blocks.find((b) => b.isStrip);
  const banner = m.blocks.find((b) => b.isBanner);
  if (!banner) fail(label, "banner absent for a zero-favourite fresh user");
  expectAt(label, "header→strip", stripBlock.top - m.header.bottom, 12);
  expectAt(label, "strip→banner", banner.top - stripBlock.bottom, 12);
  expectAt(label, "banner→first group header", m.headerTops[0] - banner.bottom, 16);
  expectAt(label, "group header→first card", m.cards[0].top - m.headerBottoms[0], 8);
  expectAt(label, "card→card", m.cards[1].top - m.cards[0].bottom, 8);
  if (m.headerTops[1] != null) {
    const before = m.cards.filter((c) => c.top < m.headerTops[1]);
    expectAt(label, "group→group", m.headerTops[1] - Math.max(...before.map((c) => c.bottom)), 16);
  }
  expectAt(label, "banner left vs card left", Math.abs(banner.left - m.cards[0].left), 0);
  expectAt(label, "banner right vs card right", Math.abs(banner.right - m.cards[0].right), 0);
  if (m.overflow > 1) fail(label, `horizontal overflow ${m.overflow}px`);

  // ---- banner: 48px tall, 36px pill with a 44px band, nothing touching
  const pill = await page.evaluate(() => {
    const region = document.querySelector('[role="region"]');
    if (!region) return null;
    const link = region.querySelector("a");
    const dismiss = region.querySelector("button");
    const b = link.getBoundingClientRect();
    const d = dismiss.getBoundingClientRect();
    const bannerBox = region.getBoundingClientRect();
    const x = b.left + b.width / 2;
    const inside = (y) => {
      const el = document.elementFromPoint(x, y);
      return el === link || link.contains(el);
    };
    let top = b.top;
    while (inside(top - 0.5) && b.top - top < 10) top -= 0.5;
    let bottom = b.bottom;
    while (inside(bottom + 0.5) && bottom - b.bottom < 10) bottom += 0.5;
    return {
      bannerH: bannerBox.height,
      pillH: b.height,
      pillHit: bottom - top,
      above: b.top - bannerBox.top,
      below: bannerBox.bottom - b.bottom,
      dismissH: d.height,
      dismissW: d.width,
      dismissGap: d.left >= b.left ? d.left - b.right : b.left - d.right,
    };
  });
  if (!pill) fail(label, "no banner CTA to measure");
  else {
    expectAt(label, "banner height", pill.bannerH, 48);
    expectAt(label, "Choose pill height", pill.pillH, 36);
    expectAt(label, "Choose hit band", pill.pillHit, 44);
    expectAt(label, "Choose clear of top edge", pill.above, 6);
    expectAt(label, "Choose clear of bottom edge", pill.below, 6);
    expectAt(label, "dismiss size", Math.min(pill.dismissW, pill.dismissH), 44);
    if (pill.dismissGap < 4) fail(label, `dismiss sits ${pill.dismissGap}px from the pill`);
  }
  await page.screenshot({ path: `${REVIEW5}/feed-top-${lang}-${width}.png` });

  // ---- chip tap selects its day; today stays outlined
  const target = dayNumber(lang, 2);
  const tapped = await page.evaluate(([num]) => {
    const chips = [...document.querySelector('[role="group"]').querySelectorAll(":scope > button")];
    const chip = chips.find((c) => (c.children[1]?.textContent ?? "") === num);
    if (!chip) return false;
    chip.click();
    return true;
  }, [target]);
  await page.waitForTimeout(800);
  if (!tapped) fail(label, `no chip for today+2 (${target})`);
  else {
    const after = await page.evaluate(() => {
      const chips = [...document.querySelector('[role="group"]').querySelectorAll(":scope > button")];
      const today = chips.find((c) => c.getAttribute("aria-current") === "date");
      return {
        pressed: chips.find((c) => c.getAttribute("aria-pressed") === "true")?.children[1]?.textContent ?? "",
        todayOutlined: today ? today.classList.contains("border-volt") && !today.classList.contains("bg-volt") : false,
        cards: document.querySelectorAll("main ul li").length,
      };
    });
    if (after.pressed !== target) fail(label, `chip tap selected "${after.pressed}", want "${target}"`);
    if (!after.todayOutlined) fail(label, "today lost its outline while another day is selected");
    if (after.cards === 0) fail(label, "the feed lost its cards for a day that has matches");
  }

  // ---- calendar: far date re-centres the window, Today returns to default
  await page.click("header button[aria-haspopup='dialog']");
  await page.waitForTimeout(700);
  if (!(await page.evaluate(() => Boolean(document.querySelector('[role="dialog"]')))))
    fail(label, "the header calendar button did not open the sheet");
  await page.screenshot({ path: `${REVIEW5}/calendar-sheet-${lang}-${width}.png` });

  const far = new Date();
  far.setDate(far.getDate() + 20);
  const monthAhead = await page.evaluate(([iso, l]) => {
    const date = new Date(iso);
    const header = document.querySelector('[role="dialog"] span.text-md')?.textContent ?? "";
    // The sheet runs on the ACTIVE calendar: Solar Hijri under Persian,
    // Gregorian under English. The header must name the far day's month in
    // that system, not the host one.
    const month = new Intl.DateTimeFormat(l === "fa" ? "fa-IR" : undefined, {
      month: "long",
      calendar: l === "fa" ? "persian" : "gregory",
    }).format(date);
    return { month, header, same: header.includes(month) };
  }, [far.toISOString(), lang]);
  if (!monthAhead.same) {
    const nextLabel = { en: "Next month", fa: "ماه بعد" }[lang];
    await page.click(`[role="dialog"] button[aria-label="${nextLabel}"]`);
    await page.waitForTimeout(400);
  }
  const farDay = calendarDayNumber(lang, far);
  const picked = await page.evaluate(([num]) => {
    const cells = [...document.querySelector('[role="dialog"]').querySelectorAll("button")].filter(
      (b) => (b.textContent ?? "").trim() === num,
    );
    if (!cells.length) return { ok: false, dotFree: false };
    // Prefer a dot-free cell: the feed assertion below counts on an EMPTY
    // matchday, and with the ± 3-month range now fetched the day-20 read can
    // carry real fixtures.
    const dotFree = cells.find((c) => !c.querySelector("span.bg-volt")) ?? null;
    (dotFree ?? cells[0]).click();
    return { ok: true, dotFree: Boolean(dotFree) };
  }, [farDay]);
  await page.waitForTimeout(900);
  if (!picked.ok) fail(label, `the calendar has no cell for day ${farDay}`);
  else {
    const centred = await page.evaluate(() => {
      const chips = [...document.querySelector('[role="group"]').querySelectorAll(":scope > button")];
      return {
        pressedIndex: chips.findIndex((c) => c.getAttribute("aria-pressed") === "true"),
        fourth: chips[3]?.children[1]?.textContent ?? "",
        cards: document.querySelectorAll("main ul li").length,
        empty: Boolean(document.querySelector(".pitch-watermark")),
      };
    });
    expectAt(label, "far pick lands in chip slot", centred.pressedIndex, 3, 0);
    if (centred.fourth !== farDay) fail(label, `4th chip reads ${centred.fourth}, want ${farDay}`);
    // Only meaningful on an empty matchday (see the dot-free cell pick).
    if (picked.dotFree && (centred.cards !== 0 || !centred.empty))
      fail(label, `feed not filtered to the picked day (cards=${centred.cards}, empty=${centred.empty})`);
    await page.screenshot({ path: `${REVIEW5}/far-date-${lang}-${width}.png` });
  }

  await page.click("header button[aria-haspopup='dialog']");
  await page.waitForTimeout(600);
  const todayLabel = { en: "Today", fa: "امروز" }[lang];
  const shortcut = await page.evaluate(([t]) => {
    const b = [...document.querySelector('[role="dialog"]').querySelectorAll("button")].find(
      (x) => (x.textContent ?? "").trim() === t,
    );
    return b ? Math.round(b.getBoundingClientRect().height) : -1;
  }, [todayLabel]);
  if (shortcut < 44) fail(label, `"Today" shortcut missing or ${shortcut}px (< 44)`);
  else {
    await page.click(`[role="dialog"] >> text="${todayLabel}"`);
    await page.waitForTimeout(900);
    const home = await page.evaluate(() => {
      const chips = [...document.querySelector('[role="group"]').querySelectorAll(":scope > button")];
      return {
        first: chips[0]?.children[1]?.textContent ?? "",
        second: chips[1]?.children[1]?.textContent ?? "",
        pressedIndex: chips.findIndex((c) => c.getAttribute("aria-pressed") === "true"),
        currentIndex: chips.findIndex((c) => c.getAttribute("aria-current") === "date"),
        dialog: Boolean(document.querySelector('[role="dialog"]')),
      };
    });
    if (home.dialog) fail(label, "Today did not close the sheet");
    if (home.first !== dayNumber(lang, -1)) fail(label, `default window does not start at yesterday (${home.first})`);
    if (home.second !== dayNumber(lang, 0)) fail(label, `the second chip is not today (${home.second})`);
    if (home.pressedIndex !== 1 || home.currentIndex !== 1) fail(label, "Today did not select today");
    else pass(label, "far date re-centres on the 4th chip, Today restores the default week");
  }

  await ctx.close();
}

/**
 * The same rhythm with the banner out of the way: favourites (banner hidden,
 * league chip row shown) and a dismissed banner (nothing between strip and the
 * first group header).
 */
async function checkFeedTopWithoutBanner(browser, lang, width, height, fixtures) {
  const measureFlow = async (page) =>
    page.evaluate(() => {
      const rectOf = (el) => {
        const b = el.getBoundingClientRect();
        return {
          top: b.top,
          bottom: b.bottom,
          h: b.height,
          text: (el.textContent ?? "").trim().slice(0, 16),
        };
      };
      const container = document.querySelector("main > div");
      const headerEls = [...document.querySelectorAll('h2[id^="feed-group-"], h2#feed-finished-heading')];
      return {
        header: rectOf(document.querySelector("header")),
        strip: rectOf(document.querySelector('[role="group"]')),
        blocks: [...container.children].map(rectOf),
        headerTops: headerEls.map((h) => h.parentElement.getBoundingClientRect().top),
        banner: Boolean(document.querySelector('[role="region"]')),
        overflow: document.documentElement.scrollWidth - window.innerWidth,
      };
    });

  // ---- favourites: banner hidden, league chip row between strip and groups
  const favLabel = `feedTop favourite ${lang} ${width}x${height}`;
  const favCtx = await browser.newContext({ viewport: { width, height }, storageState: round4Storage(lang) });
  const favPage = await favCtx.newPage();
  await mockFeed(favPage, t4Payload({ live: 2, upcoming: 3, finished: 1 }));
  await favPage.route("**/team/**/logo", (r) => r.fulfill({ body: "" }));
  const favUser = devUserId(`fav_${lang}_${width}`);
  const seeded = await seedFavorite(favUser, fixtures.teamId);
  if (!seeded) fail(favLabel, "could not seed a favourite through the API");
  await settle(favPage, appUrl(favUser, "/matches"), 4500);
  const fav = await measureFlow(favPage);
  if (fav.banner) fail(favLabel, "banner still visible with a favourite");
  const nextBlock = fav.blocks.find((b) => b.top > fav.strip.bottom + 0.5 && b.h > 0.5);
  expectAt(favLabel, "header→strip", fav.strip.top - fav.header.bottom, 12);
  expectAt(favLabel, "strip→league row", nextBlock.top - fav.strip.bottom, 12);
  expectAt(favLabel, "league row→first group header", fav.headerTops[0] - nextBlock.bottom, 16);
  if (fav.overflow > 1) fail(favLabel, `horizontal overflow ${fav.overflow}px`);
  await favPage.screenshot({ path: `${REVIEW5}/feed-favourites-${lang}-${width}.png` });
  await favCtx.close();

  // ---- dismissed banner: strip straight to the first group header, 16px
  const dismissedLabel = `feedTop dismissed ${lang} ${width}x${height}`;
  const ctx = await browser.newContext({
    viewport: { width, height },
    storageState: round4Storage(lang, { [PICK_BANNER_KEY]: true }),
  });
  const page = await ctx.newPage();
  await mockFeed(page, t4Payload({ live: 2, upcoming: 3, finished: 1 }));
  await page.route("**/team/**/logo", (r) => r.fulfill({ body: "" }));
  await settle(page, appUrl(devUserId(`dismissed_${lang}_${width}`), "/matches"), 4500);
  const d = await measureFlow(page);
  if (d.banner) fail(dismissedLabel, "banner still visible after a persisted dismiss");
  expectAt(dismissedLabel, "header→strip", d.strip.top - d.header.bottom, 12);
  expectAt(dismissedLabel, "strip→first group header", d.headerTops[0] - d.strip.bottom, 16);
  await ctx.close();
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
  // Round-4 visual work (Tasks 1b/2/3/4 acceptance).
  await captureSplash(browserHandle, "en");
  await captureSplash(browserHandle, "fa");
  await checkPickBanner(browserHandle, "en");
  await checkPickBanner(browserHandle, "fa");
  await checkGroups(browserHandle, "en", 390);
  await checkGroups(browserHandle, "fa", 390);
  await checkGroups(browserHandle, "en", 360);
  await checkGroups(browserHandle, "fa", 360);
  await checkSavedChoiceBeatsDefault(browserHandle, "en");
  await checkSavedChoiceBeatsDefault(browserHandle, "fa");
  await checkLoadingSkeleton(browserHandle, "en", 390);
  await checkLoadingSkeleton(browserHandle, "fa", 390);
  await checkLoadingSkeleton(browserHandle, "en", 360);
  await checkLoadingSkeleton(browserHandle, "fa", 360);
  await checkEmptyDay(browserHandle, "en", 390, true);
  await checkEmptyDay(browserHandle, "en", 360, false);
  await checkEmptyDay(browserHandle, "fa", 390, true);
  await checkEmptyDay(browserHandle, "fa", 360, false);
  await checkTimelineRows(browserHandle, "en", 390);
  await checkTimelineRows(browserHandle, "fa", 390);
  await checkTimelineRows(browserHandle, "en", 360);
  await checkTimelineRows(browserHandle, "fa", 360);
  // Round-5 feed polish (Tasks 1+2): strip, header actions, pill, rhythm.
  for (const lang of ["en", "fa"])
    for (const [w, h] of [
      [390, 844],
      [360, 640],
    ])
      await checkFeedTop(browserHandle, lang, w, h);
  for (const lang of ["en", "fa"])
    for (const [w, h] of [
      [390, 844],
      [360, 640],
    ])
      await checkFeedTopWithoutBanner(browserHandle, lang, w, h, fixtures);
  printFeedTopTable();
} finally {
  await browserHandle.close();
}

if (failures.length > 0) {
  console.error(`\nSMOKE FAILED: ${failures.length} finding(s)`);
  process.exit(1);
}
console.log("\nSMOKE OK");
