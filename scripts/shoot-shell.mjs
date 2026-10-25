/**
 * One-off visual aid: screenshots of the app frame — container, border and
 * the gap between the device screen edge and the app content — for a phone
 * viewport, in both languages. Skips onboarding if a fresh dev identity
 * triggers it, then screenshots the matches feed twice: plain, and with an
 * overlay marking the container edges + measured gutters.
 *
 * Usage: node scripts/shoot-shell.mjs   (dev servers must be running)
 */
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

const BASE = "http://localhost:5173";
const OUT = "screenshots/shell";
/** 390×844 = a phone (the app column fills the width, the gutter is the only
 * spacing); 820 = a tablet where the 560px max-width column is visibly
 * centered with real screen↔app gaps. */
const SHOTS = [
  { name: "phone", viewport: { width: 390, height: 844 } },
  { name: "tablet", viewport: { width: 820, height: 1180 } },
];

mkdirSync(OUT, { recursive: true });

// Same rule as browser-smoke: local Windows has no bundled chromium, so lean on
// the installed Chrome (fall back to Edge) unless an env channel says so.
const CHANNEL = process.env.SMOKE_CHANNEL || "chrome";
const browser = await chromium
  .launch({ channel: CHANNEL })
  .catch(() => chromium.launch({ channel: "msedge" }));
try {
  for (const lang of ["en", "fa"]) {
  for (const { name, viewport } of SHOTS) {
    const user = Number(`9${Date.now()}${Math.floor(Math.random() * 90 + 10)}`);
    const ctx = await browser.newContext({
      viewport,
      deviceScaleFactor: 2, // crisp for sharing
      locale: lang === "fa" ? "fa-IR" : "en-US",
    });
    await ctx.addInitScript(([l]) => {
      localStorage.setItem("matchday.lang", l);
      localStorage.removeItem("matchday.loggedOut");
    }, [lang]);
    const page = await ctx.newPage();
    await page.goto(`${BASE}/?devUser=${user}#/matches`);
    await page.waitForLoadState("networkidle").catch(() => {});

    // A fresh identity can land on onboarding; Skip into the feed.
    await page.waitForTimeout(1500);
    const skip = page.locator("button", { hasText: /skip|رد/i }).first();
    if (await skip.isVisible().catch(() => false)) {
      await skip.click();
      await page.waitForTimeout(1200);
    }
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForTimeout(1500);

    // Plain shot — the frame as the user sees it.
    await page.screenshot({ path: `${OUT}/feed-${lang}-${name}.png` });

    // Overlay shot: magenta = the app column's edges (screen↔app gap), cyan =
    // the content rails inside the 16px gutter, with measured labels so the
    // spacing is point-at-able in chat.
    await page.evaluate(() => {
      const main = document.querySelector("#main-content");
      const r = main.getBoundingClientRect();
      const cs = getComputedStyle(main);
      const padL = parseFloat(cs.paddingLeft);
      const padR = parseFloat(cs.paddingRight);
      const colL = r.left;
      const colR = r.right;
      const contL = r.left + padL;
      const contR = r.right - padR;
      const vw = window.innerWidth;
      const gutter = Math.round(padL);
      const sideGapL = Math.round(colL);
      const sideGapR = Math.round(vw - colR);
      const overlay = document.createElement("div");
      overlay.id = "shell-overlay";
      overlay.innerHTML = `
      <style>
        .col-l{position:fixed;top:0;bottom:0;left:${colL}px;width:2px;background:#ff2ea6;z-index:2147483647}
        .col-r{position:fixed;top:0;bottom:0;left:${colR}px;width:2px;background:#ff2ea6;z-index:2147483647}
        .cont-l{position:fixed;top:0;bottom:0;left:${contL}px;width:2px;background:#00e5ff;z-index:2147483647}
        .cont-r{position:fixed;top:0;bottom:0;left:${contR}px;width:2px;background:#00e5ff;z-index:2147483647}
        .lbl{position:fixed;bottom:110px;z-index:2147483647;font:700 11px/1.4 monospace;
          background:#ffe900;color:#000;padding:2px 6px;border-radius:4px;white-space:nowrap;box-shadow:0 0 0 1px #000}
      </style>`;
      const labels = [
        { text: `screen↔app ${sideGapL}px ␣ app column ${Math.round(colR - colL)}px`, side: "l" },
        { text: `app ${sideGapR}px screen`, side: "r" },
        { text: `content gutter ${gutter}px`, side: "c" },
      ];
      for (const l of labels) {
        const el = document.createElement("div");
        el.className = "lbl";
        el.textContent = l.text;
        if (l.side === "l") el.style.left = "6px";
        if (l.side === "r") el.style.right = "6px";
        if (l.side === "c") {
          el.style.left = `${contL + 4}px`;
          el.style.bottom = "150px";
        }
        overlay.appendChild(el);
      }
      document.body.appendChild(overlay);
    });
    await page.screenshot({ path: `${OUT}/feed-${lang}-${name}-annotated.png` });
    console.log(
      `[shell] ${lang}/${name}: saved. measured: ` +
        JSON.stringify(
          await page.evaluate(() => {
            const main = document.querySelector("#main-content");
            const r = main.getBoundingClientRect();
            const cs = getComputedStyle(main);
            return {
              viewportWidth: window.innerWidth,
              appColumnWidth: Math.round(r.width),
              screenToAppGapLeft: Math.round(r.left),
              screenToAppGapRight: Math.round(window.innerWidth - r.right),
              contentGutter: cs.paddingLeft,
              maxWidth: cs.maxWidth,
            };
          }),
        ),
    );
    await ctx.close();
  }
  }
} finally {
  await browser.close();
}
console.log("DONE");
