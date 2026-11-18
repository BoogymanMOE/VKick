import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";

const BASE = "https://vkick.onrender.com";
const ROOT = "D:/football";
const SHOT_DIR = `${ROOT}/bug-bash/screenshots`;
mkdirSync(SHOT_DIR, { recursive: true });

const browser = await chromium.launch({
  executablePath: "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  headless: true,
  args: ["--no-sandbox"],
});

const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await context.newPage();

const consoleErrors = [];
const networkErrors = [];
let currentStep = 0;
page.on("console", (msg) => {
  if (msg.type() === "error") consoleErrors.push({ step: currentStep, text: msg.text() });
});
page.on("response", (res) => {
  if (res.status() >= 400) networkErrors.push({ step: currentStep, url: res.url(), status: res.status() });
});

const results = [];
function markStep(n, title) {
  currentStep = n;
}
async function shot(name) {
  const p = `${SHOT_DIR}/${name}`;
  try { await page.screenshot({ path: p, fullPage: false }); } catch (e) { /* ignore */ }
  return `bug-bash/screenshots/${name}`;
}
function stepErrors(startC, startN) {
  return {
    console: consoleErrors.slice(startC).map((e) => e.text),
    network: networkErrors.slice(startN).map((e) => `${e.status} ${e.url}`),
  };
}

async function runStep(n, title, fn) {
  markStep(n, title);
  const startC = consoleErrors.length;
  const startN = networkErrors.length;
  const t0 = Date.now();
  const res = { step: n, title, status: "PASS", notes: [], errors: null, screenshot: null, loadMs: 0 };
  try {
    await fn(res);
  } catch (e) {
    res.status = "FAIL";
    res.notes.push(`EXCEPTION: ${e && e.message ? e.message : String(e)}`);
  }
  res.loadMs = Date.now() - t0;
  res.errors = stepErrors(startC, startN);
  if (res.screenshot == null) res.screenshot = await shot(`step-${String(n).padStart(2, "0")}.png`);
  results.push(res);
  console.log(`Step ${n} ${res.status} (${res.loadMs}ms) console=${res.errors.console.length} net=${res.errors.network.length}`);
}

async function wait(ms) { await page.waitForTimeout(ms); }

// Step 1: Cold onboard
await runStep(1, "Cold onboard", async (res) => {
  const t0 = Date.now();
  await page.goto(BASE + "/", { waitUntil: "domcontentloaded", timeout: 30000 });
  await wait(6000);
  res.loadMs = Date.now() - t0;
  const body = await page.evaluate(() => document.body.innerText);
  res.notes.push(`URL: ${page.url()}`);
  res.notes.push(`Body snippet: ${body.slice(0, 200).replace(/\n/g, " | ")}`);
  if (/Step 1 of 3/.test(body)) res.notes.push("Landed on onboarding (expected for fresh user).");
  else if (/Matches/.test(body)) res.notes.push("Landed on home feed.");
  else res.notes.push("Unexpected landing.");
  res.screenshot = await shot("step-01.png");
});

// Step 2: Pick favorite teams
await runStep(2, "Pick favorite teams", async (res) => {
  // We are on onboarding step 1. Pick Arsenal.
  await page.evaluate(() => { const b = [...document.querySelectorAll("button")].find((x) => (x.textContent || "").trim() === "Arsenal"); if (b) b.click(); });
  await wait(500);
  await page.evaluate(() => { const b = [...document.querySelectorAll("button")].find((x) => (x.textContent || "").trim() === "Continue"); if (b) b.click(); });
  await wait(3000);
  // Step 2: La Liga -> Real Madrid
  await page.evaluate(() => { const b = [...document.querySelectorAll("button")].find((x) => (x.textContent || "").trim() === "La Liga"); if (b) b.click(); });
  await wait(1000);
  await page.evaluate(() => { const b = [...document.querySelectorAll("button")].find((x) => (x.textContent || "").trim() === "Real Madrid"); if (b) b.click(); });
  await wait(500);
  await page.evaluate(() => { const b = [...document.querySelectorAll("button")].find((x) => (x.textContent || "").trim() === "Continue"); if (b) b.click(); });
  await wait(3000);
  // Step 3: follow leagues
  await page.evaluate(() => { const b = [...document.querySelectorAll("button")].find((x) => (x.textContent || "").trim() === "Premier League"); if (b) b.click(); });
  await wait(300);
  await page.evaluate(() => { const b = [...document.querySelectorAll("button")].find((x) => (x.textContent || "").trim() === "La Liga"); if (b) b.click(); });
  await wait(300);
  await page.evaluate(() => { const b = [...document.querySelectorAll("button")].find((x) => (x.textContent || "").trim() === "Start watching"); if (b) b.click(); });
  await wait(6000);
  const body = await page.evaluate(() => document.body.innerText);
  res.notes.push(`URL: ${page.url()}`);
  res.notes.push(`Body snippet: ${body.slice(0, 200).replace(/\n/g, " | ")}`);
  // verify persistence across reload
  await page.reload({ waitUntil: "domcontentloaded", timeout: 30000 });
  await wait(6000);
  const body2 = await page.evaluate(() => document.body.innerText);
  res.notes.push(`After reload snippet: ${body2.slice(0, 200).replace(/\n/g, " | ")}`);
  res.screenshot = await shot("step-02.png");
});

// Step 3: Language toggle
await runStep(3, "Language toggle", async (res) => {
  for (const expected of ["fa", "de", "en"]) {
    // toggle
    await page.evaluate(() => { const b = document.querySelector("header button[aria-label], button[aria-label*='language' i]"); if (b) b.click(); else { const x = [...document.querySelectorAll("button")].find((y) => (y.textContent||"").toLowerCase().includes("en") || (y.textContent||"").toLowerCase().includes("fa") || (y.textContent||"").toLowerCase().includes("de")); if (x) x.click(); } });
    // fallback: find globe toggle by text
    await page.evaluate(() => {
      const btns = [...document.querySelectorAll("button")];
      const t = btns.find((b) => /^[A-Z]{2}$/i.test((b.textContent||"").trim()) || (b.textContent||"").trim().toLowerCase() === "en" || (b.textContent||"").trim().toLowerCase() === "fa" || (b.textContent||"").trim().toLowerCase() === "de");
      if (t) t.click();
    });
    await wait(1500);
    const info = await page.evaluate(() => ({ dir: document.documentElement.dir, lang: document.documentElement.lang, toggle: [...document.querySelectorAll("button")].map((b) => (b.textContent||"").trim()).find((t) => /^(en|fa|de)$/i.test(t)) }));
    res.notes.push(`After toggle -> dir=${info.dir} lang=${info.lang} btn=${info.toggle}`);
    const shotName = `step-03-${info.lang}.png`;
    await page.screenshot({ path: `${SHOT_DIR}/${shotName}` });
    // check horizontal overflow
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    if (overflow > 1) res.notes.push(`HORIZONTAL OVERFLOW ${overflow}px in ${info.lang}`);
  }
  res.screenshot = await shot("step-03.png");
});

// Step 4: Home feed desktop
await runStep(4, "Home feed desktop", async (res) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(BASE + "/#/matches", { waitUntil: "domcontentloaded", timeout: 30000 });
  await wait(5000);
  // go to a day with matches if needed
  await page.evaluate(() => { const b = [...document.querySelectorAll("button")].find((x) => /Go to \d/.test(x.textContent||"")); if (b) b.click(); });
  await wait(3000);
  // scroll 3 screens
  for (let i = 0; i < 3; i++) { await page.mouse.wheel(0, 900); await wait(800); }
  const imgCheck = await page.evaluate(() => {
    const imgs = [...document.querySelectorAll("img")];
    const broken = imgs.filter((im) => im.complete && im.naturalWidth === 0).length;
    return { total: imgs.length, broken };
  });
  res.notes.push(`Images: total=${imgCheck.total} broken=${imgCheck.broken}`);
  const body = await page.evaluate(() => document.body.innerText.slice(0, 300));
  res.notes.push(`Body: ${body.replace(/\n/g, " | ")}`);
  res.screenshot = await shot("step-04.png");
});

// Step 5: Home feed mobile
await runStep(5, "Home feed mobile", async (res) => {
  await page.setViewportSize({ width: 375, height: 667 });
  await page.goto(BASE + "/#/matches", { waitUntil: "domcontentloaded", timeout: 30000 });
  await wait(5000);
  await page.evaluate(() => { const b = [...document.querySelectorAll("button")].find((x) => /Go to \d/.test(x.textContent||"")); if (b) b.click(); });
  await wait(3000);
  for (let i = 0; i < 3; i++) { await page.mouse.wheel(0, 667); await wait(800); }
  const metrics = await page.evaluate(() => {
    const overflow = document.documentElement.scrollWidth - window.innerWidth;
    const smallTargets = [...document.querySelectorAll("button,a")].filter((el) => {
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0 && (r.width < 44 || r.height < 44);
    }).length;
    return { overflow, smallTargets };
  });
  res.notes.push(`Horizontal overflow: ${metrics.overflow}px`);
  res.notes.push(`Tap targets <44px: ${metrics.smallTargets}`);
  res.screenshot = await shot("step-05.png");
});

// Step 6: Team page
await runStep(6, "Team page", async (res) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(BASE + "/#/team/112", { waitUntil: "domcontentloaded", timeout: 30000 });
  await wait(6000);
  const tabs = ["Team sheet", "Fixtures", "Form", "News"];
  for (const tab of tabs) {
    await page.evaluate((t) => { const b = [...document.querySelectorAll("button")].find((x) => (x.textContent || "").trim() === t); if (b) b.click(); }, tab);
    await wait(2500);
    const shotName = `step-06-${tab.replace(/\s+/g, "-").toLowerCase()}.png`;
    await page.screenshot({ path: `${SHOT_DIR}/${shotName}` });
    const info = await page.evaluate(() => {
      const imgs = [...document.querySelectorAll("img")];
      const broken = imgs.filter((im) => im.complete && im.naturalWidth === 0).length;
      return { imgs: imgs.length, broken };
    });
    res.notes.push(`${tab}: imgs=${info.imgs} broken=${info.broken}`);
  }
  res.screenshot = await shot("step-06.png");
});

// Step 7: Match detail finished
await runStep(7, "Match detail finished", async (res) => {
  await page.goto(BASE + "/#/match/401874983", { waitUntil: "domcontentloaded", timeout: 30000 });
  await wait(6000);
  const body = await page.evaluate(() => document.body.innerText.slice(0, 400));
  res.notes.push(`Body: ${body.replace(/\n/g, " | ")}`);
  // check lineups tab
  await page.evaluate(() => { const b = [...document.querySelectorAll("button")].find((x) => (x.textContent || "").trim() === "Lineups"); if (b) b.click(); });
  await wait(3000);
  res.screenshot = await shot("step-07.png");
});

// Step 8: Predict upcoming match (UI check)
await runStep(8, "Predict upcoming match", async (res) => {
  // find a scheduled match via API
  const apiRes = await page.evaluate(async () => {
    const r = await fetch("https://vkick.onrender.com/api/matches?limit=50");
    const j = await r.json();
    const m = (j.matches || []).find((x) => x.status === "scheduled");
    return m ? m.id : null;
  });
  res.notes.push(`Scheduled match id: ${apiRes}`);
  if (apiRes) {
    await page.goto(BASE + "/#/match/" + apiRes, { waitUntil: "domcontentloaded", timeout: 30000 });
    await wait(6000);
    const body = await page.evaluate(() => document.body.innerText);
    res.notes.push(`Prediction UI present: ${/predict/i.test(body)}`);
    res.notes.push(`Body snippet: ${body.slice(0, 300).replace(/\n/g, " | ")}`);
  } else {
    res.notes.push("No scheduled match found.");
  }
  res.screenshot = await shot("step-08.png");
});

// Step 9: Rate players (UI check)
await runStep(9, "Rate players", async (res) => {
  await page.goto(BASE + "/#/match/401874983", { waitUntil: "domcontentloaded", timeout: 30000 });
  await wait(6000);
  const body = await page.evaluate(() => document.body.innerText);
  res.notes.push(`Rating UI present: ${/rate/i.test(body)}`);
  res.notes.push(`Body snippet: ${body.slice(0, 300).replace(/\n/g, " | ")}`);
  res.screenshot = await shot("step-09.png");
});

// Step 10: Leaderboard
await runStep(10, "Leaderboard", async (res) => {
  await page.goto(BASE + "/#/leaderboards", { waitUntil: "domcontentloaded", timeout: 30000 });
  await wait(5000);
  const body = await page.evaluate(() => document.body.innerText);
  res.notes.push(`URL: ${page.url()}`);
  res.notes.push(`Body snippet: ${body.slice(0, 400).replace(/\n/g, " | ")}`);
  res.screenshot = await shot("step-10.png");
  // also try /leaderboard
  await page.goto(BASE + "/#/leaderboard", { waitUntil: "domcontentloaded", timeout: 30000 });
  await wait(3000);
  const body2 = await page.evaluate(() => document.body.innerText);
  res.notes.push(`Singular route body: ${body2.slice(0, 200).replace(/\n/g, " | ")}`);
});

// Step 11: Profile
await runStep(11, "Profile", async (res) => {
  await page.goto(BASE + "/#/profile", { waitUntil: "domcontentloaded", timeout: 30000 });
  await wait(5000);
  const body = await page.evaluate(() => document.body.innerText);
  res.notes.push(`Body snippet: ${body.slice(0, 600).replace(/\n/g, " | ")}`);
  res.screenshot = await shot("step-11.png");
});

await browser.close();

writeFileSync(`${ROOT}/bug-bash-results.json`, JSON.stringify(results, null, 2));
console.log("DONE");
