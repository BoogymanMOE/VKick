// FA/RTL verification with REAL page reloads (hash navigation alone keeps SPA state).
import fs from "node:fs";

const OUT = ".ui-shots/fresh";
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

// RTL-specific checks: overflow in RTL, physical-left paddings that don't flip,
// and a shot of each screen so mirrored layout can be eyeballed.
const RTL_CHECK = `(() => {
  const vw = document.documentElement.clientWidth;
  const doc = document.documentElement;
  const out = { dir: doc.dir, hScroll: doc.scrollWidth > vw + 1, offenders: [] };
  const walk = (el) => {
    const r = el.getBoundingClientRect();
    const s = getComputedStyle(el);
    const clipped = ["auto","scroll","hidden"].includes(s.overflowX);
    if (r.width > 0 && (r.right > vw + 1 || r.left < -1) && !clipped) {
      out.offenders.push({
        tag: el.tagName.toLowerCase(),
        cls: (typeof el.className === "string" ? el.className : "").slice(0, 60),
        left: Math.round(r.left), right: Math.round(r.right),
        text: (el.textContent || "").trim().slice(0, 30),
      });
    }
    for (const c of el.children) walk(c);
  };
  walk(document.body);
  out.offenders = out.offenders.slice(0, 6);
  // any hardcoded physical margin/padding-left/right utilities on buttons?
  out.physicalSides = [...document.querySelectorAll('[class*="pl-"], [class*="pr-"], [class*="ml-"], [class*="mr-"], [class*="text-left"], [class*="text-right"]')]
    .slice(0, 8).map(el => (typeof el.className === "string" ? el.className : "").match(/(?:pl|pr|ml|mr|text-left|text-right)-\\S+/g)?.[0]);
  return out;
})()`;

const pages = [
  ["02-matches", "matches"],
  ["05-table", "table"],
  ["07-leaderboards", "leaderboards"],
  ["10-profile", "profile"],
  ["04-cups", "cups"],
  ["12-matchdetail", "match/401882858"],
];

const results = {};
for (const [name, route] of pages) {
  // Fresh target with the language pre-set BEFORE load: a real reload path.
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
    // Seed localStorage via a data: URL on the same origin is not possible;
    // instead load the app once, set lang, then hard-reload.
    await cdp.send("Page.navigate", { url: `${BASE}${route}` });
    await sleep(3500);
    await cdp.send("Runtime.evaluate", {
      expression: `localStorage.setItem("matchday.lang","fa")`,
      returnByValue: true,
    });
    await cdp.send("Page.navigate", { url: `${BASE}${route}` });
    await sleep(4500);

    const out = (await cdp.send("Runtime.evaluate", { expression: RTL_CHECK, returnByValue: true })).result
      .value;
    results[name] = out;

    const metrics = await cdp.send("Page.getLayoutMetrics");
    const full = metrics.cssContentSize || metrics.contentSize;
    const s = await cdp.send("Page.captureScreenshot", {
      format: "png",
      captureBeyondViewport: true,
      clip: { x: 0, y: 0, width: Math.min(full.width, 390), height: Math.min(full.height, 4000), scale: 1 },
    });
    fs.writeFileSync(`${OUT}/fa-${name}.png`, Buffer.from(s.data, "base64"));
  } catch (e) {
    results[name] = { FAIL: e.message };
  }
  cdp.close();
  await closeTarget(t.id);
}
fs.writeFileSync(`${OUT}/fa-signals.json`, JSON.stringify(results, null, 1));
for (const [k, v] of Object.entries(results)) {
  if (!v || v.FAIL) {
    console.log(k, "FAIL", v?.FAIL);
    continue;
  }
  console.log(
    k,
    "dir=" + v.dir,
    v.hScroll ? "HSCROLL!" : "ok",
    "offenders:" + (v.offenders?.length ?? 0),
    "physSides:" + (v.physicalSides?.filter(Boolean).length ?? 0),
  );
}
