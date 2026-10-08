/**
 * Durable error logs. Console output scrolls away and is lost on a restart, so
 * anything worth investigating has to land in a file on disk. Two separate
 * streams:
 *
 *   logs/server-errors.log  — unhandled API errors (the express error handler)
 *   logs/client-errors.log  — errors reported by the browser (ErrorBoundary +
 *                             window `error` / `unhandledrejection`)
 *
 * Both are size-capped by RETENTION_LOG_KB through the same RotatingLogger the
 * API log uses. Appending must never throw: a logging failure cannot be the
 * thing that takes the process down, so every write is best-effort.
 */
import fs from "node:fs";
import path from "node:path";
import { RotatingLogger, logCapKb } from "../db/retention.js";

/** Walk up to the nearest package.json — the same rule the rest of the app uses. */
function findProjectRoot(start: string): string {
  let dir = start;
  for (;;) {
    if (fs.existsSync(path.join(dir, "package.json"))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) return start;
    dir = parent;
  }
}

const LOGS_DIR = path.join(findProjectRoot(import.meta.dirname), "logs");
try {
  fs.mkdirSync(LOGS_DIR, { recursive: true });
} catch {
  /* read-only checkout: the logger degrades to a no-op below */
}

export const serverErrorLogFile = path.join(LOGS_DIR, "server-errors.log");
export const clientErrorLogFile = path.join(LOGS_DIR, "client-errors.log");

const serverLog = new RotatingLogger(serverErrorLogFile, logCapKb());
const clientLog = new RotatingLogger(clientErrorLogFile, logCapKb());

/** Persist one unhandled API error. Never throws. */
export function logServerError(err: unknown, context?: string): void {
  const detail = err instanceof Error ? `${err.message}${err.stack ? `\n${err.stack}` : ""}` : String(err);
  const line = `${new Date().toISOString()}${context ? ` [${context}]` : ""} ${detail}\n`;
  try {
    serverLog.append(line);
  } catch {
    /* disk full / read-only: console already has it */
  }
}

export interface ClientErrorEntry {
  /** The signed-in user, when the report carried a usable token. */
  userId?: number;
  message: string;
  stack?: string;
  url?: string;
  /** Where it came from: "window" | "unhandledrejection" | "react-boundary". */
  source?: string;
}

/** Persist one browser-reported error. Never throws. */
export function logClientError(entry: ClientErrorEntry): void {
  const parts = [
    new Date().toISOString(),
    `user=${entry.userId ?? "-"}`,
    `source=${entry.source ?? "window"}`,
    `url=${entry.url ?? "-"}`,
    `msg=${entry.message}`,
  ];
  if (entry.stack) parts.push(`stack=${entry.stack}`);
  try {
    clientLog.append(`${parts.join(" ")}\n`);
  } catch {
    /* best effort */
  }
}
