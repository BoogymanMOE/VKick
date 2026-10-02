// Post-fix verification: re-run the a11y signals + shots on every screen the
// P1/P2/P3 fixes touched. Run with dev servers + chrome :9334 up.
import fs from "node:fs";

const OUT = ".ui-shots/fixed";
fs.mkdirSync(OUT, { recursive: true });
const BASE = "http://localhost:5173/#/";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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
  const out = { hash: location.hash, hScroll: document.documentElement.scrollWidth > vw + 1 };
  const bad = [];
  for (const el of document.querySelectorAll('button, a, [role="button"], input, select, textarea')) {
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) continue;
    const cs = getComputedStyle(el);
    if (cs.visibility === "hidden" || cs.pointerEvents === "none") continue;
    if (r.height < 44 || r.width < 44) bad.push({ h: Math.round(r.height), w: Math.round(r.width), text: (el.textContent || el.getAttribute("aria-label") || "").trim().slice(0, 24) });
  }
  out.smallTargets = bad.slice(0, 8);
  function lum(c) {
    // No regex on purpose: this code ships through a nested template literal,
    // and backslash-escaping a paren regex across that boundary is fragile.
    const parts = c.slice(c.indexOf("(") + 1).split(",");
    const r = Number(parts[0]), g = Number(parts[1]), b = Number(parts[2]);
    if (Number.isNaN(r) || Number.isNaN(g) || Number.isNaN(b)) return null;
    const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
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
    const l1 = lum(cs.color), l2 = lum(bgOf(el));
    if (l1 === null || l2 === null) continue;
    const ratio = (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
    const px = parseFloat(cs.fontSize);
    const bold = parseInt(cs.fontWeight) >= 700;
    if (ratio < (px >= 24 || (px >= 18.66 && bold) ? 3 : 4.5) - 0.01) low.push({ text: el.textContent.trim().slice(0, 24), ratio: +ratio.toFixed(2), px });
  }
  out.lowContrast = low.slice(0, 10);
  // round headings on cups
  out.h3s = [...document.querySelectorAll("h2, h3, [class*='label-lg']")].map(h => h.textContent.trim().slice(0, 28)).slice(0, 10);
  return out;
})()`;

const pages = [
  ["01-onboarding", "onboarding"],
  ["02-login", "login"],
  ["03-matches", "matches"],
  ["04-cups", "cups"],
  ["05-table", "table"],
  ["06-stats", "stats"],
  ["07-leaderboards", "leaderboards"],
  ["08-replay", "match/401882858/replay"],
  ["09-profile", "profile"],
];

const results = {};
for (const [name, route] of pages) {
  const t = await newTarget("about:blank");
  const cdp = await connect(t.webSocketDebuggerUrl);
  try {
    await cdp.send("Page.enable");
    await cdp.send("Emulation.setDeviceMetricsOverride", {
      width: 390,
      height: 844,
      deviceScaleFactor: 2,
      mobile: true,
    });
    await cdp.send("Page.navigate", { url: `${BASE}${route}` });
    await sleep(5000);
    const out = (await cdp.send("Runtime.evaluate", { expression: SIGNALS, returnByValue: true })).result
      .value;
    results[name] = out;
    const metrics = await cdp.send("Page.getLayoutMetrics");
    const full = metrics.cssContentSize || metrics.contentSize;
    const s = await cdp.send("Page.captureScreenshot", {
      format: "png",
      captureBeyondViewport: true,
      clip: { x: 0, y: 0, width: Math.min(full.width, 390), height: Math.min(full.height, 4000), scale: 1 },
    });
    fs.writeFileSync(`${OUT}/${name}.png`, Buffer.from(s.data, "base64"));
  } catch (e) {
    results[name] = { FAIL: String(e?.stack ?? e?.message ?? e) };
  }
  cdp.close();
  await closeTarget(t.id);
}
fs.writeFileSync(`${OUT}/signals.json`, JSON.stringify(results, null, 1));
for (const [k, v] of Object.entries(results)) {
  if (!v || v.FAIL) {
    console.log(k, "FAIL", v?.FAIL);
    continue;
  }
  const flags = [];
  if (v.smallTargets?.length) flags.push(`smallTargets:${v.smallTargets.length}`);
  if (v.lowContrast?.length) flags.push(`lowContrast:${v.lowContrast.length}`);
  if (v.hScroll) flags.push("HSCROLL");
  console.log(k, flags.join(" ") || "ok", "| headings:", (v.h3s || []).slice(0, 4).join(" / "));
}
