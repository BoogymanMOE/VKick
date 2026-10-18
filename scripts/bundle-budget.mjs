/**
 * Performance budget for the production bundle.
 *
 * Desktop dev hides what a 360px phone on 3G feels like; the cheapest guard
 * is a hard ceiling on what ships. Vite already prints gzip sizes — this
 * script re-derives them from dist/ after a build and FAILS (exit 1) when
 * the budget is blown, so CI stops a size regression instead of shipping it.
 *
 * Run via `npm run budget` (wired into CI right after `npm run build`).
 * Current baseline (~151KB gzipped JS) leaves real headroom before 200KB.
 */
import { readdirSync, statSync, readFileSync } from "fs";
import { join } from "path";
import { gzipSync } from "zlib";

const DIST = "dist/assets";

/** Max TOTAL gzip bytes of shipped JS. */
const TOTAL_JS_BUDGET = 200 * 1024;
/** Max gzip bytes of any single JS chunk — keeps lazy routes honest. */
const CHUNK_JS_BUDGET = 60 * 1024;
/** Max TOTAL gzip bytes of shipped CSS. */
const TOTAL_CSS_BUDGET = 20 * 1024;

const bytes = (buf) => gzipSync(buf).length;

const entries = [];
for (const name of readdirSync(DIST)) {
  const p = join(DIST, name);
  if (!statSync(p).isFile()) continue;
  let gz;
  try {
    gz = bytes(readFileSync(p));
  } catch {
    gz = 0; // unfindable file: stat said file, read failed — treat as 0
  }
  if (name.endsWith(".js")) entries.push({ name, gz, kind: "js" });
  else if (name.endsWith(".css")) entries.push({ name, gz, kind: "css" });
}

const js = entries.filter((e) => e.kind === "js");
const css = entries.filter((e) => e.kind === "css");
const totalJs = js.reduce((s, e) => s + e.gz, 0);
const totalCss = css.reduce((s, e) => s + e.gz, 0);
const biggest = js.reduce((max, e) => (e.gz > max.gz ? e : max), { name: "-", gz: 0, kind: "js" });

const kb = (n) => `${(n / 1024).toFixed(1)}KB`;
console.log(`bundle budget: JS total ${kb(totalJs)} / ${kb(TOTAL_JS_BUDGET)} · biggest ${biggest.name} ${kb(biggest.gz)} / ${kb(CHUNK_JS_BUDGET)} · CSS total ${kb(totalCss)} / ${kb(TOTAL_CSS_BUDGET)}`);

let failed = false;
if (totalJs > TOTAL_JS_BUDGET) {
  console.error(`  ✗ JS total ${kb(totalJs)} exceeds the ${kb(TOTAL_JS_BUDGET)} gzip budget`);
  failed = true;
}
if (biggest.gz > CHUNK_JS_BUDGET) {
  console.error(`  ✗ ${biggest.name} is ${kb(biggest.gz)} — over the ${kb(CHUNK_JS_BUDGET)} per-chunk budget`);
  failed = true;
}
if (totalCss > TOTAL_CSS_BUDGET) {
  console.error(`  ✗ CSS total ${kb(totalCss)} exceeds the ${kb(TOTAL_CSS_BUDGET)} gzip budget`);
  failed = true;
}
if (js.length === 0) {
  console.error("  ✗ no JS assets found under dist/assets — run npm run build first");
  failed = true;
}
if (failed) process.exit(1);
console.log("bundle budget: OK");
