/**
 * Off-site copy of the nightly backups — push the snapshot into a private
 * GitHub repository using plain git commands.
 *
 * WHY GIT: a private GitHub repo is free and needs no credit card, unlike
 * object storage. The nightly snapshot is copied into the repo's `backups/`
 * folder, committed and pushed, so the off-site copy lives in the same place
 * the source does. The local snapshot stays on the Render disk as the primary
 * copy; this is the disaster-recovery layer for losing that disk.
 *
 * The remote URL (including its credentials) is read from BACKUP_GIT_URL and
 * is never hardcoded. A git identity is supplied per-command via `git -c`, so
 * the commit succeeds on a fresh checkout without mutating the repo's config.
 *
 * FAIL-SAFE BY DESIGN: every failure resolves to a result (it never rejects),
 * so the scheduler can fire-and-forget it. The local snapshot is already on
 * disk before this runs, so a push failure never loses data.
 */
import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

export interface GitBackupConfig {
  url: string;
  repoDir: string;
}

export interface GitBackupResult {
  status: "pushed" | "skipped" | "failed";
  detail?: string;
}

/** Folder inside the repo that holds the pushed snapshots. */
export const BACKUP_FOLDER = "backups";
/** Fixed commit message, so `git log` reads as a backup feed. */
export const COMMIT_MESSAGE = "Nightly DB backup";
/** Identity supplied per-command; git needs *a* name/email to commit. */
const IDENTITY_ARGS = ["-c", "user.name=Vkick Backup", "-c", "user.email=backup@vkick-app.local"];

/** Read the remote URL from the environment (never hardcoded). */
export function readGitBackupConfig(env: NodeJS.ProcessEnv = process.env): GitBackupConfig {
  return {
    url: (env.BACKUP_GIT_URL ?? "").trim(),
    repoDir: process.cwd(),
  };
}

interface GitRun {
  code: number;
  stdout: string;
  stderr: string;
}

function runGit(args: string[], cwd: string, spawnFn: typeof spawn = spawn): Promise<GitRun> {
  return new Promise((resolve) => {
    const child: ChildProcess = spawnFn("git", args, { cwd, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (chunk: Buffer | string) => {
      if (stdout.length < 4000) stdout += chunk.toString();
    });
    child.stderr?.on("data", (chunk: Buffer | string) => {
      if (stderr.length < 4000) stderr += chunk.toString();
    });
    child.on("error", (err: NodeJS.ErrnoException) => {
      resolve({ code: -1, stdout, stderr: err.message });
    });
    child.on("close", (code) => {
      resolve({ code: code ?? -1, stdout, stderr });
    });
  });
}

/** Point `origin` at the configured URL, creating it if this is a fresh clone. */
async function ensureRemote(cfg: GitBackupConfig, spawnFn: typeof spawn): Promise<string | null> {
  const add = await runGit(["remote", "add", "origin", cfg.url], cfg.repoDir, spawnFn);
  if (add.code === 0) return null;
  const set = await runGit(["remote", "set-url", "origin", cfg.url], cfg.repoDir, spawnFn);
  return set.code === 0 ? null : set.stderr.trim().slice(0, 300) || "could not set git remote";
}

/**
 * Copy `snapshotPath` into the repo's `backups/` folder, then `git add`,
 * `git commit` and `git push` it. Resolves — never rejects — so the caller can
 * fire-and-forget without a try/catch.
 */
export async function pushSnapshotToGit(
  snapshotPath: string,
  cfg: GitBackupConfig,
  spawnFn: typeof spawn = spawn,
): Promise<GitBackupResult> {
  try {
    if (!cfg.url) return { status: "skipped", detail: "BACKUP_GIT_URL not set" };
    if (!fs.existsSync(path.join(cfg.repoDir, ".git"))) {
      return { status: "skipped", detail: `no git repo at ${cfg.repoDir}` };
    }

    // Stage the snapshot inside the repo so git can track it.
    const destDir = path.join(cfg.repoDir, BACKUP_FOLDER);
    fs.mkdirSync(destDir, { recursive: true });
    const dest = path.join(destDir, path.basename(snapshotPath));
    fs.copyFileSync(snapshotPath, dest);
    const rel = path.relative(cfg.repoDir, dest).split(path.sep).join("/");

    const remoteErr = await ensureRemote(cfg, spawnFn);
    if (remoteErr) return { status: "failed", detail: remoteErr };

    const add = await runGit([...IDENTITY_ARGS, "add", rel], cfg.repoDir, spawnFn);
    if (add.code !== 0) {
      return { status: "failed", detail: `git add failed: ${add.stderr.trim().slice(0, 300)}` };
    }

    const commit = await runGit([...IDENTITY_ARGS, "commit", "-m", COMMIT_MESSAGE], cfg.repoDir, spawnFn);
    if (commit.code !== 0) {
      // Nothing new to commit (snapshot unchanged) is not a failure.
      if (/nothing to commit/i.test(commit.stderr + commit.stdout)) {
        return { status: "skipped", detail: "nothing to commit" };
      }
      return { status: "failed", detail: `git commit failed: ${commit.stderr.trim().slice(0, 300)}` };
    }

    const push = await runGit([...IDENTITY_ARGS, "push", "origin", "HEAD"], cfg.repoDir, spawnFn);
    if (push.code !== 0) {
      return { status: "failed", detail: `git push failed: ${push.stderr.trim().slice(0, 300)}` };
    }
    return { status: "pushed" };
  } catch (err) {
    return { status: "failed", detail: err instanceof Error ? err.message : String(err) };
  }
}
