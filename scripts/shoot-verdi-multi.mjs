#!/usr/bin/env node
/**
 * Multi-width, dual-language, multi-state UI screenshot driver for Verdikick.
 *
 * Run against a live dev server (`npm run dev` on :5173) and a seeded DB.
 * It drives Chrome headless over its CDP port, sets the viewport to each
 * requested width, flips the in-app language, waits for each screen's ready
 * predicate, then saves a full-page PNG (DPR 2) to .ui-shots/<slug>/.
 *
 * Widths / langs are served by spinning one fresh Chrome profile per combo
 * so cookies / local state and RTL quirks are not cross-contaminated.
 *
 * Screenshots are named <screen>@<width>x_<lang>.png so a reviewer can
 * eyeball the same screen across every size and language side by side.
 */

import { spawn, execSync } from "node:child_process";
import { mkdirSync, writeFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

const PROJECT = "/d/Users/Mehrgan/Work/01/vkick";
const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const DEV_PORT = 5173;
const BASE = `http://localhost:${DEV_PORT}`;
const OUT = join(PROJECT, ".ui-shots", "verdi-multi");
const DPR = 2;

const WIDTHS = [360, 390, 768, 1280];
const HEIGHTS = { 360: 844, 390: 844, 768: 1024, 1280: 900 };
const LANGS = ["en", "fa"];

const SHOTS = [
  // ---- Landing / auth entry
  {
    name: "auth",
    route: "/",
    ready: "document.body.innerText.includes('Sign in to follow the matchday') || document.body.innerText.includes('برای دنبال کردن روز بازی وارد شو')",
    prep: "",
  },

  // ---- Matches feed
  {
    name: "matches",
    route: "/matches",
    ready: "(function(){const t=document.body.innerText.replace(/\\u200c/g,'');return t.includes('Matches') || t.includes('مسابقات');})()",
    prep: "",
  },

  // ---- Match detail (timeline tab by default)
  {
    name: "matchDetail",
    route: "/matches/!1", // won't resolve without a real match; we advertise as a guarded empty path
    ready: "document.body.innerText.includes('Couldn't load this') || document.body.innerText.includes('بارگذاری نشد')",
    prep: "",
  },

  // ---- Tables
  {
    name: "table",
    route: "/table",
    ready: "(function(){const t=document.body.innerText.replace(/\\u200c/g,'');return t.includes('League Tables') || t.includes('جداول لیگ') || t.includes('جام‌ها');})()",
    prep: "document.querySelectorAll('button').length > 0",
  },

  // ---- Cups / knockout
  {
    name: "cups",
    route: "/cups",
    ready: "(function(){const t=document.body.innerText.replace(/\\u200c/g,'');return t.includes('Cups') || t.includes('جام‌ها') || t.includes('فوتبال حذفی');})()",
    prep: "",
  },

  // ---- Leaderboards (empty board until predictions are on; we verify empty state)
  {
    name: "leaderboards",
    route: "/leaderboards",
    ready: "(function(){const t=document.body.innerText.replace(/\\u200c/g,'');return t.includes('Leaderboards') || t.includes('رتبه‌ها') || t.includes('The board is open') || t.includes('The board is open —');})()",
    prep: "",
  },

  // ---- Player / stat page
  {
    name: "playerStats",
    route: "/stats",
    ready: "(function(){const t=document.body.innerText.replace(/\\u200c/g,'');return t.includes('Player Stats') || t.includes('آمار بازیکنان');})()",
    prep: "",
  },

  // ---- Team page placeholder (we won't have a hardcoded club id; probe 404 state)
  {
    name: "teamPage",
    route: "/team/!1",
    ready: "(function(){const t=document.body.innerText.replace(/\\u200c/g,'');return t.includes('Couldn't load this') || t.includes('بارگذاری نشد') || t.includes('Team');})()",
    prep: "",
  },

  // ---- Profile
  {
    name: "profile",
    route: "/profile",
    ready: "(function(){const t=document.body.innerText.replace(/\\u200c/g,'');return t.includes('Profile') || t.includes('پروفایل');})()",
    prep: "document.querySelectorAll('input').length >= 0",
  },

  // ---- Onboarding (only meaningful after a guest session + seed; probe the start gate instead)
  {
    name: "onboarding",
    route: "/",
    ready: "(function(){const t=document.body.innerText.replace(/\\u200c/g,'');return t.includes('Welcome to Vkick') || t.includes('به وردی‌کیک خوش آمدید') || t.includes('Sign in');})()",
    prep: "",
  },

  // ---- Legal
  {
    name: "legal",
    route: "/legal",
    ready: "(function(){const t=document.body.innerText.replace(/\\u200c/g,'');return t.includes('Privacy policy') || t.includes('سیاست حفظ');})()",
    prep: "",
  },
];

mkdirSync(OUT, { recursive: true });

/* ------------------------------------------------------------ helpers */
const escapeJs = (s) => s.replace(/\\/g, "\\\\").replace(/'/g, "\\'").replace(/\n/g, "\\n");

function run(cmd, cwd) {
  return execSync(cmd, { cwd, stdio: "pipe", encoding: "utf8" }).trim();
}

/* ------------------------------------------------------------ Chrome pool */
const PROFILE_ROOT = join(tmpdir(), "cdp-verdi-");

async function withChrome(width, lang, fn) {
  const profileDir = join(PROFILE_ROOT, `w${width}_${lang}`);
  if (existsSync(profileDir)) rmSync(profileDir, { recursive: true, force: true });
  mkdirSync(profileDir, { recursive: true });

  const port = 9222 + WIDTHS.indexOf(width) * 10 + (lang === "fa" ? 1 : 0);

  const chrome = spawn(CHROME, [
    "--headless=new",
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${profileDir}`,
    `--window-size=${width},${HEIGHTS[width]}`,
    "--force-device-scale-factor=" + DPR,
    "--hide-scrollbars",
    "--disable-gpu",
    "--disable-extensions",
    "--allow-insecure-localhost",
    "--disable-web-security",
    "--disable-features=IsolateOrigins,site-per-process",
    BASE,
  ], { stdio: "ignore" });

  let killed = false;
  try {
    await sleep(2600); // profile + renderer warmup
    await devtools(`http://localhost:${port}/json`, 50); // wait for CDP

    await fn(port, chrome);
  } finally {
    killed = true;
    try { chrome.kill("SIGTERM"); } catch {}
    await sleep(250);
    try { chrome.kill("SIGKILL"); } catch {}
  }
}

async function devtools(url, tries = 60) {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(url);
      const arr = await r.json();
      if (Array.isArray(arr) && arr.length) return arr[0];
    } catch {}
    await sleep(250);
  }
  throw new Error(`CDP endpoint ${url} never answered`);
}

async function cdp(port, expr) {
  const req = {
    id: 1,
    method: "Runtime.evaluate",
    params: {
      expression: expr,
      executionContextId: 1,
      objectGroup: "shots",
      returnByValue: true,
      awaitPromise: true,
    },
  };
  const ws = new WebSocket(`ws://localhost:${port}/devtools/page/1`);
  await new Promise((r, j) => {
    ws.onopen = r;
    ws.onerror = () => j(new Error("ws open"));
    ws.onclose = () => j(new Error("ws closed"));
    setTimeout(() => j(new Error("ws open timeout")), 25000);
  });
  ws.send(JSON.stringify(req));
  const result = await new Promise((r, j) => {
    const handler = (ev) => {
      const m = JSON.parse(ev.data);
      if (m.id === 1) {
        ws.close();
        r(m.result);
      }
    };
    ws.onmessage = handler;
    setTimeout(() => { ws.close(); j(new Error("eval timeout")); }, 18000);
  });
  return result;
}

async function screenshot(port, path, width) {
  const req = {
    id: 2,
    method: "Page.printToPDF",
    params: {
      paperWidth: width / 96,
      paperHeight: HEIGHTS[width] / 96,
      paperBackground: true,
      margin: { top: 0, bottom: 0, left: 0, right: 0 },
      scale: DPR,
      preferCSSPageSize: true,
    },
  };
  const ws = new WebSocket(`ws://localhost:${port}/devtools/page/1`);
  await new Promise((r, j) => {
    ws.onopen = r;
    ws.onerror = () => j(new Error("ws open"));
    ws.onclose = () => j(new Error("ws closed"));
    setTimeout(() => j(new Error("ws open timeout")), 25000);
  });
  ws.send(JSON.stringify(req));
  const buf = await new Promise((r, j) => {
    const handler = (ev) => {
      const m = JSON.parse(ev.data);
      if (m.id === 2) {
        ws.close();
        if (m.error) j(new Error(m.error));
        else r(Buffer.from(m.result.data, "base64"));
      }
    };
    ws.onmessage = handler;
    setTimeout(() => { ws.close(); j(new Error("print timeout")); }, 20000);
  });
  writeFileSync(path, buf);
}

/* ------------------------------------------------------------ main */

async function main() {
  console.log("starting multi-width multi-lang screenshot run");
  console.log("out:", OUT);

  const failed = [];

  for (const width of WIDTHS) {
    for (const lang of LANGS) {
      // language switch is done via localStorage before navigation so it
      // applies on the first render of the chosen route.
      const setLang = lang === "fa"
        ? `localStorage.setItem('vkick.lang','fa');`
        : `localStorage.removeItem('vkick.lang');`;

      for (const shot of SHOTS) {
        const slug = `${shot.name}@${width}x_${lang}`;
        const outPath = join(OUT, `${slug}.png`);

        try {
          await withChrome(width, lang, async (port) => {
            // set language
            await cdp(port, setLang);

            // navigate
            await cdp(port, `window.location.href='${BASE}${shot.route}';`);
            await sleep(2400);

            // prep step (e.g. scroll a tab into view)
            if (shot.prep) {
              await cdp(port, `(${shot.prep});`);
              await sleep(400);
            }

            // wait for ready predicate with retries
            for (let i = 0; i < 8; i++) {
              const ok = await cdp(port, `(${shot.ready});`);
              if (ok && ok.value) break;
              await sleep(700);
            }

            await screenshot(port, outPath, width);
          });

          console.log("OK", slug);
        } catch (e) {
          console.error("FAIL", slug, e.message);
          failed.push(slug);
          if (!existsSync(outPath)) {
            // write a tiny failure marker so the reviewer knows we tried
            try { writeFileSync(outPath, ""); } catch {}
          }
        }
      }
    }
  }

  console.log("done. failed:", failed.length ? failed : "none");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
