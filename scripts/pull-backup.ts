import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const BASE = process.env.VICK_API_BASE ?? "https://vkick.onrender.com";
const TOKEN = process.env.VICK_ADMIN_TOKEN ?? "";
const outDir = path.join(ROOT, "backups");
fs.mkdirSync(outDir, { recursive: true });

if (!TOKEN) {
  console.error("Set VICK_ADMIN_TOKEN env var (admin session token).");
  process.exit(1);
}

const res = await fetch(`${BASE}/api/admin/backup/latest`, {
  headers: { authorization: `Bearer ${TOKEN}` },
});
if (!res.ok) {
  console.error("Download failed:", res.status, await res.text());
  process.exit(1);
}
const buf = Buffer.from(await res.arrayBuffer());
const name = res.headers.get("content-disposition")?.match(/filename="([^"]+)"/)?.[1] ?? "matchday.db";
const dest = path.join(outDir, name);
fs.writeFileSync(dest, buf);
console.log("Saved", dest, buf.length, "bytes");
