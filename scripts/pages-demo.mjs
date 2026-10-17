// Demo album builder: screenshots every ROUTED screen except the Matchday
// feed (Matches.tsx, the one page the request excluded) at a real mobile
// viewport, then writes demo/index.html next to them so a single folder can be
// opened by anyone — no server, no build, no network.
//
// Usage (Chrome must already be listening on the debug port):
//   chrome --headless=new --remote-debugging-port=9334 --user-data-dir=.tmp/chrome-demo about:blank
//   node scripts/pages-demo.mjs
//
// Requires `npm run server` (8787) and `npm run dev` (5173) to be up: the shots
// are of the REAL app against the REAL local API, not of mock markup.
import fs from "node:fs";

const PORT = 9334;
// main.tsx mounts a HashRouter, so every route is reached as /#<route>.
// Path-based URLs silently fall through to "/" (the matchday feed).
const ORIGIN = "http://localhost:5173";
const BASE = `${ORIGIN}/#`;
const OUT = "demo";
const SHOTS = `${OUT}/shots`;
const API = "http://localhost:8787";

// Followed clubs seeded into the capture browser's guest account before the
// first shot, so the favorites surfaces (Tables "My clubs", the Profile shelf)
// show real content instead of their empty states. One club per big five.
const FAVORITES = [
  "364", // Liverpool (eng.1)
  "83", // Barcelona (esp.1)
  "110", // Internazionale (ita.1)
  "132", // Bayern Munich (ger.1)
  "160", // Paris Saint-Germain (fra.1)
];

const pages = [
  [
    "onboarding",
    "/onboarding",
    "Onboarding — pick a favorite, then your clubs and leagues",
    "The first-run flow. Three steps, each one a picker; the caps come from the server.",
  ],
  [
    "table",
    "/table",
    "Tables — league standings",
    "Standings for the synced leagues, your clubs pinned on top and highlighted in every table.",
  ],
  [
    "profile",
    "/profile",
    "Profile — account, settings, referrals",
    "Identity, push preferences, language, invite code, What's new, legal links, danger zone.",
  ],
  [
    "match-finished",
    "/match/401879262",
    "Match detail — finished",
    "Timeline, lineups, stats and crowd ratings for a completed match.",
  ],
  ["match-live", "/match/401879258", "Match detail — live", "The same screen while the match is in play."],
  [
    "team",
    "/team/364",
    "Team page — club hub",
    "Form, fixtures, results and expected-points history for one club.",
  ],
  ["cups", "/cups", "Cups — knockout brackets", "Cup competitions and their rounds."],
  [
    "ratings",
    "/ratings",
    "Ratings — the eye test",
    "Crowd ratings for one match, with the seeded votes from three accounts so the averages are real numbers.",
  ],
  [
    "login",
    "/login",
    "Login — entry screen",
    "Username/password or Telegram, rendered outside the tab shell.",
  ],
  ["privacy", "/privacy", "Privacy policy", "Legal text, both languages from one key list."],
  ["terms", "/terms", "Terms of service", "The same Legal renderer with the terms section list."],
  [
    "notfound",
    "/this-page-does-not-exist",
    "Not found",
    "Unknown deep links say so instead of silently redirecting.",
  ],
];

// NOT captured, and why (the album says so instead of quietly shrinking the
// list): /admin is operator-only. Admin.tsx redirects anyone who is not in the
// server's ADMIN_TELEGRAM_IDS to /matches, so a local guest account renders the
// redirect, not the dashboard — there is no honest screenshot to take.

// Persian re-shots of the three densest screens: the app is bilingual and RTL
// is a load-bearing part of the design, so the album shows it rather than
// describing it.
const faPages = [
  ["table", "/table", "جدول‌ها — رده‌بندی لیگ"],
  ["match-finished", "/match/401879262", "جزئیات بازی — تمام‌شده"],
  ["profile", "/profile", "پروفایل — حساب، تنظیمات، دعوت"],
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function newTarget(url) {
  const res = await fetch(`http://localhost:${PORT}/json/new?${encodeURIComponent(url)}`, {
    method: "PUT",
  });
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
    const client = {
      onEvent: null,
      send: (method, params = {}) =>
        new Promise((r, j) => {
          const i = ++id;
          pending.set(i, { resolve: r, reject: j });
          ws.send(JSON.stringify({ id: i, method, params }));
        }),
      close: () => ws.close(),
    };
    ws.onmessage = (e) => {
      const msg = JSON.parse(e.data);
      if (msg.id && pending.has(msg.id)) {
        const { resolve: r, reject: j } = pending.get(msg.id);
        pending.delete(msg.id);
        msg.error ? j(new Error(msg.error.message)) : r(msg.result);
        return;
      }
      // CDP events (no id) feed the per-page error collector.
      if (msg.method) client.onEvent?.(msg);
    };
    ws.onopen = () => resolve(client);
    ws.onerror = reject;
  });
}

/** Console/page errors seen while the target was open — the album claims the
 *  screens render, so anything the page threw is worth failing loudly over. */
function collectErrors(cdp) {
  const errors = [];
  cdp.onEvent = (msg) => {
    if (msg.method === "Runtime.exceptionThrown") {
      errors.push(msg.params?.exceptionDetails?.exception?.description ?? "exception");
    }
    if (msg.method === "Runtime.consoleAPICalled" && msg.params?.type === "error") {
      errors.push((msg.params.args ?? []).map((a) => a.value ?? a.description ?? "").join(" "));
    }
  };
  return errors;
}

/**
 * What the shot actually shows: the hash route it landed on, the UI language
 * direction, how much text rendered, and whether the page still looks empty.
 * A wrong hash or an empty body is how a silently-wrong screenshot passes a
 * "the file exists" check, so it is recorded in the manifest and warned about.
 */
async function pageState(cdp) {
  const state = await evaluate(
    cdp,
    `(() => ({
      shown: location.hash || "/",
      dir: document.documentElement.dir,
      textLen: (document.body.innerText || "").trim().length,
    }))()`,
  );
  state.warn = state.textLen < 80 ? "page looks empty" : null;
  return state;
}

async function openPage(route) {
  const target = await newTarget(`${BASE}${route}`);
  const cdp = await connect(target.webSocketDebuggerUrl);
  const errors = collectErrors(cdp);
  // Event push (not just command replies) is what makes the error collector work.
  await cdp.send("Runtime.enable");
  await cdp.send("Page.enable");
  await cdp.send("Emulation.setDeviceMetricsOverride", {
    width: 390,
    height: 844,
    deviceScaleFactor: 2,
    mobile: true,
  });
  return { target, cdp, errors };
}

async function evaluate(cdp, expression, awaitPromise = false) {
  const out = await cdp.send("Runtime.evaluate", {
    expression,
    returnByValue: true,
    awaitPromise,
  });
  if (out.exceptionDetails) throw new Error(out.exceptionDetails.text ?? "evaluate failed");
  return out.result.value;
}

async function shoot(cdp, file) {
  const metrics = await cdp.send("Page.getLayoutMetrics");
  const full = metrics.cssContentSize || metrics.contentSize;
  const shot = await cdp.send("Page.captureScreenshot", {
    format: "png",
    captureBeyondViewport: true,
    clip: {
      x: 0,
      y: 0,
      width: Math.min(full.width, 390),
      height: Math.min(full.height, 6000),
      scale: 1,
    },
  });
  fs.writeFileSync(file, Buffer.from(shot.data, "base64"));
  return { width: Math.round(Math.min(full.width, 390)), height: Math.round(Math.min(full.height, 6000)) };
}

async function main() {
  fs.mkdirSync(SHOTS, { recursive: true });

  // ---- pass 0: boot one tab, fix the language, seed favorites ------------
  const boot = await openPage("/table");
  await sleep(5000);
  await evaluate(boot.cdp, `localStorage.setItem("matchday.lang", "en")`);
  // Deterministic seed: clear whatever an earlier run followed, then follow
  // exactly FAVORITES. POSTs alone are not enough — a profile that already hit
  // the five-club cap answers MAX_CLUBS and silently keeps the old list.
  const seed = await evaluate(
    boot.cdp,
    `(async () => {
      const token =
        localStorage.getItem("matchday.session") ||
        sessionStorage.getItem("matchday.session.session");
      if (!token) return "no-token";
      const headers = { "content-type": "application/json", authorization: "Bearer " + token };
      const out = [];
      const current = await (await fetch("/api/me/favorites", { headers })).json();
      for (const fav of current.favorites ?? []) {
        const r = await fetch("/api/me/favorites/" + fav.id, { method: "DELETE", headers });
        out.push("-" + fav.id + ":" + r.status);
      }
      for (const teamId of ${JSON.stringify(FAVORITES)}) {
        const r = await fetch("/api/me/favorites", {
          method: "POST",
          headers,
          body: JSON.stringify({ teamId }),
        });
        out.push("+" + teamId + ":" + r.status);
      }
      return out.join(" ");
    })()`,
    true,
  );
  console.log("[demo] favorites seeded:", seed);

  // Crowd ratings only appear once `minVotes` distinct people have voted, so
  // this files one card each from three accounts (the local `dev:<id>` escape
  // hatch; they 401 without DEV_AUTH_SECRET and the Ratings shot then shows its
  // own empty state, which is also a real state worth seeing). Re-runs hit the
  // 3-card cap and change nothing — the earlier votes are what the shot shows.
  //
  // The match is not hardcoded: Ratings defaults to the first FINISHED match of
  // GET /api/matches (falling back to matches[0]), so seed that same one and
  // deep-link the shot to it — otherwise the votes land on a different match
  // than the screen opens.
  const votes = await evaluate(
    boot.cdp,
    `(async () => {
      const scores = [8, 6, 9];
      const list = await (await fetch("/api/matches")).json();
      const board = await (await fetch("/api/matches")).json();
      const matches = board.matches ?? [];
      // Not every finished match in the window has a lineup ingested (some
      // leagues sync scores only), so probe the sheet and skip the empty ones
      // instead of screenshotting "No players have featured yet".
      for (const match of matches) {
        if (match.status === "scheduled") continue;
        const probe = await (
          await fetch("/api/matches/" + match.id + "/ratings", {
            headers: { authorization: "Bearer dev:1" },
          })
        ).json();
        const rated = (probe.players ?? []).filter((p) => (p.minutes_played ?? 0) >= 60);
        if (rated.length < 3) continue;
        const out = [match.id];
        for (const who of ["dev:1", "dev:2", "dev:3"]) {
          const headers = { "content-type": "application/json", authorization: "Bearer " + who };
          for (const [i, p] of rated.slice(0, 3).entries()) {
            const r = await fetch("/api/matches/" + match.id + "/ratings", {
              method: "POST",
              headers,
              body: JSON.stringify({ playerId: p.player_id, rating: scores[i] }),
            });
            out.push(who + " " + p.short_name + ":" + r.status);
          }
        }
        return { id: match.id, log: out.join(", ") };
      }
      return { id: null, log: "no started match with 3+ played players" };
    })()`,
    true,
  );
  const seedMatchId = votes?.id ?? null;
  console.log("[demo] ratings seeded:", votes?.log);
  boot.cdp.close();
  await closeTarget(boot.target.id);

  // ---- pass 1: every routed screen except the Matchday feed (EN) ----------
  const manifest = [];
  // Login renders only while the browser is signed OUT; the profile keeps a
  // guest session from earlier passes, so it is shot last with the sign-out
  // flag set in one tab (the flag lives in localStorage, i.e. per profile).
  const ordered = [...pages.filter(([name]) => name !== "login"), pages.find(([name]) => name === "login")];
  for (const [name, route, title, blurb] of ordered) {
    // Ratings is deep-linked to the match whose votes were just seeded, so the
    // shot shows real crowd averages rather than whichever match sorts first.
    const url = name === "ratings" && seedMatchId ? `/ratings?match=${seedMatchId}` : route;
    const { target, cdp, errors } = await openPage(name === "login" ? "/onboarding" : url);
    try {
      if (name === "login") {
        await sleep(2500);
        await evaluate(
          cdp,
          `(() => {
            localStorage.removeItem("matchday.session");
            sessionStorage.removeItem("matchday.session.session");
            localStorage.setItem("matchday.loggedOut", "1");
          })()`,
        );
        // A hash-only navigate would not remount the SPA (the old user state is
        // still in the query cache), so set the hash and reload for a real boot.
        await evaluate(cdp, `location.hash = "${url}"`);
        await cdp.send("Page.reload", { ignoreCache: false });
      }
      // The dev server compiles route chunks on demand and the API answers
      // behind it; 6s is what the existing ui-audit uses for the same reason.
      await sleep(6500);
      const size = await shoot(cdp, `${SHOTS}/${name}.png`);
      const state = await pageState(cdp);
      manifest.push({ name, route: url, title, blurb, size, shown: state.shown, lang: "en" });
      console.log(
        `[demo] ${name.padEnd(16)} ${url.padEnd(28)} -> ${state.shown} ${size.width}x${size.height} text=${state.textLen}${state.warn ? "  WARN: " + state.warn : ""}${errors.length ? " ERRORS: " + errors.join(" | ") : ""}`,
      );
      if (name === "login") {
        // Give the profile its session back: later passes and the next run must
        // not start signed out.
        await evaluate(cdp, `localStorage.removeItem("matchday.loggedOut")`);
      }
    } catch (e) {
      console.log(`[demo] ${name} FAILED: ${e.message}`);
    }
    cdp.close();
    await closeTarget(target.id);
  }

  // ---- pass 2: Persian re-shots ------------------------------------------
  for (const [name, route, title] of faPages) {
    const { target, cdp, errors } = await openPage(route);
    try {
      await evaluate(cdp, `localStorage.setItem("matchday.lang", "fa")`);
      await cdp.send("Page.reload", { ignoreCache: false });
      await sleep(6500);
      const size = await shoot(cdp, `${SHOTS}/fa-${name}.png`);
      const state = await pageState(cdp);
      manifest.push({ name: `fa-${name}`, route, title, blurb: null, size, shown: state.shown, lang: "fa" });
      console.log(
        `[demo] fa-${name.padEnd(13)} dir=${state.dir} ${size.width}x${size.height} text=${state.textLen}${state.warn ? "  WARN: " + state.warn : ""}${errors.length ? " ERRORS: " + errors.join(" | ") : ""}`,
      );
    } catch (e) {
      console.log(`[demo] fa-${name} FAILED: ${e.message}`);
    }
    cdp.close();
    await closeTarget(target.id);
  }

  // Leave the capture profile in English, so a hand-opened tab (or the next
  // run) does not start in Farsi because pass 2 set the language.
  const reset = await openPage("/table");
  await evaluate(reset.cdp, `localStorage.setItem("matchday.lang", "en")`);
  reset.cdp.close();
  await closeTarget(reset.target.id);

  fs.writeFileSync(`${OUT}/manifest.json`, JSON.stringify(manifest, null, 2));
  writeAlbum(manifest);
  console.log(`[demo] wrote ${OUT}/index.html + ${manifest.length} shots`);
}

/* --------------------------------------------------------------- album UI */

function writeAlbum(manifest) {
  const card = (p) => {
    const kb = Math.round(fs.statSync(`${SHOTS}/${p.name}.png`).size / 1024);
    return `      <figure class="card">
        <figcaption>
          <h2>${p.title}</h2>
          <p class="route">${p.lang === "fa" ? "فارسی · " : ""}${p.route}</p>
          ${p.blurb ? `<p class="blurb">${p.blurb}</p>` : ""}
        </figcaption>
        <div class="frame${p.lang === "fa" ? " rtl" : ""}">
          <img src="shots/${p.name}.png" alt="${p.title}" width="${p.size.width}" height="${p.size.height}" loading="lazy" />
        </div>
        <a class="full" href="shots/${p.name}.png" target="_blank" rel="noreferrer">Open full size · ${p.size.width}×${p.size.height} · ${kb} KB</a>
      </figure>`;
  };

  const en = manifest
    .filter((p) => p.lang === "en")
    .map(card)
    .join("\n");
  const fa = manifest
    .filter((p) => p.lang === "fa")
    .map(card)
    .join("\n");

  fs.writeFileSync(
    `${OUT}/index.html`,
    `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Vkick — every screen except Matchday</title>
<style>
  :root {
    --bg-base: #081613; --bg-surface: #0b1d19; --bg-elevated: #122c25;
    --border-subtle: #1e3b34; --text-primary: #edf7f3; --text-secondary: #93aea6;
    --text-muted: #7b958c; --volt: #1fbfa0; --gold: #f2b705;
  }
  * { box-sizing: border-box; }
  body {
    margin: 0; background: var(--bg-base); color: var(--text-primary);
    font: 15px/1.55 "Vazirmatn", "Archivo", system-ui, sans-serif;
  }
  header {
    position: sticky; top: 0; z-index: 2; padding: 20px 24px 16px;
    background: color-mix(in srgb, var(--bg-base) 92%, transparent);
    border-bottom: 1px solid var(--border-subtle); backdrop-filter: blur(6px);
  }
  h1 { margin: 0 0 4px; font-size: 19px; letter-spacing: -0.01em; }
  .sub { margin: 0; color: var(--text-muted); font-size: 13px; }
  .sub b { color: var(--volt); font-weight: 700; }
  main { padding: 24px; }
  h2.h { font-size: 12px; text-transform: uppercase; letter-spacing: 0.12em;
        color: var(--text-muted); margin: 8px 0 16px; }
  .grid { display: grid; gap: 28px; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); }
  .card { margin: 0; display: flex; flex-direction: column; gap: 12px; }
  figcaption h2 { margin: 0 0 2px; font-size: 16px; }
  .route { margin: 0; font-family: ui-monospace, monospace; font-size: 12px; color: var(--volt); }
  .blurb { margin: 6px 0 0; font-size: 13px; color: var(--text-secondary); }
  .frame {
    border: 1px solid var(--border-subtle); border-radius: 18px; background: var(--bg-surface);
    padding: 8px; overflow: auto; max-height: 620px;
  }
  .frame img { display: block; width: 100%; border-radius: 12px; }
  .frame.rtl { direction: rtl; }
  .full { font-size: 12px; color: var(--text-muted); text-decoration: none;
          border-bottom: 1px dashed var(--border-subtle); align-self: flex-start; }
  .full:hover { color: var(--text-primary); }
  footer { padding: 8px 24px 40px; color: var(--text-muted); font-size: 12px; line-height: 1.9; }
  footer a { color: var(--volt); }
  section + section { margin-top: 40px; }
</style>
</head>
<body>
<header>
  <h1>Vkick — every screen except Matchday</h1>
  <p class="sub"><b>${manifest.length}</b> real screenshots at 390×844 from the running app (local API + SQLite), not mockups. Two screens are left out: the <b>Matchday feed</b> (excluded on request) and <b>/admin</b>, which is operator-only — it redirects any account that is not in the server's admin list, so there is nothing honest to show here.</p>
</header>
<main>
  <section>
    <h2 class="h">English</h2>
    <div class="grid">
${en}
    </div>
  </section>
  <section>
    <h2 class="h">فارسی — RTL</h2>
    <div class="grid">
${fa}
    </div>
  </section>
</main>
<footer>
  Shots taken by <code>scripts/pages-demo.mjs</code> at 390×844 against the app running locally; routes come from <code>src/App.tsx</code>.<br />
  The full source of every screen in this album (except Matchday) lives in <a href="pages-code.md">pages-code.md</a>.
</footer>
</body>
</html>
`,
  );
}

await main();
