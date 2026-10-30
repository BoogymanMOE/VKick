import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { mkdir, rename, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const option = (name: string, fallback: string) => {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] ?? fallback : fallback;
};
const DB_PATH = process.env.SQLITE_PATH ?? path.resolve(ROOT, option('--db', 'data/matchday.db'));
const OUT_DIR = path.join(ROOT, 'public/headshots');
const MISSING_PATH = path.join(ROOT, 'scripts/headshots-missing.json');
const MISSING_TMP_PATH = `${MISSING_PATH}.tmp`;
const limitArg = Number(option('--limit', '0'));
const LIMIT = Number.isSafeInteger(limitArg) && limitArg > 0 ? limitArg : null;
const ALL = process.argv.includes('--all');

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
  headshot_url: string | null;
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
    } catch (err: unknown) {
      if (attempt === RETRIES) {
        const code =
          typeof err === 'object' && err !== null && 'code' in err ? err.code : undefined;
        const name = err instanceof Error ? err.name : undefined;
        return {
          ok: false,
          status: code === 'ABORT_ERR' || name === 'AbortError' ? 0 : -1,
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
    } catch {
      if (attempt === RETRIES) return null;
      await sleep(Math.max(500, Math.min(2000, Date.now() - start)));
    }
  }
  return null;
}

async function resizeWebP(srcBytes: Buffer, dstPath: string): Promise<void> {
  const tmpPath = `${dstPath}.tmp`;
  const webp = await sharp(srcBytes)
    .resize(160, 160, { fit: 'inside', withoutEnlargement: true })
    .webp({ quality: 75 })
    .toBuffer();
  await writeFile(tmpPath, webp);
  await rename(tmpPath, dstPath);
}

async function ensureDir(dir: string) {
  await mkdir(dir, { recursive: true });
}

async function main() {
  if (!LIMIT && !ALL) {
    throw new Error('Refusing an unbounded download; pass --limit <count> or explicitly pass --all.');
  }

  bullet(`DB: ${DB_PATH}`);
  bullet(`OUT: ${OUT_DIR}`);
  bullet(`Pattern: ${ESPN_HEADSHOT('000000')}`);
  bullet('');

  await ensureDir(OUT_DIR);

  const db = new DatabaseSync(DB_PATH);
  const allRows = db
    .prepare(
      `SELECT p.id, p.full_name AS name, t.league, p.headshot_url
       FROM players p
       JOIN teams t ON t.id = p.team_id
       WHERE p.active = 1
       ORDER BY (p.headshot_url IS NULL OR p.headshot_url = ''), t.league, p.full_name`,
    )
    .all() as unknown as Player[];
  const rows = LIMIT ? allRows.slice(0, LIMIT) : allRows;

  bullet(`Active players queued for local headshots: ${allRows.length}`);
  if (LIMIT) bullet(`Limited run: processing first ${rows.length} players`);
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
  const missing: MissingEntry[] = [];
  let errors = 0;

  async function worker() {
    while (true) {
      const i = idx;
      idx += 1;
      const p = queue[i];
      if (!p) return;

      const playerId = String(p.id);
      const outFile = path.join(OUT_DIR, `${playerId}.webp`);
      const alreadyExists = await sharp(outFile)
        .metadata()
        .then((metadata) => metadata.format === 'webp', () => false);

      if (alreadyExists) {
        skipped += 1;
        continue;
      }

      const url = p.headshot_url || ESPN_HEADSHOT(playerId);
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

      // 3) Resize and convert to a valid webp regardless of the source format.
      try {
        await resizeWebP(bytes, outFile);
        downloaded += 1;
        const after = await fs.promises.stat(outFile);
        bullet(`  -> resized webp ${after.size} bytes`);
      } catch (err) {
        missing.push({ id: playerId, name: p.name, league: p.league, probeUrl: url, status: -2 });
        errors += 1;
        bullet(`  -> image conversion failed: ${String(err)}`);
      }

      await sleep(DELAY_MS);
    }
  }

  for (let i = 0; i < CONCURRENCY; i++) {
    workers.push(worker());
  }

  await Promise.all(workers);

  // Write the report atomically so interruption never leaves malformed JSON.
  await writeFile(MISSING_TMP_PATH, JSON.stringify({ generated: new Date().toISOString(), missing }, null, 2) + '\n');
  await rename(MISSING_TMP_PATH, MISSING_PATH);

  bullet('');
  bullet('=== SUMMARY ===');
  bullet(`Total active players processed     : ${queue.length}`);
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
