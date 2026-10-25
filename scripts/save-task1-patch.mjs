const fs = require("fs");
const path = require("path");

// Write the (currently empty) Task 1 partial diff to .tmp/, CRLF to match repo.
const dir = ".tmp";
if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

const outPath = path.join(dir, "task1-partial.patch");
const content = ""; // git diff src/pages/Matches.tsx is currently clean
fs.writeFileSync(outPath, content, "utf8");
console.log("wrote", outPath, "bytes:", Buffer.byteLength(content, "utf8"));
