/**
 * UI/UX review collector: screenshots at 390x844 for EN and FA, plus the
 * full-code bundle path handled separately (see collect-code.mjs).
 *
 * Pages: Login, Onboarding (all steps), Matches (live/upcoming/finished mix,
 * empty, loading, toast), MatchDetail (timeline/stats/lineups x live/finished/
 * upcoming), Tables (tables + browse), Cups, TeamPage (squad/form/stats/xg),
 * Profile (page, notification sheet, reset sheet), NotFound.
 *
 * Run: SMOKE_CHANNEL=msedge node scripts/ui-review.mjs
 * Output: .ui-shots/review/ (gitignored)
 */
import { mkdirSync, writeFileSync } from "fs";
import { chromium } from "playwright";

const BASE = process.env.SMOKE_BASE_URL ?? "http://localhost:5173";
const API = process.env.SMOKE_API_URL ?? "http://localhost:8787";
const CHANNEL = process.env.SMOKE_CHANNEL ?? "";
const OUT = ".ui-shots/review";
mkdirSync(OUT, { recursive: true });

function devUserId() {
  return Number(`9${Date.now() % 10_000_000_000_000}${String(Math.floor(Math.random() * 100)).padStart(2, "0")}`);
}
function appUrl(user, hash) {
  return `${BASE}/?devUser=${encodeURIComponent(user)}#${hash}`;
}

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
      console.error(`servers never came up: ${API} / ${BASE}`);
      process.exit(1);
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
}

await waitReady();

const PAGEW = 390, PAGEH = 844;

const browser = CHANNEL
  ? await chromium.launch({ headless: true, args: ["--no-sandbox"], channel: CHANNEL })
  : await chromium.launch({ headless: true, args: ["--no-sandbox"] });

// ---------------------------------------------------------------- fixtures
const res = await fetch(`${API}/api/matches?limit=300`);
const { matches } = await res.json();
const live = matches.find((m) => m.status === "live" || m.status === "halftime") ?? null;
const finished = matches.find((m) => m.status === "finished") ?? matches.at(-1);
const upcoming = matches.find((m) => m.status === "scheduled") ?? null;
const teamId = matches[0]?.home_team_id;
console.log(`fixtures: live=${live?.id} finished=${finished?.id} upcoming=${upcoming?.id} team=${teamId}`);

async function newPage(lang, { lcp = false } = {}) {
  const ctx = await browser.newContext({ viewport: { width: PAGEW, height: PAGEH } });
  await ctx.addInitScript(
    ([lang, ]) => {
      localStorage.setItem("matchday.lang", lang);
      localStorage.removeItem("matchday.loggedOut");
      localStorage.setItem("verdikick.onboarded", "1");
      localStorage.setItem("verdikick.introSeen", "1");
      localStorage.setItem("verdikick.whatsNewSeen", "9.9.9");
    },
    [lang, lcp],
  );
  return ctx.newPage();
}

let shotCount = 0;
async function shot(page, name, { fullPage = false, wait = 600 } = {}) {
  await page.waitForTimeout(wait);
  await page.screenshot({ path: `${OUT}/${name}.png`, fullPage });
  shotCount += 1;
}

async function settle(page, url, ms = 3000) {
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.waitForTimeout(ms);
}

// ------------------------------------------------------------------ pages
for (const lang of ["en", "fa"]) {
  const L = lang;

  // 1. Login (on its own, signed out)
  {
    const ctx = await browser.newContext({ viewport: { width: PAGEW, height: PAGEH } });
    await ctx.addInitScript(([lang]) => {
      localStorage.setItem("matchday.lang", lang);
      localStorage.setItem("matchday.loggedOut", "1");
    }, [lang]);
    const page = await ctx.newPage();
    await settle(page, appUrl(devUserId(), "/login"), 2000);
    await shot(page, `login-${L}`, { fullPage: true });
    await ctx.close();
  }

  // 2. Onboarding: step 1 (pick), step 2 (more clubs), step 3 (leagues)
  {
    const page = await newPage(L);
    await settle(page, appUrl(devUserId(), "/onboarding"), 3500);
    await shot(page, `onboarding-step1-pick-${L}`, { fullPage: true });
    await page.evaluate(() => {
      const cards = [...document.querySelectorAll("ul button")];
      const b = cards.find((x) => (x.textContent ?? "").trim().length > 1);
      if (b) b.click();
    });
    await page.waitForTimeout(2500);
    const cont = { en: "Continue", fa: "ادامه" }[lang];
    await page.evaluate(([t]) => {
      const b = [...document.querySelectorAll("button")].find((x) => (x.textContent ?? "").trim() === t);
      if (b) b.click();
    }, [cont]);
    await page.waitForTimeout(2000);
    await shot(page, `onboarding-step2-clubs-${L}`, { fullPage: true });
    await page.evaluate(([t]) => {
      const b = [...document.querySelectorAll("button")].find((x) => (x.textContent ?? "").trim() === t);
      if (b) b.click();
    }, [cont]);
    await page.waitForTimeout(2000);
    await shot(page, `onboarding-step3-leagues-${L}`, { fullPage: true });
    await page.context().close();
  }

  // 3. Matches feed: mixed day + loading + empty + toast
  {
    const page = await newPage(L);
    // loading state: hard-block one fetch and shoot early
    await page.route(`**/api/matches**`, async (route) => {
      await new Promise((r) => setTimeout(r, 2500));
      await route.continue();
    });
    page.goto(appUrl(devUserId(), "/matches"), { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(700);
    await shot(page, `matches-loading-${L}`);
    await page.unroute(`**/api/matches**`);
    await page.waitForTimeout(3500);
    await shot(page, `matches-feed-mixed-${L}`, { fullPage: true });
    // empty day
    await settle(page, appUrl(devUserId(), "/matches?date=2031-05-05"), 2500);
    await shot(page, `matches-empty-${L}`, { fullPage: true });
    // toast via refresh
    await settle(page, appUrl(devUserId(), "/matches"), 2500);
    await page.evaluate(() => {
      const b = [...document.querySelectorAll("button")].find(
        (x) => x.getAttribute("aria-label") === "Refresh" || x.getAttribute("aria-label") === "تحديث",
      );
      if (b) b.click();
    });
    await page.waitForTimeout(500);
    await shot(page, `toast-refresh-${L}`);
    await page.context().close();
  }

  // 4. MatchDetail: live / finished / upcoming x timeline / stats / lineups
  for (const [kind, match] of [["live", live], ["finished", finished], ["upcoming", upcoming]]) {
    if (!match) continue;
    for (const tab of ["timeline", "stats", "lineups"]) {
      const page = await newPage(L);
      await settle(page, appUrl(devUserId(), `/match/${match.id}?tab=${tab}`), 3500);
      await shot(page, `match-${kind}-${tab}-${L}`, { fullPage: true });
      await page.context().close();
    }
  }

  // 5. Tables view (a real league table) + Browse view: the All/Leagues/Cups
  //    group chips, then the Cups group itself. KNOWN REVIEW FINDING, captured
  //    on purpose: with the live catalog exposing only league rows, selecting
  //    "Cups" renders NO rows and NO empty-state hint — the section is blank.
  //    The cup group WITH fixtures is on the Cups page (see /cups shots).
  for (const view of ["tables", "browse"]) {
    const page = await newPage(L);
    await settle(page, appUrl(devUserId(), "/table"), 3500);
    const label = view === "browse" ? { en: "Browse", fa: "مرور" }[lang] : { en: "Tables", fa: "جدول‌ها" }[lang];
    await page.evaluate((label) => {
      const b = [...document.querySelectorAll("button")].find((x) => (x.textContent ?? "").trim() === label);
      if (b) b.click();
    }, [label]);
    await page.waitForTimeout(2000);
    await shot(page, `table-${view}-${L}`, { fullPage: true });
    if (view === "browse") {
      const cupsLabel = { en: "Cups", fa: "جام‌ها" }[lang];
      await page.evaluate((cupsLabel) => {
        const b = [...document.querySelectorAll("button")].find((x) => (x.textContent ?? "").trim() === cupsLabel);
        if (b) b.click();
      }, [cupsLabel]);
      await page.waitForTimeout(2000);
      await shot(page, `table-browse-cups-selected-${L}`, { fullPage: true });
    }
    await page.context().close();
  }

  // 6. Cups
  {
    const page = await newPage(L);
    await settle(page, appUrl(devUserId(), "/cups"), 3500);
    await shot(page, `cups-${L}`, { fullPage: true });
    await page.context().close();
  }

  // 7. TeamPage: all four tabs
  for (const tab of ["squad", "form", "stats", "xg"]) {
    const page = await newPage(L);
    await settle(page, appUrl(devUserId(), `/team/${teamId}?tab=${tab}`), 3500);
    await shot(page, `team-${tab}-${L}`, { fullPage: true });
    await page.context().close();
  }

  // 8. Profile: page, notification sheet, reset sheet
  {
    const page = await newPage(L);
    await settle(page, appUrl(devUserId(), "/profile"), 3500);
    await shot(page, `profile-page-${L}`, { fullPage: true });
    // openRow is defined INSIDE the browser context: helpers from the Node
    // scope do not exist where these callbacks execute.
    const openRow = (rowTexts) =>
      page.evaluate((texts) => {
        const els = [...document.querySelectorAll("div, li, button")];
        const el = els.find(
          (b) => texts.some((t) => (b.textContent ?? "").includes(t)) && (b.textContent ?? "").length < 140,
        );
        if (el) {
          el.click();
          return true;
        }
        return false;
      }, rowTexts);
    await openRow(L === "fa" ? ["اعلان‌ها", "اطلاع‌رسانی"] : ["Notifications"]);
    await page.waitForTimeout(1200);
    await shot(page, `profile-sheet-notifications-${L}`);
    await page.keyboard.press("Escape");
    await page.waitForTimeout(800);
    // reset sheet
    await openRow(L === "fa" ? ["بازنشانی تنظیمات", "بازنشانی"] : ["Reset local"]);
    await page.waitForTimeout(1200);
    await shot(page, `profile-sheet-reset-${L}`);
    await page.context().close();
  }

  // 9. NotFound
  {
    const page = await newPage(L);
    await settle(page, appUrl(devUserId(), "/no-such-screen-xyz"), 3000);
    await shot(page, `notfound-${L}`, { fullPage: true });
    await page.context().close();
  }
}

await browser.close();
writeFileSync(`${OUT}/fixtures.json`, JSON.stringify({ live, finished, upcoming, teamId }, null, 2));
console.log(`DONE: ${shotCount} screenshots in ${OUT}`);
