// Full-page screenshots + overflow check at a real mobile viewport (390x844).
import fs from "node:fs";

const PORT = 9334;
const BASE = "http://localhost:5173/#/";
const OUT = ".ui-shots";
const pages = [
  ["matches", "matches"],
  ["matchdetail", "match/401915418"],
  ["matchfinished", "match/401915444"],
  ["leaderboards", "leaderboards"],
  ["ratings", "ratings"],
  ["profile", "profile"],
  ["myteams", "my-teams"],
  ["table", "table"],
  ["browse", "browse"],
  ["stats", "stats"],
  ["cups", "cups"],
  ["login", "login"],
  ["onboarding", "onboarding"],
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function newTarget(url) {
  const res = await fetch(`http://localhost:${PORT}/json/new?${encodeURIComponent(url)}`, { method: "PUT" });
  return res.json();
}
async function closeTarget(id) {
  await fetch(`http://localhost:${PORT}/json/close/${id}`, { method: "DELETE" }).catch(() => {});
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

const EXPRESSION = `(() => {
  const vw = document.documentElement.clientWidth;
  const doc = document.documentElement;
  const over = [];
  const walk = (el) => {
    const r = el.getBoundingClientRect();
    const style = getComputedStyle(el);
    const clipped = style.overflowX === 'auto' || style.overflowX === 'scroll' || style.overflowX === 'hidden';
    if (r.width > 0 && r.right > vw + 1 && !clipped) {
      over.push({
        tag: el.tagName.toLowerCase(),
        cls: (typeof el.className === 'string' ? el.className : '').slice(0, 70),
        right: Math.round(r.right),
        text: (el.textContent || '').trim().slice(0, 36),
      });
    }
    for (const c of el.children) walk(c);
  };
  walk(document.body);
  return {
    hash: location.hash,
    scrollW: doc.scrollWidth,
    clientW: vw,
    horizontalScroll: doc.scrollWidth > vw + 1,
    offenders: over.slice(0, 6),
  };
})()`;

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
    await sleep(6000);
    const out = await cdp.send("Runtime.evaluate", { expression: EXPRESSION, returnByValue: true });
    console.log(name, JSON.stringify(out.result.value));

    // Full-page screenshot
    const metrics = await cdp.send("Page.getLayoutMetrics");
    const full = metrics.cssContentSize || metrics.contentSize;
    const shot = await cdp.send("Page.captureScreenshot", {
      format: "png",
      captureBeyondViewport: true,
      clip: { x: 0, y: 0, width: Math.min(full.width, 390), height: Math.min(full.height, 4000), scale: 1 },
    });
    fs.writeFileSync(`${OUT}/${name}.png`, Buffer.from(shot.data, "base64"));
  } catch (e) {
    console.log(name, "FAIL", e.message);
  }
  cdp.close();
  await closeTarget(t.id);
}
