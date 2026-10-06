/**
 * Dependency-free gzip for outgoing responses.
 *
 * The stack is deliberately zero-cost/zero-dep (no `compression` package), and
 * the server was sending every bundle raw: `react-*.js` is 158 KB on the wire
 * where the gzipped copy is 52 KB — tripled bytes on exactly the mobile
 * Telegram webview this app ships to. This buffers the response, gzips it when
 * the client asked for gzip and the type is compressible, and otherwise emits
 * the bytes untouched.
 *
 * Buffering (rather than streaming) is a deliberate trade: the largest thing
 * this server serves is a ~160 KB bundle, and it keeps the `write`/`end`
 * interception honest — no partial-flush states to get wrong. Responses are
 * never handed to the client before the headers are final, so `Content-Length`
 * is always the one that matches the bytes on the wire.
 */
import zlib from "node:zlib";
import type { Request, Response, NextFunction } from "express";

/** Below this the RTT dominates: gzipping 300 bytes saves nothing. */
const MIN_BYTES = 1024;

const COMPRESSIBLE = /^(text\/|application\/(javascript|json|manifest\+json|xml)|image\/svg\+xml)/i;

function shouldCompress(res: Response, length: number): boolean {
  if (res.statusCode !== 200 || length < MIN_BYTES) return false;
  if (res.getHeader("content-encoding")) return false;
  return COMPRESSIBLE.test(String(res.getHeader("content-type") ?? ""));
}

export function gzip(req: Request, res: Response, next: NextFunction): void {
  if (req.method !== "GET" && req.method !== "HEAD") return next();

  // Set even when this response ends up uncompressed: a shared cache must be
  // told the bytes depend on Accept-Encoding, or it can hand a gzip body to a
  // client that never asked for one.
  if (!res.hasHeader("Vary")) res.setHeader("Vary", "Accept-Encoding");
  if (!/\bgzip\b/i.test(String(req.headers["accept-encoding"] ?? ""))) return next();

  const write = res.write.bind(res) as unknown as (...args: unknown[]) => boolean;
  const end = res.end.bind(res) as unknown as (...args: unknown[]) => unknown;
  const chunks: Buffer[] = [];

  // encoding/callback args on write are dropped while buffering: nothing that
  // calls this server (express, send) passes either.
  res.write = ((chunk: unknown, ..._rest: unknown[]) => {
    if (chunk) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
    return true; // always "writable": we are buffering, not streaming
  }) as typeof res.write;

  res.end = ((chunk?: unknown, ...rest: unknown[]) => {
    const callback = [chunk, ...rest].find((a) => typeof a === "function") as (() => void) | undefined;
    if (chunk && typeof chunk !== "function") {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
    }
    const body = Buffer.concat(chunks);
    const finish = () => {
      if (callback) callback();
    };

    // Someone flushed headers behind our back (writeHead), or this is a 304 /
    // HEAD / error / non-compressible type: emit exactly what we buffered and
    // let Node own the framing — Content-Length already matches.
    if (res.headersSent || !shouldCompress(res, body.length)) {
      if (body.length > 0) write(body);
      end(finish);
      return res;
    }

    zlib.gzip(body, (err, zipped) => {
      if (err) {
        // Compression failed; the client still gets correct bytes, just bigger.
        write(body);
        end(finish);
        return;
      }
      res.setHeader("Content-Encoding", "gzip");
      res.setHeader("Vary", "Accept-Encoding");
      res.removeHeader("Content-Length");
      res.setHeader("Content-Length", String(zipped.length));
      write(zipped);
      end(finish);
    });
    return res;
  }) as typeof res.end;

  next();
}
