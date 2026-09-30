/*
 * Brand asset installer (node scripts/make-icons.cjs).
 * The app ships the official Vkick logo set kept in "vkick logos/" — this
 * script copies each file into public/ under the names index.html and
 * site.webmanifest reference, and removes leftovers from the old generated
 * set. Re-run after replacing any asset in "vkick logos/".
 */
const fs = require("fs");
const path = require("path");

const srcDir = path.join(__dirname, "..", "vkick logos");
const outDir = path.join(__dirname, "..", "public");

/* [source file in "vkick logos/", destination name in public/] */
const ASSETS = [
  ["vkick-mark-teal.svg", "vkick-mark.svg"], // SVG favicon, boot splash, login mark
  ["favicon-16.png", "favicon-16.png"],
  ["favicon-32.png", "favicon-32.png"],
  ["favicon-48.png", "favicon-48.png"],
  ["apple-touch-icon-180.png", "apple-touch-icon.png"],
  ["android-chrome-192.png", "icon-192.png"],
  ["android-chrome-512.png", "icon-512.png"],
  ["android-chrome-512-maskable.png", "icon-512-maskable.png"],
  ["telegram-icon-512.png", "telegram-icon.png"],
];

/* Icons from the old generated set that nothing references any more. */
const STALE = ["boot.svg", "icon-64.png", "icon-180.png"];

fs.mkdirSync(outDir, { recursive: true });

for (const [src, dest] of ASSETS) {
  fs.copyFileSync(path.join(srcDir, src), path.join(outDir, dest));
  console.log(`public/${dest}  <-  vkick logos/${src}`);
}

for (const name of STALE) {
  const file = path.join(outDir, name);
  if (fs.existsSync(file)) {
    fs.rmSync(file);
    console.log(`removed public/${name} (old brand set)`);
  }
}
