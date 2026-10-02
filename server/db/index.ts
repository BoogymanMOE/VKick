import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";
import { migrate } from "./schema.js";

export type DB = DatabaseSync;

/** Values SQLite can bind — mirrors node:sqlite's SQLInputValue. */
export type BindValue = null | number | bigint | string | Uint8Array;
export type Bindings = BindValue[] | Record<string, BindValue>;

const ROOT = path.resolve(import.meta.dirname, "..", "..");

/** Minimal .env loader (no dotenv dependency needed). */
function loadEnv(): void {
  const envPath = path.join(ROOT, ".env");
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
loadEnv();

let _db: DB | null = null;

export function getDb(): DB {
  if (_db) return _db;
  const file = process.env.SQLITE_PATH || "./data/matchday.db";
  const dir = path.dirname(path.resolve(file));
  fs.mkdirSync(dir, { recursive: true });
  _db = new DatabaseSync(file);
  migrate(_db);
  return _db;
}

/**
 * Prepare + run a statement. `sql` may use either anonymous `?` placeholders
 * with an array of values, or named `:name` placeholders with an object
 * (node:sqlite accepts bare key names for named parameters by default).
 */
export function run(db: DB, sql: string, params: Bindings = []): void {
  const stmt = db.prepare(sql);
  if (Array.isArray(params)) stmt.run(...params);
  else stmt.run(params);
}

export function all<T = Record<string, unknown>>(db: DB, sql: string, params: Bindings = []): T[] {
  const stmt = db.prepare(sql);
  return (Array.isArray(params) ? stmt.all(...params) : stmt.all(params)) as T[];
}

export function get<T = Record<string, unknown>>(db: DB, sql: string, params: Bindings = []): T | undefined {
  const stmt = db.prepare(sql);
  return (Array.isArray(params) ? stmt.get(...params) : stmt.get(params)) as T | undefined;
}

/**
 * Run a function inside a transaction, rolling back on throw. Nested calls
 * run inline inside the outer transaction (SQLite has no auto-savepoints;
 * all tx bodies in this codebase are synchronous, so a depth counter is a
 * reliable nesting detector).
 */
let txDepth = 0;
export function tx<T>(db: DB, fn: () => T): T {
  if (txDepth > 0) return fn();
  db.exec("BEGIN");
  txDepth++;
  try {
    const out = fn();
    txDepth--;
    db.exec("COMMIT");
    return out;
  } catch (err) {
    txDepth--;
    db.exec("ROLLBACK");
    throw err;
  }
}

/** Idempotent insert-or-update used all over the sync layer. */
export function upsert(db: DB, table: string, row: Record<string, BindValue>, conflictKeys: string[]): void {
  const cols = Object.keys(row);
  const updates = cols.filter((c) => !conflictKeys.includes(c));
  const sql = `INSERT INTO ${table} (${cols.join(",")}) VALUES (${cols.map(() => "?").join(",")})
    ON CONFLICT(${conflictKeys.join(",")}) DO UPDATE SET ${updates
      .map((c) => `${c}=excluded.${c}`)
      .join(",")}`;
  db.prepare(sql).run(...Object.values(row));
}

/**
 * Upsert where NULLs in the new row do NOT overwrite existing values
 * (coalesceCols), and '' values do NOT overwrite existing values either
 * (skipEmptyCols) — used for team fields that only some ESPN endpoints
 * provide, and for the domestic-league guard against cup scoreboards.
 */
export function upsertCoalesce(
  db: DB,
  table: string,
  row: Record<string, BindValue>,
  conflictKeys: string[],
  coalesceCols: string[],
  skipEmptyCols: string[] = [],
): void {
  const cols = Object.keys(row);
  const updates = cols.filter((c) => !conflictKeys.includes(c));
  const sql = `INSERT INTO ${table} (${cols.join(",")}) VALUES (${cols.map(() => "?").join(",")})
    ON CONFLICT(${conflictKeys.join(",")}) DO UPDATE SET ${updates
      .map((c) => {
        if (coalesceCols.includes(c)) return `${c}=COALESCE(excluded.${c}, ${table}.${c})`;
        if (skipEmptyCols.includes(c))
          return `${c}=CASE WHEN excluded.${c} = '' THEN ${table}.${c} ELSE excluded.${c} END`;
        return `${c}=excluded.${c}`;
      })
      .join(",")}`;
  db.prepare(sql).run(...Object.values(row));
}
