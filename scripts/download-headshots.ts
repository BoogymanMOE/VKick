import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';

const execAsync = promisify(exec);

const DB_PATH = path.resolve('data/matchday.db');
const OUT_DIR = path.resolve('public/headshots');
const MISSING_PATH = path.resolve('scripts/headshots-missing.json');

const ESPN_HEADSHOT = (id: string | number) =>
  `https://a.espncdn.com/i/headshots/soccer/players/full/${id}.png`;

const CONCURRENCY = 5;
const TIMEOUT_MS = 12_000;
const RETRIES = 3;
const DELAY_MS = 120;

interface Player {
  id: string;
  name: string;
  league: string;
}

interface MissingEntry {
  id: string;
  name: string;
  league: string;
  probeUrl: string;
  status: number | string;
}

async function bullet(text: string) {
  process.stdout.write(text + '\n');
}

async function sleep(ms: number) {
  return new Promise<void>((r) => setTimeout(r, ms));
}

async function probe(
  url: string,
  timeoutMs = TIMEOUT_MS,
): Promise<{ ok: boolean; status: number }> {
  for (let attempt = 0; attempt <= RETRIES; attempt++) {
    const start = Date.now();
    try {
      const res = await fetch(url, {
        method: 'HEAD',
        headers: { 'user-agent': 'Mozilla/5.0 (compatible; vkick-headshots/1.0)' },
        signal: AbortSignal.timeout(timeoutMs),
      });
      return { ok: res.ok, status: res.status };
    } catch (err: any) {
      if (attempt === RETRIES) {
        return {
          ok: false,
          status: err?.code === 'ABORT_ERR' || err?.name === 'AbortError'
            ? 0
            : -1,
        };
      }
      const waited = Date.now() - start;
      const next = Math.max(500, Math.min(2000, waited));
      await sleep(next);
    }
  }
  return { ok: false, status: -1 };
}

async function downloadBinary(
  url: string,
  timeoutMs = TIMEOUT_MS,
): Promise<Buffer | null> {
  for (let attempt = 0; attempt <= RETRIES; attempt++) {
    const start = Date.now();
    try {
      const res = await fetch(url, {
        headers: { 'user-agent': 'Mozilla/5.0 (compatible; vkick-headshots/1.0)' },
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!res.ok) {
        if (attempt === RETRIES) return null;
        await sleep(Math.max(500, Math.min(2000, Date.now() - start)));
        continue;
      }
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.length === 0) {
        if (attempt === RETRIES) return null;
        await sleep(Math.max(500, Math.min(2000, Date.now() - start)));
        continue;
      }
      return buf;
    } catch (err: any) {
      if (attempt === RETRIES) return null;
      await sleep(Math.max(500, Math.min(2000, Date.now() - start)));
    }
  }
  return null;
}

async function isWebPAlready(bytes: Buffer): Promise<boolean> {
  // webp magic bytes: 52 49 46 37 0D 0A 1A 0A
  return (
    bytes.length >= 12 &&
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x37 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  );
}

async function resizeWebP(srcBytes: Buffer, dstPath: string): Promise<void> {
  // cwebp -quiet -mt -size 160x160 -jpeg_quality 75 -qstamp 1 -o out.webp in.png
  // Fallback: if cwebp absent, write png (we still deliver locally, just bigger).
  const tmp = dstPath + '.tmp.png';
  await writeFile(tmp, srcBytes);

  try {
    const { stdout, stderr } = await execAsync(
      `cwebp -quiet -mt -size 160x160 -jpeg_quality 75 -mt -o "${dstPath}" "${tmp}"`,
      { timeout: 25_000 },
    );
    await fs.promises.rm(tmp, { force: true });
    if (!stdout && !stderr) return;
    bullet(`  cwebp stdout/stderr: ${stdout || stderr}`);
  } catch (err: any) {
    // If cwebp is missing or failed, keep the original PNG — later steps will
    // still serve it locally and it is still better than nothing.
    if (err?.code === 'ENOENT' || /not found|cwebp/.test(String(err))) {
      bullet(`  cwebp not available; keeping original PNG for ${path.basename(dstPath)}`);
      return;
    }
    throw err;
  }
}

async function ensureDir(dir: string) {
  await mkdir(dir, { recursive: true });
}

async function main() {
  bullet(`DB: ${DB_PATH}`);
  bullet(`OUT: ${OUT_DIR}`);
  bullet(`Pattern: ${ESPN_HEADSHOT('000000')}`);
  bullet('');

  await ensureDir(OUT_DIR);

  const db = new DatabaseSync(DB_PATH);
  const rows = db
    .prepare(
      `SELECT p.id, p.full_name, t.league
       FROM players p
       JOIN teams t ON t.id = p.team_id
       WHERE p.active = 1 AND (p.headshot_url IS NULL OR p.headshot_url = '')
       ORDER BY t.league, p.full_name`,
    )
    .all() as Player[];

  bullet(`Active players without stored headshot_url: ${rows.length}`);
  bullet('');

  // Count per league
  const byLeague: Record<string, number> = {};
  for (const r of rows) {
    byLeague[r.league || 'unknown'] = (byLeague[r.league || 'unknown'] ?? 0) + 1;
  }
  bullet('Per league:');
  for (const L of Object.keys(byLeague).sort()) {
    bullet(`  ${L.padEnd(18)} ${byLeague[L]}`);
  }
  bullet('');

  const queue = rows.map((r) => ({ ...r }));
  const workers: Promise<void>[] = [];
  let idx = 0;

  let downloaded = 0;
  let skipped = 0;
  let missing: MissingEntry[] = [];
  let errors = 0;

  async function worker() {
    while (true) {
      const i = idx;
      idx += 1;
      const p = queue[i];
      if (!p) return;

      const playerId = String(p.id);
      const outFile = path.join(OUT_DIR, `${playerId}.webp`);
      const alreadyExists = await fs.promises.stat(outFile).then(
        () => true,
        () => false,
      );

      if (alreadyExists) {
        skipped += 1;
        continue;
      }

      const url = ESPN_HEADSHOT(playerId);
      bullet(
        `[${String(idx).padStart(5)}/${queue.length}] ${p.name.padEnd(30)} ${playerId} — probing ${url}`,
      );

      // 1) Probe with HEAD first (fast, cheap).
      const { ok, status } = await probe(url);
      if (!ok) {
        missing.push({ id: playerId, name: p.name, league: p.league, probeUrl: url, status });
        errors += 1;
        await sleep(DELAY_MS);
        continue;
      }

      // 2) Download binary.
      const bytes = await downloadBinary(url);
      if (!bytes) {
        missing.push({ id: playerId, name: p.name, league: p.league, probeUrl: url, status: -1 });
        errors += 1;
        await sleep(DELAY_MS);
        continue;
      }

      // 3) If already webp, just save.
      if (await isWebPAlready(bytes)) {
        await writeFile(outFile, bytes);
        downloaded += 1;
        bullet(`  -> saved webp ${bytes.length} bytes`);
      } else {
        // 4) Resize to webp.
        try {
          await resizeWebP(bytes, outFile);
          downloaded += 1;
          const after = await fs.promises.stat(outFile);
          bullet(`  -> resized webp ${after.size} bytes`);
        } catch (err) {
          // Leave the tmp file or saved PNG as fallback.
          const tmp = outFile + '.tmp.png';
          try {
            await fs.promises.stat(tmp);
            await fs.promises.rename(tmp, outFile);
            bullet(`  -> kept original PNG (resize failed)`);
          } catch {
            missing.push({ id: playerId, name: p.name, league: p.league, probeUrl: url, status: -2 });
            errors += 1;
          }
        }
      }

      await sleep(DELAY_MS);
    }
  }

  for (let i = 0; i < CONCURRENCY; i++) {
    workers.push(worker());
  }

  await Promise.all(workers);

  // Write missing report (always, even empty, so callers can diff).
  await writeFile(MISSING_PATH, JSON.stringify({ generated: new Date().toISOString(), missing }, null, 2) + '\n');

  bullet('');
  bullet('=== SUMMARY ===');
  bullet(`Total players without stored URL : ${queue.length}`);
  bullet(`Downloaded (saved to public/headshots) : ${downloaded}`);
  bullet(`Skipped (already existed)           : ${skipped}`);
  bullet(`Missing / dead / error              : ${missing.length}  (see ${MISSING_PATH})`);
  bullet(`Errors (unexpected failures)        : ${errors}`);
  bullet('');
  bullet(`Output dir contents: ${OUT_DIR}`);
  const files = await fs.promises.readdir(OUT_DIR);
  bullet(`Files in public/headshots: ${files.length}`);
  const totalBytes = files.reduce((acc, f) => {
    try {
      return acc + fs.statSync(path.join(OUT_DIR, f)).size;
    } catch {
      return acc;
    }
  }, 0);
  bullet(`Total bytes on disk: ${totalBytes.toLocaleString()} (${Math.round(totalBytes / 1024)} KB)`);
}

main().catch((err) => {
  console.error('FATAL:', err);
  process.exit(1);
});
