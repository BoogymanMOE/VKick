import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { mkdir, writeFile } from "node:fs/promises";
import sharp from "sharp";
import { getDb, all } from "../server/db/index.ts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const LOGOS_DIR = path.join(ROOT, "public", "logos");
const UA = "VKickBot/1.0";

async function main() {
  await mkdir(LOGOS_DIR, { recursive: true });
  const db = getDb();
  const teams = all<{ id: string; logo_url: string | null; name: string }>(db, "SELECT id, logo_url, name FROM teams WHERE logo_url IS NOT NULL AND logo_url != ''");
  console.log("teams with logo_url:", teams.length);
  let ok = 0, fail = 0;
  for (const t of teams) {
    const dest = path.join(LOGOS_DIR, `${t.id}.webp`);
    if (fs.existsSync(dest)) { ok++; continue; }
    try {
      const res = await fetch(t.logo_url!, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(20_000) });
      if (!res.ok) { fail++; continue; }
      const buf = Buffer.from(await res.arrayBuffer());
      const webp = await sharp(buf).resize(128, 128, { fit: "inside", withoutEnlargement: true }).webp({ quality: 85 }).toBuffer();
      await writeFile(dest, webp);
      ok++;
    } catch (e) {
      fail++;
      console.error("FAIL", t.id, t.name, String(e));
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  console.log(`logos: ok=${ok} fail=${fail}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
