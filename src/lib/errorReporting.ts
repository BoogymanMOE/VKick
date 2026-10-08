/**
 * Client-side error capture.
 *
 * Two producers feed this: the render ErrorBoundary (a component threw) and the
 * two global browser events (an uncaught `error` or an unhandled promise from
 * anywhere in the app). Both forward a capped payload to POST /api/client-errors
 * so the failure survives in logs/client-errors.log instead of vanishing into a
 * user's console.
 *
 * Reporting must never make things worse, so every path here is best-effort:
 * a failed fetch is swallowed, an empty message is dropped, and repeats of the
 * same error within ten seconds are collapsed — a render loop can otherwise fire
 * this endpoint thousands of times and burn the rate-limit budget in seconds.
 */
import { api } from "./api";

const MAX_MESSAGE = 500;
const MAX_STACK = 2000;
const MAX_URL = 500;
const MAX_SOURCE = 40;
/** Same message+source twice inside this window is one report. */
const DEDUPE_MS = 10_000;

function clip(value: unknown, max: number): string | undefined {
  return typeof value === "string" && value ? value.slice(0, max) : undefined;
}

let lastKey = "";
let lastAt = 0;

/** True when this report should go out (not a duplicate of the last one). */
function shouldSend(key: string): boolean {
  const now = Date.now();
  if (key === lastKey && now - lastAt < DEDUPE_MS) return false;
  lastKey = key;
  lastAt = now;
  return true;
}

export interface ClientErrorInput {
  message: string;
  stack?: string;
  url?: string;
  /** "react-boundary" | "window" | "unhandledrejection". */
  source?: string;
}

/**
 * Send one error report. Safe to call from any context: synchronous, swallows
 * every failure, and no-ops on an empty message or an immediate repeat.
 */
export function reportClientError(input: ClientErrorInput): void {
  const message = typeof input.message === "string" ? input.message.trim() : "";
  if (!message) return;
  const source = input.source ?? "window";
  if (!shouldSend(`${source}:${message}`)) return;
  void api
    .reportClientError({
      message: message.slice(0, MAX_MESSAGE),
      stack: clip(input.stack, MAX_STACK),
      url: clip(input.url, MAX_URL),
      source: clip(source, MAX_SOURCE),
    })
    .catch(() => {
      /* the server may be down; an error report must never surface its own failure */
    });
}

/**
 * Attach the two global listeners. Idempotent per call site — main.tsx calls it
 * once before mount. A no-op outside a browser so importing this module in a
 * test or SSR context stays safe.
 */
export function installErrorReporting(): void {
  if (typeof window === "undefined") return;

  window.addEventListener("error", (event) => {
    const err = event.error as Error | undefined;
    reportClientError({
      message: err?.message ?? event.message ?? "window error",
      stack: err?.stack,
      url: event.filename
        ? `${event.filename}:${event.lineno ?? 0}:${event.colno ?? 0}`
        : window.location.href,
      source: "window",
    });
  });

  window.addEventListener("unhandledrejection", (event) => {
    const reason = event.reason as unknown;
    const err = reason instanceof Error ? reason : undefined;
    reportClientError({
      message: err?.message ?? String(reason),
      stack: err?.stack,
      url: window.location.href,
      source: "unhandledrejection",
    });
  });
}
