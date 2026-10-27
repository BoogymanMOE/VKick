import { execSync } from "node:child_process";

/**
 * Build identity for the API process.
 *
 * The server is a separate `tsc -p tsconfig.server.json` pipeline, so Vite's
 * `define` (which only rewrites the client bundle) reaches nothing here — the
 * values have to be resolved at runtime instead. `gitCommitShort` is a
 * deliberate twin of the one in vite.config.ts: same rules, same fallback,
 * but no shared import, because importing the Vite config from server code
 * would drag the client build toolchain into the API.
 *
 * RENDER_GIT_COMMIT is set by Render on every push deploy and is the exact
 * answer; otherwise ask git; a git-less checkout still has to boot, so "dev".
 */
function gitCommitShort(): string {
  if (process.env.RENDER_GIT_COMMIT) return process.env.RENDER_GIT_COMMIT.slice(0, 7);
  try {
    return execSync("git rev-parse --short HEAD", { stdio: ["ignore", "pipe", "ignore"] })
      .toString()
      .trim();
  } catch {
    return "dev";
  }
}

/** Commit the running process was started from. */
export const APP_COMMIT: string = gitCommitShort();

/**
 * Boot time, not build time — the server has no build step that could stamp
 * one in. That is the useful number on this side anyway: it tells you when the
 * process restarted, which is what a deploy actually changes.
 */
export const APP_BUILT_AT: string = new Date().toISOString();
