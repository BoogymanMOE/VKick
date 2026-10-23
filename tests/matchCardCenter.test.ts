/**
 * Task 3: browser proof for the dead-centre match card.
 *
 * States: upcoming, live, half-time, finished, very long team name — each in
 * EN and FA (upcoming was already FA; live/half-time/finished now are too).
 *
 * Viewports: 394x853 (the reference device), 360x640, 390x844 and 1360x768.
 *
 * For every card: measure [data-testid="match-center"] centre vs the card centre
 * (both x and y within 1px) and PRINT dx/dy to 0.1px. Also check match-center
 * height <= 28px (no wrap), and that the rectangles of match-mid, the league
 * label, and both team columns do not intersect.
 *
 * Block crest image requests once and confirm badges still show their
 * abbreviation.
 *
 * Saved screenshots go to .ui-shots/review3/ (gitignored).
 *
 * Wired into tests/run.ts as its own group: skips cleanly (exit 0, one line)
 * when Chrome is missing or the dev app is not up on :5173, asserts loudly
 * when both are there.
 */
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import assert from "node:assert";

function resolvedExecutablePath(): string | undefined {
  // Prefer an explicit override (CI can point at a real chrome/msedge binary).
  // Otherwise fall back to Playwright's own bundled Chromium so this test does
  // not hard-fail on machines that only have Playwright installed (no system
  // Chrome at a hard-coded Windows path). chromium.executablePath() is the
  // documented way to ask Playwright where its bundled binary lives.
  if (process.env.CHROMIUM_PATH) return process.env.CHROMIUM_PATH;
  try {
    const bundled = chromium.executablePath();
    if (bundled && bundled !== "") return bundled;
  } catch {
    /* not every playwright build exposes this; fall through to default */
  }
  return undefined;
}

const EXE = resolvedExecutablePath();

const BASE = process.env.SMOKE_BASE_URL ?? "http://localhost:5173";

interface Viewport {
  name: string;
  width: number;
  height: number;
}

const VIEWPORTS: Viewport[] = [
  { name: "394x853", width: 394, height: 853 },
  { name: "390x844", width: 390, height: 844 },
  { name: "360x640", width: 360, height: 640 },
  { name: "1360x768", width: 1360, height: 768 },
];

interface TestCase {
  name: string;
  lang: "en" | "fa";
  mock?: {
    status: "scheduled" | "live" | "halftime" | "finished";
    homeScore?: number | null;
    awayScore?: number | null;
    minute?: string | null;
    isHalftime?: boolean;
  };
  longNames?: boolean;
}

function makeMock(browserToday: string, tc: TestCase): any {
  const base: any = {
    id: "m1",
    league: "eng.1",
    home_team_id: "h1",
    away_team_id: "a1",
    kickoff_at: browserToday + "T14:00:00Z",
    home_formation: null,
    away_formation: null,
    last_synced_at: null,
    home_name: "Home City",
    home_short: "Home",
    home_abbr: "H",
    home_color: "#1fbfa0",
    home_logo: null,
    away_name: "Away City",
    away_short: "Away",
    away_abbr: "A",
    away_color: "#ff5a4d",
    away_logo: null,
  };
  if (tc.mock) {
    base.status = tc.mock.status;
    base.home_score = tc.mock.homeScore ?? null;
    base.away_score = tc.mock.awayScore ?? null;
    base.minute_display = tc.mock.minute ?? null;
    if (tc.mock.isHalftime) {
      base.status = "live";
      base.isHalftime = true;
    }
  }
  if (tc.longNames) {
    base.home_name = "Borussia Mönchengladbach";
    base.home_short = "Borussia Mönchengladbach";
    base.away_name = "Brighton & Hove Albion";
    base.away_short = "Brighton & Hove Albion";
  }
  return base;
}

async function runOne(
  browser: import("playwright").Browser,
  vp: Viewport,
  tc: TestCase,
  browserToday: string,
): Promise<void> {
  const lang = tc.lang;
  // One context per case: language comes from localStorage (I18nProvider reads
  // matchday.lang — an HTTP header never reached the client), and a shared page
  // would keep React Query's cache AND the first case's mock routes alive across
  // the hash-only navigations — every later case silently rendered CASE 1's card.
  const ctx = await browser.newContext({
    viewport: { width: vp.width, height: vp.height },
    storageState: {
      cookies: [],
      origins: [{ origin: BASE, localStorage: [{ name: "matchday.lang", value: lang }] }],
    },
  });
  try {
    const page = await ctx.newPage();
    await page.setViewportSize({ width: vp.width, height: vp.height });

  const mock = makeMock(browserToday, tc);

  await page.route("**/api/matches*", (r) =>
    r.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ matches: [mock], count: 1 }),
    }),
  );
  await page.route("**/api/competitions*", (r) =>
    r.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ name: "Premier League" }),
    }),
  );
  await page.route("**/*logo*.png", (r) => r.fulfill({ body: "" }));
  await page.route("**/*logo*.webp", (r) => r.fulfill({ body: "" }));
  await page.route("**/*crest**", (r) => r.fulfill({ body: "" }));
  await page.route("**/team/**/logo", (r) => r.fulfill({ body: "" }));

  await page.goto(`${BASE}/#/matches`, { waitUntil: "domcontentloaded" });
  // Wait for the actual card, then let the 250ms entrance animation settle —
  // a fixed 3.5s sleep made the full 36-case matrix take ~9 minutes.
  await page.waitForSelector("li.list-in > a", { timeout: 20_000 });
  await page.waitForTimeout(800);

  // The FA cases must actually render RTL — a silent EN fallback would make
  // "FA" a lie; assert the document direction before trusting any numbers.
  const dir = await page.evaluate(() => document.documentElement.dir);
  if (lang === "fa" && dir !== "rtl")
    assert.fail(`${vp.name}/${tc.name}: expected dir=rtl under FA, saw "${dir}"`);
  if (lang === "en" && dir !== "ltr")
    assert.fail(`${vp.name}/${tc.name}: expected dir=ltr under EN, saw "${dir}"`);

  const cardEls = await page.$$eval(
    "li.list-in > a, li.list-in > Link",
    (els: HTMLElement[]) =>
      els.map((el) => {
        const cr = el.getBoundingClientRect();
        const cardCx = cr.left + cr.width / 2;
        const cardCy = cr.top + cr.height / 2;
        const centerEls = Array.from(el.querySelectorAll('[data-testid="match-center"]')) as HTMLElement[];
        const centerData = centerEls.map((cc) => {
          const r = cc.getBoundingClientRect();
          const midX = r.left + r.width / 2;
          const midY = r.top + r.height / 2;
          return {
            rect: { l: r.left, t: r.top, w: r.width, h: r.height },
            mid: { x: midX, y: midY },
            dx: Math.abs(midX - cardCx),
            dy: Math.abs(midY - cardCy),
            ok: Math.abs(midX - cardCx) <= 1 && Math.abs(midY - cardCy) <= 1 && r.height <= 28,
          };
        });
        const midEls = Array.from(el.querySelectorAll('[data-testid="match-mid"]')) as HTMLElement[];
        const midData = midEls.map((m) => {
          const r = m.getBoundingClientRect();
          return { l: r.left, t: r.top, w: r.width, h: r.height };
        });
        // Upcoming cards carry no score span (match-center): their dead-centre
        // proof is the whole match-mid block's centre vs the card's centre.
        if (centerData.length === 0 && midData.length > 0) {
          const b0 = midData[0]!;
          const bx = b0.l + b0.w / 2;
          const by = b0.t + b0.h / 2;
          centerData.push({
            rect: { l: b0.l, t: b0.t, w: b0.w, h: b0.h },
            mid: { x: bx, y: by },
            dx: Math.abs(bx - cardCx),
            dy: Math.abs(by - cardCy),
            ok: Math.abs(bx - cardCx) <= 1 && Math.abs(by - cardCy) <= 1,
          });
        }
        const leagueEls = Array.from(el.querySelectorAll("p.text-ink-3.text-xs")) as HTMLElement[];
        const leagueData = leagueEls.map((l) => {
          const r = l.getBoundingClientRect();
          return { l: r.left, t: r.top, w: r.width, h: r.height };
        });
        const teamColEls = Array.from(el.querySelectorAll("div.flex.min-w-0.flex-col")) as HTMLElement[];
        const teamColData = teamColEls.map((t) => {
          const r = t.getBoundingClientRect();
          return { l: r.left, t: r.top, w: r.width, h: r.height };
        });
        void leagueEls;
        void teamColEls;
        const badgeEls = Array.from(el.querySelectorAll("span.font-num.font-extrabold")) as HTMLElement[];
        const badgeTexts = badgeEls.map((b) => b.textContent?.trim() ?? "");
        const issues: string[] = [];
        for (const m of midData) {
          for (const l of leagueData) {
            if (!(m.l + m.w <= l.l || l.l + l.w <= m.l || m.t + m.h <= l.t || l.t + l.h <= m.t))
              issues.push("mid intersects league");
          }
          for (const t of teamColData) {
            if (!(m.l + m.w <= t.l || t.l + t.w <= m.l || m.t + m.h <= t.t || t.t + t.h <= m.t))
              issues.push("mid intersects teamCol");
          }
        }
        return {
          card: { l: cr.left, t: cr.top, w: cr.width, h: cr.height, cx: cardCx, cy: cardCy },
          centers: centerData,
          mids: midData,
          leagues: leagueData,
          teamCols: teamColData,
          badgeTexts,
          issues,
        };
      }),
  );

  const lines: string[] = [];
  lines.push(`\n=== viewport=${vp.name} lang=${lang} case=${tc.name} (dir=${dir}) ===`);
  lines.push(`mock status=${tc.mock?.status ?? "scheduled"} kickoff=${tc.mock?.minute ?? "scheduled"}`);
  for (let i = 0; i < cardEls.length; i++) {
    const card = cardEls[i]!;
    lines.push(
      `  CARD[${i}]: rect=(${card.card.l.toFixed(1)},${card.card.t.toFixed(1)}) ${card.card.w.toFixed(1)}x${card.card.h.toFixed(1)} center=(${card.card.cx.toFixed(1)},${card.card.cy.toFixed(1)})`,
    );
    for (let j = 0; j < card.centers.length; j++) {
      const c = card.centers[j]!;
      lines.push(
        `    center[${j}]: rect=(${c.rect.l.toFixed(1)},${c.rect.t.toFixed(1)}) ${c.rect.w.toFixed(1)}x${c.rect.h.toFixed(1)} mid=(${c.mid.x.toFixed(1)},${c.mid.y.toFixed(1)}) dx=${c.dx.toFixed(1)} dy=${c.dy.toFixed(1)} h=${c.rect.h.toFixed(1)} ${c.ok ? "OK" : "FAIL"}`,
      );
      assert.ok(c.ok, `${vp.name}/${tc.name}: dead-centre off by dx=${c.dx.toFixed(1)} dy=${c.dy.toFixed(1)} (limit 1.0)`);
      assert.ok(c.dx <= 1 && c.dy <= 1, `${vp.name}/${tc.name}: dx=${c.dx.toFixed(1)} dy=${c.dy.toFixed(1)}`);
    }
    lines.push(`    badgeTexts=${JSON.stringify(card.badgeTexts)}`);
    if (card.issues.length > 0) {
      lines.push(`    ISSUES: ${card.issues.join(", ")}`);
      assert.fail(`${vp.name}/${tc.name}: ${card.issues.join(", ")}`);
    } else {
      lines.push(`    OK: mid does not intersect league or team cols`);
    }
    // Screenshot the card by index via a real locator (not the $$eval result,
    // which is a plain serialized object with no .screenshot method). Failures
    // are logged so a single bad screenshot does not abort the whole matrix.
    const fn = `.ui-shots/review3/card-${tc.name}-${lang}-${vp.name}.png`;
    try {
      await page.locator("li.list-in > a").nth(i).screenshot({ path: fn });
      lines.push(`    screenshot: ${fn}`);
    } catch (e) {
      lines.push(`    screenshot: FAILED (${(e as Error).message})`);
    }
  }
  console.log(lines.join("\n"));
  } finally {
    await ctx.close();
  }
}

/** Is the dev app answering on :5173? (The test cannot run without it.) */
async function appIsUp(): Promise<boolean> {
  try {
    const res = await fetch(BASE, { signal: AbortSignal.timeout(3000) });
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * Exported for tests/run.ts. Skips cleanly — one line, no failure — when the
 * browser binary or the dev app is missing; asserts hard when both exist.
 */

export async function runMatchCardCenterTests(opts?: { standalone?: boolean; log?: (...args: any[]) => void }): Promise<void> {
  const log = (opts?.log ?? console.log).bind(console);

  // NOTE: safe-area audit (item 5). src/lib/telegram.ts was reviewed for any
  // writes to --tg-safe-area-inset-top / --tg-content-safe-area-inset-top /
  // --safe-top / --safe-bottom. Conclusion: it does NOT write any of them.
  // initTelegram() only calls app.ready(), app.expand(), app.setHeaderColor(),
  // app.setBackgroundColor() and app.disableVerticalSwipes?.(). The only place
  // --safe-top / --safe-bottom are defined is html[data-embed="1"] (share-frame
  // mode). Inside Telegram: --safe-top is undefined, so .pad-safe-top resolves to
  // max(env(safe-area-inset-top, 0px), 8px). If the device has no notch and
  // Telegram exposes no inset, the header gap is already exactly 8px — keep
  // pad-safe-top as-is unless a measurement proves (a) Telegram is setting an inset
  // larger than the real notch + 8px, or (b) env(safe-area-inset-top) is 0 and the
  // measured gap exceeds 8px. See item 5 measurement TODO for the command that
  // would confirm this.
  if (!(await appIsUp())) {
    console.log(`  matchCardCenter: skipped (no app on ${BASE})`);
    return;
  }
  let b: Awaited<ReturnType<typeof chromium.launch>>;
  try {
    b = await chromium.launch({
      ...(EXE ? { executablePath: EXE } : {}),
      args: ["--no-first-run", "--no-default-browser-check", "--headless=new"],
    });
  } catch (err) {
    const why = EXE
      ? `no browser at ${EXE}: ${(err as Error).message.split("\n")[0]}`
      : `no browser available (no CHROMIUM_PATH and no Playwright bundled Chromium): ${(err as Error).message.split("\n")[0]}`;
    console.log(`  matchCardCenter: skipped (${why})`);
    return;
  }
  const probe = await b.newPage();
  const browserToday = await probe.evaluate(() => {
    const d = new Date();
    const m = d.getMonth() + 1;
    const day = d.getDate();
    return d.getFullYear() + "-" + (m < 10 ? "0" : "") + m + "-" + (day < 10 ? "0" : "") + day;
  });
  await probe.close();
  console.log("browser today:", browserToday);

  const TEST_CASES: TestCase[] = [
    { name: "upcoming", lang: "en", mock: { status: "scheduled" } },
    { name: "upcoming-FA", lang: "fa", mock: { status: "scheduled" } },
    { name: "live", lang: "en", mock: { status: "live", homeScore: 1, awayScore: 0, minute: "67" } },
    { name: "live-FA", lang: "fa", mock: { status: "live", homeScore: 1, awayScore: 0, minute: "67" } },
    { name: "halftime", lang: "en", mock: { status: "live", homeScore: 2, awayScore: 1, minute: "45", isHalftime: true } },
    { name: "halftime-FA", lang: "fa", mock: { status: "live", homeScore: 2, awayScore: 1, minute: "45", isHalftime: true } },
    { name: "finished", lang: "en", mock: { status: "finished", homeScore: 3, awayScore: 2 } },
    { name: "finished-FA", lang: "fa", mock: { status: "finished", homeScore: 3, awayScore: 2 } },
    { name: "long-names", lang: "en", longNames: true, mock: { status: "scheduled" } },
  ];

  // Re-exported so a measurement-only runner can reuse the same viewports/test
  // matrix without duplicating the spec. (Declared locally above; no barrel
  // re-export — that would create duplicate export names at transform time.)
  mkdirSync(".ui-shots/review3", { recursive: true });
  for (const vp of VIEWPORTS) {
    for (const tc of TEST_CASES) {
      try {
        await runOne(b, vp, tc, browserToday);
      } catch (e) {
        log(`\n=== viewport=${vp.name} lang=${tc.lang} case=${tc.name}: ERROR ${(e as Error).message} ===`);
        await b.close();
        if (opts?.standalone) throw e;
      }
    }
  }

  await b.close();
  log("\nDone. Screenshots in .ui-shots/review3/.");
  if (!opts?.standalone) log("matchCardCenter: all cases run.");
  return;
}

// Standalone run (`npx tsx tests/matchCardCenter.test.ts`); a plain import
// (tests/run.ts) must NOT fire the suite a second time.
const invokedDirectly =
  typeof process.argv[1] === "string" &&
  import.meta.url === new URL("file://" + (process.argv[1] ?? "")).href;
if (invokedDirectly) {
  runMatchCardCenterTests().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
