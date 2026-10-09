/**
 * Off-site copy of the nightly backups — push `BACKUP_DIR` to Cloudflare R2
 * (any S3-compatible store works) with rclone.
 *
 * WHY rclone: the local snapshots live on the same Render disk as the database,
 * so they die with the disk. rclone is a single static binary, speaks the S3
 * API R2 exposes, and needs no SDK in this repo. It reads its remote from the
 * same `RCLONE_CONFIG_*` environment variables every rclone install already
 * honours, so credentials stay in the dashboard and never land in the tree.
 *
 * FAIL-SAFE BY DESIGN: a missing binary (`rclone` not installed), a bad bucket
 * or an offline night must never take the API down, so every failure resolves
 * to a result and the scheduler just logs it. The local snapshot is already on
 * disk by the time this runs, so an upload failure never loses data.
 */
import { spawn, type ChildProcess } from "node:child_process";

/** Destination when BACKUP_REMOTE is unset — the bucket this app expects. */
export const DEFAULT_REMOTE = "r2:vkick-backups/";

export interface RcloneConfig {
  type: string;
  provider: string;
  accessKeyId: string;
  secretAccessKey: string;
  endpoint: string;
  remote: string;
}

export interface OffsiteResult {
  status: "uploaded" | "skipped" | "failed";
  detail?: string;
}

/** Read the remote config from the environment, trimming empty values. */
export function readRcloneConfig(env: NodeJS.ProcessEnv = process.env): RcloneConfig {
  return {
    type: (env.RCLONE_CONFIG_R2_TYPE ?? "").trim(),
    provider: (env.RCLONE_CONFIG_R2_PROVIDER ?? "").trim(),
    accessKeyId: (env.RCLONE_CONFIG_R2_ACCESS_KEY_ID ?? "").trim(),
    secretAccessKey: (env.RCLONE_CONFIG_R2_SECRET_ACCESS_KEY ?? "").trim(),
    endpoint: (env.RCLONE_CONFIG_R2_ENDPOINT ?? "").trim(),
    remote: (env.BACKUP_REMOTE ?? "").trim() || DEFAULT_REMOTE,
  };
}

/** All five R2 fields must be present before we hand anything to rclone. */
export function offsiteConfigured(cfg: RcloneConfig): boolean {
  return Boolean(cfg.type && cfg.provider && cfg.accessKeyId && cfg.secretAccessKey && cfg.endpoint);
}

/**
 * Upload every file in `dir` to the configured remote. Resolves — never
 * rejects — so a caller can fire-and-forget without a try/catch.
 */
export function uploadBackup(
  dir: string,
  cfg: RcloneConfig,
  spawnFn: typeof spawn = spawn,
): Promise<OffsiteResult> {
  return new Promise((resolve) => {
    if (!offsiteConfigured(cfg)) {
      resolve({ status: "skipped", detail: "R2 rclone config incomplete" });
      return;
    }

    let child: ChildProcess;
    try {
      child = spawnFn("rclone", ["copy", dir, cfg.remote], {
        env: {
          ...process.env,
          RCLONE_CONFIG_R2_TYPE: cfg.type,
          RCLONE_CONFIG_R2_PROVIDER: cfg.provider,
          RCLONE_CONFIG_R2_ACCESS_KEY_ID: cfg.accessKeyId,
          RCLONE_CONFIG_R2_SECRET_ACCESS_KEY: cfg.secretAccessKey,
          RCLONE_CONFIG_R2_ENDPOINT: cfg.endpoint,
        },
        stdio: ["ignore", "ignore", "pipe"],
        windowsHide: true,
      });
    } catch (err) {
      resolve({ status: "failed", detail: err instanceof Error ? err.message : String(err) });
      return;
    }

    let stderr = "";
    child.stderr?.on("data", (chunk: Buffer | string) => {
      if (stderr.length < 4000) stderr += chunk.toString();
    });
    child.on("error", (err: NodeJS.ErrnoException) => {
      if (err.code === "ENOENT") {
        resolve({ status: "skipped", detail: "rclone not installed" });
      } else {
        resolve({ status: "failed", detail: err.message });
      }
    });
    child.on("close", (code) => {
      if (code === 0) {
        resolve({ status: "uploaded" });
      } else {
        const tail = stderr.trim().slice(0, 300);
        resolve({ status: "failed", detail: `rclone exited ${code}${tail ? `: ${tail}` : ""}` });
      }
    });
  });
}
