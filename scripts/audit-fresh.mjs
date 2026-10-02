// Fresh visual audit: CDP screenshots + a11y/contrast/empty-state signals.
// Usage: dev servers + headless chrome (remote-debugging-port=9334) running.
import fs from "node:fs";
import { DatabaseSync } from "node:sqlite";

const OUT = ".ui-shots/fresh";
fs.mkdirSync(OUT, { recursive: true });
const BASE = "http://localhost:5173/#/";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---- pick real match ids from the DB
const db = new DatabaseSync("./data/matchday.db", { readOnly: true });
const q = (sql) => db.prepare(sql).all();
const live = q(`SELECT id FROM matches WHERE status='live' ORDER BY id LIMIT 1`)[0]?.id ?? "401861089";
const big =
  q(
    `SELECT id FROM matches WHERE status='finished' AND league IN ('eng.1','esp.1','ita.1','ger.1','fra.1','uefa.champions') ORDER BY kickoff_at DESC LIMIT 1`,
  )[0]?.id ?? "401882858";
const soon =
  q(`SELECT id FROM matches WHERE status='scheduled' ORDER BY kickoff_at ASC LIMIT 1`)[0]?.id ?? "401882839";

const pages = [
  ["01-onboarding", "onboarding"],
  ["02-matches", "matches"],
  ["03-browse", "browse"],
  ["04-cups", "cups"],
  ["05-table", "table"],
  ["06-stats", "stats"],
  ["07-leaderboards", "leaderboards"],
  ["08-predictions", "predictions"],
  ["09-ratings", "ratings"],
  ["10-profile", "profile"],
  ["11-myteams", "my-teams"],
  ["12-matchdetail-live", `match/${live}`],
  ["13-matchdetail-finished", `match/${big}`],
  ["14-replay", `match/${big}/replay`],
  ["15-team", `team/${big ? "" : ""}`].filter(Boolean), // replaced below
];
pages.pop(); // drop the placeholder team entry
const teamId = q(`SELECT id FROM teams WHERE logo_url IS NOT NULL LIMIT 1`)[0]?.id;
if (teamId) pages.push(["15-team", `team/${teamId}`]);

async function newTarget(url) {
  const res = await fetch(`http://localhost:9334/json/new?${encodeURIComponent(url)}`, { method: "PUT" });
  return res.json();
}
async function closeTarget(id) {
  await fetch(`http://localhost:9334/json/close/${id}`, { method: "DELETE" }).catch(() => {});
}
function connect(wsUrl) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    let id = 0;
    const pending = new Map();
    ws.onmessage = (e) => {
      const msg = JSON.parse(e.data);
      if (msg.id && pending.has(msg.id)) {
        const { resolve: r, reject: j } = pending.get(msg.id);
        pending.delete(msg.id);
        msg.error ? j(new Error(msg.error.message)) : r(msg.result);
      }
    };
    ws.onopen = () =>
      resolve({
        send: (method, params = {}) =>
          new Promise((r, j) => {
            const i = ++id;
            pending.set(i, { resolve: r, reject: j });
            ws.send(JSON.stringify({ id: i, method, params }));
          }),
        close: () => ws.close(),
      });
    ws.onerror = reject;
  });
}

const SIGNALS = `(() => {
  const vw = document.documentElement.clientWidth;
  const out = { hash: location.hash, dir: document.documentElement.dir, hScroll: document.documentElement.scrollWidth > vw + 1 };
  // empty states
  out.emptyStates = [...document.querySelectorAll("div")].filter(d => {
    const t = d.className || "";
    return typeof t === "string" && t.includes("border-dashed") && t.includes("pitch-watermark");
  }).map(d => (d.textContent || "").trim().slice(0, 70));
  // broken crest imgs
  out.brokenImgs = [...document.images].filter(i => i.complete && i.naturalWidth === 0).map(i => (i.src || "").slice(-48));
  // tiny touch targets: interactive elements under 44px in the smaller dimension
  const bad = [];
  for (const el of document.querySelectorAll('button, a, [role="button"], input, select, textarea')) {
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) continue;
    if (r.height < 44 || r.width < 44) {
      const cs = getComputedStyle(el);
      if (cs.visibility === "hidden" || cs.pointerEvents === "none") continue;
      bad.push({ tag: el.tagName.toLowerCase(), h: Math.round(r.height), w: Math.round(r.width), text: (el.textContent || "").trim().slice(0, 26) });
    }
  }
  out.smallTargets = bad.slice(0, 8);
  // low-contrast text sampling
  function lum(c) {
    const m = c.match(/rgba?\\(([\\d.]+),\\s*([\\d.]+),\\s*([\\d.]+)/);
    if (!m) return null;
    const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
    return 0.2126 * f(m[1]) + 0.7152 * f(m[2]) + 0.0722 * f(m[3]);
  }
  function bgOf(el) {
    let n = el;
    while (n && n !== document.documentElement) {
      const c = getComputedStyle(n).backgroundColor;
      if (c && !c.includes("rgba(0, 0, 0, 0)")) return c;
      n = n.parentElement;
    }
    return "rgb(8, 22, 19)";
  }
  const low = [];
  for (const el of document.querySelectorAll("p, span, div, h1, h2, h3, a, button")) {
    if (!el.textContent || !el.textContent.trim() || el.children.length > 2) continue;
    const cs = getComputedStyle(el);
    const fg = cs.color, bg = bgOf(el);
    const l1 = lum(fg), l2 = lum(bg);
    if (l1 === null || l2 === null) continue;
    const ratio = (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
    const px = parseFloat(cs.fontSize);
    const bold = parseInt(cs.fontWeight) >= 700;
    const large = px >= 24 || (px >= 18.66 && bold);
    const need = large ? 3 : 4.5;
    if (ratio < need - 0.01) low.push({ text: el.textContent.trim().slice(0, 30), fg, bg, ratio: +ratio.toFixed(2), px });
  }
  out.lowContrast = low.slice(0, 10);
  out.headingFont = (() => { const h = document.querySelector("h1, h2"); return h ? getComputedStyle(h).fontFamily.split(",")[0] : null; })();
  return out;
})()`;

const results = {};
for (const [name, route] of pages) {
  const t = await newTarget(`${BASE}${route}`);
  const cdp = await connect(t.webSocketDebuggerUrl);
  try {
    await cdp.send("Page.enable");
    await cdp.send("Emulation.setDeviceMetricsOverride", {
      width: 390,
      height: 844,
      deviceScaleFactor: 2,
      mobile: true,
    });
    await sleep(5500);
    const out = (await cdp.send("Runtime.evaluate", { expression: SIGNALS, returnByValue: true })).result
      .value;
    results[name] = out;

    // FA variant for the four busiest screens
    if (["02-matches", "05-table", "07-leaderboards", "10-profile"].includes(name)) {
      await cdp.send("Runtime.evaluate", {
        expression: `localStorage.setItem("matchday.lang","fa")`,
        returnByValue: true,
      });
      await cdp.send("Page.navigate", { url: `${BASE}${route}` });
      await sleep(4500);
      const fa = (await cdp.send("Runtime.evaluate", { expression: SIGNALS, returnByValue: true })).result
        .value;
      results[name + "-fa"] = fa;
      const metrics = await cdp.send("Page.getLayoutMetrics");
      const full = metrics.cssContentSize || metrics.contentSize;
      const s = await cdp.send("Page.captureScreenshot", {
        format: "png",
        captureBeyondViewport: true,
        clip: { x: 0, y: 0, width: Math.min(full.width, 390), height: Math.min(full.height, 4000), scale: 1 },
      });
      fs.writeFileSync(`${OUT}/${name}-fa.png`, Buffer.from(s.data, "base64"));
      // restore EN
      await cdp.send("Runtime.evaluate", {
        expression: `localStorage.setItem("matchday.lang","en")`,
        returnByValue: true,
      });
    }

    const metrics = await cdp.send("Page.getLayoutMetrics");
    const full = metrics.cssContentSize || metrics.contentSize;
    const s = await cdp.send("Page.captureScreenshot", {
      format: "png",
      captureBeyondViewport: true,
      clip: {
        x: 0,
        root: undefined,
        x2: 0,
        y: 0,
        width: Math.min(full.width, 390),
        height: Math.min(full.height, 4000),
        scale: 1,
      },
    });
    fs.writeFileSync(`${OUT}/${name}.png`, Buffer.from(s.data, "base64"));
  } catch (e) {
    results[name] = { FAIL: e.message };
  }
  cdp.close();
  await closeTarget(t.id);
}
fs.writeFileSync(`${OUT}/signals.json`, JSON.stringify(results, null, 1));
console.log("done. pages:", Object.keys(results).length);
for (const [k, v] of Object.entries(results)) {
  if (!v || v.FAIL) {
    console.log(k, "FAIL", v?.FAIL);
    continue;
  }
  const flags = [];
  if (v.emptyStates?.length) flags.push(`empty:${v.emptyStates.length}`);
  if (v.smallTargets?.length) flags.push(`smallTargets:${v.smallTargets.length}`);
  if (v.lowContrast?.length) flags.push(`lowContrast:${v.lowContrast.length}`);
  if (v.brokenImgs?.length) flags.push(`brokenImgs:${v.brokenImgs.length}`);
  console.log(k, flags.join(" ") || "ok");
}
