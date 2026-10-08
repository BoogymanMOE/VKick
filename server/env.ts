/**
 * Environment bootstrap shared by every entry point.
 *
 * The API, the CLIs and the backup tool all need the same two things: the
 * project root, and a `.env` file applied to `process.env`.
 *
 * The root is found by walking up to the nearest package.json because source
 * and the emitted build sit at different depths (server/ vs
 * dist-server/server/), so a hardcoded `../..` is wrong for one of them.
 *
 * Real environment variables always win: `loadEnv` only fills keys that are
 * still undefined, so a value set by the shell or the hosting platform is never
 * shadowed by a stale line in the file.
 */
import fs from "node:fs";
import path from "node:path";

/** Nearest ancestor directory containing a package.json (or `start` at the root). */
export function findProjectRoot(start: string): string {
  let dir = start;
  for (;;) {
    if (fs.existsSync(path.join(dir, "package.json"))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) return start; // hit the filesystem root — nothing better to offer
    dir = parent;
  }
}

/** Root of the checkout/build that contains this file. */
export const PROJECT_ROOT = findProjectRoot(import.meta.dirname);

/** Minimal `.env` loader (no dotenv dependency needed). Existing vars win. */
export function loadEnv(): void {
  const envPath = path.join(PROJECT_ROOT, ".env");
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!m) continue;
    const key = m[1] as string;
    let value = m[2] as string;
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = value;
  }
}
