// Diagnostic: does #/profile self-navigate? When does it leave? Then FA screenshot.
import fs from "node:fs";

const PORT = 9334;
const BASE = "http://localhost:5173/#/";
const OUT = ".ui-shots";
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

const evalJs = async (cdp, expression) =>
  (await cdp.send("Runtime.evaluate", { expression, returnByValue: true })).result.value;

async function shot(cdp, name) {
  const metrics = await cdp.send("Page.getLayoutMetrics");
  const full = metrics.cssContentSize || metrics.contentSize;
  const s = await cdp.send("Page.captureScreenshot", {
    format: "png",
    captureBeyondViewport: true,
    clip: { x: 0, y: 0, width: Math.min(full.width, 390), height: Math.min(full.height, 4000), scale: 1 },
  });
  fs.writeFileSync(`${OUT}/${name}.png`, Buffer.from(s.data, "base64"));
  console.log(
    "wrote",
    name,
    "clipH",
    Math.min(full.height, 4000),
    "hashAfter",
    await evalJs(cdp, "location.hash"),
  );
}

const t = await newTarget(`${BASE}profile`);
const cdp = await connect(t.webSocketDebuggerUrl);
try {
  await cdp.send("Page.enable");
  await cdp.send("Emulation.setDeviceMetricsOverride", {
    width: 390,
    height: 844,
    deviceScaleFactor: 2,
    mobile: true,
  });

  // Watch hash over 12s WITHOUT touching anything
  for (let i = 0; i < 6; i++) {
    await sleep(2000);
    console.log(
      `t=${(i + 1) * 2}s hash=${await evalJs(cdp, "location.hash")} heading=${await evalJs(cdp, "(document.querySelector('h1,h2')||{}).textContent||''").then((x) => String(x).slice(0, 30))}`,
    );
  }

  // Click FA
  const clicked = await evalJs(
    cdp,
    `(() => {
    const b = [...document.querySelectorAll('button')].find(x => x.textContent.trim() === 'فارسی');
    if (b) { b.click(); return 'clicked'; } return 'no-btn';
  })()`,
  );
  console.log("lang:", clicked);
  for (let i = 0; i < 6; i++) {
    await sleep(500);
    console.log(
      `afterClick +${(i + 1) * 0.5}s hash=${await evalJs(cdp, "location.hash")} dir=${await evalJs(cdp, "document.documentElement.dir")}`,
    );
  }
  await shot(cdp, "fa-profile");

  // Restore EN if still possible
  const en = await evalJs(
    cdp,
    `(() => {
    const b = [...document.querySelectorAll('button')].find(x => x.textContent.trim() === 'English');
    if (b) { b.click(); return 'en-restored'; } return 'no-en-btn';
  })()`,
  );
  console.log(en);
} catch (e) {
  console.log("FAIL", e.message);
}
cdp.close();
await closeTarget(t.id);
